"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

import { MAINTENANCE_TYPE_LABEL, SERVICE_KEYS, type ServiceKey } from "./labels"
import { cancel, complete, reschedule, schedule, start } from "./service"
import { isValidTimezone, zonedToUtc } from "./time"

export type MaintState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const typeKeys = Object.keys(MAINTENANCE_TYPE_LABEL) as [
  keyof typeof MAINTENANCE_TYPE_LABEL,
  ...(keyof typeof MAINTENANCE_TYPE_LABEL)[],
]

const checkbox = z
  .union([z.literal("on"), z.literal("")])
  .optional()
  .transform((v) => v === "on")

const createSchema = z.object({
  title: z.string().trim().min(3, "Titre trop court").max(120),
  description: z.string().trim().max(4000).optional(),
  type: z.enum(typeKeys),
  impact: z.enum(["none", "degraded", "partial", "full"]),
  startsAt: z.string().min(1, "Début requis"),
  endsAt: z.string().min(1, "Fin requise"),
  timezone: z.string().min(1),
  nodes: z.string().trim().max(500).optional(),
  customerMessage: z.string().trim().max(1000).optional(),
  notifyBeforeMinutes: z.coerce
    .number()
    .int()
    .min(0)
    .max(60 * 24 * 14),
  isPublic: checkbox,
})

function refresh() {
  revalidatePath("/admin/maintenance")
  revalidatePath("/dashboard")
  revalidatePath("/status")
}

export async function createMaintenance(
  _prev: MaintState,
  formData: FormData
): Promise<MaintState> {
  const admin = await requireAdmin()
  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: `${i?.path.join(".")} : ${i?.message}` }
  }
  const d = parsed.data

  if (!isValidTimezone(d.timezone)) return { error: "Fuseau horaire invalide" }
  const startsAt = zonedToUtc(d.startsAt, d.timezone)
  const endsAt = zonedToUtc(d.endsAt, d.timezone)
  if (!startsAt || !endsAt) return { error: "Date invalide" }
  if (endsAt <= startsAt) return { error: "La fin doit être après le début." }

  const services = formData
    .getAll("services")
    .map(String)
    .filter((s): s is ServiceKey => (SERVICE_KEYS as string[]).includes(s))
  if (services.length === 0) {
    return { error: "Choisis au moins un service concerné." }
  }

  const nodes = (d.nodes ?? "")
    .split(/[\s,;]+/)
    .map((n) => n.trim())
    .filter(Boolean)
    .slice(0, 30)

  const siteIds = formData
    .getAll("siteIds")
    .map(String)
    .filter((s) => s.length > 0 && s.length <= 64)
    .slice(0, 100)

  const [row] = await db
    .insert(schema.maintenanceEvents)
    .values({
      title: d.title,
      description: d.description || null,
      type: d.type,
      impact: d.impact,
      startsAt,
      endsAt,
      timezone: d.timezone,
      services,
      nodes,
      siteIds,
      customerMessage: d.customerMessage || null,
      isPublic: d.isPublic,
      notifyBeforeMinutes: d.notifyBeforeMinutes,
      createdBy: admin.email,
    })
    .returning({ id: schema.maintenanceEvents.id })

  await logActivity(admin, "Maintenance créée (brouillon)", {
    type: "maintenance",
    id: row.id,
    label: d.title,
  })
  refresh()
  return { ok: true, notice: "Brouillon créé. Programme-le pour l'annoncer." }
}

const idSchema = z.string().min(1).max(64)

export async function maintenanceTransition(
  id: string,
  action: "schedule" | "start" | "complete" | "cancel"
): Promise<MaintState> {
  const admin = await requireAdmin()
  const eid = idSchema.parse(id)
  const res =
    action === "schedule"
      ? await schedule(eid, admin)
      : action === "start"
        ? await start(eid, admin)
        : action === "complete"
          ? await complete(eid, admin)
          : await cancel(eid, admin)
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function rescheduleMaintenance(
  id: string,
  startsLocal: string,
  endsLocal: string
): Promise<MaintState> {
  const admin = await requireAdmin()
  const eid = idSchema.parse(id)
  const [e] = await db
    .select()
    .from(schema.maintenanceEvents)
    .where(eq(schema.maintenanceEvents.id, eid))
  if (!e) return { error: "Maintenance introuvable" }
  const startsAt = zonedToUtc(startsLocal, e.timezone)
  const endsAt = zonedToUtc(endsLocal, e.timezone)
  if (!startsAt || !endsAt) return { error: "Date invalide" }
  const res = await reschedule(eid, startsAt, endsAt, admin)
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

/* ───────────── Incidents ───────────── */

const incidentSchema = z.object({
  title: z.string().trim().min(3).max(120),
  impact: z.enum(["degraded", "partial", "full"]),
  message: z.string().trim().max(1000).optional(),
  isPublic: checkbox,
})

export async function createIncident(
  _prev: MaintState,
  formData: FormData
): Promise<MaintState> {
  const admin = await requireAdmin()
  const parsed = incidentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: `${i?.path.join(".")} : ${i?.message}` }
  }
  const components = formData
    .getAll("components")
    .map(String)
    .filter((s) => (SERVICE_KEYS as string[]).includes(s))
  if (components.length === 0) {
    return { error: "Choisis au moins un composant touché." }
  }
  await db.insert(schema.incidents).values({
    title: parsed.data.title,
    impact: parsed.data.impact,
    message: parsed.data.message || null,
    isPublic: parsed.data.isPublic,
    components,
  })
  await logActivity(admin, "Incident ouvert", {
    type: "maintenance",
    label: parsed.data.title,
  })
  refresh()
  return { ok: true }
}

export async function updateIncident(
  id: string,
  status: "investigating" | "identified" | "monitoring" | "resolved"
): Promise<MaintState> {
  const admin = await requireAdmin()
  const iid = idSchema.parse(id)
  const res = await db
    .update(schema.incidents)
    .set({
      status,
      resolvedAt: status === "resolved" ? new Date() : null,
    })
    .where(eq(schema.incidents.id, iid))
  if (res.rowsAffected !== 1) return { error: "Incident introuvable" }
  await logActivity(admin, `Incident : ${status}`, {
    type: "maintenance",
    id: iid,
  })
  refresh()
  return { ok: true }
}
