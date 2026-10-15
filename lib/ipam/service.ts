import "server-only"

import { and, count, eq, inArray, ne, sql } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { isUniqueViolation } from "@/lib/db/errors"

import {
  canonicalIp,
  enumerate,
  inCidr,
  overlaps,
  parseCidr,
  parseIp,
  usableBounds,
  validateNetwork,
  type Cidr,
} from "./cidr"

type Result<T = object> = ({ ok: true } & T) | { ok: false; error: string }

type AddressRow = typeof schema.ipAddresses.$inferSelect
type NetworkRow = typeof schema.ipNetworks.$inferSelect

/** Motif des réservations posées pendant la création d'un VPS. */
export const CREATION_REASON = "Création de VPS"
/** Une réservation de création plus ancienne est considérée comme périmée. */
const CREATION_GRACE_MS = 30 * 60_000

/** Réservation de création récente : ne doit être ni libérée ni désactivée à la main. */
const creationInFlight = (
  a: Pick<AddressRow, "status" | "reason" | "assignedAt">
) =>
  a.status === "reserved" &&
  !!a.reason?.startsWith(CREATION_REASON) &&
  !!a.assignedAt &&
  Date.now() - a.assignedAt.getTime() < CREATION_GRACE_MS

/** Plafond d'adresses générées d'un coup. */
export const MAX_GENERATE = 4096

/* ───────────── Journal ───────────── */

export async function logIpam(entry: {
  actor: string
  action: string
  address?: string | null
  addressId?: string | null
  networkId?: string | null
  oldValue?: string | null
  newValue?: string | null
  result?: "ok" | "refused" | "error"
  reason?: string | null
}) {
  try {
    await db.insert(schema.ipamLogs).values({
      actor: entry.actor,
      action: entry.action,
      address: entry.address ?? null,
      addressId: entry.addressId ?? null,
      networkId: entry.networkId ?? null,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      result: entry.result ?? "ok",
      reason: entry.reason?.slice(0, 300) ?? null,
    })
  } catch {
    // le journal ne doit pas faire échouer l'opération
  }
}

const describe = (a: Pick<AddressRow, "status" | "serverId" | "mode">) =>
  `${a.status}${a.serverId ? ` (VPS ${a.serverId.slice(0, 8)})` : ""}${a.mode ? ` [${a.mode}]` : ""}`

const cidrOf = (n: Pick<NetworkRow, "cidr">): Cidr => {
  const r = parseCidr(n.cidr)
  if (!r.ok) throw new Error(`CIDR corrompu en base : ${n.cidr}`)
  return r.cidr
}

/* ───────────── Réseaux ───────────── */

export type NetworkInput = {
  name: string
  cidr: string
  gateway?: string | null
  dnsServers?: string[]
  vlan?: number | null
  bridge?: string | null
  node?: string | null
  rangeStart?: string | null
  rangeEnd?: string | null
  mode: "dhcp" | "static" | "both"
  dhcpAvailable: boolean
  clientAssignable: boolean
  allowOverlap: boolean
  notes?: string | null
}

export async function createNetwork(
  input: NetworkInput,
  actor: string
): Promise<Result<{ id: string; warning?: string }>> {
  const parsed = parseCidr(input.cidr)
  if (!parsed.ok) return { ok: false, error: `CIDR : ${parsed.error}` }
  const { cidr, canonical } = parsed

  const v = validateNetwork(cidr, {
    gateway: input.gateway,
    rangeStart: input.rangeStart,
    rangeEnd: input.rangeEnd,
  })
  if (!v.ok) return { ok: false, error: v.error }

  const dns: string[] = []
  for (const raw of input.dnsServers ?? []) {
    const d = canonicalIp(raw)
    if (!d) return { ok: false, error: `Serveur DNS invalide : ${raw}` }
    dns.push(d)
  }

  if (
    (input.mode === "dhcp" || input.mode === "both") &&
    !input.dhcpAvailable
  ) {
    return {
      ok: false,
      error:
        "Le mode DHCP exige de confirmer qu'un serveur DHCP est opérationnel sur ce réseau.",
    }
  }

  // Chevauchements : refusés seulement si NI l'un NI l'autre n'est documenté.
  const existing = await db
    .select()
    .from(schema.ipNetworks)
    .where(eq(schema.ipNetworks.family, cidr.family))
  let warning: string | undefined
  for (const other of existing) {
    if (!overlaps(cidr, cidrOf(other))) continue
    if (input.allowOverlap || other.allowOverlap) {
      warning = `Chevauche « ${other.name} » (${other.cidr}) : documenté comme volontaire.`
      continue
    }
    return {
      ok: false,
      error: `Chevauche « ${other.name} » (${other.cidr}). Si c'est voulu (réseau isolé), coche « chevauchement documenté ».`,
    }
  }

  try {
    const [row] = await db
      .insert(schema.ipNetworks)
      .values({
        name: input.name,
        cidr: canonical,
        family: cidr.family,
        gateway: v.gateway,
        dnsServers: dns,
        vlan: input.vlan ?? null,
        bridge: input.bridge || null,
        node: input.node || null,
        rangeStart: v.start,
        rangeEnd: v.end,
        mode: input.mode,
        dhcpAvailable: input.dhcpAvailable,
        clientAssignable: input.clientAssignable,
        allowOverlap: input.allowOverlap,
        notes: input.notes || null,
      })
      .returning({ id: schema.ipNetworks.id })
    await logIpam({
      actor,
      action: "network.create",
      networkId: row.id,
      newValue: `${input.name} ${canonical}`,
    })
    return { ok: true, id: row.id, warning }
  } catch (e) {
    if (isUniqueViolation(e)) {
      return { ok: false, error: "Un réseau porte déjà ce nom." }
    }
    return { ok: false, error: "Création impossible" }
  }
}

export async function deleteNetwork(
  networkId: string,
  actor: string
): Promise<Result> {
  const [net] = await db
    .select()
    .from(schema.ipNetworks)
    .where(eq(schema.ipNetworks.id, networkId))
  if (!net) return { ok: false, error: "Réseau introuvable" }

  const [{ used }] = await db
    .select({ used: count() })
    .from(schema.ipAddresses)
    .where(
      and(
        eq(schema.ipAddresses.networkId, networkId),
        inArray(schema.ipAddresses.status, ["assigned", "reserved", "conflict"])
      )
    )
  const [{ servers }] = await db
    .select({ servers: count() })
    .from(schema.servers)
    .where(eq(schema.servers.networkId, networkId))
  if (used > 0 || servers > 0) {
    await logIpam({
      actor,
      action: "network.delete",
      networkId,
      result: "refused",
      reason: `${used} adresse(s) utilisée(s), ${servers} VPS`,
    })
    return {
      ok: false,
      error: `Réseau encore utilisé (${used} adresse(s) attribuée(s)/réservée(s), ${servers} VPS). Libère-les d'abord.`,
    }
  }

  await db.transaction(async (tx) => {
    await tx
      .delete(schema.ipAddresses)
      .where(eq(schema.ipAddresses.networkId, networkId))
    await tx
      .delete(schema.ipNetworks)
      .where(eq(schema.ipNetworks.id, networkId))
  })
  await logIpam({
    actor,
    action: "network.delete",
    networkId,
    oldValue: `${net.name} ${net.cidr}`,
  })
  return { ok: true }
}

export async function setNetworkActive(
  networkId: string,
  active: boolean,
  actor: string
): Promise<Result> {
  const res = await db
    .update(schema.ipNetworks)
    .set({ isActive: active })
    .where(eq(schema.ipNetworks.id, networkId))
  if (res.rowsAffected !== 1) return { ok: false, error: "Réseau introuvable" }
  await logIpam({
    actor,
    action: active ? "network.enable" : "network.disable",
    networkId,
  })
  return { ok: true }
}

/* ───────────── Adresses ───────────── */

/** Génère les enregistrements de la plage utilisable (la passerelle est réservée). */
export async function generateAddresses(
  networkId: string,
  actor: string
): Promise<Result<{ created: number; truncated: boolean }>> {
  const [net] = await db
    .select()
    .from(schema.ipNetworks)
    .where(eq(schema.ipNetworks.id, networkId))
  if (!net) return { ok: false, error: "Réseau introuvable" }

  const c = cidrOf(net)
  const b = usableBounds(c)
  const start = net.rangeStart
    ? (parseIp(net.rangeStart)?.value ?? b.first)
    : b.first
  const end = net.rangeEnd ? (parseIp(net.rangeEnd)?.value ?? b.last) : b.last
  const addresses = [...enumerate(c.family, start, end, MAX_GENERATE)]
  const truncated = end - start + 1n > BigInt(MAX_GENERATE)

  let created = 0
  // Lots de 200 : limite le nombre de variables SQL par requête.
  for (let i = 0; i < addresses.length; i += 200) {
    const batch = addresses.slice(i, i + 200)
    const res = await db
      .insert(schema.ipAddresses)
      .values(
        batch.map((address) => ({
          networkId,
          address,
          status:
            address === net.gateway
              ? ("reserved" as const)
              : ("available" as const),
          reason: address === net.gateway ? "Passerelle" : null,
        }))
      )
      .onConflictDoNothing()
    created += res.rowsAffected
  }

  await logIpam({
    actor,
    action: "address.generate",
    networkId,
    newValue: `${created} adresse(s)`,
    reason: truncated ? `Limité à ${MAX_GENERATE} adresses` : null,
  })
  return { ok: true, created, truncated }
}

export async function addAddress(
  networkId: string,
  rawAddress: string,
  actor: string
): Promise<Result<{ id: string }>> {
  const [net] = await db
    .select()
    .from(schema.ipNetworks)
    .where(eq(schema.ipNetworks.id, networkId))
  if (!net) return { ok: false, error: "Réseau introuvable" }

  const ip = parseIp(rawAddress)
  if (!ip) return { ok: false, error: "Adresse invalide" }
  const c = cidrOf(net)
  if (!inCidr(c, ip)) {
    return { ok: false, error: "L'adresse n'appartient pas à ce réseau" }
  }
  const b = usableBounds(c)
  if (ip.value < b.first || ip.value > b.last) {
    return { ok: false, error: "Adresse réseau ou broadcast : non attribuable" }
  }
  const address = canonicalIp(rawAddress)!

  try {
    const [row] = await db
      .insert(schema.ipAddresses)
      .values({ networkId, address })
      .returning({ id: schema.ipAddresses.id })
    await logIpam({
      actor,
      action: "address.add",
      addressId: row.id,
      networkId,
      address,
    })
    return { ok: true, id: row.id }
  } catch {
    return { ok: false, error: "Cette adresse existe déjà dans ce réseau" }
  }
}

async function getAddress(id: string) {
  const [a] = await db
    .select()
    .from(schema.ipAddresses)
    .where(eq(schema.ipAddresses.id, id))
  return a ?? null
}

/**
 * Transition atomique : l'UPDATE n'agit que si le statut est encore l'un des
 * statuts attendus. Deux requêtes simultanées ne peuvent pas réussir toutes
 * les deux (SQLite sérialise les écritures).
 */
async function transition(
  id: string,
  from: AddressRow["status"][],
  patch: Partial<typeof schema.ipAddresses.$inferInsert>
) {
  const res = await db
    .update(schema.ipAddresses)
    .set(patch)
    .where(
      and(
        eq(schema.ipAddresses.id, id),
        inArray(schema.ipAddresses.status, from)
      )
    )
  return res.rowsAffected === 1
}

export async function reserveAddress(
  id: string,
  reason: string,
  actor: string
): Promise<Result> {
  const before = await getAddress(id)
  if (!before) return { ok: false, error: "Adresse introuvable" }
  const done = await transition(id, ["available"], {
    status: "reserved",
    reason: reason.slice(0, 200) || "Réservée",
    releasedAt: null,
  })
  await logIpam({
    actor,
    action: "address.reserve",
    addressId: id,
    networkId: before.networkId,
    address: before.address,
    oldValue: describe(before),
    newValue: done ? "reserved" : null,
    result: done ? "ok" : "refused",
    reason,
  })
  return done
    ? { ok: true }
    : {
        ok: false,
        error: "Adresse non disponible (déjà réservée ou attribuée)",
      }
}

/** Libération manuelle : refusée tant qu'un VPS existant s'en sert. */
export async function releaseAddress(
  id: string,
  actor: string
): Promise<Result> {
  const before = await getAddress(id)
  if (!before) return { ok: false, error: "Adresse introuvable" }

  if (before.serverId) {
    const [srv] = await db
      .select({
        id: schema.servers.id,
        ipAddressId: schema.servers.ipAddressId,
      })
      .from(schema.servers)
      .where(eq(schema.servers.id, before.serverId))
    if (srv && srv.ipAddressId === id) {
      await logIpam({
        actor,
        action: "address.release",
        addressId: id,
        networkId: before.networkId,
        address: before.address,
        result: "refused",
        reason: "Utilisée par un VPS existant",
      })
      return {
        ok: false,
        error:
          "Cette adresse est utilisée par un VPS. Change d'abord sa configuration réseau.",
      }
    }
  }

  if (creationInFlight(before)) {
    await logIpam({
      actor,
      action: "address.release",
      addressId: id,
      networkId: before.networkId,
      address: before.address,
      result: "refused",
      reason: "Création de VPS en cours",
    })
    return {
      ok: false,
      error:
        "Une création de VPS est en cours sur cette adresse (réservation de moins de 30 min).",
    }
  }

  const done = await transition(id, ["reserved", "assigned", "conflict"], {
    status: "available",
    mode: null,
    serverId: null,
    siteId: null,
    reason: null,
    releasedAt: new Date(),
  })
  await logIpam({
    actor,
    action: "address.release",
    addressId: id,
    networkId: before.networkId,
    address: before.address,
    oldValue: describe(before),
    newValue: done ? "available" : null,
    result: done ? "ok" : "refused",
  })
  return done ? { ok: true } : { ok: false, error: "Rien à libérer" }
}

export async function disableAddress(
  id: string,
  reason: string,
  actor: string
): Promise<Result> {
  const before = await getAddress(id)
  if (!before) return { ok: false, error: "Adresse introuvable" }
  const done = await transition(id, ["available"], {
    status: "disabled",
    reason: reason.slice(0, 200) || "Désactivée",
  })
  await logIpam({
    actor,
    action: "address.disable",
    addressId: id,
    networkId: before.networkId,
    address: before.address,
    oldValue: describe(before),
    newValue: done ? "disabled" : null,
    result: done ? "ok" : "refused",
    reason,
  })
  return done
    ? { ok: true }
    : {
        ok: false,
        error:
          "Désactivation possible uniquement pour une adresse disponible (libère-la d'abord).",
      }
}

export async function enableAddress(
  id: string,
  actor: string
): Promise<Result> {
  const before = await getAddress(id)
  if (!before) return { ok: false, error: "Adresse introuvable" }
  const done = await transition(id, ["disabled"], {
    status: "available",
    reason: null,
  })
  await logIpam({
    actor,
    action: "address.enable",
    addressId: id,
    networkId: before.networkId,
    address: before.address,
    result: done ? "ok" : "refused",
  })
  return done ? { ok: true } : { ok: false, error: "Adresse non désactivée" }
}

/** Attribution manuelle par un admin à un VPS (réservée ou disponible). */
export async function assignToServer(
  id: string,
  serverId: string,
  actor: string
): Promise<Result> {
  const before = await getAddress(id)
  if (!before) return { ok: false, error: "Adresse introuvable" }
  const [srv] = await db
    .select({ id: schema.servers.id })
    .from(schema.servers)
    .where(eq(schema.servers.id, serverId))
  if (!srv) return { ok: false, error: "VPS introuvable" }

  if (creationInFlight(before)) {
    return {
      ok: false,
      error: "Une création de VPS est en cours sur cette adresse.",
    }
  }
  const done = await transition(id, ["available", "reserved"], {
    status: "assigned",
    mode: "static",
    serverId,
    assignedAt: new Date(),
    releasedAt: null,
  })
  await logIpam({
    actor,
    action: "address.assign",
    addressId: id,
    networkId: before.networkId,
    address: before.address,
    oldValue: describe(before),
    newValue: done ? `assigned VPS ${serverId.slice(0, 8)}` : null,
    result: done ? "ok" : "refused",
  })
  return done
    ? { ok: true }
    : { ok: false, error: "Adresse déjà attribuée ou désactivée" }
}

/* ───────────── Allocation pour la création d'un VPS ───────────── */

export type PlanNetworkScope = {
  node: string
  bridge: string
  modes: "dhcp" | "static" | "both"
}

/** Réseaux proposables à un client pour une offre. */
export async function clientNetworks(scope: PlanNetworkScope) {
  const nets = await db
    .select()
    .from(schema.ipNetworks)
    .where(
      and(
        eq(schema.ipNetworks.isActive, true),
        eq(schema.ipNetworks.clientAssignable, true)
      )
    )
  return nets.filter(
    (n) =>
      (!n.node || n.node === scope.node) &&
      (!n.bridge || n.bridge === scope.bridge)
  )
}

export const planAllows = (
  plan: PlanNetworkScope["modes"],
  mode: "dhcp" | "static"
) => plan === "both" || plan === mode

export const networkAllows = (
  n: Pick<NetworkRow, "mode" | "dhcpAvailable">,
  mode: "dhcp" | "static"
) =>
  mode === "dhcp"
    ? n.dhcpAvailable && (n.mode === "dhcp" || n.mode === "both")
    : n.mode === "static" || n.mode === "both"

/**
 * Réserve atomiquement une adresse disponible pour un client.
 * Retourne l'enregistrement réservé, ou une erreur si quelqu'un l'a prise.
 */
export async function reserveForCreation(
  addressId: string,
  networkId: string,
  actor: string
): Promise<Result<{ address: AddressRow }>> {
  const done = await db
    .update(schema.ipAddresses)
    .set({
      status: "reserved",
      reason: `${CREATION_REASON} (${actor})`,
      assignedAt: new Date(),
      releasedAt: null,
    })
    .where(
      and(
        eq(schema.ipAddresses.id, addressId),
        eq(schema.ipAddresses.networkId, networkId),
        eq(schema.ipAddresses.status, "available")
      )
    )
  const a = await getAddress(addressId)
  if (done.rowsAffected !== 1 || !a) {
    await logIpam({
      actor,
      action: "address.reserve",
      addressId,
      networkId,
      result: "refused",
      reason: "Adresse indisponible lors de la réservation",
    })
    return {
      ok: false,
      error: "Cette adresse vient d'être prise. Choisis-en une autre.",
    }
  }
  await logIpam({
    actor,
    action: "address.reserve",
    addressId,
    networkId,
    address: a.address,
    oldValue: "available",
    newValue: "reserved",
    reason: "Création de VPS",
  })
  return { ok: true, address: a }
}

/** Confirme l'attribution une fois le VPS réellement créé. */
export async function confirmAssignment(
  addressId: string,
  serverId: string,
  mode: "dhcp" | "static",
  actor: string
) {
  const done = await transition(addressId, ["reserved"], {
    status: "assigned",
    mode,
    serverId,
    assignedAt: new Date(),
  })
  const a = await getAddress(addressId)
  await logIpam({
    actor,
    action: "address.assign",
    addressId,
    networkId: a?.networkId,
    address: a?.address,
    oldValue: "reserved",
    newValue: done ? `assigned VPS ${serverId.slice(0, 8)}` : null,
    result: done ? "ok" : "error",
  })
  return done
}

/** Annule une réservation de création (seulement si elle est encore « reserved »). */
export async function cancelReservation(addressId: string, actor: string) {
  const a = await getAddress(addressId)
  const done = await transition(addressId, ["reserved"], {
    status: "available",
    reason: null,
    releasedAt: new Date(),
  })
  await logIpam({
    actor,
    action: "address.release",
    addressId,
    networkId: a?.networkId,
    address: a?.address,
    oldValue: "reserved",
    newValue: done ? "available" : null,
    result: done ? "ok" : "refused",
    reason: "Création de VPS annulée",
  })
  return done
}

/** Libère l'ancienne adresse d'un VPS, une fois la transition confirmée. */
export async function releaseAfterTransition(
  addressId: string,
  serverId: string,
  actor: string
) {
  const a = await getAddress(addressId)
  if (!a || a.serverId !== serverId) return false
  const done = await transition(addressId, ["assigned"], {
    status: "available",
    mode: null,
    serverId: null,
    reason: null,
    releasedAt: new Date(),
  })
  await logIpam({
    actor,
    action: "address.release",
    addressId,
    networkId: a.networkId,
    address: a.address,
    oldValue: describe(a),
    newValue: done ? "available" : null,
    result: done ? "ok" : "refused",
    reason: "Changement de configuration réseau confirmé",
  })
  return done
}

/* ───────────── Détection de conflits ───────────── */

/**
 * Compare les adresses réellement observées (remontées par Proxmox) à l'IPAM.
 * Aucune sonde réseau : une adresse qui ne répond pas n'est jamais considérée
 * comme libre. Retourne le nombre de conflits marqués.
 */
export async function detectConflicts(actor: string) {
  const servers = await db
    .select({
      id: schema.servers.id,
      name: schema.servers.name,
      address: schema.servers.address,
      ipv6: schema.servers.ipv6,
    })
    .from(schema.servers)
    .where(
      sql`${schema.servers.address} is not null or ${schema.servers.ipv6} is not null`
    )

  let flagged = 0
  const seen = new Map<string, string>()

  for (const s of servers) {
    for (const raw of [s.address, s.ipv6]) {
      const address = raw ? canonicalIp(raw) : null
      if (!address) continue

      // Même adresse observée sur deux VPS.
      const prev = seen.get(address)
      if (prev && prev !== s.id) {
        const rows = await db
          .select()
          .from(schema.ipAddresses)
          .where(eq(schema.ipAddresses.address, address))
        for (const r of rows) {
          if (
            await transition(r.id, ["available", "reserved", "assigned"], {
              status: "conflict",
              comment: `Observée sur plusieurs VPS (${prev.slice(0, 8)}, ${s.id.slice(0, 8)})`,
            })
          ) {
            flagged++
            await logIpam({
              actor,
              action: "address.conflict",
              addressId: r.id,
              networkId: r.networkId,
              address,
              oldValue: describe(r),
              newValue: "conflict",
              reason: "Doublon observé",
            })
          }
        }
      }
      seen.set(address, s.id)

      // Adresse observée mais enregistrée pour un autre usage / libre / désactivée.
      const rows = await db
        .select()
        .from(schema.ipAddresses)
        .where(
          and(
            eq(schema.ipAddresses.address, address),
            ne(schema.ipAddresses.status, "conflict"),
            ne(schema.ipAddresses.status, "reserved")
          )
        )
      for (const r of rows) {
        const wrongOwner = r.status === "assigned" && r.serverId !== s.id
        const notAssigned = r.status === "available" || r.status === "disabled"
        // Un VPS en DHCP peut légitimement utiliser une adresse « available »
        // du pool DHCP : on ne marque que les adresses statiques gérées.
        if (!wrongOwner && !notAssigned) continue
        if (
          await transition(r.id, [r.status], {
            status: "conflict",
            comment: `Utilisée par le VPS « ${s.name} » alors que l'IPAM indique : ${describe(r)}`,
          })
        ) {
          flagged++
          await logIpam({
            actor,
            action: "address.conflict",
            addressId: r.id,
            networkId: r.networkId,
            address,
            oldValue: describe(r),
            newValue: "conflict",
            reason: `Observée sur ${s.name}`,
          })
        }
      }
    }
  }
  return flagged
}

/** Retire le drapeau « conflit » (l'admin a corrigé la situation). */
export async function resolveConflict(
  id: string,
  actor: string
): Promise<Result> {
  const a = await getAddress(id)
  if (!a) return { ok: false, error: "Adresse introuvable" }
  // Retour à l'état cohérent avec les liens existants.
  const next = a.serverId ? "assigned" : "available"
  const done = await transition(id, ["conflict"], {
    status: next,
    comment: null,
  })
  await logIpam({
    actor,
    action: "address.resolve",
    addressId: id,
    networkId: a.networkId,
    address: a.address,
    oldValue: "conflict",
    newValue: done ? next : null,
    result: done ? "ok" : "refused",
  })
  return done ? { ok: true } : { ok: false, error: "Pas en conflit" }
}

/* ───────────── Statistiques ───────────── */

export async function ipamStats() {
  const rows = await db
    .select({
      networkId: schema.ipAddresses.networkId,
      status: schema.ipAddresses.status,
      n: count(),
    })
    .from(schema.ipAddresses)
    .groupBy(schema.ipAddresses.networkId, schema.ipAddresses.status)

  const total: Record<string, number> = {
    available: 0,
    reserved: 0,
    assigned: 0,
    disabled: 0,
    conflict: 0,
  }
  const perNetwork = new Map<string, Record<string, number>>()
  for (const r of rows) {
    total[r.status] += r.n
    const m = perNetwork.get(r.networkId) ?? {}
    m[r.status] = r.n
    perNetwork.set(r.networkId, m)
  }
  const all = Object.values(total).reduce((a, b) => a + b, 0)
  return { total, all, perNetwork }
}

/** Historique d'une adresse. */
export async function addressHistory(addressId: string) {
  return db
    .select()
    .from(schema.ipamLogs)
    .where(eq(schema.ipamLogs.addressId, addressId))
    .orderBy(sql`${schema.ipamLogs.id} desc`)
    .limit(50)
}
