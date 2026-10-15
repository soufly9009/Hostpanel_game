import "server-only"

import { and, eq, isNotNull, isNull, lte, or } from "drizzle-orm"

import { errorText, logError, logWarning } from "@/lib/discord/logging"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import { destroyServer, setSuspended } from "@/lib/provision"

/**
 * Renouvellement des VPS : chaque VPS a une échéance (RENEW_PERIOD_DAYS, 7 j
 * par défaut). Une vérification (RENEW_CHECK_EVERY_DAYS, 3 j par défaut)
 * suspend ceux dont l'échéance est dépassée.
 */

const DAY = 86_400_000
const JOB = "renewals"

/** Durée d'une période : celle de l'offre si définie, sinon RENEW_PERIOD_DAYS. */
export const periodMs = (periodDays?: number | null) =>
  (periodDays ?? env.RENEW_PERIOD_DAYS) * DAY
export const checkEveryMs = () => env.RENEW_CHECK_EVERY_DAYS * DAY

/** Échéance d'un VPS tout juste créé. */
export const newExpiry = (periodDays?: number | null, from = new Date()) =>
  new Date(from.getTime() + periodMs(periodDays))

/** Plafond : on ne peut pas stocker plus de 2 périodes d'avance. */
export const maxExpiry = (periodDays?: number | null, now = new Date()) =>
  new Date(now.getTime() + 2 * periodMs(periodDays))

/** Date à partir de laquelle un nouveau renouvellement est permis (1 par période). */
export const nextRenewalAt = (
  lastRenewedAt: Date | null,
  periodDays?: number | null
) =>
  lastRenewedAt
    ? new Date(lastRenewedAt.getTime() + periodMs(periodDays))
    : null

/** Prolonge d'une période à partir de l'échéance (ou de maintenant si passée). */
export function extendedExpiry(
  current: Date | null,
  periodDays?: number | null,
  now = new Date()
) {
  const base = current && current > now ? current : now
  const next = new Date(base.getTime() + periodMs(periodDays))
  const cap = maxExpiry(periodDays, now)
  return next > cap ? cap : next
}

export type RenewalResult = {
  ranAt: string
  checked: number
  suspended: number
  deleted: number
  expiringSoon: number
  errors: string[]
}

/**
 * Exécute la vérification si elle est due (ou si `force`). Retourne null si une
 * autre instance l'a déjà exécutée récemment (réservation atomique en base).
 */
export async function runRenewalCheck(
  opts: { force?: boolean } = {}
): Promise<RenewalResult | null> {
  const now = new Date()

  await db.insert(schema.jobRuns).values({ name: JOB }).onConflictDoNothing()

  if (opts.force) {
    await db
      .update(schema.jobRuns)
      .set({ lastRunAt: now })
      .where(eq(schema.jobRuns.name, JOB))
  } else {
    const due = new Date(now.getTime() - checkEveryMs())
    const claim = await db
      .update(schema.jobRuns)
      .set({ lastRunAt: now })
      .where(
        and(
          eq(schema.jobRuns.name, JOB),
          or(
            isNull(schema.jobRuns.lastRunAt),
            lte(schema.jobRuns.lastRunAt, due)
          )
        )
      )
    if (claim.rowsAffected !== 1) return null
  }

  const result: RenewalResult = {
    ranAt: now.toISOString(),
    checked: 0,
    suspended: 0,
    deleted: 0,
    expiringSoon: 0,
    errors: [],
  }

  const rows = await db
    .select()
    .from(schema.servers)
    .where(isNotNull(schema.servers.expiresAt))

  const graceMs = env.RENEW_DELETE_AFTER_DAYS
    ? env.RENEW_DELETE_AFTER_DAYS * DAY
    : null

  for (const s of rows) {
    result.checked++
    const expiresAt = s.expiresAt as Date

    if (expiresAt > now) {
      if (expiresAt.getTime() - now.getTime() <= checkEveryMs()) {
        result.expiringSoon++
      }
      continue
    }

    try {
      let reason = s.suspendReason

      // 1. Échéance dépassée : suspension (sauf si l'admin l'a déjà suspendu).
      if (!s.suspended) {
        await setSuspended(s, true)
        await db
          .update(schema.servers)
          .set({ suspended: true, suspendReason: "expired" })
          .where(eq(schema.servers.id, s.id))
        reason = "expired"
        result.suspended++
        void logWarning({
          category: "renewals",
          title: "VPS suspendu : échéance dépassée",
          service: "VPS client",
          action: "suspension",
          result: "success",
          meta: { vps: s.id },
          dedupeKey: `expired:${s.id}`,
        })
      }

      // 2. Suppression optionnelle après la période de grâce.
      if (
        graceMs !== null &&
        reason === "expired" &&
        expiresAt.getTime() + graceMs <= now.getTime()
      ) {
        await destroyServer(s)
        await db.delete(schema.servers).where(eq(schema.servers.id, s.id))
        result.deleted++
        void logWarning({
          category: "renewals",
          title: "VPS supprimé après la période de grâce",
          service: "VPS client",
          action: "suppression automatique",
          result: "success",
          meta: { vps: s.id },
          dedupeKey: `grace-del:${s.id}`,
        })
      }
    } catch (e) {
      result.errors.push(
        `${s.name} (${s.vmid}) : ${e instanceof Error ? e.message : "erreur"}`
      )
      void logError({
        category: "renewals",
        title: "Échec du traitement d'une échéance",
        service: "VPS client",
        action: "vérification des renouvellements",
        result: "failure",
        message: errorText(e),
        meta: { vps: s.id },
        dedupeKey: `renewal-fail:${s.id}`,
      })
    }
  }

  await db
    .update(schema.jobRuns)
    .set({ lastResult: result })
    .where(eq(schema.jobRuns.name, JOB))

  return result
}

export async function getRenewalStatus() {
  const [row] = await db
    .select()
    .from(schema.jobRuns)
    .where(eq(schema.jobRuns.name, JOB))

  const lastRunAt = row?.lastRunAt ?? null
  return {
    lastRunAt,
    nextRunAt: lastRunAt
      ? new Date(lastRunAt.getTime() + checkEveryMs())
      : null,
    result: (row?.lastResult as RenewalResult | null) ?? null,
    periodDays: env.RENEW_PERIOD_DAYS,
    everyDays: env.RENEW_CHECK_EVERY_DAYS,
    deleteAfterDays: env.RENEW_DELETE_AFTER_DAYS ?? null,
  }
}
