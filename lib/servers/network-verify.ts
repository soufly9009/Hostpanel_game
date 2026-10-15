import "server-only"

import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { releaseAfterTransition } from "@/lib/ipam/service"
import { getVpsAddresses } from "@/lib/proxmox/client"

type ServerRow = typeof schema.servers.$inferSelect

export type NetworkVerification = {
  state: "synced" | "pending" | "error"
  message: string | null
  observed: { ipv4: string | null; ipv6: string | null }
  releasedPrevious: boolean
}

/**
 * Compare la configuration voulue aux adresses RÉELLEMENT observées (interfaces
 * LXC / agent QEMU). L'ancienne adresse n'est libérée que si la nouvelle est
 * confirmée et différente de l'ancienne.
 */
export async function verifyServerNetwork(
  server: ServerRow,
  actor: string
): Promise<NetworkVerification> {
  const observed = await getVpsAddresses(
    server.node,
    server.virt,
    server.vmid,
    {
      configFallback: false,
    }
  )

  // Adresse statique attendue, le cas échéant.
  let expected: { address: string; family: "ipv4" | "ipv6" } | null = null
  if (server.networkMode === "static" && server.ipAddressId) {
    const [row] = await db
      .select({
        address: schema.ipAddresses.address,
        family: schema.ipNetworks.family,
      })
      .from(schema.ipAddresses)
      .innerJoin(
        schema.ipNetworks,
        eq(schema.ipNetworks.id, schema.ipAddresses.networkId)
      )
      .where(eq(schema.ipAddresses.id, server.ipAddressId))
    if (row) expected = row
  }

  const have = expected
    ? (expected.family === "ipv4" ? observed.ipv4 : observed.ipv6) ===
      expected.address
    : Boolean(observed.ipv4 || observed.ipv6)

  if (!have) {
    const message = !(observed.ipv4 || observed.ipv6)
      ? "Aucune adresse observée pour le moment (VPS arrêté, ou agent invité indisponible)."
      : expected
        ? `Adresse observée (${observed.ipv4 ?? observed.ipv6}) différente de celle configurée (${expected.address}).`
        : "Adresse DHCP non encore observée."
    await db
      .update(schema.servers)
      .set({ netSyncState: "pending", netError: message })
      .where(eq(schema.servers.id, server.id))
    return { state: "pending", message, observed, releasedPrevious: false }
  }

  // Confirmé : mise à jour des adresses affichées en DHCP.
  const patch: Partial<typeof schema.servers.$inferInsert> = {
    netSyncState: "synced",
    netError: null,
    netUpdatedAt: new Date(),
  }
  if (!expected) {
    patch.address = observed.ipv4
    patch.ipv6 = observed.ipv6
  }

  // L'ancienne adresse n'est libérée qu'une fois la transition confirmée.
  let releasedPrevious = false
  if (server.previousIpAddressId) {
    const [prev] = await db
      .select({ address: schema.ipAddresses.address })
      .from(schema.ipAddresses)
      .where(eq(schema.ipAddresses.id, server.previousIpAddressId))
    const stillUsed =
      prev && (prev.address === observed.ipv4 || prev.address === observed.ipv6)
    if (!stillUsed) {
      releasedPrevious = await releaseAfterTransition(
        server.previousIpAddressId,
        server.id,
        actor
      )
      patch.previousIpAddressId = null
    }
  }

  await db
    .update(schema.servers)
    .set(patch)
    .where(eq(schema.servers.id, server.id))

  return { state: "synced", message: null, observed, releasedPrevious }
}
