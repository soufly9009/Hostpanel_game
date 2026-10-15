"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { zonedToUtc } from "@/lib/maintenance/time"

import {
  cancelAnnouncement,
  finishAnnouncement,
  rescheduleAnnouncement,
  scheduleAnnouncement,
  startAnnouncement,
} from "./announcements"
import { applyPendingMigrations } from "./deploy"

export type MigState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const TZ = "Europe/Paris"

const checkbox = z
  .union([z.literal("on"), z.literal("")])
  .optional()
  .transform((v) => v === "on")

const schemaCreate = z.object({
  kind: z.enum(["database", "vps"]),
  title: z.string().trim().min(3, "Titre trop court").max(120),
  scheduledAt: z.string().min(1, "Date requise"),
  estimatedMinutes: z.coerce
    .number()
    .int()
    .min(1)
    .max(60 * 24),
  impact: z.string().trim().max(300).optional(),
  services: z.string().trim().max(300).optional(),
  reason: z.string().trim().max(300).optional(),
  sourceNode: z.string().trim().max(60).optional(),
  targetNode: z.string().trim().max(60).optional(),
  notifyBeforeMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14),
  isPublic: checkbox,
})

function refresh() {
  revalidatePath("/admin/migrations")
  revalidatePath("/admin")
  revalidatePath("/dashboard")
}

export async function createAnnouncement(
  _prev: MigState,
  formData: FormData
): Promise<MigState> {
  const admin = await requireAdmin()
  const parsed = schemaCreate.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: `${i?.path.join(".")} : ${i?.message}` }
  }
  const d = parsed.data

  const when = zonedToUtc(d.scheduledAt, TZ)
  if (!when) return { error: "Date invalide" }

  const serverIds =
    d.kind === "vps"
      ? formData
          .getAll("serverIds")
          .map(String)
          .filter((s) => s && s.length <= 64)
          .slice(0, 200)
      : []
  if (d.kind === "vps") {
    if (serverIds.length === 0) return { error: "Sélectionne au moins un VPS." }
    if (!d.sourceNode || !d.targetNode) {
      return { error: "Nœud d'origine et nœud de destination requis." }
    }
    if (d.sourceNode === d.targetNode) {
      return {
        error: "Les nœuds d'origine et de destination doivent différer.",
      }
    }
  }

  const [row] = await db
    .insert(schema.migrationAnnouncements)
    .values({
      kind: d.kind,
      title: d.title,
      scheduledAt: when,
      estimatedMinutes: d.estimatedMinutes,
      impact: d.impact || null,
      services: (d.services ?? "")
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .slice(0, 20),
      reason: d.reason || null,
      sourceNode: d.kind === "vps" ? d.sourceNode || null : null,
      targetNode: d.kind === "vps" ? d.targetNode || null : null,
      serverIds,
      isPublic: d.isPublic,
      notifyBeforeMinutes: d.notifyBeforeMinutes,
      createdBy: admin.email,
    })
    .returning({ id: schema.migrationAnnouncements.id })

  await logActivity(admin, "Annonce de migration créée (brouillon)", {
    type: "migration",
    id: row.id,
    label: d.title,
  })
  refresh()
  return { ok: true, notice: "Brouillon créé. Programme-le pour notifier." }
}

export async function announcementTransition(
  id: string,
  action: "schedule" | "start" | "complete" | "fail" | "cancel"
): Promise<MigState> {
  const admin = await requireAdmin()
  const aid = z.string().min(1).max(64).parse(id)
  const res =
    action === "schedule"
      ? await scheduleAnnouncement(aid, admin)
      : action === "start"
        ? await startAnnouncement(aid, admin)
        : action === "complete"
          ? await finishAnnouncement(aid, true, "Terminée manuellement.", admin)
          : action === "fail"
            ? await finishAnnouncement(
                aid,
                false,
                "Marquée échouée manuellement.",
                admin
              )
            : await cancelAnnouncement(aid, admin)
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function rescheduleAnnouncementAction(
  id: string,
  local: string,
  minutes: number
): Promise<MigState> {
  const admin = await requireAdmin()
  const when = zonedToUtc(local, TZ)
  const m = z
    .number()
    .int()
    .min(1)
    .max(60 * 24)
    .safeParse(minutes)
  if (!when || !m.success) return { error: "Date ou durée invalide" }
  const res = await rescheduleAnnouncement(
    z.string().min(1).max(64).parse(id),
    when,
    m.data,
    admin
  )
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

/* ───────────── Déploiement des migrations SQL ───────────── */

const deploySchema = z.object({
  tags: z.string().min(1),
  confirm: z.literal("APPLIQUER", { error: "Tape APPLIQUER pour confirmer." }),
  allowDestructive: checkbox,
  announcementId: z.string().max(64).optional(),
})

export async function deployMigrations(
  _prev: MigState,
  formData: FormData
): Promise<MigState> {
  const admin = await requireAdmin()
  const parsed = deploySchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const d = parsed.data

  await logActivity(admin, "Déploiement de migrations lancé", {
    type: "migration",
  })
  const res = await applyPendingMigrations({
    actor: admin.email,
    expectedTags: d.tags.split(",").filter(Boolean),
    allowDestructive: d.allowDestructive,
    announcementId: d.announcementId || null,
  })
  refresh()
  if (!res.ok) {
    await logActivity(admin, `Déploiement refusé/échoué : ${res.code}`, {
      type: "migration",
    })
    return { error: res.error }
  }
  await logActivity(admin, `Migrations appliquées (${res.applied.length})`, {
    type: "migration",
  })
  return {
    ok: true,
    notice: `${res.applied.length} migration(s) appliquée(s) et vérifiée(s)${
      res.backup
        ? ` · sauvegarde : ${res.backup}`
        : res.backupNote
          ? ` · ${res.backupNote}`
          : ""
    }`,
  }
}
