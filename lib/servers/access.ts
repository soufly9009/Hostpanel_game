import "server-only"

import { eq } from "drizzle-orm"

import { getCurrentUser, requireUser } from "@/lib/auth/session"
import type { RoleName } from "@/lib/auth/roles"
import { db, schema } from "@/lib/db"

/** VPS accessible à l'utilisateur courant (propriétaire ou admin), sinon null. */
export async function getAccessibleServer(serverId: string) {
  const user = await requireUser()
  return findServerFor(user, serverId)
}

/** Variante pour les route handlers : null si non connecté. */
export async function getAccessibleServerOrNull(serverId: string) {
  const user = await getCurrentUser()
  if (!user) return null
  return findServerFor(user, serverId)
}

async function findServerFor(
  user: { id: string; role: RoleName },
  serverId: string
) {
  const [server] = await db
    .select()
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
  if (!server || (server.userId !== user.id && user.role !== "admin")) {
    return null
  }
  return server
}
