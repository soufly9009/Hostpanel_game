"use server"

import { redirect } from "next/navigation"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { hashPassword, verifyPassword } from "@/lib/auth/password"
import { destroySession, requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

import { deletionBlocker, eraseUser } from "./privacy"

export type AccountState = { error?: string; ok?: boolean } | undefined

const passwordSchema = z
  .object({
    current: z.string().min(1, "Mot de passe actuel requis"),
    next: z
      .string()
      .min(8, "8 caractères minimum")
      .max(128, "Mot de passe trop long"),
  })
  .refine((v) => v.current !== v.next, {
    message: "Le nouveau mot de passe doit être différent",
  })

/** Change le mot de passe puis déconnecte les autres sessions. */
export async function changePassword(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const user = await requireUser()
  const parsed = passwordSchema.safeParse({
    current: formData.get("current"),
    next: formData.get("next"),
  })
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const [row] = await db
    .select({ hash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
  if (!row?.hash || !(await verifyPassword(parsed.data.current, row.hash))) {
    return { error: "Mot de passe actuel incorrect" }
  }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data.next) })
    .where(eq(schema.users.id, user.id))
  await logActivity(user, "Mot de passe modifié", { type: "account" })
  return { ok: true }
}

/** Ferme toutes les sessions du compte (y compris celle-ci). */
export async function logoutEverywhere() {
  const user = await requireUser()
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, user.id))
  await logActivity(user, "Déconnexion de toutes les sessions", {
    type: "account",
  })
  await destroySession()
  redirect("/login")
}

/**
 * RGPD : suppression du compte par son titulaire (mot de passe + saisie de
 * confirmation). Refusée tant que des services réels existent.
 */
export async function deleteAccount(
  _prev: AccountState,
  formData: FormData
): Promise<AccountState> {
  const user = await requireUser()
  if (String(formData.get("confirm") ?? "").trim() !== "SUPPRIMER") {
    return { error: "Tape SUPPRIMER pour confirmer." }
  }
  const [row] = await db
    .select({ hash: schema.users.passwordHash })
    .from(schema.users)
    .where(eq(schema.users.id, user.id))
  const password = String(formData.get("password") ?? "")
  if (!row?.hash || !(await verifyPassword(password, row.hash))) {
    return { error: "Mot de passe incorrect" }
  }

  const blocker = await deletionBlocker(user)
  if (blocker) return { error: blocker }

  await eraseUser(user.id)
  // Aucune donnée personnelle dans le journal : seulement le fait.
  await logActivity(null, "Compte supprimé à la demande de son titulaire", {
    type: "account",
  })
  await destroySession()
  redirect("/?compte=supprime")
}
