import Link from "next/link"
import { and, count, desc, eq, gte, like, or, sum } from "drizzle-orm"

import {
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/kit"
import { SearchInput } from "@/components/kit-client"
import { Pagination } from "@/components/pagination"
import { can, requireStaff } from "@/lib/auth/permissions"
import {
  formatMoney,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
} from "@/lib/billing/money"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Factures" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 30

export default async function StaffInvoicesPage({
  searchParams,
}: {
  searchParams: Promise<{
    status?: string
    q?: string
    page?: string
    notfound?: string
  }>
}) {
  const user = await requireStaff()
  if (!(await can(user, "billing.view"))) {
    return (
      <>
        <PageHeader title="Factures" />
        <ErrorState
          title="Accès limité"
          message="Permission billing.view requise."
        />
      </>
    )
  }
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const q = (sp.q ?? "").trim().slice(0, 80)
  const I = schema.invoices
  const status = (schema.INVOICE_STATUSES as readonly string[]).includes(
    sp.status ?? ""
  )
    ? (sp.status as (typeof schema.INVOICE_STATUSES)[number])
    : undefined
  const where = and(
    status ? eq(I.status, status) : undefined,
    q
      ? or(
          like(I.number, `%${q.toUpperCase()}%`),
          like(schema.users.email, `%${q}%`)
        )
      : undefined
  )
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const [settings, [{ total }], rows, [unpaid], [month]] = await Promise.all([
    getBillingSettings(),
    db
      .select({ total: count() })
      .from(I)
      .leftJoin(schema.users, eq(schema.users.id, I.userId))
      .where(where),
    db
      .select({ inv: I, email: schema.users.email })
      .from(I)
      .leftJoin(schema.users, eq(schema.users.id, I.userId))
      .where(where)
      .orderBy(desc(I.issuedAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db
      .select({ n: count(), amount: sum(I.totalCents) })
      .from(I)
      .where(and(eq(I.status, "unpaid"), eq(I.type, "invoice"))),
    db
      .select({ amount: sum(I.totalCents) })
      .from(I)
      .where(and(eq(I.status, "paid"), gte(I.paidAt, monthStart))),
  ])

  const filters = [
    { v: undefined, label: "Toutes" },
    { v: "unpaid", label: "À payer" },
    { v: "paid", label: "Payées" },
    { v: "cancelled", label: "Annulées" },
    { v: "refunded", label: "Remboursées" },
  ]

  return (
    <>
      <PageHeader
        title="Factures"
        description={
          settings.mode === "invoices"
            ? "Factures et avoirs de tous les clients."
            : "La facturation est désactivée (Admin → Facturation) : aucune nouvelle facture automatique."
        }
      />
      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Impayées"
          value={unpaid?.n ?? 0}
          tone={(unpaid?.n ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Montant à encaisser"
          value={formatMoney(Number(unpaid?.amount ?? 0), settings.currency)}
        />
        <StatCard
          label="Encaissé ce mois-ci"
          value={formatMoney(Number(month?.amount ?? 0), settings.currency)}
        />
      </div>
      {sp.notfound && <ErrorState title="Numéro introuvable" />}
      <div className="flex flex-wrap items-center gap-3">
        <SearchInput placeholder="Numéro ou e-mail…" />
        <nav aria-label="Statut" className="flex flex-wrap gap-1 text-sm">
          {filters.map((f) => (
            <Link
              key={f.label}
              href={
                f.v ? `/support/invoices?status=${f.v}` : "/support/invoices"
              }
              className={`rounded-md px-2 py-1 ${status === f.v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </Link>
          ))}
        </nav>
      </div>
      {rows.length === 0 ? (
        <EmptyState title="Aucune facture" />
      ) : (
        <div className="overflow-x-auto rounded-xl border">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Numéro</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Émise</th>
                <th className="p-3 font-medium">Échéance</th>
                <th className="p-3 text-right font-medium">TTC</th>
                <th className="p-3 font-medium">Statut</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map(({ inv, email }) => (
                <tr key={inv.id}>
                  <td className="p-3">
                    <Link
                      className="font-mono underline-offset-2 hover:underline"
                      href={`/invoices/${inv.id}`}
                    >
                      {inv.number}
                    </Link>
                  </td>
                  <td className="p-3">
                    {inv.userId && email ? (
                      <Link
                        className="hover:underline"
                        href={`/admin/users/${inv.userId}`}
                      >
                        {email}
                      </Link>
                    ) : (
                      <span className="text-muted-foreground">
                        {inv.buyer.name} (compte supprimé)
                      </span>
                    )}
                  </td>
                  <td className="p-3">
                    {inv.issuedAt.toLocaleDateString("fr-FR")}
                  </td>
                  <td className="p-3">
                    {inv.dueAt.toLocaleDateString("fr-FR")}
                  </td>
                  <td className="p-3 text-right tabular-nums">
                    {formatMoney(inv.totalCents, inv.currency)}
                  </td>
                  <td className="p-3">
                    <StatusBadge tone={INVOICE_STATUS_TONE[inv.status]}>
                      {INVOICE_STATUS_LABEL[inv.status]}
                    </StatusBadge>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Pagination
        basePath="/support/invoices"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        params={{ status, q: q || undefined }}
      />
    </>
  )
}
