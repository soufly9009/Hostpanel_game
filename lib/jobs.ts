import "server-only"

import { and, eq, isNull, isNotNull, lte, or } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import { sendDueReminders } from "@/lib/maintenance/service"
import { sendDueMigrationReminders } from "@/lib/migrations/announcements"
import { notify } from "@/lib/notifications"
import { checkEveryMs } from "@/lib/renewals"
import { inspectCertificate, EXPIRING_DAYS } from "@/lib/sites/ssl"
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
} from "@/lib/proxmox/snapshots"

const DAY = 86_400_000

/** Réserve atomiquement l'exécution d'une tâche (même mécanisme que les renouvellements). */
export async function claim(name: string, everyMs: number) {
  const now = new Date()
  await db.insert(schema.jobRuns).values({ name }).onConflictDoNothing()
  const res = await db
    .update(schema.jobRuns)
    .set({ lastRunAt: now })
    .where(
      and(
        eq(schema.jobRuns.name, name),
        or(
          isNull(schema.jobRuns.lastRunAt),
          lte(schema.jobRuns.lastRunAt, new Date(now.getTime() - everyMs))
        )
      )
    )
  return res.rowsAffected === 1
}

async function saveResult(name: string, result: unknown) {
  await db
    .update(schema.jobRuns)
    .set({ lastResult: result })
    .where(eq(schema.jobRuns.name, name))
}

/* ───────────── Snapshots automatiques (quotidien) ───────────── */

export async function runAutoSnapshots() {
  if (!(await claim("snapshots", DAY - 60_000))) return null

  const servers = await db
    .select()
    .from(schema.servers)
    .where(
      and(
        eq(schema.servers.autoSnapshot, true),
        eq(schema.servers.suspended, false)
      )
    )

  const day = new Date().toISOString().slice(0, 10).replace(/-/g, "")
  const result = {
    checked: servers.length,
    created: 0,
    pruned: 0,
    errors: [] as string[],
  }

  for (const s of servers) {
    try {
      const existing = await listSnapshots(s.node, s.virt, s.vmid)
      const name = `auto-${day}`
      if (!existing.some((x) => x.name === name)) {
        await createSnapshot(
          s.node,
          s.virt,
          s.vmid,
          name,
          "Snapshot automatique"
        )
        result.created++
      }
      const autos = existing
        .filter((x) => x.auto && x.name !== name)
        .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
      // On garde (KEEP - 1) anciens + celui du jour.
      for (const old of autos.slice(Math.max(env.SNAPSHOT_AUTO_KEEP - 1, 0))) {
        await deleteSnapshot(s.node, s.virt, s.vmid, old.name)
        result.pruned++
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "erreur"
      result.errors.push(`${s.name} (${s.vmid}) : ${msg}`)
      await notify({
        userId: s.userId,
        dedupeKey: `snapfail:${s.id}:${day}`,
        level: "warning",
        title: `Snapshot automatique échoué : ${s.name}`,
        body: msg.slice(0, 200),
        href: `/servers/${s.id}`,
      })
    }
  }

  await saveResult("snapshots", result)
  return result
}

/* ───────────── Notifications (échéances, certificats) ───────────── */

export async function runNotificationChecks() {
  if (!(await claim("notifications", 6 * 3_600_000))) return null

  const now = Date.now()
  const result = { created: 0, errors: [] as string[] }
  const add = async (n: Parameters<typeof notify>[0]) => {
    if (await notify(n)) result.created++
  }

  const servers = await db
    .select()
    .from(schema.servers)
    .where(isNotNull(schema.servers.expiresAt))

  for (const s of servers) {
    const exp = s.expiresAt!.getTime()
    const day = s.expiresAt!.toISOString().slice(0, 10)
    if (exp <= now) {
      await add({
        userId: s.userId,
        dedupeKey: `expired:${s.id}:${day}`,
        level: "error",
        title: `${s.name} a expiré`,
        body: "Renouvelle le VPS pour le réactiver.",
        href: `/servers/${s.id}`,
      })
    } else if (exp - now <= checkEveryMs()) {
      await add({
        userId: s.userId,
        dedupeKey: `renew:${s.id}:${day}`,
        level: "warning",
        title: `${s.name} expire bientôt`,
        body: `Échéance le ${s.expiresAt!.toLocaleDateString("fr-FR")}.`,
        href: `/servers/${s.id}`,
      })
    }
  }

  const sites = await db.select().from(schema.sites)
  // Sondes TLS : 4 en parallèle maximum.
  for (let i = 0; i < sites.length; i += 4) {
    await Promise.all(
      sites.slice(i, i + 4).map(async (site) => {
        try {
          const cert = await inspectCertificate(site.domain)
          if (cert.state === "expired" || cert.state === "expiring") {
            await add({
              userId: site.userId,
              dedupeKey: `cert:${site.id}:${cert.validTo?.slice(0, 10)}:${cert.state}`,
              level: cert.state === "expired" ? "error" : "warning",
              title:
                cert.state === "expired"
                  ? `Certificat expiré : ${site.domain}`
                  : `Certificat à renouveler : ${site.domain}`,
              body:
                cert.state === "expiring"
                  ? `Il reste ${cert.daysLeft} jour(s) (seuil ${EXPIRING_DAYS} j).`
                  : undefined,
              href: `/sites/${site.id}`,
            })
          }
        } catch (e) {
          result.errors.push(
            `${site.domain} : ${e instanceof Error ? e.message : "erreur"}`
          )
        }
      })
    )
  }

  await saveResult("notifications", result)
  return result
}

/* ───────────── Rappels de maintenance et de migration ───────────── */

/**
 * Envoie des notifications uniquement. Aucune opération système ni migration
 * n'est déclenchée par l'arrivée d'une date.
 */
export async function runAnnouncementReminders() {
  if (!(await claim("announcements", 10 * 60_000))) return null
  const result = {
    maintenance: await sendDueReminders(),
    migrations: await sendDueMigrationReminders(),
  }
  await saveResult("announcements", result)
  return result
}
