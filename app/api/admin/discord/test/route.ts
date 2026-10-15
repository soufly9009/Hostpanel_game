import { getCurrentUser } from "@/lib/auth/session"
import { buildPayload } from "@/lib/discord/embed"
import { logEvent, newCorrelationId } from "@/lib/discord/logging"
import { postToWebhook, webhookConfigured } from "@/lib/discord/webhook"

export const dynamic = "force-dynamic"

/** Un test toutes les 10 s au plus (instance unique). */
const g = globalThis as unknown as { __discordTestAt?: number }

type Outcome =
  | "accepted"
  | "rejected"
  | "timeout"
  | "not_configured"
  | "rate_limited"
  | "network_error"

/**
 * Envoie une notification de test. Réservé aux administrateurs ; la réponse
 * ne contient jamais l'URL du webhook (seulement le type de résultat).
 */
export async function POST() {
  const user = await getCurrentUser()
  // 404 : on ne révèle pas l'existence de la route aux non-administrateurs.
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Introuvable" }, { status: 404 })
  }

  const now = Date.now()
  if (g.__discordTestAt && now - g.__discordTestAt < 10_000) {
    return Response.json(
      { result: "rate_limited", message: "Patiente quelques secondes." },
      { status: 429 }
    )
  }
  g.__discordTestAt = now

  if (!webhookConfigured()) {
    return Response.json({
      result: "not_configured" satisfies Outcome,
      message:
        "DISCORD_LOG_WEBHOOK_URL est absente ou invalide dans l'environnement.",
    })
  }

  const correlationId = newCorrelationId()
  const res = await postToWebhook(
    buildPayload({
      level: "info",
      category: "system",
      title: "Notification de test",
      message:
        "Ce message confirme que le webhook du panel fonctionne. Aucune action n'est requise.",
      service: "Panel",
      action: "test",
      result: "success",
      correlationId,
      createdAt: new Date(),
    })
  )

  let outcome: Outcome
  let message: string
  if (res.ok) {
    outcome = "accepted"
    message = "Test accepté par Discord."
  } else if (res.kind === "timeout") {
    outcome = "timeout"
    message = "Discord n'a pas répondu dans le délai imparti."
  } else if (res.kind === "network") {
    outcome = "network_error"
    message = "Erreur réseau lors de l'envoi."
  } else if (res.kind === "rate_limited") {
    outcome = "rate_limited"
    message = `Discord demande de patienter ${res.retryAfter ?? "quelques"} s.`
  } else if (res.kind === "not_configured" || res.kind === "invalid_url") {
    outcome = "not_configured"
    message = "Webhook absent ou invalide."
  } else {
    outcome = "rejected"
    message = res.detail
  }

  // Trace locale uniquement (pas de second envoi Discord).
  await logEvent(res.ok ? "success" : "warning", {
    category: "system",
    title: res.ok ? "Test Discord accepté" : "Test Discord échoué",
    service: "Panel",
    action: "test webhook",
    result: res.ok ? "success" : "failure",
    message,
    correlationId,
    discord: false,
  })

  return Response.json({ result: outcome, message })
}
