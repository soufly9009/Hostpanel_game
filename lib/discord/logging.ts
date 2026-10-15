import "server-only"

import { createHash, randomBytes } from "node:crypto"

import { and, asc, desc, eq, gte, isNull, lte, or, sql } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"

import { buildPayload, LEVEL_RANK, type Level } from "./embed"
import { redactMeta, redactText, safeErrorMessage } from "./redact"
import { getDiscordSettings } from "./settings"
import { postToWebhook, webhookConfigured } from "./webhook"

/**
 * Journal central des événements + file de livraison Discord.
 *
 * - Chaque événement est écrit localement (system_events) AVANT tout envoi.
 * - L'envoi est asynchrone, jamais bloquant, jamais fatal.
 * - La ligne en base sert de file persistante : un redémarrage ne perd rien.
 * - Ce module ne s'appelle jamais lui-même : un échec Discord met seulement à
 *   jour la ligne concernée (pas de boucle de notification).
 */

export type LogInput = {
  category: (typeof schema.EVENT_CATEGORIES)[number]
  title: string
  message?: string | null
  service?: string
  action?: string
  result?: "success" | "failure" | "info"
  correlationId?: string
  meta?: Record<string, unknown>
  /** Regroupe les répétitions d'un même événement (ex. `start:${serverId}`). */
  dedupeKey?: string
  /** Fenêtre de déduplication (ms). Défaut : 10 min (≥ warning), sinon aucune. */
  dedupeWindowMs?: number
  /** false : enregistré localement, jamais envoyé à Discord. */
  discord?: boolean
}

/* ───────────── Constantes ───────────── */

const MAX_SENDS_PER_MINUTE = 20
const MAX_ATTEMPTS = 6
const BACKOFF_BASE_MS = 30_000
const BACKOFF_MAX_MS = 30 * 60_000
/** Un événement non critique en attente depuis plus longtemps est abandonné. */
const STALE_MS = 24 * 3_600_000
const DEFAULT_DEDUPE_MS = 10 * 60_000

/* ───────────── Utilitaires ───────────── */

export const newCorrelationId = () => randomBytes(4).toString("hex")

/** Valeurs secrètes de l'environnement, masquées partout où elles apparaîtraient. */
function secretValues() {
  return [
    env.PROXMOX_TOKEN_SECRET,
    env.PLESK_API_KEY,
    env.DISCORD_LOG_WEBHOOK_URL,
    env.ADMIN_TOKEN,
    env.CRON_SECRET,
    env.PROXMOX_SSH_PASSWORD,
    env.PROXMOX_SSH_PRIVATE_KEY,
    env.DATABASE_AUTH_TOKEN,
  ].filter((v): v is string => typeof v === "string" && v.length > 0)
}

const clean = (s: string | null | undefined, max: number) =>
  s ? redactText(s, { secrets: secretValues(), maxLength: max }) : null

/** Message d'erreur sûr (sans pile, sans secret). */
export function errorText(e: unknown) {
  return safeErrorMessage(e, { secrets: secretValues() })
}

function fingerprint(i: LogInput, level: Level) {
  const basis =
    i.dedupeKey ??
    // sans clé explicite : message normalisé (chiffres/ids retirés)
    (i.message ?? i.title).toLowerCase().replace(/[0-9a-f-]{6,}|\d+/g, "#")
  return createHash("sha1")
    .update(
      `${i.category}|${i.action ?? ""}|${level}|${i.result ?? ""}|${basis}`
    )
    .digest("hex")
    .slice(0, 20)
}

function publicLink(correlationId: string | null) {
  if (!env.PANEL_PUBLIC_URL) return null
  const base = `${env.PANEL_PUBLIC_URL}/admin/events`
  return correlationId ? `${base}?ref=${correlationId}` : base
}

/* ───────────── Enregistrement ───────────── */

export async function logEvent(level: Level, input: LogInput) {
  try {
    const correlationId = input.correlationId ?? newCorrelationId()
    const fp = fingerprint(input, level)
    const windowMs =
      input.dedupeWindowMs ??
      (input.dedupeKey || LEVEL_RANK[level] >= 1 ? DEFAULT_DEDUPE_MS : 0)

    // Déduplication : on incrémente le compteur de l'événement d'origine.
    if (windowMs > 0) {
      const since = new Date(Date.now() - windowMs)
      const [existing] = await db
        .select({ id: schema.systemEvents.id })
        .from(schema.systemEvents)
        .where(
          and(
            eq(schema.systemEvents.fingerprint, fp),
            gte(schema.systemEvents.createdAt, since)
          )
        )
        .orderBy(desc(schema.systemEvents.id))
        .limit(1)
      if (existing) {
        await db
          .update(schema.systemEvents)
          .set({ occurrences: sql`${schema.systemEvents.occurrences} + 1` })
          .where(eq(schema.systemEvents.id, existing.id))
        return { id: existing.id, correlationId, deduplicated: true as const }
      }
    }

    const settings = await getDiscordSettings()
    const wantsDiscord =
      input.discord !== false &&
      settings.enabled &&
      webhookConfigured() &&
      // success partage le rang d'info : « info » = tout, sinon filtré par rang
      LEVEL_RANK[level] >= LEVEL_RANK[settings.minLevel] &&
      settings.categories.includes(input.category)

    const [row] = await db
      .insert(schema.systemEvents)
      .values({
        level,
        category: input.category,
        service: clean(input.service, 80),
        action: clean(input.action, 80),
        result: input.result ?? "info",
        title: clean(input.title, 200) ?? "Événement",
        message: clean(input.message, 1000),
        correlationId,
        meta: redactMeta(input.meta, { secrets: secretValues() }),
        fingerprint: fp,
        discordState: wantsDiscord ? "pending" : "skipped",
      })
      .returning({ id: schema.systemEvents.id })

    if (wantsDiscord) {
      // Envoi immédiat, en arrière-plan : n'attend jamais Discord.
      void deliver(row.id).catch(() => {})
    }
    return { id: row.id, correlationId, deduplicated: false as const }
  } catch {
    // La supervision ne doit jamais faire échouer l'opération métier.
    return null
  }
}

export const logInfo = (i: LogInput) => logEvent("info", i)
export const logSuccess = (i: LogInput) => logEvent("success", i)
export const logWarning = (i: LogInput) => logEvent("warning", i)
export const logError = (i: LogInput) => logEvent("error", i)
export const logCritical = (i: LogInput) => logEvent("critical", i)

/** Déclenche immédiatement la livraison d'un événement déjà enregistré. */
export const notifyDiscord = (eventId: number) => deliver(eventId)

/* ───────────── Livraison ───────────── */

const backoff = (attempt: number) =>
  Math.min(BACKOFF_BASE_MS * 2 ** Math.max(attempt - 1, 0), BACKOFF_MAX_MS)

type Outcome = "sent" | "retry" | "failed" | "skipped" | "rate_limited"

/** Les envois passent un par un : le plafond par minute reste exact. */
const gq = globalThis as unknown as { __discordChain?: Promise<unknown> }
function deliver(id: number): Promise<Outcome> {
  const run = (gq.__discordChain ?? Promise.resolve()).then(
    () => deliverNow(id),
    () => deliverNow(id)
  )
  gq.__discordChain = run.catch(() => undefined)
  return run
}

/** Les dates sont stockées à la seconde : on arrondit au-dessus (jamais avant l'échéance). */
const at = (ms: number) => new Date(Math.ceil(ms / 1000) * 1000)

async function deliverNow(id: number): Promise<Outcome> {
  const now = new Date()

  // Réservation atomique : une seule livraison simultanée par événement.
  const claim = await db
    .update(schema.systemEvents)
    .set({ discordNextAttemptAt: at(now.getTime() + 60_000) })
    .where(
      and(
        eq(schema.systemEvents.id, id),
        eq(schema.systemEvents.discordState, "pending"),
        or(
          isNull(schema.systemEvents.discordNextAttemptAt),
          lte(schema.systemEvents.discordNextAttemptAt, now)
        )
      )
    )
  if (claim.rowsAffected !== 1) return "skipped"

  const [ev] = await db
    .select()
    .from(schema.systemEvents)
    .where(eq(schema.systemEvents.id, id))
  if (!ev) return "skipped"

  // Événement trop ancien : abandon explicite (pas de rafale tardive).
  if (
    ev.level !== "critical" &&
    now.getTime() - ev.createdAt.getTime() > STALE_MS
  ) {
    await db
      .update(schema.systemEvents)
      .set({ discordState: "failed", discordLastError: "Expiré avant envoi" })
      .where(eq(schema.systemEvents.id, id))
    return "failed"
  }

  // Limitation globale : on laisse en attente, le flusher reprendra.
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.systemEvents)
    .where(
      and(
        eq(schema.systemEvents.discordState, "sent"),
        gte(schema.systemEvents.discordSentAt, new Date(now.getTime() - 60_000))
      )
    )
  if (Number(n) >= MAX_SENDS_PER_MINUTE) {
    await db
      .update(schema.systemEvents)
      .set({ discordNextAttemptAt: at(now.getTime() + 30_000) })
      .where(eq(schema.systemEvents.id, id))
    return "rate_limited"
  }

  const payload = buildPayload({
    level: ev.level,
    category: ev.category,
    title: ev.title,
    message: ev.message,
    service: ev.service,
    action: ev.action,
    result: ev.result,
    correlationId: ev.correlationId,
    occurrences: ev.occurrences,
    meta: ev.meta,
    createdAt: ev.createdAt,
    url: publicLink(ev.correlationId),
  })

  const res = await postToWebhook(payload)
  const attempts = ev.discordAttempts + 1

  if (res.ok) {
    await db
      .update(schema.systemEvents)
      .set({
        discordState: "sent",
        discordAttempts: attempts,
        discordSentAt: new Date(),
        discordNextAttemptAt: null,
        discordLastError: null,
      })
      .where(eq(schema.systemEvents.id, id))
    return "sent"
  }

  if (res.kind === "rate_limited") {
    // On respecte Retry-After ; la tentative ne compte pas comme un échec.
    await db
      .update(schema.systemEvents)
      .set({
        discordNextAttemptAt: at(Date.now() + (res.retryAfter ?? 5) * 1000),
        discordLastError: `Limite Discord (réessai dans ${res.retryAfter ?? 5} s)`,
      })
      .where(eq(schema.systemEvents.id, id))
    return "rate_limited"
  }

  const permanent =
    res.kind === "rejected" ||
    res.kind === "invalid_url" ||
    res.kind === "not_configured"
  if (permanent || attempts >= MAX_ATTEMPTS) {
    await db
      .update(schema.systemEvents)
      .set({
        discordState: "failed",
        discordAttempts: attempts,
        discordNextAttemptAt: null,
        discordLastError: res.detail.slice(0, 200),
      })
      .where(eq(schema.systemEvents.id, id))
    return "failed"
  }

  // Erreur temporaire : réessai avec temporisation progressive.
  await db
    .update(schema.systemEvents)
    .set({
      discordAttempts: attempts,
      discordNextAttemptAt: at(Date.now() + backoff(attempts)),
      discordLastError: res.detail.slice(0, 200),
    })
    .where(eq(schema.systemEvents.id, id))
  return "retry"
}

const g = globalThis as unknown as { __discordFlushing?: boolean }

/**
 * Traite la file : critiques d'abord, au plus `limit` événements par passage.
 * Appelée périodiquement par le planificateur et au démarrage (reprise).
 */
export async function flushPending(limit = 10) {
  if (g.__discordFlushing) return { processed: 0, sent: 0 }
  if (!webhookConfigured()) return { processed: 0, sent: 0 }
  g.__discordFlushing = true
  try {
    const now = new Date()
    const rows = await db
      .select({ id: schema.systemEvents.id, level: schema.systemEvents.level })
      .from(schema.systemEvents)
      .where(
        and(
          eq(schema.systemEvents.discordState, "pending"),
          or(
            isNull(schema.systemEvents.discordNextAttemptAt),
            lte(schema.systemEvents.discordNextAttemptAt, now)
          )
        )
      )
      .orderBy(asc(schema.systemEvents.id))
      .limit(100)

    // Critiques et erreurs d'abord.
    rows.sort(
      (a, b) => LEVEL_RANK[b.level as Level] - LEVEL_RANK[a.level as Level]
    )

    let processed = 0
    let sent = 0
    for (const r of rows.slice(0, limit)) {
      const out = await deliver(r.id)
      processed++
      if (out === "sent") sent++
      // Discord demande de ralentir : on s'arrête, le prochain passage reprendra.
      if (out === "rate_limited") break
    }
    return { processed, sent }
  } finally {
    g.__discordFlushing = false
  }
}

/* ───────────── Statistiques (page d'administration) ───────────── */

export async function deliveryStats() {
  const rows = await db
    .select({
      state: schema.systemEvents.discordState,
      n: sql<number>`count(*)`,
    })
    .from(schema.systemEvents)
    .groupBy(schema.systemEvents.discordState)
  const by: Record<string, number> = {}
  for (const r of rows) by[r.state] = Number(r.n)

  const [last] = await db
    .select({
      createdAt: schema.systemEvents.createdAt,
      title: schema.systemEvents.title,
    })
    .from(schema.systemEvents)
    .orderBy(desc(schema.systemEvents.id))
    .limit(1)

  const [lastSent] = await db
    .select({ at: schema.systemEvents.discordSentAt })
    .from(schema.systemEvents)
    .where(eq(schema.systemEvents.discordState, "sent"))
    .orderBy(desc(schema.systemEvents.id))
    .limit(1)

  const [lastFail] = await db
    .select({
      err: schema.systemEvents.discordLastError,
      at: schema.systemEvents.createdAt,
    })
    .from(schema.systemEvents)
    .where(eq(schema.systemEvents.discordState, "failed"))
    .orderBy(desc(schema.systemEvents.id))
    .limit(1)

  return {
    pending: by.pending ?? 0,
    sent: by.sent ?? 0,
    failed: by.failed ?? 0,
    skipped: by.skipped ?? 0,
    lastEventAt: last?.createdAt ?? null,
    lastSentAt: lastSent?.at ?? null,
    lastFailure: lastFail?.err ?? null,
  }
}

/** Purge les événements locaux anciens (90 jours). */
export async function purgeOldEvents() {
  await db
    .delete(schema.systemEvents)
    .where(
      lte(schema.systemEvents.createdAt, new Date(Date.now() - 90 * 86_400_000))
    )
}
