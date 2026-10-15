import "server-only"

import { sql } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"

/**
 * Journal des appels Proxmox. N'enregistre que les modifications
 * (POST/PUT/DELETE) et les erreurs ; les lectures réussies ne sont gardées
 * qu'avec PROXMOX_LOG_READS=true. Les corps de requête (mots de passe…) ne
 * sont jamais journalisés.
 */

const MAX_ROWS = 5000

type Call = {
  method: string
  path: string
  status: number
  durationMs: number
  error?: string
}

const VM = /^\/nodes\/[^/]+\/(lxc|qemu)\/(\d+)/

function label(method: string, path: string) {
  const vm = VM.exec(path)
  const target = vm ? `${vm[1] === "lxc" ? "LXC" : "VM"} ${vm[2]}` : null
  const on = target ? ` de ${target}` : ""

  if (method === "POST" && /^\/nodes\/[^/]+\/lxc$/.test(path)) {
    return "Création d'un conteneur LXC"
  }
  if (/\/qemu\/\d+\/clone$/.test(path)) return "Clonage d'un template QEMU"
  if (path.endsWith("/status/start")) return `Démarrage${on}`
  if (path.endsWith("/status/shutdown")) return `Arrêt${on}`
  if (path.endsWith("/status/reboot")) return `Redémarrage${on}`
  if (path.endsWith("/status/stop")) return `Arrêt forcé${on}`
  if (path.includes("/firewall/options")) return `Pare-feu : options${on}`
  if (path.includes("/firewall/rules")) {
    if (method === "POST") return `Pare-feu : règle ajoutée${on}`
    if (method === "DELETE") return `Pare-feu : règle supprimée${on}`
    if (method === "PUT") return `Pare-feu : règle modifiée${on}`
  }
  if (method === "PUT" && path.endsWith("/config"))
    return `Configuration modifiée${on}`
  if (method === "PUT" && path.endsWith("/resize")) return `Disque agrandi${on}`
  if (
    method === "DELETE" &&
    vm &&
    /^\/nodes\/[^/]+\/(lxc|qemu)\/\d+$/.test(path)
  ) {
    return `Suppression${on}`
  }
  if (method === "GET")
    return `Lecture : ${path.split("/").slice(-2).join("/")}`
  return `${method} ${path}`
}

async function currentActor() {
  try {
    // Hors requête (planificateur…) cookies() lève : acteur « système ».
    const { getCurrentUser } = await import("@/lib/auth/session")
    const user = await getCurrentUser()
    return user ? user.email : "système"
  } catch {
    return "système"
  }
}

export async function recordProxmoxCall(call: Call) {
  try {
    const isRead = call.method === "GET"
    const isError = call.status === 0 || call.status >= 400 || !!call.error
    if (isRead && !isError && !env.PROXMOX_LOG_READS) return

    // Pas de chaîne de requête dans le journal.
    const path = call.path.split("?")[0]

    await db.insert(schema.proxmoxLogs).values({
      actor: await currentActor(),
      action: label(call.method, path),
      method: call.method,
      path,
      status: call.status,
      durationMs: Math.max(0, Math.round(call.durationMs)),
      error: call.error ? call.error.slice(0, 500) : null,
    })

    // Purge occasionnelle : on garde les MAX_ROWS lignes les plus récentes.
    if (Math.random() < 0.02) {
      await db.run(
        sql`DELETE FROM proxmox_logs WHERE id <= (SELECT MAX(id) FROM proxmox_logs) - ${MAX_ROWS}`
      )
    }
  } catch {
    // Le journal ne doit jamais casser un appel Proxmox.
  }
}
