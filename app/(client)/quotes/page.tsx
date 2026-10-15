import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { requireUser } from "@/lib/auth/session"
import { formatMoney } from "@/lib/billing/money"
import { db, schema } from "@/lib/db"
import { QUOTE_STATUS } from "@/lib/quotes/labels"

export const metadata = { title: "Devis" }
export const dynamic = "force-dynamic"

export default async function QuotesPage() {
  const user = await requireUser()
  const quotes = await db
    .select()
    .from(schema.quotes)
    .where(eq(schema.quotes.userId, user.id))
    .orderBy(desc(schema.quotes.createdAt))
  return (
    <>
      <PageHeader
        title="Devis"
        description="Propositions de l'équipe : accepte-les pour recevoir la facture."
      />
      {quotes.length === 0 ? (
        <EmptyState title="Aucun devis" />
      ) : (
        <ul className="divide-y rounded-xl border bg-card text-sm">
          {quotes.map((q) => {
            const st = QUOTE_STATUS[q.status]
            return (
              <li key={q.id}>
                <Link
                  href={`/quotes/${q.id}`}
                  className="flex flex-wrap items-center gap-2 p-4 hover:bg-muted/40"
                >
                  <span className="font-mono">{q.number}</span>
                  <span className="font-medium">{q.title}</span>
                  <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  <span className="ml-auto tabular-nums">
                    {formatMoney(q.totalCents, q.currency)}
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}
