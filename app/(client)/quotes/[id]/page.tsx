import Link from "next/link"
import { notFound } from "next/navigation"
import { eq } from "drizzle-orm"

import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { QuoteResponse } from "@/components/quote-controls"
import { can } from "@/lib/auth/permissions"
import { isStaffRole } from "@/lib/auth/roles"
import { requireUser } from "@/lib/auth/session"
import { computeInvoice, formatMoney, formatRate } from "@/lib/billing/money"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"
import { isPast } from "@/lib/expiry"
import { QUOTE_STATUS } from "@/lib/quotes/labels"

export const dynamic = "force-dynamic"

export default async function QuotePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const [q] = await db
    .select()
    .from(schema.quotes)
    .where(eq(schema.quotes.id, id))
  const staff = isStaffRole(user.role) && (await can(user, "billing.view"))
  if (!q || (q.userId !== user.id && !staff)) notFound()

  const s = await getBillingSettings()
  const lines = computeInvoice(q.lines, {
    taxRateBp: q.taxRateBp,
    pricesIncludeTax: s.pricesIncludeTax,
  }).items
  const money = (c: number) => formatMoney(c, q.currency)
  const expired = q.status === "sent" && isPast(q.validUntil)
  const st = QUOTE_STATUS[q.status]

  return (
    <>
      <PageHeader
        title={`Devis ${q.number}`}
        description={
          <>
            <Link className="underline" href="/quotes">
              Mes devis
            </Link>{" "}
            · {q.title}
          </>
        }
        actions={
          <StatusBadge tone={expired ? "warning" : st.tone}>
            {expired ? "Expiré" : st.label}
          </StatusBadge>
        }
      />
      <Section
        title="Détail"
        description={`Émis le ${q.createdAt.toLocaleDateString("fr-FR")} · valable jusqu'au ${q.validUntil.toLocaleDateString("fr-FR")}`}
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="py-2 pr-3 font-medium">Désignation</th>
                <th className="py-2 pr-3 text-right font-medium">Qté</th>
                <th className="py-2 pr-3 text-right font-medium">PU HT</th>
                <th className="py-2 text-right font-medium">Total HT</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {lines.map((l, i) => (
                <tr key={i}>
                  <td className="py-2 pr-3">{l.description}</td>
                  <td className="py-2 pr-3 text-right">{l.quantity}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {money(l.unitCents)}
                  </td>
                  <td className="py-2 text-right tabular-nums">
                    {money(l.totalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <dl className="mt-4 ml-auto grid max-w-xs grid-cols-2 gap-1 text-sm">
          <dt className="text-muted-foreground">Total HT</dt>
          <dd className="text-right tabular-nums">{money(q.subtotalCents)}</dd>
          <dt className="text-muted-foreground">
            {q.taxLabel} ({formatRate(q.taxRateBp)})
          </dt>
          <dd className="text-right tabular-nums">{money(q.taxCents)}</dd>
          <dt className="font-semibold">Total TTC</dt>
          <dd className="text-right font-semibold tabular-nums">
            {money(q.totalCents)}
          </dd>
        </dl>
        {q.notes && (
          <p className="mt-4 text-sm text-muted-foreground">{q.notes}</p>
        )}
      </Section>
      {q.status === "sent" && !expired && q.userId === user.id && (
        <Section title="Ta réponse">
          <QuoteResponse id={q.id} total={money(q.totalCents)} />
        </Section>
      )}
      {q.invoiceId && (
        <p className="text-sm">
          Facture associée :{" "}
          <Link className="underline" href={`/invoices/${q.invoiceId}`}>
            voir la facture
          </Link>
        </p>
      )}
    </>
  )
}
