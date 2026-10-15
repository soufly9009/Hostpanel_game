"use server"

import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { logInfo } from "@/lib/discord/logging"
import { requireUser } from "@/lib/auth/session"
import { CATALOG_BY_ID } from "@/lib/firewall/catalog"
import { getProfile } from "@/lib/firewall/profiles"
import { isDuplicate } from "@/lib/firewall/rules"
import { getAccessibleServer } from "@/lib/servers/access"
import { ProxmoxError } from "@/lib/proxmox/client"
import {
  addFirewallRule,
  deleteFirewallRule,
  getFirewall,
  setFirewallOptions,
  toggleFirewallRule,
} from "@/lib/proxmox/firewall"

export type FirewallActionState =
  { error?: string; ok?: boolean; notice?: string } | undefined

/** Nombre maximum de règles par VPS. */
const MAX_RULES = 50

const errorMessage = (e: unknown) =>
  e instanceof ProxmoxError
    ? `Proxmox : ${e.message}`
    : e instanceof Error
      ? e.message
      : "Erreur inconnue"

async function audit(server: { id: string; name: string }, action: string) {
  await logActivity(await requireUser(), action, {
    type: "server",
    id: server.id,
    label: server.name,
  })
  void logInfo({
    category: "firewall",
    title: "Pare-feu modifié",
    service: "VPS client",
    action,
    result: "success",
    meta: { vps: server.id },
    dedupeKey: `fw:${server.id}:${action}`,
    dedupeWindowMs: 30_000,
  })
}

async function writableServer(serverId: string) {
  const server = await getAccessibleServer(serverId)
  if (!server) return { error: "VPS introuvable" } as const
  if (server.suspended) return { error: "VPS suspendu" } as const
  return { server } as const
}

export async function setFirewallEnabled(
  serverId: string,
  enable: boolean,
  policyIn: "ACCEPT" | "DROP" = "ACCEPT"
): Promise<FirewallActionState> {
  const found = await writableServer(serverId)
  if ("error" in found) return { error: found.error }
  if (policyIn !== "ACCEPT" && policyIn !== "DROP") {
    return { error: "Politique invalide" }
  }
  const { server } = found

  try {
    await setFirewallOptions(server.node, server.virt, server.vmid, {
      enable,
      policyIn,
    })
    await audit(
      server,
      `Pare-feu ${enable ? "activé" : "désactivé"} (entrant ${policyIn})`
    )
    return { ok: true }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

const PORT = "(?:\\d{1,5})(?::\\d{1,5})?"
const dportRe = new RegExp(`^${PORT}(?:,${PORT})*$`)
const ipv4 = "(?:\\d{1,3}\\.){3}\\d{1,3}(?:/\\d{1,2})?"
const ipv6 = "[0-9a-fA-F:]{2,39}(?:/\\d{1,3})?"
const sourceRe = new RegExp(`^(?:${ipv4}|${ipv6})$`)

const ruleSchema = z.object({
  serverId: z.string().min(1),
  type: z.enum(["in", "out"]),
  action: z.enum(["ACCEPT", "DROP", "REJECT"]),
  proto: z.enum(["", "tcp", "udp", "icmp"]).default(""),
  dport: z
    .string()
    .trim()
    .max(100)
    .refine(
      (v) => v === "" || dportRe.test(v),
      "Ports invalides (ex. 80, 8000:8100, 80,443)"
    )
    .refine(
      (v) =>
        v === "" ||
        v.split(/[,:]/).every((p) => Number(p) >= 1 && Number(p) <= 65535),
      "Les ports doivent être entre 1 et 65535"
    )
    .default(""),
  source: z
    .string()
    .trim()
    .max(60)
    .refine((v) => v === "" || sourceRe.test(v), "Source invalide (IP ou CIDR)")
    .default(""),
  comment: z
    .string()
    .trim()
    .max(60)
    // Proxmox restreint les caractères des commentaires.
    .transform((v) => v.replace(/[^\p{L}\p{N} ._-]/gu, ""))
    .default(""),
})

export async function addRule(
  _prev: FirewallActionState,
  formData: FormData
): Promise<FirewallActionState> {
  const parsed = ruleSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const r = parsed.data

  if (r.dport && !["tcp", "udp"].includes(r.proto)) {
    return { error: "Un port nécessite le protocole TCP ou UDP" }
  }

  const found = await writableServer(r.serverId)
  if ("error" in found) return { error: found.error }
  const { server } = found

  try {
    const current = await getFirewall(server.node, server.virt, server.vmid)
    if (current.rules.length >= MAX_RULES) {
      return { error: `Limite de ${MAX_RULES} règles atteinte` }
    }
    if (
      isDuplicate(
        {
          type: r.type,
          action: r.action,
          proto: r.proto,
          dport: r.dport,
          source: r.source,
        },
        current.rules
      )
    ) {
      return {
        error:
          "Cette règle existe déjà (même sens, action, protocole, port et source).",
      }
    }
    await addFirewallRule(server.node, server.virt, server.vmid, {
      type: r.type,
      action: r.action,
      proto: r.proto || undefined,
      dport: r.dport || undefined,
      source: r.source || undefined,
      comment: r.comment || undefined,
    })
    await audit(
      server,
      `Règle de pare-feu ajoutée (${r.type} ${r.proto || "tout"}${r.dport ? " " + r.dport : ""})`
    )
    return { ok: true }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

export async function removeRule(
  serverId: string,
  pos: number
): Promise<FirewallActionState> {
  if (!Number.isInteger(pos) || pos < 0) return { error: "Règle invalide" }
  const found = await writableServer(serverId)
  if ("error" in found) return { error: found.error }
  const { server } = found

  try {
    await deleteFirewallRule(server.node, server.virt, server.vmid, pos)
    await audit(server, "Règle de pare-feu supprimée")
    return { ok: true }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

export async function setRuleEnabled(
  serverId: string,
  pos: number,
  enable: boolean
): Promise<FirewallActionState> {
  if (!Number.isInteger(pos) || pos < 0) return { error: "Règle invalide" }
  const found = await writableServer(serverId)
  if ("error" in found) return { error: found.error }
  const { server } = found

  try {
    await toggleFirewallRule(server.node, server.virt, server.vmid, pos, enable)
    return { ok: true }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

/**
 * Configuration automatique : applique un profil recommandé.
 * Les règles sont ajoutées AVANT d'activer le pare-feu et de fixer la
 * politique entrante, pour ne jamais couper l'accès (SSH) en cours de route.
 * Les règles déjà présentes sont ignorées (pas de doublon).
 */
export async function autoConfigureFirewall(
  serverId: string,
  profileId: string
): Promise<FirewallActionState> {
  const profile = getProfile(profileId)
  if (!profile) return { error: "Profil inconnu" }

  const found = await writableServer(serverId)
  if ("error" in found) return { error: found.error }
  const { server } = found

  try {
    const current = await getFirewall(server.node, server.virt, server.vmid)

    const toAdd = profile.rules.filter((r) => !isDuplicate(r, current.rules))
    if (current.rules.length + toAdd.length > MAX_RULES) {
      return { error: `Limite de ${MAX_RULES} règles dépassée` }
    }

    for (const rule of toAdd) {
      await addFirewallRule(server.node, server.virt, server.vmid, {
        type: rule.type as "in" | "out",
        action: rule.action as "ACCEPT" | "DROP" | "REJECT",
        proto: rule.proto ?? undefined,
        dport: rule.dport ?? undefined,
        source: rule.source ?? undefined,
        comment: rule.comment,
      })
    }

    await setFirewallOptions(server.node, server.virt, server.vmid, {
      enable: true,
      policyIn: profile.policyIn,
    })

    const skipped = profile.rules.length - toAdd.length
    return {
      ok: true,
      notice: `Profil « ${profile.label} » appliqué : ${toAdd.length} règle(s) ajoutée(s)${
        skipped > 0 ? `, ${skipped} déjà présente(s)` : ""
      }. Pare-feu activé.`,
    }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}

/**
 * Ajoute des services du catalogue (jeux, bots, voix, web…).
 * Les services « sensibles » (bases de données, RCON, RDP…) exigent une IP
 * source : on refuse de les exposer à tout Internet.
 */
export async function addCatalogRules(
  serverId: string,
  ids: string[],
  source: string
): Promise<FirewallActionState> {
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > 20) {
    return { error: "Sélection invalide" }
  }
  const src = (source ?? "").trim()
  if (src && !sourceRe.test(src)) {
    return { error: "Source invalide (IP ou CIDR)" }
  }

  const entries = []
  for (const id of new Set(ids)) {
    const entry = CATALOG_BY_ID.get(id)
    if (!entry) return { error: `Service inconnu : ${id}` }
    if (entry.sensitive && !src) {
      return {
        error: `« ${entry.label} » est un service sensible : indique l'IP autorisée pour ne pas l'exposer à tout Internet.`,
      }
    }
    entries.push(entry)
  }

  const found = await writableServer(serverId)
  if ("error" in found) return { error: found.error }
  const { server } = found

  try {
    const current = await getFirewall(server.node, server.virt, server.vmid)

    const planned: {
      proto: string
      dport: string | null
      comment: string
    }[] = []
    for (const entry of entries) {
      for (const r of entry.rules) {
        const candidate = {
          type: "in",
          action: "ACCEPT",
          proto: r.proto,
          dport: r.dport,
          source: src || null,
        }
        const dup =
          isDuplicate(candidate, current.rules) ||
          planned.some((p) => p.proto === r.proto && p.dport === r.dport)
        if (!dup) {
          planned.push({
            proto: r.proto,
            dport: r.dport,
            comment: entry.label
              .replace(/[^\p{L}\p{N} ._-]/gu, "")
              .slice(0, 60),
          })
        }
      }
    }

    if (planned.length === 0) {
      return { error: "Ces règles existent déjà." }
    }
    if (current.rules.length + planned.length > MAX_RULES) {
      return {
        error: `Limite de ${MAX_RULES} règles dépassée (${planned.length} à ajouter).`,
      }
    }

    for (const r of planned) {
      await addFirewallRule(server.node, server.virt, server.vmid, {
        type: "in",
        action: "ACCEPT",
        proto: r.proto,
        dport: r.dport ?? undefined,
        source: src || undefined,
        comment: r.comment,
      })
    }

    return {
      ok: true,
      notice: `${planned.length} règle(s) ajoutée(s)${src ? ` (source ${src})` : ""}.`,
    }
  } catch (e) {
    return { error: errorMessage(e) }
  }
}
