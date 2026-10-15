import "server-only"

import { proxmoxRequest as request, type Virt } from "./client"
import {
  configMatches,
  mergeLxcNet0,
  nameserverParam,
  qemuIpconfig0,
  withQemuVlan,
  type NetworkSpec,
} from "./netspec"

/**
 * Configuration réseau d'un VPS existant (conteneur ou VM).
 * Modifie uniquement la configuration du VPS : jamais celle de l'hôte Proxmox.
 */

export type AppliedNetwork = {
  /** La configuration relue côté Proxmox correspond à la demande. */
  configured: boolean
  /** Le changement n'est effectif qu'après un redémarrage du VPS. */
  needsRestart: boolean
  /** Ligne de configuration relue (net0 pour LXC, ipconfig0 pour QEMU). */
  line: string | null
}

const cfgPath = (node: string, virt: Virt, vmid: number) =>
  `/nodes/${node}/${virt}/${vmid}/config`

export async function readNetworkLine(node: string, virt: Virt, vmid: number) {
  const cfg = await request<Record<string, string>>(
    "GET",
    cfgPath(node, virt, vmid)
  )
  return {
    line: (virt === "lxc" ? cfg.net0 : cfg.ipconfig0) ?? null,
    net0: cfg.net0 ?? null,
    nameserver: cfg.nameserver ?? null,
  }
}

export async function applyVpsNetwork(
  node: string,
  virt: Virt,
  vmid: number,
  spec: NetworkSpec
): Promise<AppliedNetwork> {
  const path = cfgPath(node, virt, vmid)
  const current = await request<Record<string, string>>("GET", path)
  const ns = nameserverParam(spec.dns)

  if (virt === "lxc") {
    await request("PUT", path, {
      net0: mergeLxcNet0(current.net0, spec),
      ...(ns && { nameserver: ns }),
    })
  } else {
    await request("PUT", path, {
      ipconfig0: qemuIpconfig0(spec),
      ...(ns && { nameserver: ns }),
      ...(current.net0 && spec.vlan !== undefined
        ? { net0: withQemuVlan(current.net0, spec.vlan) }
        : {}),
    })
  }

  // Relecture : on ne déclare « configuré » que si Proxmox le confirme.
  const after = await readNetworkLine(node, virt, vmid)
  const status = await request<{ status?: string }>(
    "GET",
    `/nodes/${node}/${virt}/${vmid}/status/current`
  ).catch(() => null)
  const running = status?.status === "running"

  return {
    configured: configMatches(after.line ?? undefined, spec),
    // cloud-init (QEMU) ne s'applique qu'au prochain démarrage.
    needsRestart: virt === "qemu" && running,
    line: after.line,
  }
}
