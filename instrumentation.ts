export async function register() {
  // Le planificateur n'a de sens que dans le runtime Node.js (pas en Edge).
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startScheduler } = await import("./lib/scheduler")
    startScheduler()
    // Panel vierge : affiche comment terminer l'installation.
    const { announceSetup } = await import("./lib/install/access")
    void announceSetup().catch(() => undefined)
  }
}

/**
 * Erreurs internes non gérées (rendu, route handlers, server actions).
 * Un seul événement par route et par message (dédupliqué) : jamais de pile
 * d'appels, jamais d'URL avec identifiants (on utilise le modèle de route).
 */
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string },
  context: { routePath: string; routeType: string }
) {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  try {
    const { errorText, logError } = await import("./lib/discord/logging")
    const message = errorText(err)
    await logError({
      category: "app",
      title: "Erreur interne de l'application",
      service: context.routeType,
      action: `${request.method} ${context.routePath}`,
      result: "failure",
      message,
      meta: { digest: (err as { digest?: string } | null)?.digest ?? "" },
      dedupeKey: `${context.routePath}:${message.slice(0, 80)}`,
    })
  } catch {
    // jamais d'exception depuis le gestionnaire d'erreurs
  }
}
