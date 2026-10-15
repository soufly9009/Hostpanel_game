import "server-only"

import { and, desc, eq, gte, inArray } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { logEvent } from "@/lib/discord/logging"
import { db, schema } from "@/lib/db"
import { notify } from "@/lib/notifications"
import { formatInZone, formatUtc } from "@/lib/maintenance/time"
import { minutesLabel } from "@/lib/maintenance/labels"

type Ann = typeof schema.migrationAnnouncements.$inferSelect
type NotifKind = (typeof schema.migrationNotifications.$inferSelect)["kind"]

const TZ = "Europe/Paris"

type R = { ok: true } | { ok: false; error: string }
type Actor = { id: string; email: string }

/* ───────────── Destinataires et texte ───────────── */

/** Pour une annonce VPS : propriétaires + leurs propres VPS (jamais ceux des autres). */
async function vpsRecipients(a: Ann) {
  if (a.serverIds.length === 0) return new Map<string, string[]>()
  const rows = await db
    .select({
      userId: schema.servers.userId,
      name: schema.servers.name,
    })
    .from(schema.servers)
    .where(inArray(schema.servers.id, a.serverIds))
  const map = new Map<string, string[]>()
  for (const r of rows) {
    map.set(r.userId, [...(map.get(r.userId) ?? []), r.name])
  }
  return map
}

function windowText(a: Ann) {
  const end = new Date(a.scheduledAt.getTime() + a.estimatedMinutes * 60_000)
  return `Début prévu : ${formatInZone(a.scheduledAt, TZ)} (${TZ}, ${formatUtc(a.scheduledAt)}). Durée estimée : ${minutesLabel(a.estimatedMinutes)} (fin vers ${formatInZone(end, TZ)}).`
}

/** Texte de l'alerte base de données (modèle demandé). */
export function databaseMessage(a: Ann) {
  return [
    "Une nouvelle migration de base de données est programmée.",
    "Une interruption temporaire du panel peut se produire pendant l'opération.",
    windowText(a),
    a.services.length > 0
      ? `Services concernés : ${a.services.join(", ")}.`
      : "Les services concernés seront indiqués dans cette annonce.",
    a.impact ? `Impact attendu : ${a.impact}.` : null,
  ]
    .filter(Boolean)
    .join(" ")
}

const KIND_TITLE: Record<NotifKind, (a: Ann) => string> = {
  reminder: (a) => `Migration à venir : ${a.title}`,
  update: (a) => `Planning modifié : ${a.title}`,
  started: (a) => `Migration en cours : ${a.title}`,
  completed: (a) => `Migration terminée : ${a.title}`,
  failed: (a) => `Migration échouée : ${a.title}`,
  cancelled: (a) => `Migration annulée : ${a.title}`,
}

/**
 * Envoie une notification d'annonce, au plus une fois par (annonce, type,
 * révision) : l'insertion dans l'historique sert de verrou anti-doublon.
 */
export async function notifyAnnouncement(a: Ann, kind: NotifKind) {
  if (a.status === "draft") return 0

  const claim = await db
    .insert(schema.migrationNotifications)
    .values({ announcementId: a.id, kind, revision: a.revision })
    .onConflictDoNothing()
  if (claim.rowsAffected !== 1) return 0

  let recipients = 0
  const send = async (userId: string, body: string) => {
    const ok = await notify({
      userId,
      dedupeKey: `mig:${a.id}:${kind}:${a.revision}`,
      level: kind === "failed" ? "error" : "warning",
      title: KIND_TITLE[kind](a),
      body: body.slice(0, 600),
      href: "/dashboard",
    })
    if (ok) recipients++
  }

  if (a.kind === "database") {
    const msg = databaseMessage(a)
    // Admins toujours ; clients seulement si l'annonce est publique.
    const users = await db
      .select({ id: schema.users.id, role: schema.users.role })
      .from(schema.users)
    for (const u of users) {
      if (u.role === "admin" || a.isPublic) await send(u.id, msg)
    }
  } else {
    const map = await vpsRecipients(a)
    const nodes =
      a.isPublic && a.sourceNode && a.targetNode
        ? ` Nœud d'origine : ${a.sourceNode} → destination : ${a.targetNode}.`
        : ""
    for (const [userId, names] of map) {
      await send(
        userId,
        `VPS concerné(s) : ${names.join(", ")}. ${windowText(a)}${nodes}${a.impact ? ` Impact attendu : ${a.impact}.` : ""}${a.reason && a.isPublic ? ` Motif : ${a.reason}.` : ""}`
      )
    }
  }

  await db
    .update(schema.migrationNotifications)
    .set({ recipients })
    .where(
      and(
        eq(schema.migrationNotifications.announcementId, a.id),
        eq(schema.migrationNotifications.kind, kind),
        eq(schema.migrationNotifications.revision, a.revision)
      )
    )
  return recipients
}

/* ───────────── Cycle de vie ───────────── */

async function load(id: string) {
  const [a] = await db
    .select()
    .from(schema.migrationAnnouncements)
    .where(eq(schema.migrationAnnouncements.id, id))
  return a ?? null
}

async function move(
  id: string,
  from: Ann["status"][],
  patch: Partial<typeof schema.migrationAnnouncements.$inferInsert>
) {
  const res = await db
    .update(schema.migrationAnnouncements)
    .set(patch)
    .where(
      and(
        eq(schema.migrationAnnouncements.id, id),
        inArray(schema.migrationAnnouncements.status, from)
      )
    )
  return res.rowsAffected === 1
}

export async function scheduleAnnouncement(
  id: string,
  actor: Actor
): Promise<R> {
  const a = await load(id)
  if (!a) return { ok: false, error: "Annonce introuvable" }
  if (a.scheduledAt <= new Date()) {
    return { ok: false, error: "La date prévue est déjà passée." }
  }
  if (a.kind === "vps") {
    if (a.serverIds.length === 0) {
      return { ok: false, error: "Sélectionne au moins un VPS." }
    }
    if (!a.sourceNode || !a.targetNode || a.sourceNode === a.targetNode) {
      return {
        ok: false,
        error: "Nœud d'origine et de destination requis et différents.",
      }
    }
  }
  if (!(await move(id, ["draft"], { status: "scheduled" }))) {
    return { ok: false, error: "Seul un brouillon peut être programmé." }
  }
  void logEvent("info", {
    category: "migration",

    title: "Migration programmée",

    service: "Migration",

    action: "programmée",

    result: "success",

    message: a.title,

    dedupeKey: `migration:${id}:programmée`,
  })
  await logActivity(actor, "Migration programmée", {
    type: "migration",
    id,
    label: a.title,
  })
  // Annonce immédiate (type « update » = première information).
  await notifyAnnouncement({ ...a, status: "scheduled" }, "update")
  return { ok: true }
}

export async function rescheduleAnnouncement(
  id: string,
  scheduledAt: Date,
  estimatedMinutes: number,
  actor: Actor
): Promise<R> {
  const a = await load(id)
  if (!a) return { ok: false, error: "Annonce introuvable" }
  if (!["draft", "scheduled", "notified"].includes(a.status)) {
    return { ok: false, error: "Replanification impossible à ce stade." }
  }
  if (scheduledAt <= new Date()) {
    return { ok: false, error: "La nouvelle date est déjà passée." }
  }
  const res = await db
    .update(schema.migrationAnnouncements)
    .set({
      scheduledAt,
      estimatedMinutes,
      revision: a.revision + 1,
      // Une nouvelle date redevient « programmée » : le rappel sera renvoyé.
      status: a.status === "draft" ? "draft" : "scheduled",
    })
    .where(
      and(
        eq(schema.migrationAnnouncements.id, id),
        inArray(schema.migrationAnnouncements.status, [
          "draft",
          "scheduled",
          "notified",
        ])
      )
    )
  if (res.rowsAffected !== 1)
    return { ok: false, error: "Replanification impossible" }
  const fresh = (await load(id))!
  if (a.status !== "draft") await notifyAnnouncement(fresh, "update")
  void logEvent("info", {
    category: "migration",

    title: "Migration replanifiée",

    service: "Migration",

    action: "replanifiée",

    result: "success",

    message: a.title,

    dedupeKey: `migration:${id}:replanifiée`,
  })
  await logActivity(actor, "Migration replanifiée", {
    type: "migration",
    id,
    label: a.title,
  })
  return { ok: true }
}

export async function startAnnouncement(id: string, actor: Actor): Promise<R> {
  if (!(await move(id, ["scheduled", "notified"], { status: "in_progress" }))) {
    return { ok: false, error: "L'annonce n'est pas programmée." }
  }
  const a = (await load(id))!
  await notifyAnnouncement(a, "started")
  void logEvent("warning", {
    category: "migration",

    title: "Migration démarrée",

    service: "Migration",

    action: "démarrée",

    result: "success",

    message: a.title,

    dedupeKey: `migration:${id}:démarrée`,
  })
  await logActivity(actor, "Migration démarrée", {
    type: "migration",
    id,
    label: a.title,
  })
  return { ok: true }
}

export async function finishAnnouncement(
  id: string,
  success: boolean,
  result: string,
  actor: Actor
): Promise<R> {
  const done = await move(id, ["in_progress", "scheduled", "notified"], {
    status: success ? "completed" : "failed",
    result: result.slice(0, 500),
    finishedAt: new Date(),
  })
  if (!done) return { ok: false, error: "L'annonce n'est pas en cours." }
  const a = (await load(id))!
  await notifyAnnouncement(a, success ? "completed" : "failed")
  void logEvent(success ? "success" : "error", {
    category: "migration",
    title: success ? "Migration terminée" : "Migration échouée",
    service: a.kind === "database" ? "Base de données" : "VPS",
    action: success ? "terminée" : "échouée",
    result: success ? "success" : "failure",
    message: a.title,
    dedupeKey: `migration:${id}:${success ? "ok" : "ko"}`,
  })
  await logActivity(
    actor,
    success ? "Migration terminée" : "Migration échouée",
    {
      type: "migration",
      id,
      label: a.title,
    }
  )
  return { ok: true }
}

export async function cancelAnnouncement(id: string, actor: Actor): Promise<R> {
  const before = await load(id)
  const done = await move(
    id,
    ["draft", "scheduled", "notified", "in_progress"],
    {
      status: "cancelled",
      finishedAt: new Date(),
    }
  )
  if (!done || !before) return { ok: false, error: "Annulation impossible" }
  if (before.status !== "draft") {
    await notifyAnnouncement((await load(id))!, "cancelled")
  }
  void logEvent("warning", {
    category: "migration",

    title: "Migration annulée",

    service: "Migration",

    action: "annulée",

    result: "success",

    message: before.title,

    dedupeKey: `migration:${id}:annulée`,
  })
  await logActivity(actor, "Migration annulée", {
    type: "migration",
    id,
    label: before.title,
  })
  return { ok: true }
}

/* ───────────── Rappels et bannières ───────────── */

/** Envoie les rappels dus et passe l'annonce en « notification envoyée ». */
export async function sendDueMigrationReminders(now = new Date()) {
  const rows = await db
    .select()
    .from(schema.migrationAnnouncements)
    .where(
      and(
        eq(schema.migrationAnnouncements.status, "scheduled"),
        gte(
          schema.migrationAnnouncements.scheduledAt,
          new Date(now.getTime() - 60 * 60_000)
        )
      )
    )
  let sent = 0
  for (const a of rows) {
    const due = a.scheduledAt.getTime() - a.notifyBeforeMinutes * 60_000
    if (now.getTime() < due) continue
    sent += await notifyAnnouncement(a, "reminder")
    await move(a.id, ["scheduled"], { status: "notified" })
  }
  return sent
}

export type AnnouncementBanner = {
  id: string
  kind: "database" | "vps"
  title: string
  status: string
  scheduledAt: string
  estimatedMinutes: number
  message: string
  nodes: string | null
}

/**
 * Annonces à afficher à un utilisateur. Un client ne voit que :
 *  - les migrations de base marquées publiques ;
 *  - les migrations de VPS qui touchent SES propres VPS (nœuds seulement
 *    si l'administrateur les a rendus publics).
 */
export async function announcementBannersFor(user: {
  id: string
  role: "user" | "support" | "admin"
}): Promise<AnnouncementBanner[]> {
  const rows = await db
    .select()
    .from(schema.migrationAnnouncements)
    .where(
      inArray(schema.migrationAnnouncements.status, [
        "scheduled",
        "notified",
        "in_progress",
      ])
    )
    .orderBy(schema.migrationAnnouncements.scheduledAt)
    .limit(20)

  const out: AnnouncementBanner[] = []
  for (const a of rows) {
    if (a.kind === "database") {
      if (user.role !== "admin" && !a.isPublic) continue
      out.push({
        id: a.id,
        kind: "database",
        title: a.title,
        status: a.status,
        scheduledAt: a.scheduledAt.toISOString(),
        estimatedMinutes: a.estimatedMinutes,
        message: databaseMessage(a),
        nodes: null,
      })
      continue
    }
    const mine = (await vpsRecipients(a)).get(user.id)
    if (!mine) continue
    out.push({
      id: a.id,
      kind: "vps",
      title: a.title,
      status: a.status,
      scheduledAt: a.scheduledAt.toISOString(),
      estimatedMinutes: a.estimatedMinutes,
      message: `VPS concerné(s) : ${mine.join(", ")}. ${windowText(a)}${a.impact ? ` Impact attendu : ${a.impact}.` : ""}`,
      nodes:
        a.isPublic && a.sourceNode && a.targetNode
          ? `${a.sourceNode} → ${a.targetNode}`
          : null,
    })
  }
  return out
}

export async function listAnnouncements() {
  return db
    .select()
    .from(schema.migrationAnnouncements)
    .orderBy(desc(schema.migrationAnnouncements.scheduledAt))
    .limit(100)
}

export async function notificationHistory(announcementId: string) {
  return db
    .select()
    .from(schema.migrationNotifications)
    .where(eq(schema.migrationNotifications.announcementId, announcementId))
    .orderBy(desc(schema.migrationNotifications.id))
}
