"use server"

import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"
import { and, eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { deletionBlocker, eraseUser } from "@/lib/account/privacy"
import { issueResetLink } from "@/lib/auth/reset"
import {
  getCurrentUser,
  requireAdmin,
  startImpersonation,
  stopImpersonation,
} from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

export type ClientState =
  { error?: string; ok?: boolean; notice?: string; link?: string } | undefined

const idSchema = z.string().min(1).max(64)

async function target(userId: string) {
  const [u] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, idSchema.parse(userId)))
  return u ?? null
}

/** Se connecter en tant que client (jamais un autre administrateur). */
export async function impersonateAction(userId: string): Promise<ClientState> {
  const admin = await requireAdmin()
  const u = await target(userId)
  if (!u) return { error: "Client introuvable" }
  if (u.id === admin.id) return { error: "C'est ton propre compte." }
  if (u.role === "admin") {
    return { error: "Impossible de se connecter en tant qu'administrateur." }
  }
  await startImpersonation(u.id)
  await logActivity(admin, `Connexion en tant que ${u.email}`, {
    type: "account",
    id: u.id,
    label: u.email,
  })
  auditSensitive(
    admin,
    "Connexion en tant que client",
    { client: u.id.slice(0, 8) },
    "warning"
  )
  redirect("/dashboard")
}

export async function stopImpersonationAction() {
  const user = await getCurrentUser()
  const ok = await stopImpersonation()
  if (ok && user) {
    await logActivity(null, `Fin de la connexion en tant que ${user.email}`, {
      type: "account",
      id: user.id,
    })
  }
  redirect(ok && user ? `/admin/users/${user.id}` : "/login")
}

/** Envoie un lien de réinitialisation et le renvoie (à transmettre sans SMTP). */
export async function adminResetPasswordAction(
  userId: string
): Promise<ClientState> {
  const admin = await requireAdmin()
  const u = await target(userId)
  if (!u) return { error: "Client introuvable" }
  const link = await issueResetLink(u.id)
  if (!link) return { error: "Trop de demandes récentes (3 par heure)." }
  await logActivity(admin, "Lien de réinitialisation envoyé", {
    type: "account",
    id: u.id,
    label: u.email,
  })
  return {
    ok: true,
    notice: "Lien envoyé par e-mail (valable 30 min, usage unique).",
    link,
  }
}

export async function addClientNoteAction(
  _prev: ClientState,
  formData: FormData
): Promise<ClientState> {
  const admin = await requireAdmin()
  const userId = idSchema.safeParse(formData.get("userId"))
  const body = String(formData.get("body") ?? "").trim()
  if (!userId.success) return { error: "Client invalide" }
  if (body.length < 2 || body.length > 2000)
    return { error: "Note vide ou trop longue." }
  await db.insert(schema.clientNotes).values({
    userId: userId.data,
    author: admin.email,
    body,
    isPinned: formData.get("isPinned") !== null,
  })
  revalidatePath(`/admin/users/${userId.data}`)
  return { ok: true }
}

export async function deleteClientNoteAction(
  noteId: string
): Promise<ClientState> {
  await requireAdmin()
  const [n] = await db
    .delete(schema.clientNotes)
    .where(eq(schema.clientNotes.id, idSchema.parse(noteId)))
    .returning({ userId: schema.clientNotes.userId })
  if (n) revalidatePath(`/admin/users/${n.userId}`)
  return { ok: true }
}

export async function togglePinNoteAction(noteId: string, pinned: boolean) {
  await requireAdmin()
  const [n] = await db
    .update(schema.clientNotes)
    .set({ isPinned: pinned })
    .where(and(eq(schema.clientNotes.id, idSchema.parse(noteId))))
    .returning({ userId: schema.clientNotes.userId })
  if (n) revalidatePath(`/admin/users/${n.userId}`)
}

/** Suppression du compte par un administrateur (mêmes garde-fous que RGPD). */
export async function adminDeleteAccountAction(
  userId: string
): Promise<ClientState> {
  const admin = await requireAdmin()
  const u = await target(userId)
  if (!u) return { error: "Client introuvable" }
  if (u.id === admin.id) return { error: "Utilise ta propre page de compte." }
  const blocker = await deletionBlocker(u)
  if (blocker)
    return {
      error: blocker.replace("Supprime d'abord tes", "Supprime d'abord ses"),
    }
  await eraseUser(u.id)
  await logActivity(admin, "Compte client supprimé", {
    type: "account",
    label: u.id.slice(0, 8),
  })
  auditSensitive(
    admin,
    "Compte client supprimé",
    { client: u.id.slice(0, 8) },
    "warning"
  )
  redirect("/admin/users")
}
