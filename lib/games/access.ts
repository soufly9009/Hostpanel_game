import "server-only"

import { eq } from "drizzle-orm"

import { getCurrentUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

/** Serveur de jeu accessible à l'utilisateur connecté (propriétaire ou admin). */
export async function getAccessibleGame(id: string) {
  const user = await getCurrentUser()
  if (!user || typeof id !== "string" || id.length > 64) return null
  const [game] = await db
    .select()
    .from(schema.gameServers)
    .where(eq(schema.gameServers.id, id))
  if (!game || (game.userId !== user.id && user.role !== "admin")) return null
  return { game, user }
}
