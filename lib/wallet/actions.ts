"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { can, requireStaff } from "@/lib/auth/permissions"
import { requireAdmin, requireUser } from "@/lib/auth/session"
import { auditSensitive } from "@/lib/discord/audit"

import { formatCredits, parseCredits } from "./format"
import {
  createCoupon,
  createGiftCards,
  deleteCoupon,
  deleteGiftCard,
  moveBalance,
  redeemCode,
  updateCoupon,
  updateGiftCard,
} from "./service"
import { saveWalletSettings } from "./settings"

export type WalletState =
  | { error?: string; ok?: boolean; notice?: string; codes?: string[] }
  | undefined

const idSchema = z.string().min(1).max(64)

/** Exige une permission de personnel ; renvoie l'utilisateur ou null. */
async function staffWith(key: string) {
  const user = await requireStaff()
  return (await can(user, key)) ? user : null
}

const DENIED = { error: "Permission insuffisante." }

/**
 * Date de formulaire (YYYY-MM-DD) → Date | null (undefined si invalide) :
 * début de journée, ou fin de journée pour une échéance.
 */
function formDate(v: FormDataEntryValue | null, endOfDay = false) {
  const s = String(v ?? "").trim()
  if (!s) return null
  const d = new Date(
    s.length === 10 ? `${s}T${endOfDay ? "23:59:59" : "00:00:00"}` : s
  )
  return Number.isNaN(d.getTime()) ? undefined : d
}

/* ───────────── Client ───────────── */

export async function redeemCodeAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const user = await requireUser()
  const res = await redeemCode(user, formData.get("code"))
  if (!res.ok) return { error: res.error }

  await logActivity(
    user,
    `${res.label} utilisé (${formatCredits(res.amountCents)})`,
    {
      type: "wallet",
    }
  )
  revalidatePath("/wallet")
  return {
    ok: true,
    notice: `${formatCredits(res.amountCents, { sign: true })} ajoutés. Nouveau solde : ${formatCredits(res.balanceCents)}.`,
  }
}

/* ───────────── Personnel : ajustement de solde ───────────── */

export async function adjustBalanceAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const staff = await staffWith("wallet.adjust")
  if (!staff) return DENIED

  const userId = idSchema.safeParse(formData.get("userId"))
  const amount = parseCredits(formData.get("amount"))
  const direction = formData.get("direction") === "debit" ? -1 : 1
  const description = String(formData.get("description") ?? "").trim()
  if (!userId.success) return { error: "Compte invalide." }
  if (amount === null || amount <= 0) {
    return { error: "Montant invalide (ex. 10 ou 12,50)." }
  }
  if (description.length < 3) return { error: "Indique un motif." }

  const res = await moveBalance({
    userId: userId.data,
    amountCents: amount * direction,
    kind: "adjustment",
    description,
    actor: staff.email,
    allowNegative: formData.get("allowNegative") === "on",
    // Un double envoi du formulaire ne crée pas deux mouvements.
    idempotencyKey: String(formData.get("nonce") ?? "").slice(0, 64) || null,
  })
  if (!res.ok) return { error: res.error }

  await logActivity(
    staff,
    `Solde ajusté (${formatCredits(amount * direction, { sign: true })})`,
    { type: "wallet", id: userId.data }
  )
  auditSensitive(staff, "Solde ajusté", {
    compte: userId.data.slice(0, 8),
    montant: amount * direction,
  })
  revalidatePath("/support/wallet")
  return {
    ok: true,
    notice: res.duplicate
      ? "Opération déjà enregistrée."
      : `Nouveau solde : ${formatCredits(res.balanceCents)}.`,
  }
}

/* ───────────── Personnel : coupons ───────────── */

function couponFromForm(formData: FormData) {
  const amount = parseCredits(formData.get("amount"))
  const max = String(formData.get("maxRedemptions") ?? "").trim()
  const perUser = String(formData.get("perUserLimit") ?? "").trim()
  const startsAt = formDate(formData.get("startsAt"))
  const expiresAt = formDate(formData.get("expiresAt"), true)
  if (startsAt === undefined || expiresAt === undefined) {
    return { error: "Date invalide." } as const
  }
  return {
    data: {
      code: String(formData.get("code") ?? ""),
      description: String(formData.get("description") ?? "") || null,
      amountCents: amount ?? -1,
      maxRedemptions: max ? Number(max) : null,
      perUserLimit: perUser ? Number(perUser) : 1,
      startsAt,
      expiresAt,
      isActive: formData.get("isActive") !== null,
    },
  } as const
}

export async function createCouponAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const input = couponFromForm(formData)
  if ("error" in input) return { error: input.error }
  if (input.data.amountCents <= 0) return { error: "Montant invalide." }

  const res = await createCoupon(input.data, staff.email)
  if (!res.ok) return { error: res.error }
  await logActivity(staff, "Coupon créé", {
    type: "wallet",
    id: res.coupon.id,
    label: res.coupon.code,
  })
  revalidatePath("/support/coupons")
  return { ok: true, notice: `Coupon ${res.coupon.code} créé.` }
}

export async function updateCouponAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const id = idSchema.safeParse(formData.get("id"))
  if (!id.success) return { error: "Coupon invalide." }
  const input = couponFromForm(formData)
  if ("error" in input) return { error: input.error }
  if (input.data.amountCents <= 0) return { error: "Montant invalide." }

  const res = await updateCoupon(id.data, input.data)
  if (!res.ok) return { error: res.error }
  await logActivity(staff, "Coupon modifié", {
    type: "wallet",
    id: id.data,
    label: res.coupon.code,
  })
  revalidatePath("/support/coupons")
  return { ok: true, notice: "Coupon enregistré." }
}

export async function setCouponActiveAction(
  id: string,
  active: boolean
): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const res = await updateCoupon(idSchema.parse(id), { isActive: active })
  if (!res.ok) return { error: res.error }
  await logActivity(staff, active ? "Coupon activé" : "Coupon désactivé", {
    type: "wallet",
    id,
    label: res.coupon.code,
  })
  revalidatePath("/support/coupons")
  return { ok: true }
}

export async function deleteCouponAction(id: string): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const res = await deleteCoupon(idSchema.parse(id))
  if (!res.ok) return { error: res.error }
  await logActivity(staff, "Coupon supprimé", {
    type: "wallet",
    id,
    label: res.coupon.code,
  })
  revalidatePath("/support/coupons")
  return { ok: true }
}

/* ───────────── Personnel : cartes cadeaux ───────────── */

export async function createGiftCardsAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const amount = parseCredits(formData.get("amount"))
  const expiresAt = formDate(formData.get("expiresAt"), true)
  if (amount === null || amount <= 0) return { error: "Montant invalide." }
  if (expiresAt === undefined) return { error: "Date invalide." }

  const res = await createGiftCards(
    {
      amountCents: amount,
      quantity: Number(formData.get("quantity") || 1),
      note: String(formData.get("note") ?? "") || null,
      expiresAt,
    },
    staff.email
  )
  if (!res.ok) return { error: res.error }
  await logActivity(staff, `${res.cards.length} carte(s) cadeau créée(s)`, {
    type: "wallet",
  })
  auditSensitive(staff, "Cartes cadeaux créées", {
    nombre: res.cards.length,
    montant: amount,
  })
  revalidatePath("/support/coupons")
  return {
    ok: true,
    notice: `${res.cards.length} carte(s) de ${formatCredits(amount)} créée(s).`,
    codes: res.cards.map((c) => c.code),
  }
}

export async function setGiftCardStatusAction(
  id: string,
  status: "active" | "disabled"
): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const res = await updateGiftCard(idSchema.parse(id), { status })
  if (!res.ok) return { error: res.error }
  await logActivity(
    staff,
    status === "active" ? "Carte cadeau réactivée" : "Carte cadeau désactivée",
    { type: "wallet", id }
  )
  revalidatePath("/support/coupons")
  return { ok: true }
}

export async function deleteGiftCardAction(id: string): Promise<WalletState> {
  const staff = await staffWith("coupons.manage")
  if (!staff) return DENIED
  const res = await deleteGiftCard(idSchema.parse(id))
  if (!res.ok) return { error: res.error }
  await logActivity(staff, "Carte cadeau supprimée", { type: "wallet", id })
  revalidatePath("/support/coupons")
  return { ok: true }
}

/* ───────────── Administration : réglages ───────────── */

export async function saveWalletSettingsAction(
  _prev: WalletState,
  formData: FormData
): Promise<WalletState> {
  const admin = await requireAdmin()
  const bonus = parseCredits(formData.get("signupBonus") || "0")
  if (bonus === null || bonus < 0) return { error: "Bonus invalide." }
  const ok = await saveWalletSettings({
    billingEnabled: formData.get("billingEnabled") !== null,
    signupBonusCents: bonus,
  })
  if (!ok) return { error: "Réglages invalides." }
  auditSensitive(admin, "Réglages des crédits modifiés", {
    facturation: formData.get("billingEnabled") !== null,
    bonus,
  })
  revalidatePath("/support/wallet")
  return { ok: true, notice: "Réglages enregistrés." }
}
