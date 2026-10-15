"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireAdmin } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { auditSensitive } from "@/lib/discord/audit"

import { WEBHOOK_EVENT_KEYS } from "./events"
import { flushWebhooks, newWebhookSecret } from "./service"

export type WebhookState =
  { error?: string; ok?: boolean; notice?: string; secret?: string } | undefined

const urlSchema = z
  .url("URL invalide")
  .refine(
    (u) => u.startsWith("https://") || process.env.NODE_ENV !== "production",
    "https requis"
  )

export async function createWebhookAction(
  _prev: WebhookState,
  formData: FormData
): Promise<WebhookState> {
  const admin = await requireAdmin()
  const name = String(formData.get("name") ?? "")
    .trim()
    .slice(0, 60)
  const url = urlSchema.safeParse(String(formData.get("url") ?? "").trim())
  const events = formData
    .getAll("events")
    .map(String)
    .filter((e) => WEBHOOK_EVENT_KEYS.includes(e))
  if (name.length < 2) return { error: "Nom requis." }
  if (!url.success) return { error: url.error.issues[0]?.message }
  if (events.length === 0) return { error: "Choisis au moins un événement." }
  const secret = newWebhookSecret()
  await db
    .insert(schema.webhooks)
    .values({ name, url: url.data, secret, events, createdBy: admin.email })
  await logActivity(admin, `Webhook créé : ${name}`, { type: "webhook" })
  auditSensitive(admin, "Webhook créé", {
    webhook: name,
    événements: events.length,
  })
  revalidatePath("/admin/webhooks")
  return {
    ok: true,
    notice: `Webhook « ${name} » créé. Clé de signature :`,
    secret,
  }
}

export async function toggleWebhookAction(id: string, active: boolean) {
  await requireAdmin()
  await db
    .update(schema.webhooks)
    .set({ isActive: active })
    .where(eq(schema.webhooks.id, z.string().max(64).parse(id)))
  revalidatePath("/admin/webhooks")
}

export async function deleteWebhookAction(id: string) {
  const admin = await requireAdmin()
  const [w] = await db
    .delete(schema.webhooks)
    .where(eq(schema.webhooks.id, z.string().max(64).parse(id)))
    .returning()
  if (w)
    await logActivity(admin, `Webhook supprimé : ${w.name}`, {
      type: "webhook",
    })
  revalidatePath("/admin/webhooks")
}

export async function rotateWebhookSecretAction(
  id: string
): Promise<WebhookState> {
  const admin = await requireAdmin()
  const secret = newWebhookSecret()
  const [w] = await db
    .update(schema.webhooks)
    .set({ secret })
    .where(eq(schema.webhooks.id, z.string().max(64).parse(id)))
    .returning()
  if (!w) return { error: "Webhook introuvable" }
  auditSensitive(
    admin,
    "Clé de webhook régénérée",
    { webhook: w.name },
    "warning"
  )
  return {
    ok: true,
    notice: "Nouvelle clé (l'ancienne ne signe plus) :",
    secret,
  }
}

/** Livraison de test « ping » immédiate. */
export async function pingWebhookAction(id: string): Promise<WebhookState> {
  await requireAdmin()
  const [w] = await db
    .select()
    .from(schema.webhooks)
    .where(eq(schema.webhooks.id, z.string().max(64).parse(id)))
  if (!w) return { error: "Webhook introuvable" }
  await db.insert(schema.webhookDeliveries).values({
    webhookId: w.id,
    event: "ping",
    payload: JSON.stringify({
      id: crypto.randomUUID(),
      event: "ping",
      createdAt: new Date().toISOString(),
      data: {},
    }),
  })
  await flushWebhooks(5)
  revalidatePath("/admin/webhooks")
  return { ok: true, notice: "Ping envoyé : vois le résultat dans le journal." }
}
