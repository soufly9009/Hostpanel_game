import Link from "next/link"
import { count, desc, eq } from "drizzle-orm"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import {
  CATEGORY_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from "@/lib/tickets/labels"

export const metadata = { title: "Support" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

export default async function TicketsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const T = schema.tickets

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(T).where(eq(T.userId, user.id)),
    db
      .select()
      .from(T)
      .where(eq(T.userId, user.id))
      .orderBy(desc(T.lastMessageAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  return (
    <>
      <PageHeader
        title="Support"
        description="Tes demandes d'assistance."
        actions={
          <Button nativeButton={false} render={<Link href="/tickets/new" />}>
            Nouveau ticket
          </Button>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun ticket"
          description="Besoin d'aide ? Crée un ticket, notre équipe te répond ici."
          action={{ href: "/tickets/new", label: "Créer un ticket" }}
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((t) => (
            <li key={t.id}>
              <Link
                href={`/tickets/${t.id}`}
                className="flex flex-wrap items-center gap-3 p-4 text-sm transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
              >
                <span className="font-mono text-xs text-muted-foreground">
                  {ticketRef(t.number)}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {t.subject}
                </span>
                <span className="text-xs text-muted-foreground">
                  {CATEGORY_LABEL[t.category]}
                </span>
                <StatusBadge tone={STATUS_TONE[t.status]}>
                  {STATUS_LABEL[t.status]}
                </StatusBadge>
                <time
                  dateTime={t.lastMessageAt.toISOString()}
                  className="text-xs text-muted-foreground"
                >
                  {t.lastMessageAt.toLocaleDateString("fr-FR")}
                </time>
              </Link>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/tickets"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
      />
    </>
  )
}
