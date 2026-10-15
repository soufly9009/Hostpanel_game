"use server"

import { clearFailedAdminLogin, recordFailedAdminLogin } from "@/lib/auth/watch"
import { redirect } from "next/navigation"
import { count, eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"
import { recordAcceptances, requiredDocuments } from "@/lib/legal/service"
import { moveBalance } from "@/lib/wallet/service"
import { getWalletSettings } from "@/lib/wallet/settings"

import { hashPassword, verifyPassword } from "./password"
import { createSession, destroySession, homeFor } from "./session"

export type AuthState = { error?: string; email?: string } | undefined

const email = z.string().trim().toLowerCase().pipe(z.email("Email invalide"))

const loginSchema = z.object({
  email,
  password: z.string().min(1, "Mot de passe requis"),
})

const registerSchema = z.object({
  name: z.string().trim().min(1, "Nom requis").max(80),
  email,
  password: z
    .string()
    .min(8, "8 caractères minimum")
    .max(200, "Mot de passe trop long"),
})

// Hash factice : "email inconnu" prend le même temps que "mauvais mot de passe".
const DUMMY_HASH = `${"00".repeat(16)}:${"00".repeat(64)}`

export async function register(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = Object.fromEntries(formData)
  const parsed = registerSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message,
      email: String(raw.email ?? ""),
    }
  }
  const { name, email, password } = parsed.data

  // Consentement explicite aux conditions obligatoires (case non pré-cochée).
  if (formData.get("terms") !== "on") {
    return {
      error: "Tu dois accepter les conditions pour créer un compte.",
      email,
    }
  }
  // Versions affichées au moment de l'inscription.
  const required = await requiredDocuments()

  const [existing] = await db
    .select({ id: schema.users.id })
    .from(schema.users)
    .where(eq(schema.users.email, email))
  if (existing) return { error: "Un compte existe déjà avec cet email", email }

  // Le premier compte (administrateur) se crée via /install/setup, protégé
  // par le code d'installation.
  const [{ total }] = await db.select({ total: count() }).from(schema.users)
  if (total === 0) {
    return { error: "Installation non terminée : ouvre /install/setup.", email }
  }

  const [user] = await db
    .insert(schema.users)
    .values({
      name,
      email,
      passwordHash: await hashPassword(password),
      role: "user",
    })
    .returning({ id: schema.users.id, role: schema.users.role })

  await recordAcceptances(user.id, required)

  const { signupBonusCents } = await getWalletSettings()
  if (signupBonusCents > 0) {
    await moveBalance({
      userId: user.id,
      amountCents: signupBonusCents,
      kind: "adjustment",
      description: "Bonus de bienvenue",
      actor: "système",
      idempotencyKey: "signup-bonus",
    }).catch(() => undefined)
  }

  await createSession(user.id)
  redirect(homeFor(user.role))
}

export async function login(
  _prev: AuthState,
  formData: FormData
): Promise<AuthState> {
  const raw = Object.fromEntries(formData)
  const parsed = loginSchema.safeParse(raw)
  if (!parsed.success) {
    return {
      error: parsed.error.issues[0]?.message,
      email: String(raw.email ?? ""),
    }
  }
  const { email, password } = parsed.data

  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.email, email))

  const ok = await verifyPassword(password, user?.passwordHash ?? DUMMY_HASH)
  if (!user || !ok) {
    if (user?.role === "admin") recordFailedAdminLogin(user.id)
    return { error: "Email ou mot de passe incorrect", email }
  }

  clearFailedAdminLogin(user.id)
  await createSession(user.id)
  redirect(homeFor(user.role))
}

export async function logout() {
  await destroySession()
  redirect("/login")
}
