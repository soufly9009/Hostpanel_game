import "server-only"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"

const KEY = "billing"

const sellerSchema = z.object({
  name: z.string().max(120),
  legalForm: z.string().max(80),
  address1: z.string().max(160),
  address2: z.string().max(160),
  postalCode: z.string().max(20),
  city: z.string().max(80),
  country: z.string().max(60),
  siret: z.string().max(40),
  rcs: z.string().max(80),
  vatNumber: z.string().max(40),
  email: z.string().max(120),
})

export const billingSettingsSchema = z.object({
  /** off : pas de factures (crédits débités directement si activé). */
  mode: z.enum(["off", "invoices"]),
  currency: z.string().regex(/^[A-Z]{3}$/),
  taxRateBp: z.number().int().min(0).max(10_000),
  taxLabel: z.string().min(1).max(20),
  /** Prix des offres saisis TTC (vente aux particuliers) ou HT. */
  pricesIncludeTax: z.boolean(),
  /** Ex. « TVA non applicable, art. 293 B du CGI » (taux 0). */
  taxExemptMention: z.string().max(200),
  invoicePrefix: z.string().regex(/^[A-Z0-9]{1,6}$/),
  creditNotePrefix: z.string().regex(/^[A-Z0-9]{1,6}$/),
  /** Délai de paiement d'une commande (le service est actif pendant ce délai). */
  orderDueDays: z.number().int().min(0).max(60),
  /** Facture de renouvellement émise N jours avant l'échéance. */
  renewalDaysBefore: z.number().int().min(1).max(60),
  /** Rappel N jours avant l'échéance de la facture. */
  reminderDaysBefore: z.number().int().min(0).max(30),
  /** Le solde de crédits peut régler une facture (1 crédit = 1 unité de devise). */
  allowCreditPayment: z.boolean(),
  /** Virement accepté : instructions affichées sur la facture (IBAN…). */
  bankTransferEnabled: z.boolean(),
  paymentInstructions: z.string().max(1000),
  latePenaltyMention: z.string().max(500),
  seller: sellerSchema,
})
export type BillingSettings = z.infer<typeof billingSettingsSchema>

export const DEFAULT_BILLING_SETTINGS: BillingSettings = {
  mode: "off",
  currency: "EUR",
  taxRateBp: 2000,
  taxLabel: "TVA",
  pricesIncludeTax: true,
  taxExemptMention: "",
  invoicePrefix: "FA",
  creditNotePrefix: "AV",
  orderDueDays: 3,
  renewalDaysBefore: 7,
  reminderDaysBefore: 3,
  allowCreditPayment: true,
  bankTransferEnabled: false,
  paymentInstructions: "",
  latePenaltyMention:
    "En cas de retard de paiement, des pénalités au taux de trois fois le taux d'intérêt légal sont exigibles, ainsi qu'une indemnité forfaitaire de 40 € pour frais de recouvrement (clients professionnels). Pas d'escompte pour paiement anticipé.",
  seller: {
    name: "",
    legalForm: "",
    address1: "",
    address2: "",
    postalCode: "",
    city: "",
    country: "France",
    siret: "",
    rcs: "",
    vatNumber: "",
    email: "",
  },
}

export async function getBillingSettings(): Promise<BillingSettings> {
  try {
    const [row] = await db
      .select()
      .from(schema.appSettings)
      .where(eq(schema.appSettings.key, KEY))
    const parsed = billingSettingsSchema.safeParse({
      ...DEFAULT_BILLING_SETTINGS,
      ...(row?.value as object | undefined),
    })
    if (parsed.success) return parsed.data
  } catch {
    // table absente : défauts
  }
  return DEFAULT_BILLING_SETTINGS
}

export async function saveBillingSettings(input: unknown) {
  const parsed = billingSettingsSchema.safeParse(input)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { ok: false as const, error: `${i?.path.join(".")} : ${i?.message}` }
  }
  await db
    .insert(schema.appSettings)
    .values({ key: KEY, value: parsed.data })
    .onConflictDoUpdate({
      target: schema.appSettings.key,
      set: { value: parsed.data, updatedAt: new Date() },
    })
  return { ok: true as const }
}

/** Mentions vendeur manquantes pour émettre des factures conformes. */
export function missingSellerFields(s: BillingSettings) {
  const m: string[] = []
  if (!s.seller.name) m.push("raison sociale")
  if (!s.seller.address1 || !s.seller.postalCode || !s.seller.city) {
    m.push("adresse")
  }
  if (!s.seller.siret) m.push("SIREN/SIRET")
  if (s.taxRateBp > 0 && !s.seller.vatNumber) m.push("n° de TVA")
  if (s.taxRateBp === 0 && !s.taxExemptMention)
    m.push("mention d'exonération de TVA")
  return m
}
