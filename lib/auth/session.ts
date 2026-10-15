import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"

import { homeFor } from "./roles"

const COOKIE_NAME = "session"
const SESSION_DAYS = 30

// Le cookie contient le jeton ; seule son empreinte SHA-256 est stockée en base.
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex")

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url")
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000)

  await db
    .insert(schema.sessions)
    .values({ id: hashToken(token), userId, expiresAt })

  const jar = await cookies()
  jar.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  })
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
    })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.id, hashToken(token)))

  if (!row || row.expiresAt.getTime() < Date.now()) return null
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
