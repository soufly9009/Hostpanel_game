"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { requireAdmin } from "@/lib/auth/session"
import { auditSensitive } from "@/lib/discord/audit"

import {
  addAddress,
  assignToServer,
  createNetwork,
  deleteNetwork,
  detectConflicts,
  disableAddress,
  enableAddress,
  generateAddresses,
  releaseAddress,
  reserveAddress,
  resolveConflict,
  setNetworkActive,
} from "./service"

export type IpamState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const bool = z
  .union([
    z.literal("on"),
    z.literal("true"),
    z.literal("false"),
    z.literal(""),
  ])
  .optional()
  .transform((v) => v === "on" || v === "true")

const networkSchema = z.object({
  name: z.string().trim().min(2, "Nom trop court").max(60),
  cidr: z.string().trim().min(3, "CIDR requis"),
  gateway: z.string().trim().optional(),
  dns: z.string().trim().optional(),
  vlan: z
    .union([z.literal(""), z.coerce.number().int().min(1).max(4094)])
    .optional()
    .transform((v) => (v === "" || v === undefined ? null : v)),
  bridge: z.string().trim().max(40).optional(),
  node: z.string().trim().max(60).optional(),
  rangeStart: z.string().trim().optional(),
  rangeEnd: z.string().trim().optional(),
  mode: z.enum(["dhcp", "static", "both"]),
  dhcpAvailable: bool,
  clientAssignable: bool,
  allowOverlap: bool,
  notes: z.string().trim().max(500).optional(),
})

function refresh() {
  revalidatePath("/admin/ipam")
}

export async function createNetworkAction(
  _prev: IpamState,
  formData: FormData
): Promise<IpamState> {
  const admin = await requireAdmin()
  const parsed = networkSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return { error: `${i?.path.join(".")} : ${i?.message}` }
  }
  const d = parsed.data
  const res = await createNetwork(
    {
      name: d.name,
      cidr: d.cidr,
      gateway: d.gateway || null,
      dnsServers: d.dns
        ? d.dns
            .split(/[\s,;]+/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [],
      vlan: d.vlan,
      bridge: d.bridge || null,
      node: d.node || null,
      rangeStart: d.rangeStart || null,
      rangeEnd: d.rangeEnd || null,
      mode: d.mode,
      dhcpAvailable: d.dhcpAvailable,
      clientAssignable: d.clientAssignable,
      allowOverlap: d.allowOverlap,
      notes: d.notes || null,
    },
    admin.email
  )
  if (!res.ok) return { error: res.error }
  auditSensitive(admin, "Réseau IPAM créé", { réseau: d.name })
  refresh()
  return { ok: true, notice: res.warning }
}

const id = z.string().min(1).max(64)

export async function deleteNetworkAction(
  networkId: string
): Promise<IpamState> {
  const admin = await requireAdmin()
  const res = await deleteNetwork(id.parse(networkId), admin.email)
  if (!res.ok) return { error: res.error }
  auditSensitive(
    admin,
    "Réseau IPAM supprimé",
    { réseau: networkId.slice(0, 8) },
    "warning"
  )
  refresh()
  return { ok: true }
}

export async function setNetworkActiveAction(
  networkId: string,
  active: boolean
): Promise<IpamState> {
  const admin = await requireAdmin()
  const res = await setNetworkActive(id.parse(networkId), active, admin.email)
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function generateAddressesAction(
  networkId: string
): Promise<IpamState> {
  const admin = await requireAdmin()
  const res = await generateAddresses(id.parse(networkId), admin.email)
  if (!res.ok) return { error: res.error }
  refresh()
  return {
    ok: true,
    notice: `${res.created} adresse(s) créée(s)${res.truncated ? " (limité à 4096)" : ""}`,
  }
}

export async function addAddressAction(
  _prev: IpamState,
  formData: FormData
): Promise<IpamState> {
  const admin = await requireAdmin()
  const parsed = z
    .object({
      networkId: id,
      address: z.string().trim().min(2, "Adresse requise"),
    })
    .safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const res = await addAddress(
    parsed.data.networkId,
    parsed.data.address,
    admin.email
  )
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function addressOperation(
  addressId: string,
  op: "reserve" | "release" | "disable" | "enable" | "resolve",
  reason = ""
): Promise<IpamState> {
  const admin = await requireAdmin()
  const aid = id.parse(addressId)
  const why = z.string().max(200).parse(reason)
  const res =
    op === "reserve"
      ? await reserveAddress(aid, why, admin.email)
      : op === "release"
        ? await releaseAddress(aid, admin.email)
        : op === "disable"
          ? await disableAddress(aid, why, admin.email)
          : op === "enable"
            ? await enableAddress(aid, admin.email)
            : await resolveConflict(aid, admin.email)
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function assignAddressAction(
  addressId: string,
  serverId: string
): Promise<IpamState> {
  const admin = await requireAdmin()
  const res = await assignToServer(
    id.parse(addressId),
    id.parse(serverId),
    admin.email
  )
  if (!res.ok) return { error: res.error }
  refresh()
  return { ok: true }
}

export async function detectConflictsAction(): Promise<IpamState> {
  const admin = await requireAdmin()
  const n = await detectConflicts(admin.email)
  refresh()
  return {
    ok: true,
    notice:
      n === 0
        ? "Aucun conflit détecté (comparaison avec les adresses remontées par Proxmox)."
        : `${n} conflit(s) détecté(s).`,
  }
}
