"use server"

import { revalidatePath } from "next/cache"
import { eq } from "drizzle-orm"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { ProxmoxError } from "@/lib/proxmox/client"
import {
  createSnapshot,
  deleteSnapshot,
  listSnapshots,
  rollbackSnapshot,
  SNAPNAME_RE,
} from "@/lib/proxmox/snapshots"
import { getAccessibleServer } from "@/lib/servers/access"

export type SnapshotState = { error?: string; ok?: boolean } | undefined

const errorMessage = (e: unknown) =>
  e instanceof ProxmoxError
    ? `Proxmox : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

/** Une seule opération de snapshot à la fois par VPS (cette instance). */
const g = globalThis as unknown as { __snapBusy?: Set<string> }
const busy = (g.__snapBusy ??= new Set<string>())

async function guarded<T>(serverId: string, fn: () => Promise<T>) {
  if (busy.has(serverId)) {
    throw new Error("Une opération de snapshot est déjà en cours sur ce VPS.")
  }
  busy.add(serverId)
  try {
    return await fn()
  } finally {
    busy.delete(serverId)
  }
}

const stamp = () => new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)

async function context(serverId: string) {
  const user = await requireUser()
  const server = await getAccessibleServer(serverId)
  if (!server) return null
  const [plan] = server.planId
    ? await db
        .select()
        .from(schema.plans)
        .where(eq(schema.plans.id, server.planId))
    : []
  return { user, server, plan: plan ?? null }
}

export async function createSnapshotAction(
  serverId: string,
  description: string
): Promise<SnapshotState> {
  const ctx = await context(serverId)
  if (!ctx) return { error: "VPS introuvable" }
  const { user, server, plan } = ctx
  if (server.suspended) return { error: "VPS suspendu" }

  const desc = z.string().trim().max(120).safeParse(description)
  if (!desc.success) return { error: "Description trop longue (120 max)" }

  const limit = plan?.snapshotLimit ?? 0
  if (limit <= 0) {
    return { error: "Les snapshots ne sont pas inclus dans cette offre." }
  }

  try {
    await guarded(server.id, async () => {
      const existing = await listSnapshots(
        server.node,
        server.virt,
        server.vmid
      )
      const manual = existing.filter((s) => !s.auto).length
      if (manual >= limit) {
        throw new Error(
          `Limite atteinte (${limit} snapshot(s) manuels). Supprime-en un d'abord.`
        )
      }
      await createSnapshot(
        server.node,
        server.virt,
        server.vmid,
        `m${stamp()}`,
        desc.data
      )
    })
  } catch (e) {
    return { error: errorMessage(e) }
  }

  await logActivity(user, "Snapshot créé", {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath(`/servers/${server.id}`)
  return { ok: true }
}

export async function deleteSnapshotAction(
  serverId: string,
  name: string
): Promise<SnapshotState> {
  const ctx = await context(serverId)
  if (!ctx) return { error: "VPS introuvable" }
  const { user, server } = ctx
  if (!SNAPNAME_RE.test(name)) return { error: "Nom de snapshot invalide" }

  try {
    await guarded(server.id, () =>
      deleteSnapshot(server.node, server.virt, server.vmid, name)
    )
  } catch (e) {
    return { error: errorMessage(e) }
  }

  await logActivity(user, `Snapshot supprimé (${name})`, {
    type: "server",
    id: server.id,
    label: server.name,
  })
  return { ok: true }
}

export async function rollbackSnapshotAction(
  serverId: string,
  name: string,
  confirmation: string
): Promise<SnapshotState> {
  const ctx = await context(serverId)
  if (!ctx) return { error: "VPS introuvable" }
  const { user, server } = ctx
  if (server.suspended) return { error: "VPS suspendu" }
  if (!SNAPNAME_RE.test(name)) return { error: "Nom de snapshot invalide" }
  if (confirmation !== name) {
    return { error: "Confirmation incorrecte : recopie le nom du snapshot." }
  }

  try {
    await guarded(server.id, () =>
      rollbackSnapshot(server.node, server.virt, server.vmid, name)
    )
  } catch (e) {
    return { error: errorMessage(e) }
  }

  await logActivity(user, `Restauration du snapshot ${name}`, {
    type: "server",
    id: server.id,
    label: server.name,
  })
  revalidatePath(`/servers/${server.id}`)
  return { ok: true }
}

export async function setAutoSnapshot(
  serverId: string,
  enabled: boolean
): Promise<SnapshotState> {
  const ctx = await context(serverId)
  if (!ctx) return { error: "VPS introuvable" }
  const { user, server, plan } = ctx
  if (enabled && (plan?.snapshotLimit ?? 0) <= 0) {
    return { error: "Les snapshots ne sont pas inclus dans cette offre." }
  }

  await db
    .update(schema.servers)
    .set({ autoSnapshot: enabled })
    .where(eq(schema.servers.id, server.id))
  await logActivity(
    user,
    enabled
      ? "Snapshots automatiques activés"
      : "Snapshots automatiques désactivés",
    { type: "server", id: server.id, label: server.name }
  )
  revalidatePath(`/servers/${server.id}`)
  return { ok: true }
}
