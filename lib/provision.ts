import "server-only"

import { eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import type { Server } from "@/lib/db/schema"
import {
  getVpsAddresses,
  getVpsStatus,
  powerVps,
  removeVps,
  type VpsSignal,
} from "@/lib/proxmox/client"

/** État temps réel d'un VPS, tel qu'affiché dans l'interface. */
export type LiveStatus = {
  state: "running" | "offline"
  suspended: boolean
  cpu: number
  memoryBytes: number
  memoryLimitBytes: number
  diskBytes: number
  diskLimitBytes: number
  networkRx: number
  networkTx: number
  uptimeMs: number
  ipv4: string | null
  ipv6: string | null
}

export async function liveStatus(server: Server): Promise<LiveStatus> {
  const s = await getVpsStatus(server.node, server.virt, server.vmid)
  let ipv4 = server.address
  let ipv6 = server.ipv6

  // Les IP ne sont connues qu'une fois le VPS démarré (DHCP, agent QEMU) :
  // on les relit à chaque statut et on les mémorise si elles changent.
  if (s.state === "running") {
    const found = await getVpsAddresses(server.node, server.virt, server.vmid)
    const nextV4 = found.ipv4 ?? ipv4
    const nextV6 = found.ipv6 ?? ipv6
    if (nextV4 !== ipv4 || nextV6 !== ipv6) {
      ipv4 = nextV4
      ipv6 = nextV6
      await db
        .update(schema.servers)
        .set({ address: ipv4, ipv6 })
        .where(eq(schema.servers.id, server.id))
    }
  }

  return {
    state: s.state,
    suspended: server.suspended,
    cpu: s.cpu,
    memoryBytes: s.memoryBytes,
    memoryLimitBytes: s.maxMemoryBytes,
    diskBytes: s.diskBytes,
    diskLimitBytes: s.maxDiskBytes,
    networkRx: s.networkRx,
    networkTx: s.networkTx,
    uptimeMs: s.uptimeMs,
    ipv4,
    ipv6,
  }
}

export function powerServer(server: Server, signal: VpsSignal) {
  return powerVps(server.node, server.virt, server.vmid, signal)
}

export function destroyServer(server: Server) {
  return removeVps(server.node, server.virt, server.vmid)
}

/**
 * Proxmox n'a pas de "suspension" : on coupe la machine, le blocage des
 * actions est assuré côté site via le drapeau `suspended`.
 */
export async function setSuspended(server: Server, suspended: boolean) {
  if (!suspended) return
  await powerVps(server.node, server.virt, server.vmid, "kill").catch(() => {})
}
