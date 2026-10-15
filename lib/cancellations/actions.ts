"use server"

import { revalidatePath } from "next/cache"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin, requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { errorText, logInfo } from "@/lib/discord/logging"
import { notify } from "@/lib/notifications"

import { findService, removeService, setCancelAtPeriodEnd } from "./service"

export type CancelState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const requestSchema = z.object({
  serviceType: z.enum(["vps", "game"]),
  serviceId: z.string().min(1).max(64),
  mode: z.enum(["immediate", "end_of_period"]),
  reason: z.string().trim().max(500).optional(),
})

function refresh(type: string, id: string) {
  revalidatePath("/admin/cancellations")
  revalidatePath(type === "vps" ? `/servers/${id}` : `/games/${id}`)
}

/** Demande du client, validée ensuite par un administrateur. */
export async function requestCancellationAction(
  _prev: CancelState,
  formData: FormData
): Promise<CancelState> {
  const user = await requireUser()
  const parsed = requestSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: "Demande invalide." }
  const d = parsed.data
  const svc = await findService(d.serviceType, d.serviceId)
  if (!svc || (svc.userId !== user.id && user.role !== "admin")) {
    return { error: "Service introuvable." }
  }
  const [open] = await db
    .select({ id: schema.cancellationRequests.id })
    .from(schema.cancellationRequests)
    .where(
      and(
        eq(schema.cancellationRequests.serviceId, d.serviceId),
        eq(schema.cancellationRequests.status, "pending")
      )
    )
  if (open) return { error: "Une demande est déjà en cours pour ce service." }

  await db.insert(schema.cancellationRequests).values({
    userId: svc.userId,
    serviceType: d.serviceType,
    serviceId: d.serviceId,
    serviceName: svc.name,
    mode: d.mode,
    reason: d.reason || null,
  })
  void logInfo({
    category: "billing",
    title: "Demande d'annulation de service",
    service: "Annulations",
    action: "demande",
    result: "info",
    meta: { service: d.serviceId.slice(0, 8), mode: d.mode },
    dedupeKey: `cancel-req:${d.serviceId}`,
  })
  await logActivity(user, `Annulation demandée : ${svc.name}`, {
    type: d.serviceType === "vps" ? "server" : "game",
    id: svc.id,
  })
  refresh(d.serviceType, d.serviceId)
  return { ok: true, notice: "Demande envoyée : elle sera traitée rapidement." }
}

export async function withdrawCancellationAction(
  id: string
): Promise<CancelState> {
  const user = await requireUser()
  const [r] = await db
    .update(schema.cancellationRequests)
    .set({ status: "withdrawn", handledAt: new Date() })
    .where(
      and(
        eq(schema.cancellationRequests.id, z.string().max(64).parse(id)),
        eq(schema.cancellationRequests.userId, user.id),
        eq(schema.cancellationRequests.status, "pending")
      )
    )
    .returning()
  if (!r) return { error: "Demande introuvable." }
  refresh(r.serviceType, r.serviceId)
  return { ok: true }
}

/** Validation : suppression immédiate, ou à l'échéance (plus de facture). */
export async function approveCancellationAction(
  id: string
): Promise<CancelState> {
  const admin = await requireAdmin()
  const [r] = await db
    .update(schema.cancellationRequests)
    .set({ status: "approved", handledBy: admin.email, handledAt: new Date() })
    .where(
      and(
        eq(schema.cancellationRequests.id, z.string().max(64).parse(id)),
        eq(schema.cancellationRequests.status, "pending")
      )
    )
    .returning()
  if (!r) return { error: "Demande déjà traitée." }

  try {
    if (r.mode === "immediate") await removeService(r.serviceType, r.serviceId)
    else await setCancelAtPeriodEnd(r.serviceType, r.serviceId, true)
  } catch (e) {
    // Échec côté infrastructure : la demande redevient en attente.
    await db
      .update(schema.cancellationRequests)
      .set({ status: "pending", handledBy: null, handledAt: null })
      .where(eq(schema.cancellationRequests.id, r.id))
    return { error: `Suppression impossible : ${errorText(e)}` }
  }
  if (r.userId) {
    await notify({
      userId: r.userId,
      dedupeKey: `cancel:${r.id}`,
      title: `Annulation validée : ${r.serviceName}`,
      body:
        r.mode === "immediate"
          ? "Le service a été supprimé."
          : "Le service restera actif jusqu'à son échéance, puis sera supprimé.",
    })
  }
  await logActivity(admin, `Annulation validée : ${r.serviceName}`, {
    type: r.serviceType === "vps" ? "server" : "game",
    id: r.serviceId,
  })
  refresh(r.serviceType, r.serviceId)
  return { ok: true }
}

export async function rejectCancellationAction(
  id: string
): Promise<CancelState> {
  const admin = await requireAdmin()
  const [r] = await db
    .update(schema.cancellationRequests)
    .set({ status: "rejected", handledBy: admin.email, handledAt: new Date() })
    .where(
      and(
        eq(schema.cancellationRequests.id, z.string().max(64).parse(id)),
        eq(schema.cancellationRequests.status, "pending")
      )
    )
    .returning()
  if (!r) return { error: "Demande déjà traitée." }
  if (r.userId) {
    await notify({
      userId: r.userId,
      dedupeKey: `cancel:${r.id}`,
      title: `Annulation refusée : ${r.serviceName}`,
      body: "Contacte le support pour plus d'informations.",
      href: "/tickets/new",
    })
  }
  refresh(r.serviceType, r.serviceId)
  return { ok: true }
}

/** Revenir sur une annulation programmée (avant l'échéance). */
export async function keepServiceAction(
  type: "vps" | "game",
  serviceId: string
): Promise<CancelState> {
  const user = await requireUser()
  const svc = await findService(type, z.string().max(64).parse(serviceId))
  if (!svc || (svc.userId !== user.id && user.role !== "admin"))
    return { error: "Service introuvable." }
  await setCancelAtPeriodEnd(type, svc.id, false)
  await logActivity(user, `Annulation programmée retirée : ${svc.name}`, {
    type: type === "vps" ? "server" : "game",
    id: svc.id,
  })
  refresh(type, svc.id)
  return { ok: true }
}
