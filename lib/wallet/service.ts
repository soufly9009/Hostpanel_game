import "server-only"

import { randomInt } from "node:crypto"
import { and, count, eq, gt, isNull, lt, or, sql } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"

import { COUPON_RE, GIFT_ALPHABET, GIFT_RE, normalizeCode } from "./format"

/**
 * Crédits fictifs. Toute variation de `users.balanceCents` passe par `move` :
 * mise à jour atomique conditionnelle (solde jamais négatif sauf demande
 * explicite) + ligne du grand livre, dans la même transaction.
 */

/** Montant maximal d'une opération : 1 000 000 crédits. */
export const MAX_AMOUNT_CENTS = 100_000_000
/** Plafond de solde : 10 000 000 crédits. */
export const MAX_BALANCE_CENTS = 1_000_000_000

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0]
type Exec = typeof db | Tx

export type WalletError = {
  ok: false
  code: "not_found" | "insufficient" | "invalid" | "limit" | "conflict"
  error: string
}
export type WalletResult =
  | {
      ok: true
      transaction: schema.WalletTransaction
      balanceCents: number
      duplicate: boolean
    }
  | WalletError

export type MoveInput = {
  userId: string
  amountCents: number
  kind: schema.WalletKind
  description: string
  actor: string
  reference?: string | null
  idempotencyKey?: string | null
  /** Autorise un solde négatif (débit forcé par le personnel). */
  allowNegative?: boolean
}

const fail = (code: WalletError["code"], error: string): WalletError => ({
  ok: false,
  code,
  error,
})

/** Annule la transaction en transportant le résultat d'échec. */
class Abort extends Error {
  constructor(readonly result: WalletError) {
    super(result.error)
  }
}

async function inTx<T>(fn: (tx: Tx) => Promise<T>): Promise<T | WalletError> {
  try {
    return await db.transaction(fn)
  } catch (e) {
    if (e instanceof Abort) return e.result
    throw e
  }
}

async function findByIdempotency(ex: Exec, userId: string, key: string) {
  const T = schema.walletTransactions
  const [prev] = await ex
    .select()
    .from(T)
    .where(and(eq(T.userId, userId), eq(T.idempotencyKey, key)))
  if (!prev) return null
  const [u] = await ex
    .select({ balanceCents: schema.users.balanceCents })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  return {
    ok: true as const,
    transaction: prev,
    balanceCents: u?.balanceCents ?? prev.balanceAfterCents,
    duplicate: true,
  }
}

async function move(ex: Exec, input: MoveInput): Promise<WalletResult> {
  const amount = input.amountCents
  if (
    !Number.isSafeInteger(amount) ||
    amount === 0 ||
    Math.abs(amount) > MAX_AMOUNT_CENTS
  ) {
    return fail("invalid", "Montant invalide.")
  }
  const description = input.description.trim().slice(0, 200)
  if (!description) return fail("invalid", "Motif requis.")

  if (input.idempotencyKey) {
    const prev = await findByIdempotency(ex, input.userId, input.idempotencyKey)
    if (prev) return prev
  }

  const U = schema.users
  const conds = [eq(U.id, input.userId)]
  if (amount < 0 && !input.allowNegative) {
    conds.push(sql`${U.balanceCents} + ${amount} >= 0`)
  }
  if (amount > 0) {
    conds.push(sql`${U.balanceCents} + ${amount} <= ${MAX_BALANCE_CENTS}`)
  }

  const [u] = await ex
    .update(U)
    .set({ balanceCents: sql`${U.balanceCents} + ${amount}` })
    .where(and(...conds))
    .returning({ balanceCents: U.balanceCents })

  if (!u) {
    const [exists] = await ex
      .select({ id: U.id })
      .from(U)
      .where(eq(U.id, input.userId))
    if (!exists) return fail("not_found", "Compte introuvable.")
    return amount < 0
      ? fail("insufficient", "Solde insuffisant.")
      : fail("limit", "Plafond de solde atteint.")
  }

  const [transaction] = await ex
    .insert(schema.walletTransactions)
    .values({
      userId: input.userId,
      amountCents: amount,
      balanceAfterCents: u.balanceCents,
      kind: input.kind,
      description,
      actor: input.actor.slice(0, 120),
      reference: input.reference ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
    })
    .returning()

  return {
    ok: true,
    transaction,
    balanceCents: u.balanceCents,
    duplicate: false,
  }
}

/** Crédite (montant > 0) ou débite (montant < 0) un compte. */
export async function moveBalance(input: MoveInput): Promise<WalletResult> {
  try {
    const r = await inTx(async (tx) => {
      const res = await move(tx, input)
      if (!res.ok) throw new Abort(res)
      return res
    })
    return r
  } catch (e) {
    // Deux requêtes simultanées avec la même clé d'idempotence.
    if (input.idempotencyKey && isUniqueViolation(e)) {
      const prev = await findByIdempotency(
        db,
        input.userId,
        input.idempotencyKey
      )
      if (prev) return prev
    }
    throw e
  }
}

export async function getBalance(userId: string) {
  const [u] = await db
    .select({ balanceCents: schema.users.balanceCents })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  return u?.balanceCents ?? null
}

/* ───────────── Saisie d'un code (coupon ou carte cadeau) ───────────── */

// Anti-force brute : 10 codes invalides par quart d'heure et par compte.
const g = globalThis as unknown as {
  __redeemFails?: Map<string, { n: number; until: number }>
}
const fails = (g.__redeemFails ??= new Map())
const FAIL_MAX = 10
const FAIL_WINDOW = 15 * 60_000

function blocked(userId: string) {
  const f = fails.get(userId)
  if (!f) return false
  if (f.until < Date.now()) {
    fails.delete(userId)
    return false
  }
  return f.n >= FAIL_MAX
}

function recordFail(userId: string) {
  const f = fails.get(userId)
  if (!f || f.until < Date.now()) {
    fails.set(userId, { n: 1, until: Date.now() + FAIL_WINDOW })
  } else f.n++
}

export type RedeemResult =
  | { ok: true; amountCents: number; balanceCents: number; label: string }
  | WalletError

export async function redeemCode(
  user: { id: string; email: string },
  raw: unknown
): Promise<RedeemResult> {
  if (blocked(user.id)) {
    return fail("limit", "Trop de codes invalides : réessaie plus tard.")
  }
  const code = normalizeCode(raw)
  if (!code) return fail("invalid", "Code requis.")

  const res = GIFT_RE.test(code)
    ? await redeemGiftCard(user, code)
    : COUPON_RE.test(code)
      ? await redeemCoupon(user, code)
      : fail("invalid", "Code invalide.")

  if (!res.ok && res.code === "invalid") recordFail(user.id)
  return res
}

async function redeemGiftCard(
  user: { id: string; email: string },
  code: string
): Promise<RedeemResult> {
  const G = schema.giftCards
  const now = new Date()
  return inTx(async (tx) => {
    // Passage atomique active → utilisée : une carte ne sert qu'une fois.
    const [card] = await tx
      .update(G)
      .set({ status: "redeemed", redeemedBy: user.id, redeemedAt: now })
      .where(
        and(
          eq(G.code, code),
          eq(G.status, "active"),
          or(isNull(G.expiresAt), gt(G.expiresAt, now))
        )
      )
      .returning()
    if (!card) {
      throw new Abort(fail("invalid", "Code invalide, expiré ou déjà utilisé."))
    }
    const r = await move(tx, {
      userId: user.id,
      amountCents: card.amountCents,
      kind: "gift_card",
      description: `Carte cadeau ${card.code.slice(0, 4)}-…`,
      actor: user.email,
      reference: card.id,
      idempotencyKey: `gift:${card.id}`,
    })
    if (!r.ok) throw new Abort(r)
    return {
      ok: true as const,
      amountCents: card.amountCents,
      balanceCents: r.balanceCents,
      label: "Carte cadeau",
    }
  })
}

async function redeemCoupon(
  user: { id: string; email: string },
  code: string
): Promise<RedeemResult> {
  const C = schema.coupons
  const R = schema.couponRedemptions
  const now = new Date()
  try {
    return await inTx(async (tx) => {
      const [c] = await tx.select().from(C).where(eq(C.code, code))
      if (!c || !c.isActive) throw new Abort(fail("invalid", "Code invalide."))
      if (c.startsAt && c.startsAt > now) {
        throw new Abort(fail("conflict", "Ce coupon n'est pas encore actif."))
      }
      if (c.expiresAt && c.expiresAt <= now) {
        throw new Abort(fail("conflict", "Ce coupon a expiré."))
      }

      const [{ n }] = await tx
        .select({ n: count() })
        .from(R)
        .where(and(eq(R.couponId, c.id), eq(R.userId, user.id)))
      if (n >= c.perUserLimit) {
        throw new Abort(fail("conflict", "Tu as déjà utilisé ce coupon."))
      }

      const upd = await tx
        .update(C)
        .set({ redemptions: sql`${C.redemptions} + 1` })
        .where(
          and(
            eq(C.id, c.id),
            or(isNull(C.maxRedemptions), lt(C.redemptions, C.maxRedemptions))
          )
        )
      if (upd.rowsAffected !== 1) {
        throw new Abort(fail("conflict", "Ce coupon est épuisé."))
      }

      // La clé d'idempotence (coupon, n° d'utilisation) empêche une double
      // utilisation concurrente au-delà de la limite par compte.
      const r = await move(tx, {
        userId: user.id,
        amountCents: c.amountCents,
        kind: "coupon",
        description: `Coupon ${c.code}`,
        actor: user.email,
        reference: c.id,
        idempotencyKey: `coupon:${c.id}:${n + 1}`,
      })
      if (!r.ok) throw new Abort(r)
      if (r.duplicate) {
        throw new Abort(fail("conflict", "Tu as déjà utilisé ce coupon."))
      }

      await tx.insert(R).values({
        couponId: c.id,
        userId: user.id,
        transactionId: r.transaction.id,
      })
      return {
        ok: true as const,
        amountCents: c.amountCents,
        balanceCents: r.balanceCents,
        label: `Coupon ${c.code}`,
      }
    })
  } catch (e) {
    if (isUniqueViolation(e)) {
      return fail("conflict", "Tu as déjà utilisé ce coupon.")
    }
    throw e
  }
}

/* ───────────── Gestion des coupons ───────────── */

const optionalDate = z
  .union([z.coerce.date(), z.null()])
  .optional()
  .refine((d) => !(d instanceof Date) || !Number.isNaN(d.getTime()), {
    message: "Date invalide",
  })

export const couponInputSchema = z.object({
  code: z
    .string()
    .transform((s) => normalizeCode(s))
    .pipe(
      z
        .string()
        .regex(COUPON_RE, "Code : 3 à 32 caractères A-Z, 0-9, - ou _")
        .refine((c) => !GIFT_RE.test(c), "Format réservé aux cartes cadeaux")
    ),
  description: z.string().trim().max(200).nullable().optional(),
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
  maxRedemptions: z.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.number().int().min(1).max(100).optional(),
  startsAt: optionalDate,
  expiresAt: optionalDate,
  isActive: z.boolean().optional(),
})
export type CouponInput = z.input<typeof couponInputSchema>

export async function createCoupon(input: unknown, actor: string) {
  const parsed = couponInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail("invalid", parsed.error.issues[0]?.message ?? "Invalide")
  }
  const d = parsed.data
  try {
    const [coupon] = await db
      .insert(schema.coupons)
      .values({
        code: d.code,
        description: d.description || null,
        amountCents: d.amountCents,
        maxRedemptions: d.maxRedemptions ?? null,
        perUserLimit: d.perUserLimit ?? 1,
        startsAt: d.startsAt ?? null,
        expiresAt: d.expiresAt ?? null,
        isActive: d.isActive ?? true,
        createdBy: actor,
      })
      .returning()
    return { ok: true as const, coupon }
  } catch (e) {
    if (isUniqueViolation(e)) return fail("conflict", "Ce code existe déjà.")
    throw e
  }
}

export async function updateCoupon(id: string, input: unknown) {
  const parsed = couponInputSchema.partial().safeParse(input)
  if (!parsed.success) {
    return fail("invalid", parsed.error.issues[0]?.message ?? "Invalide")
  }
  const d = parsed.data
  const set: Partial<schema.Coupon> = {}
  if (d.code !== undefined) set.code = d.code
  if (d.description !== undefined) set.description = d.description || null
  if (d.amountCents !== undefined) set.amountCents = d.amountCents
  if (d.maxRedemptions !== undefined) set.maxRedemptions = d.maxRedemptions
  if (d.perUserLimit !== undefined) set.perUserLimit = d.perUserLimit
  if (d.startsAt !== undefined) set.startsAt = d.startsAt
  if (d.expiresAt !== undefined) set.expiresAt = d.expiresAt
  if (d.isActive !== undefined) set.isActive = d.isActive
  if (Object.keys(set).length === 0) return fail("invalid", "Rien à modifier.")

  try {
    const [coupon] = await db
      .update(schema.coupons)
      .set(set)
      .where(eq(schema.coupons.id, id))
      .returning()
    if (!coupon) return fail("not_found", "Coupon introuvable.")
    return { ok: true as const, coupon }
  } catch (e) {
    if (isUniqueViolation(e)) return fail("conflict", "Ce code existe déjà.")
    throw e
  }
}

/** Supprime le coupon ; les crédits déjà accordés restent au grand livre. */
export async function deleteCoupon(id: string) {
  const [coupon] = await db
    .delete(schema.coupons)
    .where(eq(schema.coupons.id, id))
    .returning()
  return coupon
    ? { ok: true as const, coupon }
    : fail("not_found", "Coupon introuvable.")
}

/* ───────────── Gestion des cartes cadeaux ───────────── */

function giftCode() {
  let s = ""
  for (let i = 0; i < 16; i++)
    s += GIFT_ALPHABET[randomInt(GIFT_ALPHABET.length)]
  return s.match(/.{4}/g)!.join("-")
}

export const giftCardInputSchema = z.object({
  amountCents: z.number().int().min(1).max(MAX_AMOUNT_CENTS),
  quantity: z.number().int().min(1).max(100).optional(),
  note: z.string().trim().max(200).nullable().optional(),
  expiresAt: optionalDate,
})

export async function createGiftCards(input: unknown, actor: string) {
  const parsed = giftCardInputSchema.safeParse(input)
  if (!parsed.success) {
    return fail("invalid", parsed.error.issues[0]?.message ?? "Invalide")
  }
  const d = parsed.data
  const cards: schema.GiftCard[] = []
  for (let i = 0; i < (d.quantity ?? 1); i++) {
    // 80 bits d'aléa : une collision est improbable, on réessaie quand même.
    for (let attempt = 0; ; attempt++) {
      try {
        const [card] = await db
          .insert(schema.giftCards)
          .values({
            code: giftCode(),
            amountCents: d.amountCents,
            note: d.note || null,
            expiresAt: d.expiresAt ?? null,
            createdBy: actor,
          })
          .returning()
        cards.push(card)
        break
      } catch (e) {
        if (!isUniqueViolation(e) || attempt >= 3) throw e
      }
    }
  }
  return { ok: true as const, cards }
}

export const giftCardUpdateSchema = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  note: z.string().trim().max(200).nullable().optional(),
  expiresAt: optionalDate,
})

/** Une carte déjà utilisée n'est plus modifiable. */
export async function updateGiftCard(id: string, input: unknown) {
  const parsed = giftCardUpdateSchema.safeParse(input)
  if (!parsed.success) {
    return fail("invalid", parsed.error.issues[0]?.message ?? "Invalide")
  }
  const d = parsed.data
  const set: Partial<schema.GiftCard> = {}
  if (d.status !== undefined) set.status = d.status
  if (d.note !== undefined) set.note = d.note || null
  if (d.expiresAt !== undefined) set.expiresAt = d.expiresAt
  if (Object.keys(set).length === 0) return fail("invalid", "Rien à modifier.")

  const G = schema.giftCards
  const [card] = await db
    .update(G)
    .set(set)
    .where(
      and(eq(G.id, id), or(eq(G.status, "active"), eq(G.status, "disabled")))
    )
    .returning()
  if (card) return { ok: true as const, card }
  const [exists] = await db.select({ id: G.id }).from(G).where(eq(G.id, id))
  return exists
    ? fail("conflict", "Carte déjà utilisée : non modifiable.")
    : fail("not_found", "Carte introuvable.")
}

export async function deleteGiftCard(id: string) {
  const [card] = await db
    .delete(schema.giftCards)
    .where(eq(schema.giftCards.id, id))
    .returning()
  return card
    ? { ok: true as const, card }
    : fail("not_found", "Carte introuvable.")
}

/* ───────────── Représentation publique (API) ───────────── */

const iso = (d: Date | null) => (d ? d.toISOString() : null)

export const toApiTransaction = (t: schema.WalletTransaction) => ({
  id: t.id,
  amountCents: t.amountCents,
  balanceAfterCents: t.balanceAfterCents,
  kind: t.kind,
  description: t.description,
  actor: t.actor,
  reference: t.reference,
  idempotencyKey: t.idempotencyKey,
  createdAt: iso(t.createdAt),
})

export const toApiCoupon = (c: schema.Coupon) => ({
  id: c.id,
  code: c.code,
  description: c.description,
  amountCents: c.amountCents,
  maxRedemptions: c.maxRedemptions,
  redemptions: c.redemptions,
  perUserLimit: c.perUserLimit,
  startsAt: iso(c.startsAt),
  expiresAt: iso(c.expiresAt),
  isActive: c.isActive,
  createdAt: iso(c.createdAt),
})

export const toApiGiftCard = (g: schema.GiftCard) => ({
  id: g.id,
  code: g.code,
  amountCents: g.amountCents,
  note: g.note,
  status: g.status,
  expiresAt: iso(g.expiresAt),
  redeemedBy: g.redeemedBy,
  redeemedAt: iso(g.redeemedAt),
  createdAt: iso(g.createdAt),
})
