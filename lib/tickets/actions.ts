"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { aiConfigured, generateTicketReply } from "@/lib/ai/openrouter"
import { logActivity } from "@/lib/activity"
import { can } from "@/lib/auth/permissions"
import { isStaffRole } from "@/lib/auth/roles"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { links, queueUserEmail } from "@/lib/mail/service"

import { MAX_BODY, MAX_SUBJECT, ticketRef } from "./labels"
import {
  addMessage,
  createTicket,
  ownedServiceIds,
  recentMessageCount,
  recentTicketCount,
  setStatus,
  visibleContext,
} from "./service"

export type TicketState =
  { error?: string; ok?: boolean; draft?: string; notice?: string } | undefined

const HOUR = 3_600_000

const body = z
  .string()
  .trim()
  .min(2, "Message trop court")
  .max(MAX_BODY, `Message trop long (${MAX_BODY} caractères maximum)`)

/* ───────────── Client ───────────── */

const createSchema = z.object({
  subject: z.string().trim().min(3, "Sujet trop court").max(MAX_SUBJECT),
  category: z.enum(["vps", "site", "billing", "network", "account", "other"]),
  priority: z.enum(["low", "normal", "high"]).default("normal"),
  body,
  serverId: z.string().max(64).optional(),
  siteId: z.string().max(64).optional(),
})

export async function createTicketAction(
  _prev: TicketState,
  formData: FormData
): Promise<TicketState> {
  const user = await requireUser()
  const parsed = createSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const d = parsed.data

  // Limitation anti-abus : 5 tickets par heure.
  if ((await recentTicketCount(user.id, HOUR)) >= 5) {
    return { error: "Trop de tickets créés récemment. Réessaie plus tard." }
  }

  // Le service rattaché doit appartenir au client (jamais d'identifiant libre).
  const owned = await ownedServiceIds(user.id)
  const serverId =
    d.serverId && owned.servers.has(d.serverId) ? d.serverId : null
  const siteId = d.siteId && owned.sites.has(d.siteId) ? d.siteId : null
  if ((d.serverId && !serverId) || (d.siteId && !siteId)) {
    return { error: "Service introuvable." }
  }

  const ticket = await createTicket({
    userId: user.id,
    subject: d.subject,
    body: d.body,
    category: d.category,
    priority: d.priority,
    serverId,
    siteId,
  })
  await logActivity(user, "Ticket créé", { type: "ticket", id: ticket.id })
  revalidatePath("/tickets")
  redirect(`/tickets/${ticket.id}`)
}

async function ownTicket(ticketId: string, userId: string) {
  const [t] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
  return t && t.userId === userId ? t : null
}

export async function customerReplyAction(
  ticketId: string,
  message: string
): Promise<TicketState> {
  const user = await requireUser()
  const ticket = await ownTicket(ticketId, user.id)
  if (!ticket) return { error: "Ticket introuvable" }
  if (ticket.status === "closed") {
    return { error: "Ce ticket est fermé : ouvre un nouveau ticket." }
  }
  const b = body.safeParse(message)
  if (!b.success) return { error: b.error.issues[0]?.message }
  if ((await recentMessageCount(user.id, HOUR)) >= 30) {
    return { error: "Trop de messages envoyés. Réessaie plus tard." }
  }

  await addMessage(ticket, {
    authorId: user.id,
    kind: "customer",
    body: b.data,
  })
  revalidatePath(`/tickets/${ticket.id}`)
  return { ok: true }
}

export async function customerCloseAction(
  ticketId: string
): Promise<TicketState> {
  const user = await requireUser()
  const ticket = await ownTicket(ticketId, user.id)
  if (!ticket) return { error: "Ticket introuvable" }
  await setStatus(ticket, "closed")
  await logActivity(user, "Ticket fermé", { type: "ticket", id: ticket.id })
  revalidatePath(`/tickets/${ticket.id}`)
  revalidatePath("/tickets")
  return { ok: true }
}

/* ───────────── Personnel ───────────── */

async function staffTicket(ticketId: string, permission: string) {
  const user = await requireUser()
  if (!isStaffRole(user.role)) return { error: "Accès refusé" } as const
  if (!(await can(user, "tickets.view_all"))) {
    return { error: "Accès refusé" } as const
  }
  if (!(await can(user, permission))) {
    return { error: "Permission manquante" } as const
  }
  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
  if (!ticket) return { error: "Ticket introuvable" } as const
  return { user, ticket } as const
}

export async function staffReplyAction(
  ticketId: string,
  message: string,
  internal: boolean
): Promise<TicketState> {
  const ctx = await staffTicket(
    ticketId,
    internal ? "tickets.internal_note" : "tickets.reply"
  )
  if ("error" in ctx) return { error: ctx.error }
  const b = body.safeParse(message)
  if (!b.success) return { error: b.error.issues[0]?.message }

  await addMessage(ctx.ticket, {
    authorId: ctx.user.id,
    kind: "staff",
    body: b.data,
    internal,
  })
  if (!internal) {
    await queueUserEmail(ctx.ticket.userId, "ticket_reply", {
      ticketRef: ticketRef(ctx.ticket.number),
      subject: ctx.ticket.subject,
      ticketUrl: links.ticket(ctx.ticket.id),
    })
  }
  // Auto-assignation à la première réponse publique.
  if (!internal && !ctx.ticket.assignedTo) {
    await db
      .update(schema.tickets)
      .set({ assignedTo: ctx.user.id })
      .where(eq(schema.tickets.id, ctx.ticket.id))
  }
  await logActivity(
    ctx.user,
    internal ? "Note interne ajoutée" : "Réponse au ticket",
    { type: "ticket", id: ctx.ticket.id }
  )
  revalidatePath(`/support/tickets/${ctx.ticket.id}`)
  return { ok: true }
}

export async function staffStatusAction(
  ticketId: string,
  status: "open" | "pending" | "resolved" | "closed"
): Promise<TicketState> {
  const ctx = await staffTicket(ticketId, "tickets.close")
  if ("error" in ctx) return { error: ctx.error }
  if (!["open", "pending", "resolved", "closed"].includes(status)) {
    return { error: "Statut invalide" }
  }
  await setStatus(ctx.ticket, status)
  await logActivity(ctx.user, `Ticket : ${status}`, {
    type: "ticket",
    id: ctx.ticket.id,
  })
  revalidatePath(`/support/tickets/${ctx.ticket.id}`)
  revalidatePath("/support")
  return { ok: true }
}

export async function staffAssignAction(
  ticketId: string,
  assigneeId: string | null
): Promise<TicketState> {
  const ctx = await staffTicket(ticketId, "tickets.assign")
  if ("error" in ctx) return { error: ctx.error }

  if (assigneeId) {
    const [target] = await db
      .select({
        id: schema.users.id,
        role: schema.users.role,
        roleId: schema.users.roleId,
      })
      .from(schema.users)
      .where(eq(schema.users.id, assigneeId))
    if (!target || !isStaffRole(target.role)) {
      return { error: "Cet utilisateur ne fait pas partie du support." }
    }
    // Un collègue sans accès à la file ne peut pas recevoir de ticket.
    if (!(await can(target, "tickets.view_all"))) {
      return { error: "Ce collègue n'a pas accès aux tickets." }
    }
  }
  await db
    .update(schema.tickets)
    .set({ assignedTo: assigneeId })
    .where(eq(schema.tickets.id, ctx.ticket.id))
  await logActivity(ctx.user, "Ticket assigné", {
    type: "ticket",
    id: ctx.ticket.id,
  })
  revalidatePath(`/support/tickets/${ctx.ticket.id}`)
  revalidatePath("/support")
  return { ok: true }
}

/** Brouillon IA pour le personnel : retourné, jamais envoyé automatiquement. */
const g = globalThis as unknown as { __aiDraftAt?: Map<string, number> }
const lastDraft = (g.__aiDraftAt ??= new Map())

export async function aiDraftAction(ticketId: string): Promise<TicketState> {
  const ctx = await staffTicket(ticketId, "tickets.ai")
  if ("error" in ctx) return { error: ctx.error }
  if (!aiConfigured()) {
    return { error: "L'assistant IA n'est pas configuré (OPENROUTER_API_KEY)." }
  }

  const last = lastDraft.get(ctx.user.id) ?? 0
  if (Date.now() - last < 5_000) {
    return { error: "Patiente quelques secondes entre deux brouillons." }
  }
  lastDraft.set(ctx.user.id, Date.now())

  const messages = await visibleContext(ctx.ticket.id)
  const res = await generateTicketReply({
    subject: ctx.ticket.subject,
    category: ctx.ticket.category,
    messages,
  })
  if (!res.ok) return { error: res.detail }
  return { ok: true, draft: res.text, notice: `Modèle : ${res.model}` }
}
