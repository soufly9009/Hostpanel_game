"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { requireUser } from "@/lib/auth/session"
import { computeInvoice, formatMoney } from "@/lib/billing/money"
import { createInvoice, nextNumber, tryAutoPay } from "@/lib/billing/service"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"
import { links, queueUserEmail } from "@/lib/mail/service"
import { notify } from "@/lib/notifications"
import { emitEvent } from "@/lib/webhooks/service"

export type QuoteState =
  { error?: string; ok?: boolean; notice?: string } | undefined

function refresh(id?: string, userId?: string | null) {
  revalidatePath("/quotes")
  if (id) revalidatePath(`/quotes/${id}`)
  if (userId) revalidatePath(`/admin/users/${userId}`)
}

/** Devis (personnel avec billing.manage) : lignes libres, validité en jours. */
export async function createQuoteAction(
  _prev: QuoteState,
  formData: FormData
): Promise<QuoteState> {
  const staff = await requireStaff()
  if (!(await can(staff, "billing.manage")))
    return { error: "Permission insuffisante." }
  const userId = z.string().min(1).max(64).safeParse(formData.get("userId"))
  const title = String(formData.get("title") ?? "")
    .trim()
    .slice(0, 160)
  if (!userId.success) return { error: "Client invalide" }
  if (title.length < 3) return { error: "Titre requis." }

  const descriptions = formData.getAll("description").map(String)
  const quantities = formData.getAll("quantity").map(Number)
  const prices = formData
    .getAll("price")
    .map((p) => String(p).trim().replace(",", "."))
  const lines: {
    description: string
    quantity: number
    unitPriceCents: number
  }[] = []
  for (let i = 0; i < descriptions.length; i++) {
    const d = descriptions[i].trim().slice(0, 200)
    if (!d) continue
    if (!/^\d{1,7}(\.\d{1,2})?$/.test(prices[i] ?? ""))
      return { error: `Prix invalide : « ${d} »` }
    const q = Number.isInteger(quantities[i]) ? quantities[i] : 1
    if (q < 1 || q > 1000) return { error: "Quantité invalide" }
    lines.push({
      description: d,
      quantity: q,
      unitPriceCents: Math.round(Number(prices[i]) * 100),
    })
  }
  if (lines.length === 0) return { error: "Ajoute au moins une ligne." }

  const s = await getBillingSettings()
  const totals = computeInvoice(lines, {
    taxRateBp: s.taxRateBp,
    pricesIncludeTax: s.pricesIncludeTax,
  })
  const days = Math.min(
    180,
    Math.max(1, Number(formData.get("validDays") || 30))
  )
  const now = new Date()
  const quote = await db.transaction(async (tx) => {
    const [q] = await tx
      .insert(schema.quotes)
      .values({
        number: await nextNumber(tx, "DV", now),
        userId: userId.data,
        title,
        currency: s.currency,
        subtotalCents: totals.subtotalCents,
        taxCents: totals.taxCents,
        totalCents: totals.totalCents,
        taxRateBp: s.taxRateBp,
        taxLabel: s.taxLabel,
        lines,
        notes:
          String(formData.get("notes") ?? "")
            .trim()
            .slice(0, 1000) || null,
        validUntil: new Date(now.getTime() + days * 86_400_000),
        createdBy: staff.email,
      })
      .returning()
    return q
  })

  const total = formatMoney(quote.totalCents, quote.currency)
  await notify({
    userId: userId.data,
    dedupeKey: `quote:${quote.id}`,
    title: `Devis ${quote.number} : ${total}`,
    body: title,
    href: `/quotes/${quote.id}`,
  })
  await queueUserEmail(userId.data, "quote_sent", {
    number: quote.number,
    title,
    total,
    validUntil: quote.validUntil.toLocaleDateString("fr-FR"),
    quoteUrl: links.quote(quote.id),
  })
  await logActivity(staff, `Devis ${quote.number} envoyé`, {
    type: "quote",
    id: quote.id,
  })
  refresh(quote.id, userId.data)
  return { ok: true, notice: `Devis ${quote.number} envoyé au client.` }
}

async function ownQuote(id: string) {
  const user = await requireUser()
  const [q] = await db
    .select()
    .from(schema.quotes)
    .where(
      and(
        eq(schema.quotes.id, z.string().max(64).parse(id)),
        eq(schema.quotes.userId, user.id)
      )
    )
  return q ? { user, q } : null
}

/** Acceptation : la facture est émise aussitôt (et réglée par le solde si possible). */
export async function acceptQuoteAction(id: string): Promise<QuoteState> {
  const own = await ownQuote(id)
  if (!own) return { error: "Devis introuvable" }
  const { user, q } = own
  if (q.status !== "sent") return { error: "Ce devis n'est plus modifiable." }
  if (q.validUntil < new Date())
    return { error: "Ce devis a expiré : contacte le support." }

  // Transition atomique : un double clic n'émet pas deux factures.
  const claim = await db
    .update(schema.quotes)
    .set({ status: "accepted", respondedAt: new Date() })
    .where(and(eq(schema.quotes.id, q.id), eq(schema.quotes.status, "sent")))
  if (claim.rowsAffected !== 1) return { error: "Devis déjà traité." }

  const invoice = await createInvoice({
    userId: user.id,
    lines: q.lines,
    dueAt: new Date(Date.now() + 7 * 86_400_000),
    notes: `Devis ${q.number} accepté le ${new Date().toLocaleDateString("fr-FR")}.`,
    actor: user.email,
  })
  if (invoice) {
    await db
      .update(schema.quotes)
      .set({ invoiceId: invoice.id })
      .where(eq(schema.quotes.id, q.id))
    await tryAutoPay(invoice)
  }
  void emitEvent("quote.accepted", {
    quoteId: q.id,
    number: q.number,
    userId: user.id,
    invoiceId: invoice?.id ?? null,
  })
  await logActivity(user, `Devis ${q.number} accepté`, {
    type: "quote",
    id: q.id,
  })
  refresh(q.id, user.id)
  redirect(invoice ? `/invoices/${invoice.id}` : `/quotes/${q.id}`)
}

export async function declineQuoteAction(id: string): Promise<QuoteState> {
  const own = await ownQuote(id)
  if (!own) return { error: "Devis introuvable" }
  const res = await db
    .update(schema.quotes)
    .set({ status: "declined", respondedAt: new Date() })
    .where(
      and(eq(schema.quotes.id, own.q.id), eq(schema.quotes.status, "sent"))
    )
  if (res.rowsAffected !== 1) return { error: "Devis déjà traité." }
  await logActivity(own.user, `Devis ${own.q.number} refusé`, {
    type: "quote",
    id: own.q.id,
  })
  refresh(own.q.id, own.user.id)
  return { ok: true, notice: "Devis refusé." }
}

export async function cancelQuoteAction(id: string): Promise<QuoteState> {
  const staff = await requireStaff()
  if (!(await can(staff, "billing.manage")))
    return { error: "Permission insuffisante." }
  const [q] = await db
    .update(schema.quotes)
    .set({ status: "cancelled" })
    .where(
      and(
        eq(schema.quotes.id, z.string().max(64).parse(id)),
        eq(schema.quotes.status, "sent")
      )
    )
    .returning()
  if (!q) return { error: "Devis déjà traité." }
  await logActivity(staff, `Devis ${q.number} annulé`, {
    type: "quote",
    id: q.id,
  })
  refresh(q.id, q.userId)
  return { ok: true }
}
