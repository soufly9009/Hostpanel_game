import "server-only"

import { eq, isNotNull } from "drizzle-orm"

import { removeService } from "@/lib/cancellations/service"
import { db, schema } from "@/lib/db"
import { errorText, logError, logWarning } from "@/lib/discord/logging"
import { deleteGameServer, suspendGameServer } from "@/lib/pterodactyl/client"
import { links, queueUserEmail } from "@/lib/mail/service"
import { emitEvent } from "@/lib/webhooks/service"
import { closeConsole } from "@/lib/pterodactyl/console"

/**
 * Échéances des serveurs de jeu, mêmes règles que les VPS : suspension à
 * l'échéance, suppression optionnelle après la période de grâce.
 */
export async function processGameExpiries(
  now: Date,
  graceMs: number | null,
  checkEveryMs: number
) {
  const out = {
    checked: 0,
    suspended: 0,
    deleted: 0,
    expiringSoon: 0,
    errors: [] as string[],
  }
  const rows = await db
    .select()
    .from(schema.gameServers)
    .where(isNotNull(schema.gameServers.expiresAt))

  for (const s of rows) {
    out.checked++
    const expiresAt = s.expiresAt as Date
    if (expiresAt > now) {
      if (expiresAt.getTime() - now.getTime() <= checkEveryMs) {
        out.expiringSoon++
      }
      continue
    }
    try {
      if (s.cancelAtPeriodEnd) {
        await removeService("game", s.id)
        out.deleted++
        continue
      }
      let reason = s.suspendReason
      if (!s.suspended) {
        await suspendGameServer(s.pteroId)
        closeConsole(s.id)
        await db
          .update(schema.gameServers)
          .set({ suspended: true, suspendReason: "expired" })
          .where(eq(schema.gameServers.id, s.id))
        reason = "expired"
        out.suspended++
        void emitEvent("service.suspended", {
          type: "game",
          serviceId: s.id,
          userId: s.userId,
          reason: "expired",
        })
        await queueUserEmail(s.userId, "service_suspended", {
          service: s.name,
          reason: "échéance dépassée",
          panelUrl: links.panel(),
        })
        void logWarning({
          category: "renewals",
          title: "Serveur de jeu suspendu : échéance dépassée",
          service: "Serveur de jeu",
          action: "suspension",
          result: "success",
          meta: { serveur: s.id },
          dedupeKey: `game-expired:${s.id}`,
        })
      }
      if (
        graceMs !== null &&
        reason === "expired" &&
        expiresAt.getTime() + graceMs <= now.getTime()
      ) {
        await deleteGameServer(s.pteroId)
        await db
          .delete(schema.gameServers)
          .where(eq(schema.gameServers.id, s.id))
        out.deleted++
        void logWarning({
          category: "renewals",
          title: "Serveur de jeu supprimé après la période de grâce",
          service: "Serveur de jeu",
          action: "suppression automatique",
          result: "success",
          meta: { serveur: s.id },
          dedupeKey: `game-grace-del:${s.id}`,
        })
      }
    } catch (e) {
      out.errors.push(`${s.name} (jeu #${s.pteroId}) : ${errorText(e)}`)
      void logError({
        category: "renewals",
        title: "Échec du traitement d'une échéance (jeu)",
        service: "Serveur de jeu",
        action: "vérification des renouvellements",
        result: "failure",
        message: errorText(e),
        meta: { serveur: s.id },
        dedupeKey: `game-renewal-fail:${s.id}`,
      })
    }
  }
  return out
}
