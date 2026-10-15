import Link from "next/link"
import { notFound } from "next/navigation"
import { and, eq, inArray } from "drizzle-orm"

import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { Stars } from "@/components/support-extra-controls"
import { StaffControls, StaffReplyForm } from "@/components/ticket-forms"
import { TicketThread } from "@/components/ticket-thread"
import { aiConfigured } from "@/lib/ai/openrouter"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from "@/lib/tickets/labels"

export const dynamic = "force-dynamic"

export default async function StaffTicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireStaff()
  const { id } = await params

  if (!(await can(user, "tickets.view_all"))) {
    return (
      <ErrorState
        title="Accès limité"
        message="Ton rôle ne donne pas accès aux tickets."
      />
    )
  }

  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.id, id))
  if (!ticket) notFound()

  const [
    canReply,
    canInternal,
    canAssign,
    canClose,
    canAi,
    canUsers,
    canServices,
  ] = await Promise.all([
    can(user, "tickets.reply"),
    can(user, "tickets.internal_note"),
    can(user, "tickets.assign"),
    can(user, "tickets.close"),
    can(user, "tickets.ai"),
    can(user, "users.view"),
    can(user, "services.view"),
  ])

  const [messages, customer, staffRows, server, site] = await Promise.all([
    db
      .select({
        m: schema.ticketMessages,
        authorName: schema.users.name,
        authorEmail: schema.users.email,
      })
      .from(schema.ticketMessages)
      .leftJoin(
        schema.users,
        eq(schema.users.id, schema.ticketMessages.authorId)
      )
      .where(
        and(
          eq(schema.ticketMessages.ticketId, ticket.id),
          // Sans la permission « notes internes », elles restent masquées.
          canInternal || user.role === "admin"
            ? undefined
            : eq(schema.ticketMessages.isInternal, false)
        )
      )
      .orderBy(schema.ticketMessages.createdAt),
    canUsers
      ? db
          .select({
            email: schema.users.email,
            name: schema.users.name,
            createdAt: schema.users.createdAt,
          })
          .from(schema.users)
          .where(eq(schema.users.id, ticket.userId))
          .then((r) => r[0])
      : Promise.resolve(null),
    canAssign
      ? db
          .select({
            id: schema.users.id,
            email: schema.users.email,
            name: schema.users.name,
          })
          .from(schema.users)
          .where(inArray(schema.users.role, ["support", "admin"]))
      : Promise.resolve([]),
    canServices && ticket.serverId
      ? db
          .select({
            name: schema.servers.name,
            virt: schema.servers.virt,
            suspended: schema.servers.suspended,
          })
          .from(schema.servers)
          .where(eq(schema.servers.id, ticket.serverId))
          .then((r) => r[0])
      : Promise.resolve(null),
    canServices && ticket.siteId
      ? db
          .select({ domain: schema.sites.domain })
          .from(schema.sites)
          .where(eq(schema.sites.id, ticket.siteId))
          .then((r) => r[0])
      : Promise.resolve(null),
  ])

  const canned = canReply
    ? await db
        .select({
          id: schema.cannedResponses.id,
          title: schema.cannedResponses.title,
          body: schema.cannedResponses.body,
        })
        .from(schema.cannedResponses)
        .orderBy(schema.cannedResponses.title)
    : []

  return (
    <>
      <PageHeader
        title={`${ticketRef(ticket.number)} · ${ticket.subject}`}
        description={
          <>
            {CATEGORY_LABEL[ticket.category]} ·{" "}
            <Link href="/support" className="underline underline-offset-4">
              File d&apos;attente
            </Link>
          </>
        }
        actions={
          <>
            <StatusBadge tone={PRIORITY_TONE[ticket.priority]}>
              {PRIORITY_LABEL[ticket.priority]}
            </StatusBadge>
            <StatusBadge tone={STATUS_TONE[ticket.status]}>
              {STATUS_LABEL[ticket.status]}
            </StatusBadge>
          </>
        }
      />

      <Section title="Gestion">
        <StaffControls
          ticketId={ticket.id}
          status={ticket.status}
          assignedTo={ticket.assignedTo}
          canClose={canClose}
          canAssign={canAssign}
          staff={staffRows.map((s) => ({
            id: s.id,
            label: s.name ?? s.email,
          }))}
        />
      </Section>

      {ticket.rating && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border p-3 text-sm">
          <span className="font-medium">Avis du client</span>
          <Stars value={ticket.rating} />
          {ticket.ratingComment && (
            <span className="text-muted-foreground">
              « {ticket.ratingComment} »
            </span>
          )}
        </div>
      )}
      {(customer || server || site) && (
        <Section title="Contexte">
          <dl className="grid gap-3 text-sm sm:grid-cols-3">
            {customer && (
              <div>
                <dt className="text-muted-foreground">Client</dt>
                <dd>
                  {customer.name ?? "—"}{" "}
                  <span className="text-xs text-muted-foreground">
                    {customer.email}
                  </span>
                </dd>
              </div>
            )}
            {server && (
              <div>
                <dt className="text-muted-foreground">VPS concerné</dt>
                <dd>
                  {server.name} ({server.virt === "qemu" ? "VM" : "LXC"})
                  {server.suspended ? " · suspendu" : ""}
                </dd>
              </div>
            )}
            {site && (
              <div>
                <dt className="text-muted-foreground">Site concerné</dt>
                <dd>{site.domain}</dd>
              </div>
            )}
          </dl>
        </Section>
      )}

      <TicketThread
        viewer="staff"
        messages={messages.map(({ m, authorName, authorEmail }) => ({
          id: m.id,
          kind: m.authorKind,
          body: m.body,
          internal: m.isInternal,
          createdAt: m.createdAt,
          authorName: authorName ?? authorEmail,
          aiModel: m.aiModel,
        }))}
      />

      {ticket.status === "closed" ? (
        <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
          Ticket fermé. Rouvre-le (statut) pour y répondre.
        </p>
      ) : (
        <StaffReplyForm
          ticketId={ticket.id}
          canReply={canReply}
          canInternal={canInternal}
          canAi={canAi && aiConfigured()}
          canned={canned}
          customerName={customer?.name ?? ""}
        />
      )}
    </>
  )
}
