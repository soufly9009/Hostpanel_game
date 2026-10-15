"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { requireAdmin, requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

import { getViewableInvoice } from "./access"
import {
  cancelInvoice,
  createInvoice,
  markPaid,
  payWithCredits,
} from "./service"
import { saveBillingSettings } from "./settings"

export type BillingState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const DENIED = { error: "Permission insuffisante." }

function refresh(invoiceId?: string, userId?: string | null) {
  revalidatePath("/invoices")
  if (invoiceId) revalidatePath(`/invoices/${invoiceId}`)
  revalidatePath("/support/invoices")
  if (userId) revalidatePath(`/admin/users/${userId}`)
}

/* ───────────── Client ───────────── */

export async function payWithCreditsAction(
  invoiceId: string
): Promise<BillingState> {
  const user = await requireUser()
  const v = await getViewableInvoice(invoiceId)
  if (!v || !v.isOwner) return { error: "Facture introuvable" }
  const r = await payWithCredits(invoiceId, user.email)
  if (!r.ok) return { error: r.error }
  refresh(invoiceId, user.id)
  return { ok: true, notice: "Facture réglée. Merci !" }
}

const profileSchema = z.object({
  fullName: z.string().trim().min(2, "Nom requis").max(120),
  company: z.string().trim().max(120).optional(),
  address1: z.string().trim().min(3, "Adresse requise").max(160),
  address2: z.string().trim().max(160).optional(),
  postalCode: z.string().trim().min(2, "Code postal requis").max(20),
  city: z.string().trim().min(1, "Ville requise").max(80),
  country: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{2}$/, "Pays : code à 2 lettres (FR, BE…)"),
  vatNumber: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^([A-Z]{2}[A-Z0-9]{2,13})?$/, "N° de TVA invalide")
    .optional(),
  phone: z.string().trim().max(30).optional(),
})

async function saveProfile(userId: string, formData: FormData) {
  const parsed = profileSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const d = parsed.data
  const values = {
    fullName: d.fullName,
    company: d.company || null,
    address1: d.address1,
    address2: d.address2 || null,
    postalCode: d.postalCode,
    city: d.city,
    country: d.country,
    vatNumber: d.vatNumber || null,
    phone: d.phone || null,
    autoPayWithCredits: formData.get("autoPayWithCredits") !== null,
    updatedAt: new Date(),
  }
  await db
    .insert(schema.billingProfiles)
    .values({ userId, ...values })
    .onConflictDoUpdate({ target: schema.billingProfiles.userId, set: values })
  return null
}

/** Coordonnées de facturation du client connecté (factures futures). */
export async function saveBillingProfileAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const user = await requireUser()
  const err = await saveProfile(user.id, formData)
  if (err) return err
  await logActivity(user, "Coordonnées de facturation modifiées", {
    type: "account",
  })
  revalidatePath("/account")
  return {
    ok: true,
    notice:
      "Enregistré. Les factures déjà émises ne changent pas (elles sont figées).",
  }
}

/** Même formulaire, depuis la fiche client (administrateur). */
export async function adminSaveBillingProfileAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const admin = await requireAdmin()
  const userId = z.string().min(1).max(64).safeParse(formData.get("userId"))
  if (!userId.success) return { error: "Client invalide" }
  const err = await saveProfile(userId.data, formData)
  if (err) return err
  await logActivity(admin, "Coordonnées de facturation d'un client modifiées", {
    type: "account",
    id: userId.data,
  })
  revalidatePath(`/admin/users/${userId.data}`)
  return { ok: true, notice: "Coordonnées enregistrées." }
}

/* ───────────── Personnel ───────────── */

async function manager() {
  const user = await requireStaff()
  return (await can(user, "billing.manage")) ? user : null
}

const paymentSchema = z.object({
  method: z.enum(["bank_transfer", "manual", "card", "paypal"]),
  reference: z.string().trim().max(120).optional(),
  note: z.string().trim().max(300).optional(),
})

/** Constate un paiement reçu hors panel (virement, espèces…). */
export async function recordPaymentAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const staff = await manager()
  if (!staff) return DENIED
  const id = String(formData.get("invoiceId") ?? "")
  const parsed = paymentSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const v = await getViewableInvoice(id)
  if (!v) return { error: "Facture introuvable" }

  const ok = await markPaid(id, {
    method: parsed.data.method,
    amountCents: v.invoice.totalCents,
    reference: parsed.data.reference || null,
    note: parsed.data.note || null,
    actor: staff.email,
  })
  if (!ok) return { error: "Facture déjà réglée ou annulée." }
  await logActivity(staff, `Paiement enregistré : ${v.invoice.number}`, {
    type: "invoice",
    id,
    label: v.invoice.number,
  })
  auditSensitive(staff, "Paiement de facture enregistré", {
    facture: v.invoice.number,
    moyen: parsed.data.method,
  })
  refresh(id, v.invoice.userId)
  return { ok: true, notice: "Paiement enregistré, services prolongés." }
}

export async function cancelInvoiceAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const staff = await manager()
  if (!staff) return DENIED
  const id = String(formData.get("invoiceId") ?? "")
  const reason = String(formData.get("reason") ?? "").trim()
  if (reason.length < 3) return { error: "Indique un motif." }
  const r = await cancelInvoice(id, {
    actor: staff.email,
    reason: reason.slice(0, 300),
    refundToCredits: formData.get("refundToCredits") !== null,
  })
  if (!r.ok) return { error: r.error }
  auditSensitive(staff, "Avoir émis", { avoir: r.creditNote.number }, "warning")
  refresh(id, r.creditNote.userId)
  return { ok: true, notice: `Avoir ${r.creditNote.number} émis.` }
}

/** Facture manuelle (lignes libres) depuis la fiche client. */
export async function createCustomInvoiceAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const staff = await manager()
  if (!staff) return DENIED
  const userId = z.string().min(1).max(64).safeParse(formData.get("userId"))
  if (!userId.success) return { error: "Client invalide" }

  const descriptions = formData.getAll("description").map(String)
  const quantities = formData.getAll("quantity").map(Number)
  const prices = formData.getAll("price").map(String)
  const lines = descriptions
    .map((d, i) => ({
      description: d.trim().slice(0, 200),
      quantity: Number.isInteger(quantities[i]) ? quantities[i] : 1,
      price: prices[i]?.trim().replace(",", "."),
    }))
    .filter((l) => l.description)
  if (lines.length === 0) return { error: "Ajoute au moins une ligne." }

  const parsedLines = []
  for (const l of lines) {
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(l.price ?? "")) {
      return { error: `Prix invalide : « ${l.description} »` }
    }
    if (l.quantity < 1 || l.quantity > 1000)
      return { error: "Quantité invalide" }
    parsedLines.push({
      description: l.description,
      quantity: l.quantity,
      unitPriceCents: Math.round(Number(l.price) * 100),
    })
  }
  const days = Math.min(90, Math.max(0, Number(formData.get("dueDays") || 7)))
  const invoice = await createInvoice({
    userId: userId.data,
    lines: parsedLines,
    dueAt: new Date(Date.now() + days * 86_400_000),
    notes:
      String(formData.get("notes") ?? "")
        .trim()
        .slice(0, 500) || null,
    actor: staff.email,
  })
  if (!invoice) return { error: "Facture non émise." }
  refresh(invoice.id, userId.data)
  return { ok: true, notice: `Facture ${invoice.number} émise.` }
}

/* ───────────── Administration : réglages ───────────── */

const str = (f: FormData, k: string) => String(f.get(k) ?? "").trim()
const int = (f: FormData, k: string) => Number.parseInt(str(f, k) || "0", 10)

export async function saveBillingSettingsAction(
  _prev: BillingState,
  formData: FormData
): Promise<BillingState> {
  const admin = await requireAdmin()
  const rate = Number(str(formData, "taxRate").replace(",", "."))
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) {
    return { error: "Taux de taxe invalide" }
  }
  const res = await saveBillingSettings({
    mode: str(formData, "mode") === "invoices" ? "invoices" : "off",
    currency: str(formData, "currency").toUpperCase() || "EUR",
    taxRateBp: Math.round(rate * 100),
    taxLabel: str(formData, "taxLabel") || "TVA",
    pricesIncludeTax: formData.get("pricesIncludeTax") !== null,
    taxExemptMention: str(formData, "taxExemptMention"),
    invoicePrefix: str(formData, "invoicePrefix").toUpperCase(),
    creditNotePrefix: str(formData, "creditNotePrefix").toUpperCase(),
    orderDueDays: int(formData, "orderDueDays"),
    renewalDaysBefore: int(formData, "renewalDaysBefore"),
    reminderDaysBefore: int(formData, "reminderDaysBefore"),
    allowCreditPayment: formData.get("allowCreditPayment") !== null,
    bankTransferEnabled: formData.get("bankTransferEnabled") !== null,
    paymentInstructions: str(formData, "paymentInstructions"),
    latePenaltyMention: str(formData, "latePenaltyMention"),
    seller: {
      name: str(formData, "seller.name"),
      legalForm: str(formData, "seller.legalForm"),
      address1: str(formData, "seller.address1"),
      address2: str(formData, "seller.address2"),
      postalCode: str(formData, "seller.postalCode"),
      city: str(formData, "seller.city"),
      country: str(formData, "seller.country"),
      siret: str(formData, "seller.siret"),
      rcs: str(formData, "seller.rcs"),
      vatNumber: str(formData, "seller.vatNumber").toUpperCase(),
      email: str(formData, "seller.email"),
    },
  })
  if (!res.ok) return { error: res.error }
  auditSensitive(admin, "Réglages de facturation modifiés", {
    mode: str(formData, "mode"),
  })
  revalidatePath("/admin/billing")
  return { ok: true, notice: "Réglages enregistrés." }
}

/** Ouvre la facture d'un client (raccourci de recherche par numéro). */
export async function findInvoiceAction(formData: FormData) {
  await requireStaff()
  const number = String(formData.get("number") ?? "")
    .trim()
    .toUpperCase()
  const [inv] = await db
    .select({ id: schema.invoices.id })
    .from(schema.invoices)
    .where(eq(schema.invoices.number, number))
  redirect(inv ? `/invoices/${inv.id}` : "/support/invoices?notfound=1")
}
