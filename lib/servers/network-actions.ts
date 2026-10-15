"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { cancelReservation, confirmAssignment } from "@/lib/ipam/service"
import { ProxmoxError } from "@/lib/proxmox/client"
import { applyVpsNetwork } from "@/lib/proxmox/network"
import { getAccessibleServer } from "@/lib/servers/access"
import { resolveNetwork } from "@/lib/servers/network-plan"
import { verifyServerNetwork } from "@/lib/servers/network-verify"

export type NetworkState =
  | {
      error?: string
      ok?: boolean
      /** Résultat détaillé affiché tel quel à l'utilisateur. */
      notice?: string
    }
  | undefined

const errorMessage = (e: unknown) =>
  e instanceof ProxmoxError
    ? `Proxmox : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

/** Une modification réseau à la fois par VPS (cette instance). */
const g = globalThis as unknown as { __netBusy?: Set<string> }
const busy = (g.__netBusy ??= new Set<string>())

const changeSchema = z.object({
  mode: z.enum(["dhcp", "static"]),
  networkId: z.string().max(64).nullish(),
  addressId: z.string().max(64).nullish(),
  /** L'utilisateur a pris connaissance du risque de coupure. */
  acknowledged: z.literal(true, {
    error: "Confirme que tu as pris connaissance de la coupure possible.",
  }),
})

export async function changeNetworkAction(
  serverId: string,
  input: unknown
): Promise<NetworkState> {
  const user = await requireUser()
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.suspended) return { error: "VPS suspendu" }
  if (!server.planId) {
    return {
      error: "L'offre de ce VPS n'existe plus : modification impossible.",
    }
  }

  const parsed = changeSchema.safeParse(input)
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const req = parsed.data

  if (busy.has(server.id)) {
    return { error: "Une modification réseau est déjà en cours sur ce VPS." }
  }
  busy.add(server.id)

  try {
    const [plan] = await db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.id, server.planId))
    if (!plan) return { error: "Offre introuvable" }

    // Déjà dans cet état ? On évite un changement inutile.
    if (
      req.mode === "static" &&
      server.networkMode === "static" &&
      server.ipAddressId === req.addressId
    ) {
      return { error: "Ce VPS utilise déjà cette adresse." }
    }

    // 1-2. Contrôle des droits/portée + réservation atomique de la nouvelle IP.
    const net = await resolveNetwork(
      plan,
      { mode: req.mode, networkId: req.networkId, addressId: req.addressId },
      user.email
    )
    if (!net.ok) return { error: net.error }
    if (!net.spec) {
      return {
        error:
          "Choisis un réseau DHCP déclaré dans l'IPAM pour appliquer ce changement.",
      }
    }

    // 3. Application côté Proxmox (configuration du VPS uniquement).
    let applied
    try {
      applied = await applyVpsNetwork(
        server.node,
        server.virt,
        server.vmid,
        net.spec
      )
    } catch (e) {
      const message = errorMessage(e)
      // Rien n'a été appliqué : la nouvelle réservation est annulée,
      // l'ancienne adresse reste attribuée.
      if (net.addressId) await cancelReservation(net.addressId, user.email)
      await db
        .update(schema.servers)
        .set({ netError: message, netUpdatedAt: new Date() })
        .where(eq(schema.servers.id, server.id))
      await logActivity(user, "Échec de la modification réseau", {
        type: "server",
        id: server.id,
        label: server.name,
      })
      return { error: message }
    }

    // 4. Mise à jour locale : IPAM et état du VPS, suivis séparément.
    const previous = server.networkMode === "static" ? server.ipAddressId : null
    await db
      .update(schema.servers)
      .set({
        networkMode: net.mode,
        networkId: net.networkId,
        ipAddressId: net.addressId,
        previousIpAddressId: previous ?? server.previousIpAddressId,
        address:
          net.family === "ipv4"
            ? net.address
            : net.mode === "static"
              ? server.address
              : server.address,
        ipv6: net.family === "ipv6" ? net.address : server.ipv6,
        netSyncState: applied.configured ? "pending" : "error",
        netError: applied.configured
          ? null
          : "Proxmox n'a pas confirmé la nouvelle configuration.",
        netUpdatedAt: new Date(),
      })
      .where(eq(schema.servers.id, server.id))

    if (net.addressId) {
      await confirmAssignment(net.addressId, server.id, "static", user.email)
    }

    // 5. Vérification réelle ; libère l'ancienne adresse seulement si confirmé.
    const [fresh] = await db
      .select()
      .from(schema.servers)
      .where(eq(schema.servers.id, server.id))
    const check = await verifyServerNetwork(fresh, user.email).catch(() => null)

    await logActivity(user, `Configuration réseau modifiée (${net.mode})`, {
      type: "server",
      id: server.id,
      label: server.name,
    })
    revalidatePath(`/servers/${server.id}`)

    if (!applied.configured) {
      return {
        error:
          "Proxmox n'a pas confirmé la configuration. L'ancienne adresse reste réservée ; réessaie ou contacte le support.",
      }
    }
    if (check?.state === "synced") {
      return { ok: true, notice: "Configuration appliquée et vérifiée." }
    }
    return {
      ok: true,
      notice: applied.needsRestart
        ? "Configuration enregistrée. Redémarre le VPS pour l'appliquer, puis lance la vérification : l'ancienne adresse reste réservée jusqu'à confirmation."
        : "Configuration enregistrée, pas encore confirmée par le système invité. Lance la vérification dans quelques instants : l'ancienne adresse reste réservée jusqu'à confirmation.",
    }
  } finally {
    busy.delete(server.id)
  }
}

export async function verifyNetworkAction(
  serverId: string
): Promise<NetworkState> {
  const user = await requireUser()
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" }
  if (server.suspended) return { error: "VPS suspendu" }

  try {
    const res = await verifyServerNetwork(server, user.email)
    revalidatePath(`/servers/${server.id}`)
    return res.state === "synced"
      ? {
          ok: true,
          notice: res.releasedPrevious
            ? "Configuration confirmée. L'ancienne adresse a été libérée."
            : "Configuration confirmée.",
        }
      : { error: res.message ?? "Non confirmée pour le moment." }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}
