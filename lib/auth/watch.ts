import "server-only"

import { logWarning } from "@/lib/discord/logging"

/**
 * Détection fiable et volontairement étroite : échecs de connexion répétés
 * sur un compte ADMINISTRATEUR existant. Les échecs sur des e-mails inconnus
 * ou des comptes clients ne génèrent aucune alerte (bruit, énumération).
 * Compteur en mémoire (instance unique) ; l'alerte est dédupliquée 30 min.
 */

const WINDOW_MS = 10 * 60_000
const THRESHOLD = 5

const g = globalThis as unknown as { __adminLoginFails?: Map<string, number[]> }
const fails = (g.__adminLoginFails ??= new Map<string, number[]>())

export function recordFailedAdminLogin(userId: string) {
  const now = Date.now()
  const list = (fails.get(userId) ?? []).filter((t) => now - t < WINDOW_MS)
  list.push(now)
  fails.set(userId, list)
  if (fails.size > 200) fails.clear()

  if (list.length >= THRESHOLD) {
    void logWarning({
      category: "security",
      title: "Échecs de connexion répétés sur un compte administrateur",
      service: "Authentification",
      action: "connexion",
      result: "failure",
      message: `${list.length} échecs en moins de 10 minutes.`,
      meta: { compte: userId.slice(0, 8) },
      dedupeKey: `admin-login:${userId}`,
      dedupeWindowMs: 30 * 60_000,
    })
  }
}

export function clearFailedAdminLogin(userId: string) {
  fails.delete(userId)
}
