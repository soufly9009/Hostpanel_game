import "server-only"

import { createHmac, randomBytes } from "node:crypto"
import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm"

import { db, schema } from "@/lib/db"

import type { WebhookEvent } from "./events"

/**
 * Webhooks sortants : chaque événement crée une livraison par webhook abonné
 * (file persistante, reprise chaque minute). Corps JSON signé :
 *   X-Webhook-Signature: sha256=<HMAC-SHA256(secret, `${timestamp}.${corps}`)>
 *   X-Webhook-Timestamp: secondes Unix (refuser au-delà de 5 min de décalage)
 * Les données ne contiennent que des identifiants et montants, jamais de secret.
 */

const MAX_ATTEMPTS = 6

export const newWebhookSecret = () =>
  `whsec_${randomBytes(24).toString("base64url")}`

export function signPayload(secret: string, timestamp: number, body: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${body}`)
    .digest("hex")
}

/** Publie un événement ; n'échoue jamais. */
export async function emitEvent(
  event: WebhookEvent,
  data: Record<string, unknown>
) {
  try {
    const hooks = await db
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.isActive, true))
    const targets = hooks.filter((h) => h.events.includes(event))
    if (targets.length === 0) return
    const payload = JSON.stringify({
      id: crypto.randomUUID(),
      event,
      createdAt: new Date().toISOString(),
      data,
    })
    await db
      .insert(schema.webhookDeliveries)
      .values(targets.map((h) => ({ webhookId: h.id, event, payload })))
    void flushWebhooks(10).catch(() => undefined)
  } catch (e) {
    console.error("[webhooks] émission impossible", e)
  }
}

const g = globalThis as unknown as { __webhookFlushing?: boolean }

/** Envoie les livraisons en attente (timeout 10 s, backoff exponentiel). */
export async function flushWebhooks(limit = 20) {
  if (g.__webhookFlushing) return 0
  g.__webhookFlushing = true
  let sent = 0
  try {
    const D = schema.webhookDeliveries
    const rows = await db
      .select({ d: D, hook: schema.webhooks })
      .from(D)
      .innerJoin(schema.webhooks, eq(schema.webhooks.id, D.webhookId))
      .where(
        and(
          eq(D.status, "pending"),
          or(isNull(D.nextAttemptAt), lte(D.nextAttemptAt, new Date()))
        )
      )
      .limit(limit)
    for (const { d, hook } of rows) {
      const ts = Math.floor(Date.now() / 1000)
      let code: number | null = null
      let error: string | null = null
      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "hosting-panel-webhooks/1",
            "X-Webhook-Event": d.event,
            "X-Webhook-Timestamp": String(ts),
            "X-Webhook-Signature": `sha256=${signPayload(hook.secret, ts, d.payload)}`,
          },
          body: d.payload,
          redirect: "manual",
          signal: AbortSignal.timeout(10_000),
        })
        code = res.status
        if (!res.ok) error = `HTTP ${res.status}`
      } catch (e) {
        error = e instanceof Error ? e.message : "Erreur réseau"
      }
      const attempts = d.attempts + 1
      await db
        .update(D)
        .set(
          error
            ? {
                attempts,
                responseCode: code,
                lastError: error.slice(0, 300),
                status: attempts >= MAX_ATTEMPTS ? "failed" : "pending",
                nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
              }
            : { attempts, responseCode: code, lastError: null, status: "sent" }
        )
        .where(eq(D.id, d.id))
      if (!error) sent++
    }
  } finally {
    g.__webhookFlushing = false
  }
  return sent
}

/** Rétention des livraisons : 30 jours. */
export async function purgeOldDeliveries() {
  await db
    .delete(schema.webhookDeliveries)
    .where(
      and(
        inArray(schema.webhookDeliveries.status, ["sent", "failed"]),
        lt(
          schema.webhookDeliveries.createdAt,
          new Date(Date.now() - 30 * 86_400_000)
        )
      )
    )
}
