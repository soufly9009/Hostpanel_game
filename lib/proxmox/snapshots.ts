import "server-only"

import { proxmoxRequest, waitTask, type Virt } from "./client"

/**
 * Snapshots Proxmox. Un snapshot vit sur le MÊME stockage que le disque du
 * VPS : ce n'est pas une sauvegarde indépendante (perte du stockage = perte
 * des snapshots). La prise en charge dépend du type de stockage.
 */

export type Snapshot = {
  name: string
  description: string
  createdAt: number | null
  /** Snapshot automatique (préfixe auto-). */
  auto: boolean
}

type RawSnapshot = {
  name: string
  description?: string
  snaptime?: number
  parent?: string
}

const base = (node: string, virt: Virt, vmid: number) =>
  `/nodes/${node}/${virt}/${vmid}`

/** Nom valide côté Proxmox : lettre en tête, [A-Za-z0-9_-], 40 max. */
export const SNAPNAME_RE = /^[A-Za-z][A-Za-z0-9_-]{0,39}$/

export async function supportsSnapshots(
  node: string,
  virt: Virt,
  vmid: number
) {
  try {
    const r = await proxmoxRequest<{ hasFeature?: number | boolean }>(
      "GET",
      `${base(node, virt, vmid)}/feature`,
      { feature: "snapshot" }
    )
    return Boolean(r?.hasFeature)
  } catch {
    return false
  }
}

export async function listSnapshots(
  node: string,
  virt: Virt,
  vmid: number
): Promise<Snapshot[]> {
  const raw = await proxmoxRequest<RawSnapshot[]>(
    "GET",
    `${base(node, virt, vmid)}/snapshot`
  )
  return raw
    .filter((s) => s.name !== "current")
    .map((s) => ({
      name: s.name,
      description: s.description ?? "",
      createdAt: s.snaptime ?? null,
      auto: s.name.startsWith("auto-"),
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
}

export async function createSnapshot(
  node: string,
  virt: Virt,
  vmid: number,
  name: string,
  description: string
) {
  const upid = await proxmoxRequest<string>(
    "POST",
    `${base(node, virt, vmid)}/snapshot`,
    { snapname: name, description }
  )
  await waitTask(node, upid, 300_000)
}

export async function deleteSnapshot(
  node: string,
  virt: Virt,
  vmid: number,
  name: string
) {
  const upid = await proxmoxRequest<string>(
    "DELETE",
    `${base(node, virt, vmid)}/snapshot/${encodeURIComponent(name)}`
  )
  await waitTask(node, upid, 300_000)
}

export async function rollbackSnapshot(
  node: string,
  virt: Virt,
  vmid: number,
  name: string
) {
  const upid = await proxmoxRequest<string>(
    "POST",
    `${base(node, virt, vmid)}/snapshot/${encodeURIComponent(name)}/rollback`
  )
  await waitTask(node, upid, 300_000)
}
