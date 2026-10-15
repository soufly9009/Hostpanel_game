import { timingSafeEqual } from "node:crypto"

import { getCurrentUser } from "@/lib/auth/session"
import { env } from "@/lib/env"
import { runRenewalCheck } from "@/lib/renewals"

export const dynamic = "force-dynamic"

function hasCronSecret(request: Request) {
  if (!env.CRON_SECRET) return false
  const given = Buffer.from(
    (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "")
  )
  const expected = Buffer.from(env.CRON_SECRET)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

/**
 * Déclenche la vérification des renouvellements.
 *
 *   curl -X POST "$URL/api/cron/renewals" -H "Authorization: Bearer $CRON_SECRET"
 *
 * Sans `?force=1`, elle ne s'exécute que si le délai (3 j par défaut) est
 * écoulé. Les admins connectés peuvent aussi forcer l'exécution.
 */
async function handle(request: Request) {
  const user = await getCurrentUser()
  const isAdmin = user?.role === "admin"

  if (!hasCronSecret(request) && !isAdmin) {
    return Response.json({ error: "Non autorisé" }, { status: 401 })
  }

  const force = new URL(request.url).searchParams.get("force") === "1"
  const result = await runRenewalCheck({ force: force && isAdmin })

  return Response.json(
    result
      ? { ran: true, result }
      : { ran: false, reason: "Vérification pas encore due" }
  )
}

export const POST = handle
export const GET = handle
