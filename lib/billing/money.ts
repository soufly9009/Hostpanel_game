/**
 * Calculs de facturation (module pur, partagé serveur/client). Montants en
 * centimes, taux en points de base (2000 = 20 %).
 */

export type LineInput = {
  description: string
  quantity: number
  /** Prix unitaire saisi : TTC si `pricesIncludeTax`, sinon HT. */
  unitPriceCents: number
}

export type ComputedLine = LineInput & {
  /** Prix unitaire HT et total HT de la ligne. */
  unitCents: number
  totalCents: number
}

export function computeInvoice(
  lines: LineInput[],
  opts: { taxRateBp: number; pricesIncludeTax: boolean }
) {
  const bp = Math.max(0, opts.taxRateBp)
  const htOf = (ttc: number) => Math.round((ttc * 10_000) / (10_000 + bp))

  const items: ComputedLine[] = lines.map((l) => {
    const unitCents = opts.pricesIncludeTax
      ? htOf(l.unitPriceCents)
      : l.unitPriceCents
    // Ligne lisible : PU HT × quantité = total HT (la taxe absorbe l'arrondi).
    return { ...l, unitCents, totalCents: unitCents * l.quantity }
  })

  const subtotalCents = items.reduce((s, i) => s + i.totalCents, 0)
  const totalCents = opts.pricesIncludeTax
    ? lines.reduce((s, l) => s + l.unitPriceCents * l.quantity, 0)
    : subtotalCents + Math.round((subtotalCents * bp) / 10_000)
  return {
    items,
    subtotalCents,
    taxCents: totalCents - subtotalCents,
    totalCents,
  }
}

export function formatMoney(cents: number, currency = "EUR") {
  return new Intl.NumberFormat("fr-FR", { style: "currency", currency }).format(
    cents / 100
  )
}

export const formatRate = (bp: number) =>
  `${(bp / 100).toLocaleString("fr-FR", { maximumFractionDigits: 2 })} %`

export const INVOICE_STATUS_LABEL: Record<string, string> = {
  unpaid: "À payer",
  paid: "Payée",
  cancelled: "Annulée",
  refunded: "Remboursée",
}

export const INVOICE_STATUS_TONE: Record<
  string,
  "success" | "warning" | "danger" | "neutral" | "info"
> = {
  unpaid: "warning",
  paid: "success",
  cancelled: "neutral",
  refunded: "info",
}

export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  credits: "Solde de crédits",
  bank_transfer: "Virement bancaire",
  manual: "Paiement manuel",
  card: "Carte bancaire",
  paypal: "PayPal",
}
