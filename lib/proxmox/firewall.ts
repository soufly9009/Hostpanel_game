import "server-only"

import { proxmoxRequest, type Virt } from "./client"

/** Pare-feu par VPS via l'API firewall de Proxmox (VM.Config.Network / VM.Audit). */

export type FirewallRule = {
  pos: number
  type: "in" | "out"
  action: "ACCEPT" | "DROP" | "REJECT"
  proto: string | null
  dport: string | null
  source: string | null
  enabled: boolean
  comment: string | null
  macro: string | null
}

export type FirewallState = {
  enabled: boolean
  policyIn: "ACCEPT" | "DROP" | "REJECT"
  policyOut: "ACCEPT" | "DROP" | "REJECT"
  rules: FirewallRule[]
  /** Pare-feu du datacenter actif ? null = non lisible avec ce jeton. */
  datacenterEnabled: boolean | null
}

const base = (node: string, virt: Virt, vmid: number) =>
  `/nodes/${node}/${virt}/${vmid}/firewall`

type RawRule = {
  pos: number
  type: string
  action?: string
  proto?: string
  dport?: string
  source?: string
  enable?: number
  comment?: string
  macro?: string
}

export async function getFirewall(
  node: string,
  virt: Virt,
  vmid: number
): Promise<FirewallState> {
  const [options, rules, datacenter] = await Promise.all([
    proxmoxRequest<{
      enable?: number
      policy_in?: FirewallState["policyIn"]
      policy_out?: FirewallState["policyOut"]
    }>("GET", `${base(node, virt, vmid)}/options`),
    proxmoxRequest<RawRule[]>("GET", `${base(node, virt, vmid)}/rules`),
    proxmoxRequest<{ enable?: number }>(
      "GET",
      "/cluster/firewall/options"
    ).catch(() => null),
  ])

  return {
    enabled: Boolean(options.enable),
    policyIn: options.policy_in ?? "DROP",
    policyOut: options.policy_out ?? "ACCEPT",
    datacenterEnabled: datacenter ? Boolean(datacenter.enable) : null,
    rules: rules
      .filter((r) => r.type === "in" || r.type === "out")
      .map((r) => ({
        pos: r.pos,
        type: r.type as "in" | "out",
        action: (r.action ?? "ACCEPT") as FirewallRule["action"],
        proto: r.proto ?? null,
        dport: r.dport ?? null,
        source: r.source ?? null,
        enabled: Boolean(r.enable),
        comment: r.comment ?? null,
        macro: r.macro ?? null,
      })),
  }
}

/**
 * Le pare-feu d'une VM ne s'applique qu'aux interfaces marquées `firewall=1`.
 * Active le drapeau sur toutes les interfaces réseau.
 */
async function ensureNicFirewall(node: string, virt: Virt, vmid: number) {
  const config = await proxmoxRequest<Record<string, unknown>>(
    "GET",
    `/nodes/${node}/${virt}/${vmid}/config`
  )
  const updates: Record<string, string> = {}
  for (const [key, value] of Object.entries(config)) {
    if (!/^net\d+$/.test(key) || typeof value !== "string") continue
    if (/(^|,)firewall=1(,|$)/.test(value)) continue
    updates[key] = /(^|,)firewall=\d(,|$)/.test(value)
      ? value.replace(/firewall=\d/, "firewall=1")
      : `${value},firewall=1`
  }
  if (Object.keys(updates).length > 0) {
    await proxmoxRequest(
      "PUT",
      `/nodes/${node}/${virt}/${vmid}/config`,
      updates
    )
  }
}

export async function setFirewallOptions(
  node: string,
  virt: Virt,
  vmid: number,
  opts: { enable: boolean; policyIn?: "ACCEPT" | "DROP" | "REJECT" }
) {
  if (opts.enable) await ensureNicFirewall(node, virt, vmid)
  await proxmoxRequest("PUT", `${base(node, virt, vmid)}/options`, {
    enable: opts.enable ? 1 : 0,
    ...(opts.policyIn && { policy_in: opts.policyIn }),
  })
}

export type NewRule = {
  type: "in" | "out"
  action: "ACCEPT" | "DROP" | "REJECT"
  proto?: string
  dport?: string
  source?: string
  comment?: string
}

export async function addFirewallRule(
  node: string,
  virt: Virt,
  vmid: number,
  rule: NewRule
) {
  await proxmoxRequest("POST", `${base(node, virt, vmid)}/rules`, {
    type: rule.type,
    action: rule.action,
    enable: 1,
    ...(rule.proto && { proto: rule.proto }),
    ...(rule.dport && { dport: rule.dport }),
    ...(rule.source && { source: rule.source }),
    ...(rule.comment && { comment: rule.comment }),
  })
}

export async function deleteFirewallRule(
  node: string,
  virt: Virt,
  vmid: number,
  pos: number
) {
  await proxmoxRequest("DELETE", `${base(node, virt, vmid)}/rules/${pos}`)
}

export async function toggleFirewallRule(
  node: string,
  virt: Virt,
  vmid: number,
  pos: number,
  enable: boolean
) {
  await proxmoxRequest("PUT", `${base(node, virt, vmid)}/rules/${pos}`, {
    enable: enable ? 1 : 0,
  })
}
