"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { mailConfigured } from "@/lib/env"

import { flushEmails, queueEmail, verifySmtp } from "./service"
import { TEMPLATE_KEYS } from "./templates"

export type MailState =
  { error?: string; ok?: boolean; notice?: string } | undefined

export async function saveTemplateAction(
  _prev: MailState,
  formData: FormData
): Promise<MailState> {
  const admin = await requireAdmin()
  const key = String(formData.get("key") ?? "")
  if (!TEMPLATE_KEYS.includes(key)) return { error: "Modèle inconnu" }
  const subject = String(formData.get("subject") ?? "").trim()
  const body = String(formData.get("body") ?? "").trim()
  if (subject.length < 2 || subject.length > 200)
    return { error: "Sujet invalide" }
  if (body.length < 2 || body.length > 10_000)
    return { error: "Contenu invalide" }
  const values = {
    subject,
    body,
    isEnabled: formData.get("isEnabled") !== null,
    updatedAt: new Date(),
    updatedBy: admin.email,
  }
  await db
    .insert(schema.emailTemplates)
    .values({ key, ...values })
    .onConflictDoUpdate({ target: schema.emailTemplates.key, set: values })
  await logActivity(admin, `Modèle d'e-mail modifié : ${key}`, {
    type: "email",
  })
  revalidatePath("/admin/emails")
  return { ok: true, notice: "Modèle enregistré." }
}

/** Revient au texte par défaut. */
export async function resetTemplateAction(key: string): Promise<MailState> {
  await requireAdmin()
  await db
    .delete(schema.emailTemplates)
    .where(eq(schema.emailTemplates.key, key))
  revalidatePath("/admin/emails")
  return { ok: true }
}

/** Vérifie SMTP puis s'envoie un e-mail de test. */
export async function testEmailAction(): Promise<MailState> {
  const admin = await requireAdmin()
  const check = await verifySmtp()
  if (check !== "OK") return { error: `SMTP : ${check}` }
  await queueEmail({
    to: admin.email,
    template: "welcome",
    userId: admin.id,
    vars: { name: admin.name ?? admin.email, panelUrl: "(e-mail de test)" },
  })
  await flushEmails(5)
  revalidatePath("/admin/emails")
  return { ok: true, notice: `E-mail de test envoyé à ${admin.email}.` }
}

export async function retryFailedAction(): Promise<MailState> {
  await requireAdmin()
  if (!mailConfigured) return { error: "SMTP non configuré." }
  const n = await flushEmails(50)
  revalidatePath("/admin/emails")
  return { ok: true, notice: `${n} e-mail(s) envoyé(s).` }
}
