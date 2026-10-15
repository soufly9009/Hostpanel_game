"use server"

import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { db, schema } from "@/lib/db"

import { hashPassword } from "./password"
import { consumeReset, issueResetLink } from "./reset"

export type ResetState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const SAME_ANSWER =
  "Si un compte existe pour cette adresse, un e-mail contenant un lien de réinitialisation vient d'être envoyé."

/** Réponse identique que le compte existe ou non (pas d'énumération). */
export async function requestResetAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const email = z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email())
    .safeParse(formData.get("email"))
  if (!email.success) return { error: "Adresse e-mail invalide." }

  const [user] = await db
    .select({ id: schema.users.id, email: schema.users.email })
    .from(schema.users)
    .where(eq(schema.users.email, email.data))
  if (user) {
    const link = await issueResetLink(user.id)
    if (link) {
      await logActivity(user, "Réinitialisation du mot de passe demandée", {
        type: "account",
      })
    }
  }
  return { ok: true, notice: SAME_ANSWER }
}

const resetSchema = z
  .object({
    token: z.string().min(10).max(100),
    password: z.string().min(8, "8 caractères minimum").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Les mots de passe ne correspondent pas",
  })

export async function resetPasswordAction(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = resetSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const userId = await consumeReset(parsed.data.token)
  if (!userId) return { error: "Lien invalide ou expiré : refais une demande." }

  await db
    .update(schema.users)
    .set({ passwordHash: await hashPassword(parsed.data.password) })
    .where(eq(schema.users.id, userId))
  // Toutes les sessions sont fermées : reconnexion avec le nouveau mot de passe.
  await db.delete(schema.sessions).where(eq(schema.sessions.userId, userId))
  await logActivity(
    { id: userId, email: "réinitialisation" },
    "Mot de passe réinitialisé",
    {
      type: "account",
    }
  )
  return { ok: true, notice: "Mot de passe modifié. Tu peux te connecter." }
}
