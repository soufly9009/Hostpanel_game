import "server-only"

import { Client } from "ssh2"

import { env } from "@/lib/env"

/**
 * L'API REST de Proxmox ne permet pas d'exécuter une commande dans un LXC :
 * on passe par SSH sur l'hôte Proxmox et `pct exec`.
 */
export const hostExecConfigured = Boolean(
  env.PROXMOX_SSH_PASSWORD || env.PROXMOX_SSH_PRIVATE_KEY
)

/** Active la connexion root par mot de passe dans le conteneur. */
const ENABLE_ROOT_SSH =
  "sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin yes/g' /etc/ssh/sshd_config;" +
  "systemctl restart ssh || systemctl restart sshd"

function sshHost() {
  if (env.PROXMOX_SSH_HOST) return env.PROXMOX_SSH_HOST
  return env.PROXMOX_URL ? new URL(env.PROXMOX_URL).hostname : null
}

function runOnHost(command: string, timeoutMs = 30_000) {
  return new Promise<{ code: number; output: string }>((resolve, reject) => {
    const host = sshHost()
    if (!host) return reject(new Error("Hôte Proxmox inconnu"))
    // Erreur de configuration fréquente : le port saisi à la place de l'hôte.
    if (/^\d+$/.test(host)) {
      return reject(
        new Error(
          `PROXMOX_SSH_HOST vaut « ${host} » : indique l'IP ou le nom de l'hôte Proxmox (le port va dans PROXMOX_SSH_PORT), ou laisse-le vide pour utiliser l'hôte de PROXMOX_URL.`
        )
      )
    }

    const conn = new Client()
    let output = ""
    const timer = setTimeout(() => {
      conn.destroy()
      reject(new Error("Délai dépassé"))
    }, timeoutMs)
    const done = (fn: () => void) => {
      clearTimeout(timer)
      fn()
    }

    conn
      .on("ready", () => {
        conn.exec(command, (err, stream) => {
          if (err) return done(() => (conn.end(), reject(err)))
          stream
            .on("data", (d: Buffer) => (output += d.toString()))
            .stderr.on("data", (d: Buffer) => (output += d.toString()))
          stream.on("close", (code: number | null) =>
            done(() => {
              conn.end()
              resolve({ code: code ?? 1, output: output.trim() })
            })
          )
        })
      })
      .on("error", (e) => done(() => reject(e)))
      .connect({
        host,
        port: env.PROXMOX_SSH_PORT,
        username: env.PROXMOX_SSH_USER,
        password: env.PROXMOX_SSH_PASSWORD,
        privateKey: env.PROXMOX_SSH_PRIVATE_KEY?.replace(/\\n/g, "\n"),
        readyTimeout: 15_000,
      })
  })
}

/**
 * Autorise root à se connecter en SSH (mot de passe) dans un conteneur.
 * Best effort : réessaie le temps que le conteneur démarre, ne lève jamais.
 */
export async function enableRootSsh(
  vmid: number
): Promise<{ ok: boolean; detail?: string }> {
  if (!hostExecConfigured) {
    return { ok: false, detail: "Accès SSH à l'hôte Proxmox non configuré" }
  }
  if (!Number.isInteger(vmid) || vmid < 100) {
    return { ok: false, detail: "VMID invalide" }
  }

  // base64 : évite tout problème de guillemets entre les deux shells.
  const b64 = Buffer.from(ENABLE_ROOT_SSH).toString("base64")
  const command = `pct exec ${vmid} -- sh -c 'echo ${b64} | base64 -d | sh'`

  let last = ""
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await runOnHost(command)
      if (res.code === 0) return { ok: true }
      last = res.output || `code ${res.code}`
    } catch (e) {
      last = e instanceof Error ? e.message : String(e)
      // Configuration ou hôte introuvable : inutile de réessayer.
      if (
        /PROXMOX_SSH_HOST|ENOTFOUND|authentication|Hôte Proxmox inconnu/i.test(
          last
        )
      )
        break
    }
    await new Promise((r) => setTimeout(r, 4000))
  }
  return { ok: false, detail: last }
}

const validVmid = (vmid: number) => Number.isInteger(vmid) && vmid >= 100

/**
 * Exécute un script bash en root dans le conteneur (via l'hôte). Le script
 * passe en base64 : aucun problème de guillemets entre les deux shells.
 */
export function pctExec(vmid: number, script: string, timeoutMs = 15 * 60_000) {
  if (!validVmid(vmid)) return Promise.reject(new Error("VMID invalide"))
  const b64 = Buffer.from(script).toString("base64")
  return runOnHost(
    `pct exec ${vmid} -- sh -c 'echo ${b64} | base64 -d | bash'`,
    timeoutMs
  )
}

/** État du conteneur (« running », « stopped »…). */
export async function pctStatus(vmid: number) {
  if (!validVmid(vmid)) throw new Error("VMID invalide")
  const res = await runOnHost(`pct status ${vmid}`)
  return /status:\s*(\w+)/.exec(res.output)?.[1] ?? "unknown"
}

/**
 * Active les options nécessaires à Docker (nesting, et keyctl pour un
 * conteneur non privilégié) en conservant les autres. Redémarre le conteneur
 * si un changement a été fait. Renvoie true si un redémarrage a eu lieu.
 */
export async function ensureDockerFeatures(vmid: number) {
  if (!validVmid(vmid)) throw new Error("VMID invalide")
  const cfg = (await runOnHost(`pct config ${vmid}`)).output
  const unprivileged = /^unprivileged:\s*1/m.test(cfg)
  const current = /^features:\s*(.+)$/m.exec(cfg)?.[1]?.trim() ?? ""
  const features = new Map(
    current
      .split(",")
      .filter(Boolean)
      .map((kv) => kv.split("=") as [string, string])
  )
  const wanted: [string, string][] = [["nesting", "1"]]
  if (unprivileged) wanted.push(["keyctl", "1"])
  if (wanted.every(([k, v]) => features.get(k) === v)) return false

  for (const [k, v] of wanted) features.set(k, v)
  const value = [...features].map(([k, v]) => `${k}=${v}`).join(",")
  if (!/^[a-z0-9=,;]+$/i.test(value)) throw new Error("Options LXC inattendues")
  const set = await runOnHost(`pct set ${vmid} --features ${value}`)
  if (set.code !== 0) throw new Error(`pct set : ${set.output || set.code}`)
  const reboot = await runOnHost(`pct reboot ${vmid} --timeout 90`, 150_000)
  if (reboot.code !== 0)
    throw new Error(`Redémarrage : ${reboot.output || reboot.code}`)
  return true
}
