import "server-only"

import { env } from "@/lib/env"

/**
 * Envoi vers le webhook Discord. Aucune dépendance au reste du panel (pas de
 * journalisation ici) : évite toute boucle de notification.
 * L'URL du webhook n'apparaît jamais dans un résultat ou une erreur.
 */

export type DeliveryResult =
  | { ok: true }
  | {
      ok: false
      kind:
        | "not_configured"
        | "invalid_url"
        | "rate_limited"
        | "rejected" // 4xx : la requête ou le webhook est refusé
        | "server_error" // 5xx
        | "timeout"
        | "network"
      status?: number
      /** Délai demandé par Discord (secondes), pour « rate_limited ». */
      retryAfter?: number
      /** Description courte, sans secret. */
      detail: string
    }

const TIMEOUT_MS = 8_000

const ALLOWED_HOSTS = new Set([
  "discord.com",
  "ptb.discord.com",
  "canary.discord.com",
  "discordapp.com",
])

/**
 * Valide l'URL : https, hôte Discord, chemin /api/webhooks/{id}/{token}.
 * Refuse tout autre hôte (pas de SSRF via une variable mal configurée).
 * Les tests peuvent cibler une boucle locale uniquement avec NODE_ENV=test.
 */
export function validateWebhookUrl(raw: string | undefined | null) {
  if (!raw) return { ok: false as const, reason: "not_configured" as const }
  let u: URL
  try {
    u = new URL(raw)
  } catch {
    return { ok: false as const, reason: "invalid_url" as const }
  }
  const testLoopback =
    process.env.NODE_ENV === "test" &&
    u.protocol === "http:" &&
    ["127.0.0.1", "localhost"].includes(u.hostname)
  if (!testLoopback) {
    if (u.protocol !== "https:" || !ALLOWED_HOSTS.has(u.hostname)) {
      return { ok: false as const, reason: "invalid_url" as const }
    }
  }
  if (!/^\/api\/(v\d+\/)?webhooks\/\d+\/[\w-]+$/.test(u.pathname)) {
    return { ok: false as const, reason: "invalid_url" as const }
  }
  return { ok: true as const, url: u }
}

export function webhookConfigured() {
  return validateWebhookUrl(env.DISCORD_LOG_WEBHOOK_URL).ok
}

export type DiscordPayload = {
  username?: string
  content?: string
  embeds?: unknown[]
  allowed_mentions: { parse: [] }
}

/** Envoie un payload ; `fetchImpl` permet de l'isoler dans les tests. */
export async function postToWebhook(
  payload: DiscordPayload,
  opts: { url?: string | null; timeoutMs?: number } = {}
): Promise<DeliveryResult> {
  const v = validateWebhookUrl(opts.url ?? env.DISCORD_LOG_WEBHOOK_URL)
  if (!v.ok) {
    return {
      ok: false,
      kind: v.reason,
      detail:
        v.reason === "not_configured"
          ? "Webhook non configuré"
          : "URL de webhook invalide",
    }
  }

  const controller = new AbortController()
  const timer = setTimeout(
    () => controller.abort(),
    opts.timeoutMs ?? TIMEOUT_MS
  )

  try {
    const res = await fetch(v.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
      redirect: "error", // jamais de suivi de redirection
    })

    if (res.status === 204 || res.status === 200) {
      return { ok: true }
    }

    if (res.status === 429) {
      const header = Number(res.headers.get("retry-after"))
      let retry = Number.isFinite(header) && header > 0 ? header : 0
      if (!retry) {
        const body = (await res.json().catch(() => null)) as {
          retry_after?: number
        } | null
        retry = Number(body?.retry_after) || 5
      }
      return {
        ok: false,
        kind: "rate_limited",
        status: 429,
        retryAfter: Math.min(Math.max(retry, 1), 3600),
        detail: "Limite de débit Discord atteinte",
      }
    }

    if (res.status >= 500) {
      return {
        ok: false,
        kind: "server_error",
        status: res.status,
        detail: `Discord indisponible (HTTP ${res.status})`,
      }
    }

    // 4xx : on ne recopie pas le corps (peut contenir des détails du payload).
    return {
      ok: false,
      kind: "rejected",
      status: res.status,
      detail:
        res.status === 404 || res.status === 401
          ? `Webhook refusé ou supprimé (HTTP ${res.status})`
          : `Message refusé par Discord (HTTP ${res.status})`,
    }
  } catch (e) {
    if (e instanceof Error && e.name === "AbortError") {
      return { ok: false, kind: "timeout", detail: "Délai dépassé" }
    }
    return { ok: false, kind: "network", detail: "Erreur réseau" }
  } finally {
    clearTimeout(timer)
  }
}
