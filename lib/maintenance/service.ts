import "server-only"

import { and, desc, eq, gte, inArray, lte, or } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { logEvent } from "@/lib/discord/logging"
import { db, schema } from "@/lib/db"
import { notify } from "@/lib/notifications"

import { IMPACT_LABEL, MAINTENANCE_TYPE_LABEL, type ServiceKey } from "./labels"
import { formatInZone } from "./time"

type Event = typeof schema.maintenanceEvents.$inferSelect

/* ───────────── Qui est concerné ? ───────────── */

/**
 * Utilisateurs concernés par une maintenance :
 *  - « panel » ou « network » : tous les clients ;
 *  - « vps » : propriétaires de VPS sur les nœuds listés (tous si aucun nœud) ;
 *  - « sites » : propriétaires des sites listés (tous les sites si aucun).
 */
export async function affectedUserIds(event: Event): Promise<Set<string>> {
  const services = new Set(event.services as ServiceKey[])
  const ids = new Set<string>()

  if (services.has("panel") || services.has("network")) {
    const all = await db.select({ id: schema.users.id }).from(schema.users)
    for (const u of all) ids.add(u.id)
    return ids
  }

  if (services.has("vps")) {
    const rows = await db
      .select({ userId: schema.servers.userId, node: schema.servers.node })
      .from(schema.servers)
    for (const r of rows) {
      if (event.nodes.length === 0 || event.nodes.includes(r.node)) {
        ids.add(r.userId)
      }
    }
  }

  if (services.has("sites")) {
    const rows = await db
      .select({ userId: schema.sites.userId, id: schema.sites.id })
      .from(schema.sites)
    for (const r of rows) {
      if (event.siteIds.length === 0 || event.siteIds.includes(r.id)) {
        ids.add(r.userId)
      }
    }
  }
  return ids
}

/** Cet utilisateur est-il concerné ? (pour les bannières) */
export async function isUserAffected(event: Event, userId: string) {
  return (await affectedUserIds(event)).has(userId)
}

/* ───────────── Notifications ───────────── */

type Phase =
  "scheduled" | "reminder" | "update" | "started" | "completed" | "cancelled"

const PHASE_TITLE: Record<Phase, (e: Event) => string> = {
  scheduled: (e) => `Maintenance programmée : ${e.title}`,
  reminder: (e) => `Maintenance bientôt : ${e.title}`,
  update: (e) => `Planning modifié : ${e.title}`,
  started: (e) => `Maintenance en cours : ${e.title}`,
  completed: (e) => `Maintenance terminée : ${e.title}`,
  cancelled: (e) => `Maintenance annulée : ${e.title}`,
}

function bodyFor(e: Event) {
  const when = `${formatInZone(e.startsAt, e.timezone)} → ${formatInZone(e.endsAt, e.timezone)} (${e.timezone})`
  return [when, IMPACT_LABEL[e.impact], e.customerMessage ?? undefined]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 400)
}

/**
 * Notifie les utilisateurs concernés. Clé de déduplication :
 * événement + phase + révision : un même événement n'est jamais renvoyé.
 */
export async function notifyPhase(event: Event, phase: Phase) {
  if (event.status === "draft") return 0
  const users = await affectedUserIds(event)
  let created = 0
  for (const userId of users) {
    const ok = await notify({
      userId,
      dedupeKey: `maint:${event.id}:${phase}:${event.revision}`,
      level:
        phase === "cancelled" || phase === "completed"
          ? "info"
          : event.impact === "full" || event.impact === "partial"
            ? "warning"
            : "info",
      title: PHASE_TITLE[phase](event),
      body: bodyFor(event),
      href: "/dashboard",
    })
    if (ok) created++
  }
  return created
}

/* ───────────── Cycle de vie (toujours explicite) ───────────── */

type R = { ok: true } | { ok: false; error: string }

async function load(id: string) {
  const [e] = await db
    .select()
    .from(schema.maintenanceEvents)
    .where(eq(schema.maintenanceEvents.id, id))
  return e ?? null
}

/** Transition atomique : n'agit que si le statut courant est attendu. */
async function move(
  id: string,
  from: Event["status"][],
  patch: Partial<typeof schema.maintenanceEvents.$inferInsert>
) {
  const res = await db
    .update(schema.maintenanceEvents)
    .set({ ...patch, updatedAt: new Date() })
    .where(
      and(
        eq(schema.maintenanceEvents.id, id),
        inArray(schema.maintenanceEvents.status, from)
      )
    )
  return res.rowsAffected === 1
}

type Actor = { id: string; email: string }

/**
 * Programmer = annoncer. Cela ne déclenche aucune opération système :
 * l'heure de début n'a pour effet que des rappels.
 */
export async function schedule(id: string, actor: Actor): Promise<R> {
  const e = await load(id)
  if (!e) return { ok: false, error: "Maintenance introuvable" }
  if (e.endsAt <= e.startsAt) {
    return { ok: false, error: "La fin doit être après le début." }
  }
  if (e.endsAt <= new Date()) {
    return { ok: false, error: "La fin estimée est déjà passée." }
  }
  const done = await move(id, ["draft"], {
    status: "scheduled",
    publishedAt: e.publishedAt ?? new Date(),
  })
  if (!done)
    return { ok: false, error: "Seul un brouillon peut être programmé." }
  const fresh = (await load(id))!
  await notifyPhase(fresh, "scheduled")
  void logEvent("info", {
    category: "maintenance",

    title: "Maintenance programmée",

    service: "Maintenance",

    action: "programmée",

    result: "success",

    message: e.title,

    dedupeKey: `maintenance:${id}:programmée`,
  })
  await logActivity(actor, "Maintenance programmée", {
    type: "maintenance",
    id,
    label: e.title,
  })
  return { ok: true }
}

export async function start(id: string, actor: Actor): Promise<R> {
  const done = await move(id, ["scheduled"], { status: "in_progress" })
  if (!done) return { ok: false, error: "La maintenance n'est pas programmée." }
  const e = (await load(id))!
  await notifyPhase(e, "started")
  void logEvent("warning", {
    category: "maintenance",

    title: "Maintenance démarrée",

    service: "Maintenance",

    action: "démarrée",

    result: "success",

    message: e.title,

    dedupeKey: `maintenance:${id}:démarrée`,
  })
  await logActivity(actor, "Maintenance démarrée", {
    type: "maintenance",
    id,
    label: e.title,
  })
  return { ok: true }
}

export async function complete(id: string, actor: Actor): Promise<R> {
  const done = await move(id, ["in_progress"], { status: "completed" })
  if (!done) return { ok: false, error: "La maintenance n'est pas en cours." }
  const e = (await load(id))!
  await notifyPhase(e, "completed")
  void logEvent("success", {
    category: "maintenance",

    title: "Maintenance terminée",

    service: "Maintenance",

    action: "terminée",

    result: "success",

    message: e.title,

    dedupeKey: `maintenance:${id}:terminée`,
  })
  await logActivity(actor, "Maintenance terminée", {
    type: "maintenance",
    id,
    label: e.title,
  })
  return { ok: true }
}

export async function cancel(id: string, actor: Actor): Promise<R> {
  const before = await load(id)
  const done = await move(id, ["draft", "scheduled", "in_progress"], {
    status: "cancelled",
  })
  if (!done || !before) {
    return { ok: false, error: "Impossible d'annuler cette maintenance." }
  }
  // Un brouillon n'a jamais été annoncé : rien à notifier.
  if (before.status !== "draft") {
    await notifyPhase((await load(id))!, "cancelled")
  }
  void logEvent("warning", {
    category: "maintenance",

    title: "Maintenance annulée",

    service: "Maintenance",

    action: "annulée",

    result: "success",

    message: before.title,

    dedupeKey: `maintenance:${id}:annulée`,
  })
  await logActivity(actor, "Maintenance annulée", {
    type: "maintenance",
    id,
    label: before.title,
  })
  return { ok: true }
}

/** Change le planning ; la révision augmente → nouvelle notification. */
export async function reschedule(
  id: string,
  startsAt: Date,
  endsAt: Date,
  actor: Actor
): Promise<R> {
  if (endsAt <= startsAt) {
    return { ok: false, error: "La fin doit être après le début." }
  }
  const e = await load(id)
  if (!e) return { ok: false, error: "Maintenance introuvable" }
  if (e.status !== "draft" && e.status !== "scheduled") {
    return {
      ok: false,
      error: "Seule une maintenance non démarrée peut être replanifiée.",
    }
  }
  const res = await db
    .update(schema.maintenanceEvents)
    .set({
      startsAt,
      endsAt,
      revision: e.revision + 1,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(schema.maintenanceEvents.id, id),
        inArray(schema.maintenanceEvents.status, ["draft", "scheduled"])
      )
    )
  if (res.rowsAffected !== 1) {
    return { ok: false, error: "Replanification impossible" }
  }
  if (e.status === "scheduled") {
    await notifyPhase((await load(id))!, "update")
  }
  void logEvent("info", {
    category: "maintenance",

    title: "Maintenance replanifiée",

    service: "Maintenance",

    action: "replanifiée",

    result: "success",

    message: e.title,

    dedupeKey: `maintenance:${id}:replanifiée`,
  })
  await logActivity(actor, "Maintenance replanifiée", {
    type: "maintenance",
    id,
    label: e.title,
  })
  return { ok: true }
}

/* ───────────── Rappels (tâche planifiée) ───────────── */

/** Envoie les rappels dus. N'exécute AUCUNE opération sur l'infrastructure. */
export async function sendDueReminders(now = new Date()) {
  const events = await db
    .select()
    .from(schema.maintenanceEvents)
    .where(
      and(
        eq(schema.maintenanceEvents.status, "scheduled"),
        gte(schema.maintenanceEvents.endsAt, now)
      )
    )
  let sent = 0
  for (const e of events) {
    const due = e.startsAt.getTime() - e.notifyBeforeMinutes * 60_000
    if (now.getTime() >= due) sent += await notifyPhase(e, "reminder")
  }
  return sent
}

/* ───────────── Bannières ───────────── */

export type BannerEvent = {
  id: string
  title: string
  status: "scheduled" | "in_progress"
  type: string
  impact: Event["impact"]
  startsAt: string
  endsAt: string
  timezone: string
  message: string | null
}

/** Maintenances visibles (annoncées ou en cours) qui concernent cet utilisateur. */
export async function bannersFor(userId: string): Promise<BannerEvent[]> {
  const now = new Date()
  const rows = await db
    .select()
    .from(schema.maintenanceEvents)
    .where(
      and(
        inArray(schema.maintenanceEvents.status, ["scheduled", "in_progress"]),
        or(
          eq(schema.maintenanceEvents.status, "in_progress"),
          gte(schema.maintenanceEvents.endsAt, now)
        ),
        or(
          // Annonce visible dès sa programmation ou à la date de publication.
          lte(schema.maintenanceEvents.publishedAt, now),
          eq(schema.maintenanceEvents.status, "in_progress")
        )
      )
    )
    .orderBy(schema.maintenanceEvents.startsAt)
    .limit(20)

  const out: BannerEvent[] = []
  for (const e of rows) {
    if (!(await isUserAffected(e, userId))) continue
    out.push({
      id: e.id,
      title: e.title,
      status: e.status as "scheduled" | "in_progress",
      type: MAINTENANCE_TYPE_LABEL[e.type],
      impact: e.impact,
      startsAt: e.startsAt.toISOString(),
      endsAt: e.endsAt.toISOString(),
      timezone: e.timezone,
      message: e.customerMessage,
    })
  }
  return out
}

export async function listEvents() {
  return db
    .select()
    .from(schema.maintenanceEvents)
    .orderBy(desc(schema.maintenanceEvents.startsAt))
    .limit(200)
}
