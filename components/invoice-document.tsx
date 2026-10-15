import { StatusBadge } from "@/components/kit"
import {
  formatMoney,
  formatRate,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
  PAYMENT_METHOD_LABEL,
} from "@/lib/billing/money"
import type {
  Invoice,
  InvoiceItem,
  InvoiceParty,
  Payment,
} from "@/lib/db/schema"

const date = (d: Date) => d.toLocaleDateString("fr-FR", { dateStyle: "long" })

function Party({ title, p }: { title: string; p: InvoiceParty }) {
  return (
    <div className="text-sm">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
        {title}
      </p>
      <p className="mt-1 font-medium">{p.name}</p>
      {p.company && <p>{p.company}</p>}
      {p.lines.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {p.vatNumber && <p>TVA : {p.vatNumber}</p>}
      {p.extra?.map((l, i) => (
        <p key={i}>{l}</p>
      ))}
      {p.email && <p className="text-muted-foreground">{p.email}</p>}
    </div>
  )
}

/** Facture ou avoir, tel qu'émis (données figées). */
export function InvoiceDocument({
  invoice: inv,
  items,
  payments,
  relatedNumber,
}: {
  invoice: Invoice
  items: InvoiceItem[]
  payments: Payment[]
  relatedNumber?: string | null
}) {
  const money = (c: number) => formatMoney(c, inv.currency)
  const isCredit = inv.type === "credit_note"
  return (
    <article className="flex flex-col gap-6 rounded-xl border bg-card p-6 print:border-0 print:p-0">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">
            {isCredit ? "Avoir" : "Facture"} {inv.number}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Émise le {date(inv.issuedAt)}
            {!isCredit && ` · échéance le ${date(inv.dueAt)}`}
            {inv.paidAt && ` · réglée le ${date(inv.paidAt)}`}
          </p>
          {relatedNumber && (
            <p className="text-sm text-muted-foreground">
              {isCredit ? "Sur la facture" : "Avoir associé"} : {relatedNumber}
            </p>
          )}
        </div>
        <StatusBadge tone={INVOICE_STATUS_TONE[inv.status]}>
          {INVOICE_STATUS_LABEL[inv.status]}
        </StatusBadge>
      </header>

      <div className="grid gap-6 sm:grid-cols-2">
        <Party title="Vendeur" p={inv.seller} />
        <Party title="Client" p={inv.buyer} />
      </div>

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
            {items.map((it) => (
              <tr key={it.id}>
                <td className="py-2 pr-3">{it.description}</td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {it.quantity}
                </td>
                <td className="py-2 pr-3 text-right tabular-nums">
                  {money(it.unitCents)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {money(it.totalCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-1 text-sm">
        <dt className="text-muted-foreground">Total HT</dt>
        <dd className="text-right tabular-nums">{money(inv.subtotalCents)}</dd>
        <dt className="text-muted-foreground">
          {inv.taxLabel} ({formatRate(inv.taxRateBp)})
        </dt>
        <dd className="text-right tabular-nums">{money(inv.taxCents)}</dd>
        <dt className="font-semibold">Total TTC</dt>
        <dd className="text-right font-semibold tabular-nums">
          {money(inv.totalCents)}
        </dd>
      </dl>

      {payments.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Règlements</p>
          <ul className="mt-1 text-muted-foreground">
            {payments.map((p) => (
              <li key={p.id}>
                {date(p.createdAt)} ·{" "}
                {PAYMENT_METHOD_LABEL[p.method] ?? p.method} ·{" "}
                {money(p.amountCents)}
                {p.reference && ` · réf. ${p.reference.slice(0, 40)}`}
              </li>
            ))}
          </ul>
        </div>
      )}

      {(inv.notes || inv.legalMentions.length > 0) && (
        <footer className="border-t pt-4 text-xs text-muted-foreground">
          {inv.notes && <p className="mb-2">{inv.notes}</p>}
          {inv.legalMentions.map((m, i) => (
            <p key={i}>{m}</p>
          ))}
        </footer>
      )}
    </article>
  )
}
