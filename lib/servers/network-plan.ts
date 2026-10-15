import "server-only"

import { and, eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { canonicalIp, prefixOf } from "@/lib/ipam/cidr"
import {
  clientNetworks,
  networkAllows,
  planAllows,
  reserveForCreation,
} from "@/lib/ipam/service"
import type { NetworkSpec } from "@/lib/proxmox/netspec"

type Plan = typeof schema.plans.$inferSelect

export type NetworkRequest = {
  mode: "dhcp" | "static"
  networkId?: string | null
  addressId?: string | null
}

export type ResolvedNetwork =
  | {
      ok: true
      mode: "dhcp" | "static"
      /** Absent : DHCP « historique » sans réseau IPAM. */
      spec?: NetworkSpec
      networkId: string | null
      /** Adresse réservée (mode statique). */
      addressId: string | null
      /** Adresse à enregistrer sur le VPS (config), mode statique. */
      address: string | null
      family: "ipv4" | "ipv6" | null
    }
  | { ok: false; error: string }

/**
 * Valide la demande réseau d'un client côté serveur et, en mode statique,
 * réserve atomiquement l'adresse. Rien ne vient du navigateur sans contrôle :
 * réseau, adresse, mode et portée sont revérifiés ici.
 */
export async function resolveNetwork(
  plan: Plan,
  req: NetworkRequest,
  actorEmail: string
): Promise<ResolvedNetwork> {
  if (!planAllows(plan.networkModes, req.mode)) {
    return {
      ok: false,
      error:
        req.mode === "static"
          ? "L'adresse IP statique n'est pas proposée avec cette offre."
          : "Le DHCP n'est pas proposé avec cette offre.",
    }
  }

  const scope = {
    node: plan.proxmox.node,
    bridge: plan.proxmox.bridge,
    modes: plan.networkModes,
  }

  if (req.mode === "dhcp") {
    if (!req.networkId)
      return {
        ok: true,
        mode: "dhcp",
        networkId: null,
        addressId: null,
        address: null,
        family: null,
      }
    const nets = await clientNetworks(scope)
    const net = nets.find((n) => n.id === req.networkId)
    if (!net)
      return { ok: false, error: "Réseau non autorisé pour cette offre." }
    if (!networkAllows(net, "dhcp")) {
      return {
        ok: false,
        error: `Aucun DHCP opérationnel n'est déclaré sur « ${net.name} ».`,
      }
    }
    return {
      ok: true,
      mode: "dhcp",
      spec: { mode: "dhcp", vlan: net.vlan, dns: net.dnsServers },
      networkId: net.id,
      addressId: null,
      address: null,
      family: null,
    }
  }

  // Mode statique : réseau + adresse obligatoires.
  if (!req.networkId || !req.addressId) {
    return { ok: false, error: "Choisis un réseau et une adresse IP." }
  }
  const nets = await clientNetworks(scope)
  const net = nets.find((n) => n.id === req.networkId)
  if (!net) return { ok: false, error: "Réseau non autorisé pour cette offre." }
  if (!networkAllows(net, "static")) {
    return {
      ok: false,
      error: `« ${net.name} » ne propose pas d'adresse statique.`,
    }
  }

  // L'adresse doit appartenir à CE réseau et être libre (revérifié en base).
  const [addr] = await db
    .select()
    .from(schema.ipAddresses)
    .where(
      and(
        eq(schema.ipAddresses.id, req.addressId),
        eq(schema.ipAddresses.networkId, net.id)
      )
    )
  if (!addr) return { ok: false, error: "Adresse introuvable dans ce réseau." }
  if (addr.status !== "available") {
    return { ok: false, error: "Cette adresse n'est plus disponible." }
  }
  const address = canonicalIp(addr.address)
  if (!address) return { ok: false, error: "Adresse invalide." }

  const reserved = await reserveForCreation(addr.id, net.id, actorEmail)
  if (!reserved.ok) return { ok: false, error: reserved.error }

  return {
    ok: true,
    mode: "static",
    spec: {
      mode: "static",
      family: net.family,
      address,
      prefix: prefixOf(net.cidr),
      gateway: net.gateway,
      vlan: net.vlan,
      dns: net.dnsServers,
    },
    networkId: net.id,
    addressId: addr.id,
    address,
    family: net.family,
  }
}

type ServerRow = typeof schema.servers.$inferSelect

/** Spécification réseau à (ré)appliquer pour un VPS déjà enregistré dans l'IPAM. */
export async function specForServer(
  server: Pick<ServerRow, "networkMode" | "networkId" | "ipAddressId">
): Promise<{
  spec: NetworkSpec
  address: string | null
  family: "ipv4" | "ipv6" | null
} | null> {
  if (!server.networkId) return null
  const [net] = await db
    .select()
    .from(schema.ipNetworks)
    .where(eq(schema.ipNetworks.id, server.networkId))
  if (!net) return null

  if (server.networkMode === "static" && server.ipAddressId) {
    const [addr] = await db
      .select()
      .from(schema.ipAddresses)
      .where(eq(schema.ipAddresses.id, server.ipAddressId))
    if (!addr) return null
    return {
      spec: {
        mode: "static",
        family: net.family,
        address: addr.address,
        prefix: prefixOf(net.cidr),
        gateway: net.gateway,
        vlan: net.vlan,
        dns: net.dnsServers,
      },
      address: addr.address,
      family: net.family,
    }
  }
  return {
    spec: { mode: "dhcp", vlan: net.vlan, dns: net.dnsServers },
    address: null,
    family: null,
  }
}
