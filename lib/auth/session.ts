import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { requestInfo } from "@/lib/security/request"

import { homeFor } from "./roles"

const COOKIE_NAME = "session"
const SESSION_DAYS = 30

// Le cookie contient le jeton ; seule son empreinte SHA-256 est stockée en base.
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

const cookieOptions = (expires: Date) => ({
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  expires,
})

export async function createSession(
  userId: string,
  ttlMs = SESSION_DAYS * 24 * 60 * 60 * 1000
) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + ttlMs)

  const info = await requestInfo().catch(() => ({
    ipHint: null,
    userAgent: null,
  }))
  await db.insert(schema.sessions).values({
    id: hashToken(token),
    userId,
    expiresAt,
    ...info,
    lastSeenAt: new Date(),
  })

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, cookieOptions(expiresAt))
}

/* ───────────── Connexion « en tant que » (administrateur) ───────────── */

/** Jeton de session de l'administrateur, mis de côté pendant l'usurpation. */
const RETURN_COOKIE = "admin_return"
const IMPERSONATION_MS = 2 * 60 * 60 * 1000

/**
 * Ouvre une session de 2 h au nom du client ; la session de l'administrateur
 * est conservée à part pour y revenir (`stopImpersonation`).
 */
export async function startImpersonation(targetUserId: string) {
  const jar = await cookies()
  const current = jar.get(COOKIE_NAME)?.value
  if (!current) throw new Error("Session administrateur introuvable")
  jar.set(
    RETURN_COOKIE,
    current,
    cookieOptions(new Date(Date.now() + IMPERSONATION_MS))
  )
  await createSession(targetUserId, IMPERSONATION_MS)
}

export async function isImpersonating() {
  return Boolean((await cookies()).get(RETURN_COOKIE)?.value)
}

/** Ferme la session usurpée et rétablit celle de l'administrateur. */
export async function stopImpersonation() {
  const jar = await cookies()
  const back = jar.get(RETURN_COOKIE)?.value
  jar.delete(RETURN_COOKIE)
  const current = jar.get(COOKIE_NAME)?.value
  if (current) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(current)))
  }
  if (!back) {
    jar.delete(COOKIE_NAME)
    return false
  }
  const [row] = await db
    .select({ expiresAt: schema.sessions.expiresAt, role: schema.users.role })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, hashToken(back)))
  // Jeton de retour invalide ou qui n'est plus administrateur : déconnexion.
  if (!row || row.role !== "admin" || row.expiresAt.getTime() < Date.now()) {
    jar.delete(COOKIE_NAME)
    return false
  }
  jar.set(COOKIE_NAME, back, cookieOptions(row.expiresAt))
  return true
}

export const getCurrentUser = cache(async () => {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  if (!token) return null

  const [row] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      roleId: schema.users.roleId,
      serverLimit: schema.users.serverLimit,
      expiresAt: schema.sessions.expiresAt,
      lastSeenAt: schema.sessions.lastSeenAt,
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, hashToken(token)))

  if (!row || row.expiresAt.getTime() < Date.now()) return null
  // Dernière activité (au plus une écriture toutes les 5 minutes).
  if (!row.lastSeenAt || Date.now() - row.lastSeenAt.getTime() > 5 * 60_000) {
    void db
      .update(schema.sessions)
      .set({ lastSeenAt: new Date() })
      .where(eq(schema.sessions.id, hashToken(token)))
      .catch(() => undefined)
  }
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    role: row.role,
    roleId: row.roleId,
    serverLimit: row.serverLimit,
  }
})

export { homeFor }

/** Identifiant (empreinte) de la session courante, pour la marquer dans la liste. */
export async function currentSessionId() {
  const token = (await cookies()).get(COOKIE_NAME)?.value
  return token ? hashToken(token) : null
}

export async function requireUser() {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}

export async function requireAdmin() {
  const user = await requireUser()
  if (user.role !== "admin") redirect(homeFor(user.role))
  return user
}

export async function destroySession() {
  const jar = await cookies()
  const token = jar.get(COOKIE_NAME)?.value
  if (token) {
    await db
      .delete(schema.sessions)
      .where(eq(schema.sessions.id, hashToken(token)))
  }
  jar.delete(COOKIE_NAME)
}
