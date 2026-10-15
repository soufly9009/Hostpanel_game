import Link from "next/link"
import { notFound } from "next/navigation"
import { and, eq } from "drizzle-orm"

import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { CustomerReplyForm } from "@/components/ticket-forms"
import { RatingForm, Stars } from "@/components/support-extra-controls"
import { TicketThread } from "@/components/ticket-thread"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from "@/lib/tickets/labels"

export const dynamic = "force-dynamic"

export default async function TicketPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params

  // Propriété vérifiée dans la requête : 404 pour le ticket d'un autre client.
  const [ticket] = await db
    .select()
    .from(schema.tickets)
    .where(and(eq(schema.tickets.id, id), eq(schema.tickets.userId, user.id)))
  if (!ticket) notFound()

  const messages = await db
    .select()
    .from(schema.ticketMessages)
    .where(
      and(
        eq(schema.ticketMessages.ticketId, ticket.id),
        // Les notes internes ne sortent jamais côté client.
        eq(schema.ticketMessages.isInternal, false)
      )
    )
    .orderBy(schema.ticketMessages.createdAt)

  return (
    <>
      <PageHeader
        title={`${ticketRef(ticket.number)} · ${ticket.subject}`}
        description={
          <>
            {CATEGORY_LABEL[ticket.category]} ·{" "}
            <Link href="/tickets" className="underline underline-offset-4">
              Tous mes tickets
            </Link>
          </>
        }
        actions={
          <StatusBadge tone={STATUS_TONE[ticket.status]}>
            {STATUS_LABEL[ticket.status]}
          </StatusBadge>
        }
      />

      <TicketThread
        viewer="customer"
        messages={messages.map((m) => ({
          id: m.id,
          kind: m.authorKind,
          body: m.body,
          internal: false,
          createdAt: m.createdAt,
        }))}
      />

      <CustomerReplyForm
        ticketId={ticket.id}
        closed={ticket.status === "closed"}
      />

      {(ticket.status === "resolved" || ticket.status === "closed") && (
        <Section title="Ton avis sur notre aide">
          {ticket.ratedAt && ticket.rating ? (
            <p className="flex items-center gap-2 text-sm">
              Merci ! Ta note : <Stars value={ticket.rating} />
            </p>
          ) : (
            <RatingForm ticketId={ticket.id} />
          )}
        </Section>
      )}
    </>
  )
}
