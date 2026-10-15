import "server-only"

import { db, schema } from "@/lib/db"

type Actor = { id: string; email: string } | null

/**
 * Journal d'activité. Ne jamais y mettre de secret, de mot de passe ni de
 * corps de requête : uniquement l'action et sa cible.
 */
export async function logActivity(
  actor: Actor,
  action: string,
  target?: {
    type:
      | "server"
      | "site"
      | "plan"
      | "account"
      | "maintenance"
      | "migration"
      | "network"
      | "ticket"
      | "role"
      | "wallet"
      | "legal"
      | "api"
    id?: string
    label?: string
  }
) {
  try {
    await db.insert(schema.activityLogs).values({
      userId: actor?.id || null,
      actor: actor?.email ?? "système",
      action,
      targetType: target?.type,
      targetId: target?.id,
      targetLabel: target?.label?.slice(0, 120),
    })
  } catch {
    // le journal ne doit jamais faire échouer l'action
  }
}
