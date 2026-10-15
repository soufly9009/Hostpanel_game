import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"

import { aiConfigured, generateTicketReply } from "@/lib/ai/openrouter"
import { can } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"
import { logInfo, logWarning } from "@/lib/discord/logging"
import { notify } from "@/lib/notifications"

import { ticketRef } from "./labels"
import { getTicketSettings } from "./settings"

type Ticket = typeof schema.tickets.$inferSelect

export type NewTicketInput = {
  userId: string
  subject: string
  body: string
  category: Ticket["category"]
  priority: Ticket["priority"]
  serverId?: string | null
  siteId?: string | null
}

/* ───────────── Création ───────────── */

/**
 * Le numéro est calculé DANS l'INSERT (sous-requête) : SQLite sérialise les
 * écritures, donc deux créations simultanées ne reçoivent jamais le même
 * numéro. Le conflit d'unicité reste une sécurité (autre instance).
 */
async function insertTicket(input: NewTicketInput) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const [row] = await db
        .insert(schema.tickets)
        .values({
          number: sql`(select coalesce(max(number), 0) + 1 from tickets)`,
          userId: input.userId,
          subject: input.subject,
          category: input.category,
          priority: input.priority,
          serverId: input.serverId ?? null,
          siteId: input.siteId ?? null,
        })
        .returning()
      return row
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new Error("Numérotation des tickets indisponible, réessaie.")
}

/** Services du client pouvant être rattachés au ticket (propriété vérifiée). */
export async function ownedServiceIds(userId: string) {
  const [servers, sites] = await Promise.all([
    db
      .select({ id: schema.servers.id })
      .from(schema.servers)
      .where(eq(schema.servers.userId, userId)),
    db
      .select({ id: schema.sites.id })
      .from(schema.sites)
      .where(eq(schema.sites.userId, userId)),
  ])
  return {
    servers: new Set(servers.map((s) => s.id)),
    sites: new Set(sites.map((s) => s.id)),
  }
}

export async function createTicket(input: NewTicketInput) {
  const ticket = await insertTicket(input)
  const [msg] = await db
    .insert(schema.ticketMessages)
    .values({
      ticketId: ticket.id,
      authorId: input.userId,
      authorKind: "customer",
      body: input.body,
    })
    .returning({ id: schema.ticketMessages.id })

  await notifyStaff(ticket, `new:${msg.id}`, "Nouveau ticket")

  // Discord : référence et priorité seulement (le sujet reste dans le panel).
  void (ticket.priority === "urgent" ? logWarning : logInfo)({
    category: "support",
    title: "Nouveau ticket",
    service: "Support",
    action: "création",
    result: "success",
    meta: {
      ticket: ticketRef(ticket.number),
      priorité: ticket.priority,
      catégorie: ticket.category,
    },
    dedupeKey: `ticket-new:${ticket.id}`,
  })

  // Réponse automatique en arrière-plan : n'attend jamais l'IA.
  void maybeAutoReply(ticket.id).catch(() => {})
  return ticket
}

/* ───────────── Messages et statut ───────────── */

export async function addMessage(
  ticket: Ticket,
  m: {
    authorId: string | null
    kind: "customer" | "staff" | "ai" | "system"
    body: string
    internal?: boolean
    aiModel?: string
  }
) {
  const [row] = await db
    .insert(schema.ticketMessages)
    .values({
      ticketId: ticket.id,
      authorId: m.authorId,
      authorKind: m.kind,
      body: m.body,
      isInternal: m.internal ?? false,
      aiModel: m.aiModel ?? null,
    })
    .returning()

  if (m.internal) return row // une note interne ne change rien côté client

  // Statut : réponse du personnel/IA → en attente du client ; client → ouvert.
  const nextStatus: Ticket["status"] =
    m.kind === "customer"
      ? "open"
      : m.kind === "staff"
        ? "pending"
        : ticket.status
  await db
    .update(schema.tickets)
    .set({
      status: nextStatus,
      lastMessageAt: new Date(),
      closedAt: null,
    })
    .where(eq(schema.tickets.id, ticket.id))

  if (m.kind === "customer") {
    await notifyStaff(ticket, `reply:${row.id}`, "Réponse du client")
  } else {
    await notify({
      userId: ticket.userId,
      dedupeKey: `ticket:${ticket.id}:reply:${row.id}`,
      title: `Réponse à ton ticket ${ticketRef(ticket.number)}`,
      body:
        m.kind === "ai" ? "Réponse de l'assistant IA." : "Réponse du support.",
      href: `/tickets/${ticket.id}`,
    })
  }
  return row
}

export async function setStatus(ticket: Ticket, status: Ticket["status"]) {
  await db
    .update(schema.tickets)
    .set({
      status,
      closedAt:
        status === "closed" || status === "resolved" ? new Date() : null,
    })
    .where(eq(schema.tickets.id, ticket.id))
  if (status === "resolved" || status === "closed") {
    await notify({
      userId: ticket.userId,
      dedupeKey: `ticket:${ticket.id}:status:${status}:${Math.floor(Date.now() / 16384)}`,
      title: `Ticket ${ticketRef(ticket.number)} ${status === "resolved" ? "résolu" : "fermé"}`,
      href: `/tickets/${ticket.id}`,
    })
  }
}

/* ───────────── Notifications du personnel ───────────── */

async function notifyStaff(ticket: Ticket, key: string, title: string) {
  const staff = await db
    .select({
      id: schema.users.id,
      role: schema.users.role,
      roleId: schema.users.roleId,
    })
    .from(schema.users)
    .where(inArray(schema.users.role, ["support", "admin"]))
    .limit(50)

  let sent = 0
  for (const s of staff) {
    if (sent >= 25) break
    // Ticket assigné : seulement l'assigné ; sinon ceux qui voient la file.
    if (ticket.assignedTo && ticket.assignedTo !== s.id) continue
    if (!(await can(s, "tickets.view_all"))) continue
    await notify({
      userId: s.id,
      dedupeKey: `ticket:${ticket.id}:${key}`,
      level: ticket.priority === "urgent" ? "warning" : "info",
      title: `${title} ${ticketRef(ticket.number)}`,
      body: ticket.priority === "urgent" ? "Priorité urgente." : undefined,
      href: `/support/tickets/${ticket.id}`,
    })
    sent++
  }
}

/* ───────────── Assistant IA ───────────── */

/** Contexte envoyé à l'IA : messages visibles du client uniquement. */
export async function visibleContext(ticketId: string) {
  const rows = await db
    .select({
      kind: schema.ticketMessages.authorKind,
      body: schema.ticketMessages.body,
    })
    .from(schema.ticketMessages)
    .where(
      and(
        eq(schema.ticketMessages.ticketId, ticketId),
        eq(schema.ticketMessages.isInternal, false)
      )
    )
    .orderBy(schema.ticketMessages.createdAt)
  return rows
    .filter((r) => r.kind !== "system")
    .map((r) => ({
      from: r.kind as "customer" | "staff" | "ai",
      body: r.body,
    }))
}

/** Réponse automatique au premier message (une seule fois par ticket). */
export async function maybeAutoReply(ticketId: string) {
  if (!aiConfigured()) return
  const settings = await getTicketSettings()
  if (!settings.aiAutoReply) return

  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, ticketId))
  if (!ticket || ticket.status === "closed") return

  // Déjà répondu (IA ou personnel) : on n'intervient pas.
  const [{ answered }] = await db
    .select({ answered: sql<number>`count(*)` })
    .from(schema.ticketMessages)
    .where(
      and(
        eq(schema.ticketMessages.ticketId, ticketId),
        inArray(schema.ticketMessages.authorKind, ["ai", "staff"])
      )
    )
  if (Number(answered) > 0) return

  // Les demandes urgentes vont directement à un humain.
  if (ticket.priority === "urgent") return

  const ctx = await visibleContext(ticketId)
  const res = await generateTicketReply({
    subject: ticket.subject,
    category: ticket.category,
    messages: ctx,
  })

  if (!res.ok) {
    void logWarning({
      category: "support",
      title: "Réponse IA indisponible",
      service: "Assistant IA",
      action: "réponse automatique",
      result: "failure",
      message: res.detail,
      meta: { ticket: ticketRef(ticket.number) },
      dedupeKey: `ai-fail:${res.kind}`,
      dedupeWindowMs: 30 * 60_000,
    })
    return
  }

  const body = `${res.text}\n\n— Réponse générée automatiquement par l'assistant IA. Un membre de l'équipe peut compléter ou corriger cette réponse.`
  await addMessage(ticket, {
    authorId: null,
    kind: "ai",
    body,
    aiModel: res.model,
  })
}

export async function recentTicketCount(userId: string, sinceMs: number) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.tickets)
    .where(
      and(
        eq(schema.tickets.userId, userId),
        sql`${schema.tickets.createdAt} >= ${Math.floor((Date.now() - sinceMs) / 1000)}`
      )
    )
  return Number(n)
}

export async function recentMessageCount(userId: string, sinceMs: number) {
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.ticketMessages)
    .where(
      and(
        eq(schema.ticketMessages.authorId, userId),
        sql`${schema.ticketMessages.createdAt} >= ${Math.floor((Date.now() - sinceMs) / 1000)}`
      )
    )
  return Number(n)
}
