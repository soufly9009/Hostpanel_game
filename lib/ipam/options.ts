import "server-only"

import { and, asc, eq, inArray } from "drizzle-orm"

import { db, schema } from "@/lib/db"

import { clientNetworks, networkAllows, planAllows } from "./service"

export type NetworkOption = {
  id: string
  name: string
  cidr: string
  family: "ipv4" | "ipv6"
  gateway: string | null
  dns: string[]
  vlan: number | null
  /** DHCP réellement disponible (et autorisé par l'offre). */
  dhcp: boolean
  /** Adresse statique proposable (et autorisée par l'offre). */
  static: boolean
  /** Adresses disponibles (jusqu'à `limit`), en mode statique. */
  addresses: { id: string; address: string }[]
  /** Nombre d'adresses disponibles au total. */
  availableCount: number
}

export type NetworkOptions = {
  planModes: "dhcp" | "static" | "both"
  networks: NetworkOption[]
}

const LIMIT = 100

/** Réseaux et adresses que ce plan peut proposer à un client. */
export async function networkOptionsForPlan(
  plan: typeof schema.plans.$inferSelect
): Promise<NetworkOptions> {
  const nets = await clientNetworks({
    node: plan.proxmox.node,
    bridge: plan.proxmox.bridge,
    modes: plan.networkModes,
  })

  const out: NetworkOption[] = []
  for (const n of nets) {
    const dhcp =
      planAllows(plan.networkModes, "dhcp") && networkAllows(n, "dhcp")
    const stat =
      planAllows(plan.networkModes, "static") && networkAllows(n, "static")
    if (!dhcp && !stat) continue

    let addresses: { id: string; address: string }[] = []
    let availableCount = 0
    if (stat) {
      const rows = await db
        .select({
          id: schema.ipAddresses.id,
          address: schema.ipAddresses.address,
        })
        .from(schema.ipAddresses)
        .where(
          and(
            eq(schema.ipAddresses.networkId, n.id),
            inArray(schema.ipAddresses.status, ["available"])
          )
        )
        .orderBy(asc(schema.ipAddresses.address))
        .limit(LIMIT + 1)
      availableCount = rows.length
      addresses = rows.slice(0, LIMIT)
    }

    out.push({
      id: n.id,
      name: n.name,
      cidr: n.cidr,
      family: n.family,
      gateway: n.gateway,
      dns: n.dnsServers,
      vlan: n.vlan,
      dhcp,
      static: stat && addresses.length > 0,
      addresses,
      availableCount,
    })
  }
  return { planModes: plan.networkModes, networks: out }
}
