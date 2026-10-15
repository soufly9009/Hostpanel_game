import "server-only"

import { and, eq, inArray, sql } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"
import { errorText, logError, logSuccess } from "@/lib/discord/logging"
import { links, queueUserEmail } from "@/lib/mail/service"
import { notify } from "@/lib/notifications"
import { unsuspendGameServer } from "@/lib/pterodactyl/client"
import { extendedExpiry, newExpiry } from "@/lib/renewals"
import { rewardReferrer } from "@/lib/referrals/service"
import { moveBalance } from "@/lib/wallet/service"
import { emitEvent } from "@/lib/webhooks/service"

import { computeInvoice, formatMoney } from "./money"
import { getBillingSettings, type BillingSettings } from "./settings"

/**
 * Factures (prêtes pour l'argent réel) :
 * - numérotation continue sans trou par préfixe et année (`invoice_sequences`,
 *   attribuée dans la même transaction que la facture) ;
 * - une facture émise n'est jamais modifiée ni supprimée : l'annulation crée
 *   un AVOIR (credit_note) ; vendeur et acheteur sont figés à l'émission ;
 * - le paiement (crédits, virement constaté, passerelle future) passe par
 *   `markPaid`, qui prolonge les services liés.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]

export type ServiceType = "vps" | "game"

export type NewLine = {
  description: string
  quantity?: number
  /** Prix unitaire tel que configuré (TTC ou HT selon les réglages). */
  unitPriceCents: number
  serviceType?: ServiceType
  serviceId?: string
  kind?: "order" | "renewal" | "custom"
  periodKey?: number | null
}

export async function nextNumber(tx: Tx, prefix: string, date: Date) {
  const key = `${prefix}-${date.getFullYear()}`
  await tx
    .insert(schema.invoiceSequences)
    .values({ key, last: 0 })
    .onConflictDoNothing()
  const [row] = await tx
    .update(schema.invoiceSequences)
    .set({ last: sql`${schema.invoiceSequences.last} + 1` })
    .where(eq(schema.invoiceSequences.key, key))
    .returning({ last: schema.invoiceSequences.last })
  return `${key}-${String(row.last).padStart(6, "0")}`
}

function sellerParty(s: BillingSettings): schema.InvoiceParty {
  const v = s.seller
  return {
    name: v.name || "[Raison sociale à configurer]",
    company: v.legalForm || null,
    lines: [
      v.address1,
      v.address2,
      [v.postalCode, v.city].filter(Boolean).join(" "),
      v.country,
    ].filter(Boolean),
    vatNumber: v.vatNumber || null,
    extra: [v.siret && `SIRET : ${v.siret}`, v.rcs && v.rcs].filter(
      Boolean
    ) as string[],
    email: v.email || null,
  }
}

async function buyerParty(userId: string): Promise<schema.InvoiceParty> {
  const [row] = await db
    .select({ user: schema.users, profile: schema.billingProfiles })
    .from(schema.users)
    .leftJoin(
      schema.billingProfiles,
      eq(schema.billingProfiles.userId, schema.users.id)
    )
    .where(eq(schema.users.id, userId))
  if (!row) throw new Error("Compte introuvable")
  const p = row.profile
  return {
    name: p?.fullName || row.user.name || row.user.email,
    company: p?.company || null,
    lines: [
      p?.address1,
      p?.address2,
      [p?.postalCode, p?.city].filter(Boolean).join(" "),
      p?.country,
    ].filter(Boolean) as string[],
    vatNumber: p?.vatNumber || null,
    email: row.user.email,
  }
}

function mentions(s: BillingSettings, type: "invoice" | "credit_note") {
  const m: string[] = []
  if (s.taxRateBp === 0 && s.taxExemptMention) m.push(s.taxExemptMention)
  if (type === "invoice" && s.latePenaltyMention) m.push(s.latePenaltyMention)
  return m
}

/**
 * Émet une facture. Renvoie null si une ligne de renouvellement existe déjà
 * pour la même période (facture déjà émise). Une facture à 0 est réglée
 * immédiatement.
 */
export async function createInvoice(input: {
  userId: string
  lines: NewLine[]
  dueAt?: Date
  notes?: string | null
  actor?: string
}) {
  const s = await getBillingSettings()
  const now = new Date()
  const computed = computeInvoice(
    input.lines.map((l) => ({
      description: l.description,
      quantity: l.quantity ?? 1,
      unitPriceCents: l.unitPriceCents,
    })),
    { taxRateBp: s.taxRateBp, pricesIncludeTax: s.pricesIncludeTax }
  )
  const buyer = await buyerParty(input.userId)

  let invoice: schema.Invoice
  try {
    invoice = await db.transaction(async (tx) => {
      const [inv] = await tx
        .insert(schema.invoices)
        .values({
          number: await nextNumber(tx, s.invoicePrefix, now),
          type: "invoice",
          userId: input.userId,
          currency: s.currency,
          subtotalCents: computed.subtotalCents,
          taxCents: computed.taxCents,
          totalCents: computed.totalCents,
          taxRateBp: s.taxRateBp,
          taxLabel: s.taxLabel,
          legalMentions: mentions(s, "invoice"),
          seller: sellerParty(s),
          buyer,
          issuedAt: now,
          dueAt: input.dueAt ?? now,
          notes: input.notes ?? null,
        })
        .returning()
      await tx.insert(schema.invoiceItems).values(
        computed.items.map((c, i) => ({
          invoiceId: inv.id,
          description: c.description,
          quantity: c.quantity,
          unitCents: c.unitCents,
          totalCents: c.totalCents,
          serviceType: input.lines[i].serviceType ?? null,
          serviceId: input.lines[i].serviceId ?? null,
          kind: input.lines[i].kind ?? "custom",
          periodKey: input.lines[i].periodKey ?? null,
        }))
      )
      return inv
    })
  } catch (e) {
    if (isUniqueViolation(e)) return null
    throw e
  }

  await logActivity(
    input.actor ? { id: "", email: input.actor } : null,
    `Facture ${invoice.number} émise (${formatMoney(invoice.totalCents, invoice.currency)})`,
    { type: "invoice", id: invoice.id, label: invoice.number }
  )

  void emitEvent("invoice.created", {
    invoiceId: invoice.id,
    number: invoice.number,
    userId: invoice.userId,
    totalCents: invoice.totalCents,
    currency: invoice.currency,
    dueAt: invoice.dueAt.toISOString(),
  })

  if (invoice.totalCents <= 0) {
    await markPaid(invoice.id, {
      method: "manual",
      amountCents: 0,
      note: "Montant nul",
      actor: "système",
    })
    return invoice
  }

  await notify({
    userId: input.userId,
    dedupeKey: `invoice:${invoice.id}`,
    title: `Facture ${invoice.number} : ${formatMoney(invoice.totalCents, invoice.currency)}`,
    body: `À régler avant le ${invoice.dueAt.toLocaleDateString("fr-FR")}.`,
    href: `/invoices/${invoice.id}`,
  })
  await queueUserEmail(input.userId, "invoice_created", {
    number: invoice.number,
    total: formatMoney(invoice.totalCents, invoice.currency),
    dueDate: invoice.dueAt.toLocaleDateString("fr-FR"),
    invoiceUrl: links.invoice(invoice.id),
  })
  return invoice
}

/* ───────────── Paiement ───────────── */

/**
 * Enregistre le paiement intégral (transition atomique unpaid → paid) puis
 * applique les effets sur les services. Renvoie false si déjà réglée.
 */
export async function markPaid(
  invoiceId: string,
  p: {
    method: (typeof schema.PAYMENT_METHODS)[number]
    amountCents: number
    reference?: string | null
    note?: string | null
    actor: string
  }
) {
  const now = new Date()
  const paid = await db.transaction(async (tx) => {
    const [inv] = await tx
      .update(schema.invoices)
      .set({ status: "paid", paidAt: now })
      .where(
        and(
          eq(schema.invoices.id, invoiceId),
          eq(schema.invoices.status, "unpaid"),
          eq(schema.invoices.type, "invoice")
        )
      )
      .returning()
    if (!inv) return null
    await tx.insert(schema.payments).values({
      invoiceId,
      userId: inv.userId,
      method: p.method,
      amountCents: p.amountCents,
      reference: p.reference ?? null,
      note: p.note ?? null,
      createdBy: p.actor,
    })
    return inv
  })
  if (!paid) return false

  await applyPaidEffects(paid)

  if (paid.userId && paid.totalCents > 0) {
    await queueUserEmail(paid.userId, "invoice_paid", {
      number: paid.number,
      total: formatMoney(paid.totalCents, paid.currency),
      invoiceUrl: links.invoice(paid.id),
    })
  }
  void emitEvent("invoice.paid", {
    invoiceId: paid.id,
    number: paid.number,
    userId: paid.userId,
    totalCents: paid.totalCents,
    currency: paid.currency,
    method: p.method,
  })
  if (paid.userId && paid.totalCents > 0) {
    await rewardReferrer(paid.userId, "first_payment").catch(() => undefined)
  }
  void logSuccess({
    category: "billing",
    title: "Facture réglée",
    service: "Facturation",
    action: "paiement",
    result: "success",
    meta: { facture: paid.number, moyen: p.method },
    dedupeKey: `paid:${paid.id}`,
  })
  return true
}

/** Règle avec le solde de crédits (débit idempotent, remboursé si course). */
export async function payWithCredits(invoiceId: string, actor: string) {
  const s = await getBillingSettings()
  if (!s.allowCreditPayment) {
    return {
      ok: false as const,
      error: "Le paiement par crédits est désactivé.",
    }
  }
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
  if (!inv || !inv.userId)
    return { ok: false as const, error: "Facture introuvable" }
  if (inv.status !== "unpaid")
    return { ok: false as const, error: "Facture déjà traitée." }

  const debit = await moveBalance({
    userId: inv.userId,
    amountCents: -inv.totalCents,
    kind: "invoice",
    description: `Facture ${inv.number}`,
    actor,
    reference: inv.id,
    idempotencyKey: `invoice:${inv.id}`,
  })
  if (!debit.ok) {
    return {
      ok: false as const,
      error:
        debit.code === "insufficient"
          ? `Solde insuffisant : ${formatMoney(inv.totalCents, inv.currency)} requis.`
          : debit.error,
    }
  }
  const done = await markPaid(inv.id, {
    method: "credits",
    amountCents: inv.totalCents,
    reference: debit.transaction.id,
    actor,
  })
  if (!done && !debit.duplicate) {
    // Réglée entre-temps par un autre moyen : on recrédite.
    await moveBalance({
      userId: inv.userId,
      amountCents: inv.totalCents,
      kind: "refund",
      description: `Facture ${inv.number} déjà réglée`,
      actor: "système",
      reference: inv.id,
      idempotencyKey: `invoice-refund:${inv.id}`,
    })
    return { ok: false as const, error: "Facture déjà réglée." }
  }
  return { ok: true as const }
}

/** Tente le règlement automatique par crédits (si autorisé et solde suffisant). */
export async function tryAutoPay(invoice: schema.Invoice) {
  if (
    !invoice.userId ||
    invoice.status !== "unpaid" ||
    invoice.totalCents <= 0
  ) {
    return false
  }
  const s = await getBillingSettings()
  if (!s.allowCreditPayment) return false
  const [row] = await db
    .select({
      balance: schema.users.balanceCents,
      auto: schema.billingProfiles.autoPayWithCredits,
    })
    .from(schema.users)
    .leftJoin(
      schema.billingProfiles,
      eq(schema.billingProfiles.userId, schema.users.id)
    )
    .where(eq(schema.users.id, invoice.userId))
  if (!row || row.auto === false || row.balance < invoice.totalCents)
    return false
  const r = await payWithCredits(invoice.id, "système (paiement automatique)")
  return r.ok
}

/* ───────────── Effets sur les services ───────────── */

async function servicePeriod(type: ServiceType, serviceId: string) {
  if (type === "vps") {
    const [r] = await db
      .select({ s: schema.servers, periodDays: schema.plans.periodDays })
      .from(schema.servers)
      .leftJoin(schema.plans, eq(schema.plans.id, schema.servers.planId))
      .where(eq(schema.servers.id, serviceId))
    return r ? { ...r.s, periodDays: r.periodDays, pteroId: null } : null
  }
  const [r] = await db
    .select({ s: schema.gameServers, periodDays: schema.gamePlans.periodDays })
    .from(schema.gameServers)
    .leftJoin(
      schema.gamePlans,
      eq(schema.gamePlans.id, schema.gameServers.planId)
    )
    .where(eq(schema.gameServers.id, serviceId))
  return r ? { ...r.s, periodDays: r.periodDays } : null
}

/**
 * Prolonge les services de la facture : commande → une période à partir du
 * paiement ; renouvellement → une période ajoutée à l'échéance. Lève la
 * suspension pour échéance. Chaque ligne n'est appliquée qu'une fois.
 */
export async function applyPaidEffects(inv: schema.Invoice) {
  const items = await db
    .select()
    .from(schema.invoiceItems)
    .where(
      and(
        eq(schema.invoiceItems.invoiceId, inv.id),
        eq(schema.invoiceItems.applied, false)
      )
    )
  const now = new Date()
  for (const it of items) {
    if (!it.serviceType || !it.serviceId || it.kind === "custom") continue
    // Réservation de la ligne : jamais appliquée deux fois.
    const claim = await db
      .update(schema.invoiceItems)
      .set({ applied: true })
      .where(
        and(
          eq(schema.invoiceItems.id, it.id),
          eq(schema.invoiceItems.applied, false)
        )
      )
    if (claim.rowsAffected !== 1) continue

    try {
      const svc = await servicePeriod(it.serviceType, it.serviceId)
      if (!svc) continue
      const expiresAt =
        it.kind === "order"
          ? newExpiry(svc.periodDays, now)
          : extendedExpiry(svc.expiresAt, svc.periodDays, now)
      const lift = svc.suspended && svc.suspendReason === "expired"

      if (it.serviceType === "game" && lift && svc.pteroId) {
        await unsuspendGameServer(svc.pteroId)
      }
      const set = {
        expiresAt,
        lastRenewedAt: now,
        ...(lift ? { suspended: false, suspendReason: null } : {}),
      }
      if (it.serviceType === "vps") {
        await db
          .update(schema.servers)
          .set(set)
          .where(eq(schema.servers.id, svc.id))
      } else {
        await db
          .update(schema.gameServers)
          .set(set)
          .where(eq(schema.gameServers.id, svc.id))
      }
      await db
        .update(schema.orders)
        .set({ status: "active" })
        .where(
          and(
            eq(schema.orders.invoiceId, inv.id),
            eq(schema.orders.serviceId, svc.id)
          )
        )
    } catch (e) {
      void logError({
        category: "billing",
        title: "Facture réglée mais service non prolongé",
        service: "Facturation",
        action: "application du paiement",
        result: "failure",
        message: errorText(e),
        meta: { facture: inv.number, service: it.serviceId ?? "" },
        dedupeKey: `apply:${it.id}`,
      })
    }
  }
}

/* ───────────── Annulation : avoir ───────────── */

/**
 * Annule une facture en émettant un avoir du même montant. Facture payée :
 * statut « remboursée » et, si demandé, montant recrédité sur le solde.
 * Les services déjà prolongés ne sont pas modifiés.
 */
export async function cancelInvoice(
  invoiceId: string,
  opts: { actor: string; reason: string; refundToCredits?: boolean }
) {
  const s = await getBillingSettings()
  const [inv] = await db
    .select()
    .from(schema.invoices)
    .where(eq(schema.invoices.id, invoiceId))
  if (!inv || inv.type !== "invoice")
    return { ok: false as const, error: "Facture introuvable" }
  if (inv.status !== "unpaid" && inv.status !== "paid") {
    return { ok: false as const, error: "Facture déjà annulée." }
  }
  const items = await db
    .select()
    .from(schema.invoiceItems)
    .where(eq(schema.invoiceItems.invoiceId, inv.id))
  const now = new Date()

  const note = await db.transaction(async (tx) => {
    const res = await tx
      .update(schema.invoices)
      .set({ status: inv.status === "paid" ? "refunded" : "cancelled" })
      .where(
        and(
          eq(schema.invoices.id, inv.id),
          eq(schema.invoices.status, inv.status)
        )
      )
    if (res.rowsAffected !== 1) return null
    // Libère la période : une nouvelle facture pourra être émise.
    await tx
      .update(schema.invoiceItems)
      .set({ periodKey: null })
      .where(eq(schema.invoiceItems.invoiceId, inv.id))
    const [cn] = await tx
      .insert(schema.invoices)
      .values({
        number: await nextNumber(tx, s.creditNotePrefix, now),
        type: "credit_note",
        userId: inv.userId,
        status: inv.status === "paid" ? "refunded" : "cancelled",
        currency: inv.currency,
        subtotalCents: -inv.subtotalCents,
        taxCents: -inv.taxCents,
        totalCents: -inv.totalCents,
        taxRateBp: inv.taxRateBp,
        taxLabel: inv.taxLabel,
        legalMentions: mentions(s, "credit_note"),
        seller: inv.seller,
        buyer: inv.buyer,
        issuedAt: now,
        dueAt: now,
        relatedInvoiceId: inv.id,
        notes:
          `Avoir sur la facture ${inv.number}. Motif : ${opts.reason}`.slice(
            0,
            500
          ),
      })
      .returning()
    await tx.insert(schema.invoiceItems).values(
      items.map((it) => ({
        invoiceId: cn.id,
        description: it.description,
        quantity: it.quantity,
        unitCents: -it.unitCents,
        totalCents: -it.totalCents,
        kind: "custom" as const,
      }))
    )
    return cn
  })
  if (!note)
    return { ok: false as const, error: "Facture modifiée entre-temps." }

  if (inv.status === "paid" && opts.refundToCredits && inv.userId) {
    const r = await moveBalance({
      userId: inv.userId,
      amountCents: inv.totalCents,
      kind: "refund",
      description: `Avoir ${note.number} (facture ${inv.number})`,
      actor: opts.actor,
      reference: note.id,
      idempotencyKey: `credit-note:${note.id}`,
    })
    if (r.ok) {
      await db.insert(schema.payments).values({
        invoiceId: inv.id,
        userId: inv.userId,
        method: "credits",
        amountCents: -inv.totalCents,
        reference: r.transaction.id,
        note: `Remboursement par avoir ${note.number}`,
        createdBy: opts.actor,
      })
    }
  }
  await logActivity(
    { id: "", email: opts.actor },
    `Avoir ${note.number} émis`,
    {
      type: "invoice",
      id: inv.id,
      label: inv.number,
    }
  )
  return { ok: true as const, creditNote: note }
}

/* ───────────── Commandes et renouvellements ───────────── */

export type Priced = {
  name: string
  priceCents: number
  periodDays: number | null
}

/** Facturation active pour cette offre (mode factures et prix > 0). */
export async function invoicingFor(plan: Priced) {
  const s = await getBillingSettings()
  return s.mode === "invoices" && plan.priceCents > 0 ? s : null
}

/** Échéance provisoire d'un service commandé : le délai de paiement. */
export const orderGraceExpiry = (s: BillingSettings, from = new Date()) =>
  new Date(from.getTime() + Math.max(s.orderDueDays, 1) * 86_400_000)

/** Après la création d'un service : commande + facture + paiement auto. */
export async function invoiceOrder(input: {
  userId: string
  serviceType: ServiceType
  serviceId: string
  serviceName: string
  plan: Priced
  dueAt: Date
}) {
  const label = input.serviceType === "vps" ? "VPS" : "Serveur de jeu"
  const description = `${label} « ${input.serviceName} » — offre ${input.plan.name}`
  const [order] = await db
    .insert(schema.orders)
    .values({
      userId: input.userId,
      serviceType: input.serviceType,
      serviceId: input.serviceId,
      description,
    })
    .returning()
  const invoice = await createInvoice({
    userId: input.userId,
    dueAt: input.dueAt,
    lines: [
      {
        description: `${description} (première période)`,
        unitPriceCents: input.plan.priceCents,
        serviceType: input.serviceType,
        serviceId: input.serviceId,
        kind: "order",
      },
    ],
  })
  if (!invoice) return null
  await db
    .update(schema.orders)
    .set({ invoiceId: invoice.id })
    .where(eq(schema.orders.id, order.id))
  await tryAutoPay(invoice)
  return invoice
}

/**
 * Facture de renouvellement de la période qui se termine à `expiresAt`
 * (existante si déjà émise). Renvoie la facture.
 */
export async function renewalInvoice(input: {
  userId: string
  serviceType: ServiceType
  serviceId: string
  serviceName: string
  plan: Priced
  expiresAt: Date
}) {
  const periodKey = Math.floor(input.expiresAt.getTime() / 1000)
  const existing = await findOpenRenewal(
    input.serviceType,
    input.serviceId,
    periodKey
  )
  if (existing) return existing

  const label = input.serviceType === "vps" ? "VPS" : "Serveur de jeu"
  const days = input.plan.periodDays
  const inv = await createInvoice({
    userId: input.userId,
    dueAt: input.expiresAt,
    lines: [
      {
        description: `Renouvellement ${label} « ${input.serviceName} » — offre ${input.plan.name}${days ? ` (${days} jours)` : ""}`,
        unitPriceCents: input.plan.priceCents,
        serviceType: input.serviceType,
        serviceId: input.serviceId,
        kind: "renewal",
        periodKey,
      },
    ],
  })
  return (
    inv ??
    (await findOpenRenewal(input.serviceType, input.serviceId, periodKey))
  )
}

async function findOpenRenewal(
  type: ServiceType,
  serviceId: string,
  periodKey: number
) {
  const [row] = await db
    .select({ inv: schema.invoices })
    .from(schema.invoiceItems)
    .innerJoin(
      schema.invoices,
      eq(schema.invoices.id, schema.invoiceItems.invoiceId)
    )
    .where(
      and(
        eq(schema.invoiceItems.serviceType, type),
        eq(schema.invoiceItems.serviceId, serviceId),
        eq(schema.invoiceItems.periodKey, periodKey),
        inArray(schema.invoices.status, ["unpaid", "paid"])
      )
    )
  return row?.inv ?? null
}
