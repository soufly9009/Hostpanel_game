import "server-only"

import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { destroyServer } from "@/lib/provision"
import { deleteGameServer } from "@/lib/pterodactyl/client"
import { closeConsole } from "@/lib/pterodactyl/console"
import { emitEvent } from "@/lib/webhooks/service"

export type ServiceType = "vps" | "game"

/** Service d'un client (pour vérifier propriété et nom). */
export async function findService(type: ServiceType, id: string) {
  if (type === "vps") {
    const [s] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, id))
    return s
      ? {
          id: s.id,
          userId: s.userId,
          name: s.name,
          expiresAt: s.expiresAt,
          cancelAtPeriodEnd: s.cancelAtPeriodEnd,
        }
      : null
  }
  const [g] = await db
    .select()
    .from(schema.gameServers)
    .where(eq(schema.gameServers.id, id))
  return g
    ? {
        id: g.id,
        userId: g.userId,
        name: g.name,
        expiresAt: g.expiresAt,
        cancelAtPeriodEnd: g.cancelAtPeriodEnd,
      }
    : null
}

/** Supprime réellement le service (infrastructure puis base). */
export async function removeService(type: ServiceType, id: string) {
  if (type === "vps") {
    const [s] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, id))
    if (!s) return
    await destroyServer(s)
    await db.delete(schema.servers).where(eq(schema.servers.id, id))
    void emitEvent("service.cancelled", {
      type,
      serviceId: id,
      userId: s.userId,
    })
    return
  }
  const [g] = await db
    .select()
    .from(schema.gameServers)
    .where(eq(schema.gameServers.id, id))
  if (!g) return
  await deleteGameServer(g.pteroId)
  closeConsole(g.id)
  await db.delete(schema.gameServers).where(eq(schema.gameServers.id, id))
  void emitEvent("service.cancelled", { type, serviceId: id, userId: g.userId })
}

export async function setCancelAtPeriodEnd(
  type: ServiceType,
  id: string,
  value: boolean
) {
  if (type === "vps") {
    await db
      .update(schema.servers)
      .set({ cancelAtPeriodEnd: value })
      .where(eq(schema.servers.id, id))
  } else {
    await db
      .update(schema.gameServers)
      .set({ cancelAtPeriodEnd: value })
      .where(eq(schema.gameServers.id, id))
  }
}
