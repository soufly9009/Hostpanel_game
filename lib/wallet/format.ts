/**
 * Crédits : monnaie virtuelle du panel, sans valeur monétaire. Les montants
 * sont stockés en centimes de crédit (entiers) ; module pur (serveur/client).
 */

export const CREDIT_UNIT = "crédits"

export function formatCredits(cents: number, opts: { sign?: boolean } = {}) {
  const abs = Math.abs(cents)
  const value = (abs / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: abs % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
  const sign = cents < 0 ? "−" : opts.sign && cents > 0 ? "+" : ""
  return `${sign}${value} ${CREDIT_UNIT}`
}

/** « 12,50 » ou « 12.5 » → 1250 ; null si invalide (2 décimales max). */
export function parseCredits(input: unknown): number | null {
  const s = String(input ?? "")
    .trim()
    .replace(/\s/g, "")
    .replace(",", ".")
  if (!/^-?\d{1,9}(\.\d{1,2})?$/.test(s)) return null
  const [int, dec = ""] = s.replace("-", "").split(".")
  const cents = Number(int) * 100 + Number(dec.padEnd(2, "0"))
  return s.startsWith("-") ? -cents : cents
}

export const KIND_LABEL: Record<string, string> = {
  adjustment: "Ajustement",
  api: "API",
  coupon: "Coupon",
  gift_card: "Carte cadeau",
  purchase: "Commande",
  renewal: "Renouvellement",
  refund: "Remboursement",
  invoice: "Facture",
}

/** Carte cadeau : XXXX-XXXX-XXXX-XXXX (alphabet sans caractères ambigus). */
export const GIFT_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
export const GIFT_RE = /^[A-HJ-NP-Z2-9]{4}(-[A-HJ-NP-Z2-9]{4}){3}$/
export const COUPON_RE = /^[A-Z0-9][A-Z0-9_-]{2,31}$/

/** Majuscules, sans espaces ; une carte saisie sans tirets est reformatée. */
export function normalizeCode(raw: unknown) {
  const s = String(raw ?? "")
    .toUpperCase()
    .replace(/\s+/g, "")
    .slice(0, 64)
  const bare = s.replace(/-/g, "")
  if (/^[A-HJ-NP-Z2-9]{16}$/.test(bare)) {
    return bare.match(/.{4}/g)!.join("-")
  }
  return s
}
