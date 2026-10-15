import "server-only"

import { env, proxmoxConfigured } from "@/lib/env"

import {
  listNodes,
  ProxmoxError,
  proxmoxRawRequest,
  proxmoxRequest,
} from "./client"

/**
 * Audit des droits du jeton API Proxmox.
 *
 * 1. `/access/permissions?path=…` donne les privilèges effectifs du jeton
 *    (héritage et séparation de privilèges compris).
 * 2. Des sondes réelles exécutent les appels que le site utilise, pour
 *    confirmer que tout fonctionne vraiment.
 */

type Need = {
  privilege: string
  /** Chemin ACL Proxmox où le droit doit être effectif. */
  path: string
  purpose: string
  /** `required` bloque une fonction ; `recommended` améliore l'usage. */
  level: "required" | "recommended"
}

const needs = (node: string): Need[] => [
  {
    path: "/vms",
    privilege: "VM.Allocate",
    purpose: "Créer / supprimer des VPS",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Clone",
    purpose: "Cloner un template QEMU",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.PowerMgmt",
    purpose: "Démarrer / arrêter / redémarrer",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Audit",
    purpose: "Lire l'état, les ressources et les templates",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.CPU",
    purpose: "Appliquer les vCPU de l'offre",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.Memory",
    purpose: "Appliquer la RAM de l'offre",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.Disk",
    purpose: "Agrandir / créer le disque",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.Network",
    purpose: "Configurer le réseau",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.Options",
    purpose: "Options (démarrage auto, cloud-init)",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Config.Cloudinit",
    purpose: "Mot de passe et réseau cloud-init (QEMU)",
    level: "required",
  },
  {
    path: "/vms",
    privilege: "VM.Snapshot",
    purpose: "Créer / supprimer des snapshots",
    level: "recommended",
  },
  {
    path: "/vms",
    privilege: "VM.Snapshot.Rollback",
    purpose: "Restaurer un snapshot",
    level: "recommended",
  },
  {
    path: "/storage",
    privilege: "Datastore.AllocateSpace",
    purpose: "Allouer le disque du VPS",
    level: "required",
  },
  {
    path: "/storage",
    privilege: "Datastore.Audit",
    purpose: "Lister stockages et templates LXC",
    level: "required",
  },
  {
    path: `/nodes/${node}`,
    privilege: "Sys.Audit",
    purpose: "Lister les ponts réseau et l'état du nœud",
    level: "required",
  },
  {
    path: "/sdn/zones",
    privilege: "SDN.Use",
    purpose: "Utiliser un pont réseau (Proxmox 8+)",
    level: "recommended",
  },
]

export type PermissionCheck = {
  path: string
  privilege: string
  purpose: string
  level: Need["level"]
  status: "ok" | "missing" | "unknown"
}

export type Probe = { name: string; ok: boolean; detail: string }

export type PermissionReport = {
  configured: boolean
  connected: boolean
  tokenId: string | null
  /** true : le jeton n'a QUE les droits qu'on lui attribue (pas ceux de l'utilisateur). */
  privilegeSeparation: boolean | null
  node: string | null
  checks: PermissionCheck[]
  probes: Probe[]
  /** true si tous les droits `required` sont présents et les sondes OK. */
  ready: boolean
  missing: string[]
  error: string | null
}

const errText = (e: unknown) =>
  e instanceof Error ? e.message : "Erreur inconnue"

export async function checkProxmoxPermissions(
  requestedNode?: string | null
): Promise<PermissionReport> {
  const base: PermissionReport = {
    configured: proxmoxConfigured,
    connected: false,
    tokenId: env.PROXMOX_TOKEN_ID ?? null,
    privilegeSeparation: null,
    node: null,
    checks: [],
    probes: [],
    ready: false,
    missing: [],
    error: null,
  }
  if (!proxmoxConfigured) {
    return {
      ...base,
      error:
        "PROXMOX_URL, PROXMOX_TOKEN_ID et PROXMOX_TOKEN_SECRET sont requis.",
    }
  }

  // Connexion + choix du nœud.
  let node = requestedNode ?? null
  try {
    await proxmoxRequest("GET", "/version")
    base.connected = true
    if (!node) {
      const nodes = await listNodes()
      node = nodes.find((n) => n.online)?.node ?? nodes[0]?.node ?? null
    }
  } catch (e) {
    return { ...base, error: errText(e) }
  }
  if (!node) return { ...base, error: "Aucun nœud trouvé dans le cluster." }
  base.node = node

  // Les lectures suivantes peuvent être refusées sans que ce soit une panne
  // (l'audit l'affiche) : requêtes non journalisées, aucune alerte Discord.

  // Séparation de privilèges : un jeton « privsep » n'hérite pas de son utilisateur.
  const [tokenUser, tokenName] = (env.PROXMOX_TOKEN_ID ?? "").split("!")
  if (tokenUser && tokenName) {
    try {
      const t = await proxmoxRawRequest<{ privsep?: number | boolean }>(
        "GET",
        `/access/users/${encodeURIComponent(tokenUser)}/token/${encodeURIComponent(tokenName)}`
      )
      base.privilegeSeparation = Boolean(t?.privsep)
    } catch {
      // lecture non autorisée : on laisse null
    }
  } else {
    base.error = "PROXMOX_TOKEN_ID doit avoir la forme user@realm!nomdujeton."
  }

  // 1. Privilèges effectifs, un appel par chemin ACL.
  const list = needs(node)
  const paths = [...new Set(list.map((n) => n.path))]
  const effective = new Map<string, Record<string, number> | null>()

  await Promise.all(
    paths.map(async (path) => {
      try {
        const res = await proxmoxRawRequest<
          Record<string, Record<string, number>>
        >("GET", "/access/permissions", { path })
        effective.set(path, res?.[path] ?? {})
      } catch {
        effective.set(path, null)
      }
    })
  )

  base.checks = list.map((n) => {
    const privs = effective.get(n.path)
    return {
      ...n,
      status:
        privs === null || privs === undefined
          ? "unknown"
          : privs[n.privilege]
            ? "ok"
            : "missing",
    }
  })

  // 2. Sondes réelles : ce que le site appelle vraiment.
  const probe = async (name: string, fn: () => Promise<string>) => {
    try {
      return { name, ok: true, detail: await fn() } satisfies Probe
    } catch (e) {
      return {
        name,
        ok: false,
        detail:
          e instanceof ProxmoxError && e.status === 403
            ? "Permission refusée"
            : errText(e),
      } satisfies Probe
    }
  }

  base.probes = await Promise.all([
    probe("Lister les VM / templates", async () => {
      const r = await proxmoxRawRequest<unknown[]>(
        "GET",
        "/cluster/resources",
        {
          type: "vm",
        }
      )
      return `${r.length} VM visible(s)`
    }),
    probe("Lister les stockages du nœud", async () => {
      const r = await proxmoxRawRequest<unknown[]>(
        "GET",
        `/nodes/${node}/storage`
      )
      return `${r.length} stockage(s)`
    }),
    probe("Lister les ponts réseau", async () => {
      const r = await proxmoxRawRequest<{ type: string }[]>(
        "GET",
        `/nodes/${node}/network`
      )
      return `${r.filter((i) => i.type === "bridge" || i.type === "OVSBridge").length} pont(s)`
    }),
    probe("Réserver un VMID", async () => {
      const id = await proxmoxRawRequest<string>("GET", "/cluster/nextid")
      return `Prochain VMID : ${id}`
    }),
  ])

  base.missing = [
    ...base.checks
      .filter((c) => c.level === "required" && c.status === "missing")
      .map((c) => `${c.privilege} sur ${c.path}`),
    ...base.probes
      .filter((p) => !p.ok)
      .map((p) => `Sonde « ${p.name} » : ${p.detail}`),
  ]
  base.ready = base.missing.length === 0
  return base
}
