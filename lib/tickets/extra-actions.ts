"use server"

import { revalidatePath } from "next/cache"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export type ExtraState =
  { error?: string; ok?: boolean; notice?: string } | undefined

/* ───────────── Réponses prédéfinies ───────────── */

const cannedSchema = z.object({
  title: z.string().trim().min(2, "Titre trop court").max(100),
  body: z.string().trim().min(2, "Contenu requis").max(4000),
})

export async function saveCannedAction(
  _prev: ExtraState,
  formData: FormData
): Promise<ExtraState> {
  const staff = await requireStaff()
  if (!(await can(staff, "tickets.macros")))
    return { error: "Permission insuffisante." }
  const parsed = cannedSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const id = String(formData.get("id") ?? "")
  if (id) {
    await db
      .update(schema.cannedResponses)
      .set({ ...parsed.data, updatedAt: new Date() })
      .where(eq(schema.cannedResponses.id, id))
  } else {
    await db
      .insert(schema.cannedResponses)
      .values({ ...parsed.data, createdBy: staff.email })
  }
  revalidatePath("/support/canned")
  return { ok: true, notice: "Réponse enregistrée." }
}

export async function deleteCannedAction(id: string): Promise<ExtraState> {
  const staff = await requireStaff()
  if (!(await can(staff, "tickets.macros")))
    return { error: "Permission insuffisante." }
  await db
    .delete(schema.cannedResponses)
    .where(eq(schema.cannedResponses.id, z.string().max(64).parse(id)))
  revalidatePath("/support/canned")
  return { ok: true }
}

/* ───────────── Satisfaction ───────────── */

const ratingSchema = z.object({
  rating: z.coerce.number().int().min(1).max(5),
  comment: z.string().trim().max(1000).optional(),
})

/** Note du client, une seule fois, sur un ticket résolu ou fermé. */
export async function rateTicketAction(
  _prev: ExtraState,
  formData: FormData
): Promise<ExtraState> {
  const user = await requireUser()
  const ticketId = z.string().min(1).max(64).safeParse(formData.get("ticketId"))
  const parsed = ratingSchema.safeParse(Object.fromEntries(formData))
  if (!ticketId.success || !parsed.success)
    return { error: "Choisis une note de 1 à 5." }
  const res = await db
    .update(schema.tickets)
    .set({
      rating: parsed.data.rating,
      ratingComment: parsed.data.comment || null,
      ratedAt: new Date(),
    })
    .where(
      and(
        eq(schema.tickets.id, ticketId.data),
        eq(schema.tickets.userId, user.id),
        inArray(schema.tickets.status, ["resolved", "closed"]),
        isNull(schema.tickets.ratedAt)
      )
    )
  if (res.rowsAffected !== 1)
    return { error: "Ce ticket ne peut pas (ou plus) être noté." }
  await logActivity(user, `Ticket noté ${parsed.data.rating}/5`, {
    type: "ticket",
    id: ticketId.data,
  })
  revalidatePath(`/tickets/${ticketId.data}`)
  return { ok: true, notice: "Merci pour ton retour !" }
}
