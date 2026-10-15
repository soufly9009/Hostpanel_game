import "server-only"

import { getBillingSettings } from "@/lib/billing/settings"

import { formatCredits } from "./format"
import { moveBalance } from "./service"
import { getWalletSettings } from "./settings"

/**
 * Facturation en crédits (désactivée par défaut, cf. réglages des crédits).
 * Le débit précède l'opération ; `refundCharge` le compense si elle échoue.
 * Les administrateurs ne sont jamais débités.
 */
export async function chargeForPlan(opts: {
  actor: { email: string; role: string }
  payerId: string
  plan: { name: string; priceCents: number }
  kind: "purchase" | "renewal"
  reference: string
  key: string
}): Promise<{ ok: true; charged: number } | { ok: false; error: string }> {
  const price = opts.plan.priceCents
  if (price <= 0 || opts.actor.role === "admin") return { ok: true, charged: 0 }
  // Mode factures : le paiement passe par une facture, pas par un débit direct.
  if ((await getBillingSettings()).mode === "invoices") {
    return { ok: true, charged: 0 }
  }
  const settings = await getWalletSettings()
  if (!settings.billingEnabled) return { ok: true, charged: 0 }

  const r = await moveBalance({
    userId: opts.payerId,
    amountCents: -price,
    kind: opts.kind,
    description: `${opts.kind === "purchase" ? "Commande" : "Renouvellement"} : ${opts.plan.name}`,
    actor: opts.actor.email,
    reference: opts.reference,
    idempotencyKey: opts.key,
  })
  if (!r.ok) {
    return {
      ok: false,
      error:
        r.code === "insufficient"
          ? `Solde insuffisant : ${formatCredits(price)} requis. Ajoute des crédits depuis « Mon solde ».`
          : r.error,
    }
  }
  if (r.duplicate) return { ok: false, error: "Opération déjà en cours." }
  return { ok: true, charged: price }
}

export async function refundCharge(opts: {
  payerId: string
  amountCents: number
  reference: string
  key: string
  reason: string
}) {
  if (opts.amountCents <= 0) return
  try {
    await moveBalance({
      userId: opts.payerId,
      amountCents: opts.amountCents,
      kind: "refund",
      description: opts.reason,
      actor: "système",
      reference: opts.reference,
      idempotencyKey: `refund:${opts.key}`,
    })
  } catch (e) {
    console.error("[wallet] remboursement impossible", e)
  }
}
