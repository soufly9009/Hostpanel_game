import "server-only"

import { randomBytes } from "node:crypto"
import { cookies } from "next/headers"
import { and, eq, lt } from "drizzle-orm"

import { db, schema } from "@/lib/db"

import { openSecret, sha256 } from "./crypto"
import { requestInfo } from "./request"
import { normalizeRecoveryCode, verifyTotp } from "./totp"

/**
 * Deuxième étape de connexion. Après un mot de passe correct, un jeton
 * temporaire (5 min, 5 essais, mémoire du processus) est posé en cookie ;
 * la session n'est créée qu'après un code TOTP ou de secours valide.
 */

const COOKIE = "mfa_pending"
const TTL = 5 * 60_000

type Pending = { userId: string; exp: number; attempts: number }
const g = globalThis as unknown as {
  __mfaPending?: Map<string, Pending>
  __totpLastStep?: Map<string, number>
}
const pending = (g.__mfaPending ??= new Map())
const lastStep = (g.__totpLastStep ??= new Map())

export async function startMfa(userId: string) {
  for (const [k, v] of pending) if (v.exp < Date.now()) pending.delete(k)
  const token = randomBytes(24).toString("base64url")
  pending.set(token, { userId, exp: Date.now() + TTL, attempts: 0 })
  ;(await cookies()).set(COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: TTL / 1000,
  })
}

/** Connexion en attente de code (ou null). */
export async function pendingMfa() {
  const token = (await cookies()).get(COOKIE)?.value
  const p = token ? pending.get(token) : null
  if (!token || !p || p.exp < Date.now()) return null
  return { token, ...p }
}

export async function clearMfa(token?: string) {
  if (token) pending.delete(token)
  ;(await cookies()).delete(COOKIE)
}

/** Compte un essai ; false si la limite est atteinte (jeton détruit). */
export function countAttempt(token: string) {
  const p = pending.get(token)
  if (!p) return false
  p.attempts++
  if (p.attempts > 5) {
    pending.delete(token)
    return false
  }
  return true
}

/**
 * Vérifie un code TOTP (sans rejeu) ou un code de secours (consommé).
 * Renvoie le type de code accepté, ou null.
 */
export async function verifySecondFactor(userId: string, code: string) {
  const [u] = await db
    .select({
      secret: schema.users.totpSecret,
      enabled: schema.users.totpEnabledAt,
      recovery: schema.users.recoveryCodes,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!u?.enabled) return null

  const secret = openSecret(u.secret)
  if (secret) {
    const step = verifyTotp(
      secret,
      code,
      Date.now(),
      lastStep.get(userId) ?? -1
    )
    if (step !== null) {
      lastStep.set(userId, step)
      return "totp" as const
    }
  }

  const hash = sha256(normalizeRecoveryCode(code))
  const codes = u.recovery ?? []
  if (codes.includes(hash)) {
    // Consommation atomique : la liste doit être celle qu'on a lue.
    const res = await db
      .update(schema.users)
      .set({ recoveryCodes: codes.filter((c) => c !== hash) })
      .where(
        and(eq(schema.users.id, userId), eq(schema.users.recoveryCodes, codes))
      )
    if (res.rowsAffected === 1) return "recovery" as const
  }
  return null
}

/** Historique des connexions (IP tronquée) ; jamais d'échec bloquant. */
export async function logLogin(userId: string | null, result: string) {
  try {
    const info = await requestInfo()
    await db.insert(schema.loginEvents).values({ userId, result, ...info })
  } catch {
    // l'historique ne bloque jamais la connexion
  }
}

/** Rétention de l'historique : 90 jours. */
export async function purgeLoginEvents() {
  await db
    .delete(schema.loginEvents)
    .where(
      lt(schema.loginEvents.createdAt, new Date(Date.now() - 90 * 86_400_000))
    )
}
