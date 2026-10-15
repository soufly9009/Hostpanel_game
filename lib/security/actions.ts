"use server"

import { revalidatePath } from "next/cache"
import { and, eq, isNull, ne } from "drizzle-orm"
import QRCode from "qrcode"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { verifyPassword } from "@/lib/auth/password"
import { currentSessionId, requireAdmin, requireUser } from "@/lib/auth/session"
import { siteConfig } from "@/lib/config/site"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

import { openSecret, sealSecret, sha256 } from "./crypto"
import { verifySecondFactor } from "./mfa"
import {
  generateRecoveryCodes,
  generateTotpSecret,
  otpauthUri,
  verifyTotp,
} from "./totp"

export type SecurityState =
  | {
      error?: string
      ok?: boolean
      notice?: string
      codes?: string[]
      secret?: string
      qr?: string
    }
  | undefined

const refresh = () => revalidatePath("/account/security")

/** Étape 1 : secret provisoire + QR code (rien n'est actif). */
export async function start2faAction(): Promise<SecurityState> {
  const user = await requireUser()
  const secret = generateTotpSecret()
  const res = await db
    .update(schema.users)
    .set({ totpSecret: sealSecret(secret) })
    .where(
      and(eq(schema.users.id, user.id), isNull(schema.users.totpEnabledAt))
    )
  if (res.rowsAffected !== 1) return { error: "La 2FA est déjà active." }
  const uri = otpauthUri(secret, user.email, siteConfig.name)
  const qr = await QRCode.toDataURL(uri, { margin: 1, width: 220 })
  return { ok: true, secret, qr }
}

/** Étape 2 : premier code valide → activation + codes de secours (affichés une fois). */
export async function confirm2faAction(
  _prev: SecurityState,
  formData: FormData
): Promise<SecurityState> {
  const user = await requireUser()
  const [u] = await db
    .select({
      secret: schema.users.totpSecret,
      enabled: schema.users.totpEnabledAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
  if (u?.enabled) return { error: "La 2FA est déjà active." }
  const secret = openSecret(u?.secret)
  if (!secret) return { error: "Recommence l'activation." }
  if (verifyTotp(secret, String(formData.get("code") ?? "")) === null) {
    return { error: "Code incorrect : vérifie l'heure de ton téléphone." }
  }
  const codes = generateRecoveryCodes()
  await db
    .update(schema.users)
    .set({ totpEnabledAt: new Date(), recoveryCodes: codes.map(sha256) })
    .where(eq(schema.users.id, user.id))
  // Les autres sessions sont fermées : elles ont été ouvertes sans 2FA.
  const current = await currentSessionId()
  if (current) {
    await db
      .delete(schema.sessions)
      .where(
        and(
          eq(schema.sessions.userId, user.id),
          ne(schema.sessions.id, current)
        )
      )
  }
  await logActivity(user, "Double authentification activée", {
    type: "security",
  })
  refresh()
  return {
    ok: true,
    notice:
      "Double authentification activée. Conserve ces codes de secours en lieu sûr : ils ne seront plus affichés.",
    codes,
  }
}

export async function disable2faAction(
  _prev: SecurityState,
  formData: FormData
): Promise<SecurityState> {
  const user = await requireUser()
  const [u] = await db
    .select({ hash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
  if (
    !u?.hash ||
    !(await verifyPassword(String(formData.get("password") ?? ""), u.hash))
  ) {
    return { error: "Mot de passe incorrect." }
  }
  if (
    !(await verifySecondFactor(user.id, String(formData.get("code") ?? "")))
  ) {
    return { error: "Code incorrect." }
  }
  await db
    .update(schema.users)
    .set({ totpSecret: null, totpEnabledAt: null, recoveryCodes: null })
    .where(eq(schema.users.id, user.id))
  await logActivity(user, "Double authentification désactivée", {
    type: "security",
  })
  refresh()
  return { ok: true, notice: "Double authentification désactivée." }
}

export async function regenerateRecoveryAction(
  _prev: SecurityState,
  formData: FormData
): Promise<SecurityState> {
  const user = await requireUser()
  if (
    (await verifySecondFactor(user.id, String(formData.get("code") ?? ""))) !==
    "totp"
  ) {
    return { error: "Code de l'application requis." }
  }
  const codes = generateRecoveryCodes()
  await db
    .update(schema.users)
    .set({ recoveryCodes: codes.map(sha256) })
    .where(eq(schema.users.id, user.id))
  await logActivity(user, "Codes de secours régénérés", { type: "security" })
  refresh()
  return {
    ok: true,
    notice: "Nouveaux codes : les anciens ne fonctionnent plus.",
    codes,
  }
}

/* ───────────── Sessions ───────────── */

export async function revokeSessionAction(sessionId: string) {
  const user = await requireUser()
  const id = z.string().min(10).max(128).parse(sessionId)
  if (id === (await currentSessionId())) return
  await db
    .delete(schema.sessions)
    .where(and(eq(schema.sessions.id, id), eq(schema.sessions.userId, user.id)))
  await logActivity(user, "Session révoquée", { type: "security" })
  refresh()
}

export async function revokeOtherSessionsAction() {
  const user = await requireUser()
  const current = await currentSessionId()
  if (!current) return
  await db
    .delete(schema.sessions)
    .where(
      and(eq(schema.sessions.userId, user.id), ne(schema.sessions.id, current))
    )
  await logActivity(user, "Autres sessions fermées", { type: "security" })
  refresh()
}

/* ───────────── Administration ───────────── */

/** Client ayant perdu son téléphone et ses codes : désactivation par un admin. */
export async function adminDisable2faAction(
  userId: string
): Promise<SecurityState> {
  const admin = await requireAdmin()
  const id = z.string().min(1).max(64).parse(userId)
  await db
    .update(schema.users)
    .set({ totpSecret: null, totpEnabledAt: null, recoveryCodes: null })
    .where(eq(schema.users.id, id))
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, id))
  await logActivity(admin, "2FA d'un client désactivée", {
    type: "security",
    id,
  })
  auditSensitive(
    admin,
    "2FA d'un client désactivée",
    { client: id.slice(0, 8) },
    "warning"
  )
  revalidatePath(`/admin/users/${id}`)
  return { ok: true, notice: "2FA désactivée et sessions du client fermées." }
}
