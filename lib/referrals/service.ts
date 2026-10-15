import "server-only"

import { randomInt } from "node:crypto"
import { and, count, eq, isNull, sum } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"
import { notify } from "@/lib/notifications"
import { formatCredits } from "@/lib/wallet/format"
import { moveBalance } from "@/lib/wallet/service"
import { getWalletSettings } from "@/lib/wallet/settings"

/**
 * Parrainage : chaque client a un code ; un filleul inscrit avec ?ref=CODE
 * rapporte au parrain un bonus en crédits, une seule fois, à l'inscription
 * ou à sa première facture réglée (réglage des crédits).
 */

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

/** Code du parrain (null si inconnu). */
export async function findReferrer(code: string) {
  const c = code.trim().toUpperCase()
  if (!/^[A-Z0-9]{6,12}$/.test(c)) return null
  const [u] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.referralCode, c))
  return u?.id ?? null
}

/** Code personnel, créé à la première demande. */
export async function ensureReferralCode(userId: string) {
  const [u] = await db
    .select({ code: schema.users.referralCode })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (u?.code) return u.code
  for (let i = 0; i < 5; i++) {
    const code = Array.from(
      { length: 8 },
      () => ALPHABET[randomInt(ALPHABET.length)]
    ).join("")
    try {
      const res = await db
        .update(schema.users)
        .set({ referralCode: code })
        .where(
          and(eq(schema.users.id, userId), isNull(schema.users.referralCode))
        )
      if (res.rowsAffected === 1) return code
      return await ensureReferralCode(userId)
    } catch (e) {
      if (!isUniqueViolation(e)) throw e
    }
  }
  throw new Error("Code de parrainage indisponible")
}

/**
 * Récompense le parrain du filleul (idempotent : index unique sur le
 * filleul + clé d'idempotence du grand livre).
 */
export async function rewardReferrer(
  refereeId: string,
  trigger: "signup" | "first_payment"
) {
  const settings = await getWalletSettings()
  if (settings.referralBonusCents <= 0 || settings.referralTrigger !== trigger)
    return
  const [referee] = await db
    .select({ referredBy: schema.users.referredBy, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.id, refereeId))
  if (!referee?.referredBy || referee.referredBy === refereeId) return

  try {
    await db.insert(schema.referralRewards).values({
      referrerId: referee.referredBy,
      refereeId,
      amountCents: settings.referralBonusCents,
    })
  } catch (e) {
    if (isUniqueViolation(e)) return // déjà récompensé
    throw e
  }
  const r = await moveBalance({
    userId: referee.referredBy,
    amountCents: settings.referralBonusCents,
    kind: "adjustment",
    description: "Bonus de parrainage",
    actor: "système",
    reference: refereeId,
    idempotencyKey: `referral:${refereeId}`,
  })
  if (r.ok) {
    await notify({
      userId: referee.referredBy,
      dedupeKey: `referral:${refereeId}`,
      title: `Parrainage : ${formatCredits(settings.referralBonusCents, { sign: true })}`,
      body: "Un de tes filleuls vient de rejoindre le service. Merci !",
      href: "/referrals",
    })
  }
}

export async function referralStats(userId: string) {
  const [[{ referees }], [{ earned }]] = await Promise.all([
    db
      .select({ referees: count() })
      .from(schema.users)
      .where(eq(schema.users.referredBy, userId)),
    db
      .select({ earned: sum(schema.referralRewards.amountCents) })
      .from(schema.referralRewards)
      .where(eq(schema.referralRewards.referrerId, userId)),
  ])
  return { referees, earned: Number(earned ?? 0) }
}
