import "server-only"

import { logInfo, logWarning } from "./logging"

/**
 * Modification de paramètres sensibles par un administrateur.
 * On ne transmet que l'action et un identifiant interne tronqué.
 */
export function auditSensitive(
  admin: { id: string },
  action: string,
  meta: Record<string, unknown> = {},
  level: "info" | "warning" = "info"
) {
  const log = level === "warning" ? logWarning : logInfo
  void log({
    category: "security",
    title: "Paramètre sensible modifié",
    service: "Administration",
    action,
    result: "success",
    meta: { admin: admin.id.slice(0, 8), ...meta },
    dedupeKey: `audit:${action}:${JSON.stringify(meta)}`,
    dedupeWindowMs: 30_000,
  })
}
