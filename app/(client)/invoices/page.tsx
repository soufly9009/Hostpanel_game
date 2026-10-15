import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { EmptyState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { requireUser } from "@/lib/auth/session"
import {
  formatMoney,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
} from "@/lib/billing/money"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Factures" }
export const dynamic = "force-dynamic"

const ORDER_STATUS = {
  pending: { label: "En attente de paiement", tone: "warning" },
  active: { label: "Active", tone: "success" },
  cancelled: { label: "Annulée", tone: "neutral" },
  failed: { label: "Échouée", tone: "danger" },
} as const

export default async function InvoicesPage() {
  const user = await requireUser()
  const [invoices, orders] = await Promise.all([
    db
      .select()
      .from(schema.invoices)
      .where(eq(schema.invoices.userId, user.id))
      .orderBy(desc(schema.invoices.issuedAt))
      .limit(200),
    db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.userId, user.id))
      .orderBy(desc(schema.orders.createdAt))
      .limit(50),
  ])
  const unpaid = invoices.filter((i) => i.status === "unpaid")
  const due = unpaid.reduce((s, i) => s + i.totalCents, 0)

  return (
    <>
      <PageHeader
        title="Factures"
        description={
          unpaid.length
            ? `${unpaid.length} facture(s) à régler · ${formatMoney(due, unpaid[0].currency)}`
            : "Tout est réglé."
        }
      />
      <Section title="Factures et avoirs">
        {invoices.length === 0 ? (
          <EmptyState title="Aucune facture" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="py-2 pr-3 font-medium">Numéro</th>
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Échéance</th>
                  <th className="py-2 pr-3 text-right font-medium">
                    Total TTC
                  </th>
                  <th className="py-2 font-medium">Statut</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((i) => (
                  <tr key={i.id}>
                    <td className="py-2 pr-3">
                      <Link
                        className="font-mono underline-offset-2 hover:underline"
                        href={`/invoices/${i.id}`}
                      >
                        {i.number}
                      </Link>
                      {i.type === "credit_note" && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          avoir
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-3">
                      {i.issuedAt.toLocaleDateString("fr-FR")}
                    </td>
                    <td className="py-2 pr-3">
                      {i.dueAt.toLocaleDateString("fr-FR")}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatMoney(i.totalCents, i.currency)}
                    </td>
                    <td className="py-2">
                      <StatusBadge tone={INVOICE_STATUS_TONE[i.status]}>
                        {INVOICE_STATUS_LABEL[i.status]}
                      </StatusBadge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {orders.length > 0 && (
        <Section title="Commandes">
          <ul className="divide-y text-sm">
            {orders.map((o) => (
              <li key={o.id} className="flex flex-wrap items-center gap-2 py-2">
                <span>{o.description}</span>
                <StatusBadge tone={ORDER_STATUS[o.status].tone}>
                  {ORDER_STATUS[o.status].label}
                </StatusBadge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {o.createdAt.toLocaleDateString("fr-FR")}
                </span>
                {o.invoiceId && (
                  <Link
                    className="text-xs underline"
                    href={`/invoices/${o.invoiceId}`}
                  >
                    Facture
                  </Link>
                )}
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
