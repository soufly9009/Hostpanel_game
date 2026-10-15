import "server-only"

import https from "node:https"
import { randomBytes } from "node:crypto"

import { env } from "@/lib/env"

import { errorText, logError } from "@/lib/discord/logging"
import { enableRootSsh } from "./exec"
import {
  nameserverParam,
  newLxcNet0,
  qemuIpconfig0,
  withQemuVlan,
  type NetworkSpec,
} from "./netspec"
import { recordProxmoxCall } from "./logger"

export class ProxmoxError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = "ProxmoxError"
  }
}

/** Erreur de joignabilité ou d'authentification (pas une erreur métier). */
export function isConnectivityError(e: unknown) {
  return (
    e instanceof ProxmoxError && [0, 401, 403, 502, 503, 504].includes(e.status)
  )
}

export type Virt = "lxc" | "qemu"
export type VpsSignal = "start" | "stop" | "restart" | "kill"

type Params = Record<string, string | number | boolean>

/** Requête journalisée : modifications et erreurs (jamais le corps). */
async function request<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params?: Params
): Promise<T> {
  const start = Date.now()
  try {
    const data = await rawRequest<T>(method, path, params)
    void recordProxmoxCall({
      method,
      path,
      status: 200,
      durationMs: Date.now() - start,
    })
    return data
  } catch (e) {
    void recordProxmoxCall({
      method,
      path,
      status: e instanceof ProxmoxError ? e.status : 0,
      durationMs: Date.now() - start,
      error: e instanceof Error ? e.message : "Erreur",
    })
    // Une alerte par panne (dédupliquée 15 min) : les lectures périodiques
    // de l'interface ne produisent pas de rafale.
    if (isConnectivityError(e)) {
      void logError({
        category: "proxmox",
        title: "Erreur de connexion à Proxmox",
        service: "Proxmox",
        action: "appel API",
        result: "failure",
        message: errorText(e),
        dedupeKey: `proxmox-conn:${e instanceof ProxmoxError ? e.status : 0}`,
        dedupeWindowMs: 15 * 60_000,
      })
    }
    throw e
  }
}

function rawRequest<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  params?: Params
): Promise<T> {
  if (!env.PROXMOX_URL || !env.PROXMOX_TOKEN_ID || !env.PROXMOX_TOKEN_SECRET) {
    throw new ProxmoxError(
      "Proxmox n'est pas configuré (PROXMOX_URL et jeton API).",
      503
    )
  }

  const url = new URL(`${env.PROXMOX_URL}/api2/json${path}`)
  const hasBody = method === "POST" || method === "PUT"
  if (!hasBody && params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, String(v))
    }
  }
  const payload = hasBody && params ? JSON.stringify(params) : undefined

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        rejectUnauthorized: !env.PROXMOX_INSECURE_TLS,
        timeout: 20_000,
        headers: {
          Authorization: `PVEAPIToken=${env.PROXMOX_TOKEN_ID}=${env.PROXMOX_TOKEN_SECRET}`,
          Accept: "application/json",
          ...(payload && {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }),
        },
      },
      (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (raw += c))
        res.on("end", () => {
          const status = res.statusCode ?? 0
          let json: { data?: T; message?: string; errors?: unknown } | null =
            null
          try {
            json = raw ? JSON.parse(raw) : null
          } catch {
            // corps non JSON
          }
          if (status >= 200 && status < 300) {
            return resolve(json?.data as T)
          }
          const detail =
            json?.message ||
            (json?.errors ? JSON.stringify(json.errors) : "") ||
            res.statusMessage ||
            `HTTP ${status}`
          reject(
            new ProxmoxError(
              status === 403 || /permission check failed/i.test(detail)
                ? `Permission refusée par Proxmox (${path}) : ${detail}`
                : detail,
              status
            )
          )
        })
      }
    )
    req.on("timeout", () => req.destroy(new Error("Délai dépassé")))
    req.on("error", (e) =>
      reject(
        e instanceof ProxmoxError
          ? e
          : new ProxmoxError(`Proxmox injoignable : ${e.message}`, 502)
      )
    )
    if (payload) req.write(payload)
    req.end()
  })
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** Attend la fin d'une tâche Proxmox (UPID) ; lève si elle échoue. */
export async function waitTask(
  node: string,
  upid: string,
  timeoutMs = 180_000
) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const st = await request<{ status: string; exitstatus?: string }>(
      "GET",
      `/nodes/${node}/tasks/${encodeURIComponent(upid)}/status`
    )
    if (st.status === "stopped") {
      if (st.exitstatus && st.exitstatus !== "OK") {
        throw new ProxmoxError(`Tâche échouée : ${st.exitstatus}`, 500)
      }
      return
    }
    await sleep(1500)
  }
  throw new ProxmoxError("Délai dépassé pendant la tâche Proxmox", 504)
}

/* ───────────── Lecture ───────────── */

export async function listNodes() {
  const nodes = await request<{ node: string; status: string }[]>(
    "GET",
    "/nodes"
  )
  return nodes.map((n) => ({ node: n.node, online: n.status === "online" }))
}

export type TemplateOption = {
  virt: Virt
  value: string
  label: string
  node: string
}

export type TemplateResult = {
  options: { value: string; label: string }[]
  /** Détail de ce qui a été inspecté (affiché quand la liste est vide). */
  notes: string[]
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "erreur")

/** Stockages du nœud contenant des archives LXC (vztmpl). */
async function templateStorages(node: string) {
  try {
    const rows = await request<
      { storage: string; content?: string; active?: number; enabled?: number }[]
    >("GET", `/nodes/${node}/storage`)
    return rows
      .filter(
        (r) =>
          (r.content ?? "").split(",").includes("vztmpl") &&
          r.active !== 0 &&
          r.enabled !== 0
      )
      .map((r) => r.storage)
  } catch (primary) {
    const rows = await request<
      { storage?: string; node?: string; content?: string; status?: string }[]
    >("GET", "/cluster/resources", { type: "storage" }).catch(() => null)
    if (!rows) throw primary
    return rows
      .filter(
        (r) =>
          r.storage &&
          r.node === node &&
          r.status === "available" &&
          (r.content ?? "").split(",").includes("vztmpl")
      )
      .map((r) => r.storage as string)
  }
}

/**
 * Templates disponibles sur un nœud : templates QEMU (VM marquées "template")
 * ou archives LXC (stockages avec contenu "vztmpl").
 */
export async function listTemplates(
  node: string,
  virt: Virt
): Promise<TemplateResult> {
  const options: TemplateResult["options"] = []
  const notes: string[] = []

  if (virt === "qemu") {
    const vms = await request<
      {
        vmid: number
        name?: string
        node: string
        template?: number
        type: string
      }[]
    >("GET", "/cluster/resources", { type: "vm" })

    const onNode = vms.filter((v) => v.node === node && v.type === "qemu")
    for (const vm of onNode) {
      if (vm.template === 1) {
        options.push({
          value: String(vm.vmid),
          label: `${vm.name ?? "template"} (VMID ${vm.vmid})`,
        })
      }
    }
    notes.push(
      `${onNode.length} VM QEMU visibles sur ${node}, ${options.length} marquée(s) « template »`
    )
    if (options.length === 0) {
      notes.push(
        "Convertis une VM cloud-init en template (clic droit → Convert to template)"
      )
    }
  } else {
    const storages = await templateStorages(node)
    if (storages.length === 0) {
      notes.push(
        `Aucun stockage avec le contenu « CT Templates » sur ${node} (Datacenter → Storage)`
      )
    }

    await Promise.all(
      storages.map(async (storage) => {
        try {
          const items = await request<{ volid: string }[]>(
            "GET",
            `/nodes/${node}/storage/${storage}/content`,
            { content: "vztmpl" }
          )
          for (const it of items) {
            options.push({
              value: it.volid,
              label: it.volid.split("/").pop() ?? it.volid,
            })
          }
          notes.push(`${storage} : ${items.length} archive(s)`)
        } catch (e) {
          notes.push(`${storage} : ${errText(e)}`)
        }
      })
    )
    if (options.length === 0 && storages.length > 0) {
      notes.push("Télécharge un template : Stockage → CT Templates → Templates")
    }
  }

  options.sort((x, y) => x.label.localeCompare(y.label))
  return { options, notes }
}

export type SelectOption = { value: string; label: string }

/** Stockages actifs pouvant accueillir un disque LXC (rootdir) ou VM (images). */
export async function listStorages(
  node: string,
  virt: Virt
): Promise<SelectOption[]> {
  const content = virt === "lxc" ? "rootdir" : "images"
  const gb = (bytes?: number) =>
    bytes ? ` — ${(bytes / 1024 ** 3).toFixed(0)} Go libres` : ""

  try {
    const rows = await request<
      {
        storage: string
        type?: string
        active?: number
        enabled?: number
        avail?: number
      }[]
    >("GET", `/nodes/${node}/storage`, { content })

    return rows
      .filter((r) => r.active !== 0 && r.enabled !== 0)
      .map((r) => ({
        value: r.storage,
        label: `${r.storage}${r.type ? ` (${r.type})` : ""}${gb(r.avail)}`,
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
  } catch (primary) {
    // Repli : la vue cluster demande moins de droits que /nodes/{node}/storage.
    const rows = await request<
      {
        storage?: string
        node?: string
        content?: string
        status?: string
        maxdisk?: number
        disk?: number
      }[]
    >("GET", "/cluster/resources", { type: "storage" }).catch(() => null)
    if (!rows) throw primary

    return rows
      .filter(
        (r) =>
          r.storage &&
          r.node === node &&
          r.status === "available" &&
          (r.content ?? "").split(",").includes(content)
      )
      .map((r) => ({
        value: r.storage as string,
        label: `${r.storage}${gb(r.maxdisk && r.disk ? r.maxdisk - r.disk : undefined)}`,
      }))
      .sort((a, b) => a.value.localeCompare(b.value))
  }
}

/** Ponts réseau (Linux bridge / OVS) du nœud. */
export async function listBridges(node: string): Promise<SelectOption[]> {
  const rows = await request<{ iface: string; type: string; cidr?: string }[]>(
    "GET",
    `/nodes/${node}/network`
  )
  return rows
    .filter((r) => r.type === "bridge" || r.type === "OVSBridge")
    .map((r) => ({
      value: r.iface,
      label: r.cidr ? `${r.iface} (${r.cidr})` : r.iface,
    }))
    .sort((a, b) => a.value.localeCompare(b.value))
}

/* ───────────── Création ───────────── */

export type CreateVpsInput = {
  virt: Virt
  node: string
  storage: string
  bridge: string
  template: string
  cores: number
  memoryMb: number
  swapMb: number
  diskGb: number
  hostname: string
  password: string
  /** VMID imposé ; sinon le prochain disponible. */
  vmid?: number
  /** Configuration réseau ; absente = DHCP sur le bridge de l'offre. */
  network?: NetworkSpec
}

/** Nom d'hôte DNS valide dérivé du nom saisi par le client. */
export function toHostname(name: string) {
  const base = name
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
  return `${base || "vps"}-${randomBytes(2).toString("hex")}`
}

/** Prochain VMID libre du cluster. */
export async function nextVmid() {
  return Number(await request<string>("GET", "/cluster/nextid"))
}

/** Le VPS existe-t-il encore côté Proxmox ? (false seulement si 404/introuvable) */
export async function vpsExists(node: string, virt: Virt, vmid: number) {
  try {
    await request("GET", `/nodes/${node}/${virt}/${vmid}/config`)
    return true
  } catch (e) {
    if (e instanceof ProxmoxError && (e.status === 404 || e.status === 500)) {
      // Proxmox répond 500 « does not exist » pour un VMID absent.
      return !/does not exist|not exist|no such/i.test(e.message)
    }
    // Doute (réseau, permissions) : on considère qu'il existe, par prudence.
    return true
  }
}

export async function createVps(input: CreateVpsInput) {
  const vmid = input.vmid ?? (await nextVmid())
  const { node, virt } = input
  const net: NetworkSpec = input.network ?? { mode: "dhcp" }

  try {
    if (virt === "lxc") {
      const upid = await request<string>("POST", `/nodes/${node}/lxc`, {
        vmid,
        ostemplate: input.template,
        hostname: input.hostname,
        password: input.password,
        cores: input.cores,
        memory: input.memoryMb,
        swap: input.swapMb,
        rootfs: `${input.storage}:${input.diskGb}`,
        net0: newLxcNet0(input.bridge, net),
        ...(nameserverParam(net.dns) && {
          nameserver: nameserverParam(net.dns)!,
        }),
        unprivileged: 1,
        features: "nesting=1",
        onboot: 1,
        start: 1,
      })
      await waitTask(node, upid)
      // Autorise root en SSH (mot de passe) ; sans incidence sur la création.
      await enableRootSsh(vmid).catch(() => {})
    } else {
      const upid = await request<string>(
        "POST",
        `/nodes/${node}/qemu/${input.template}/clone`,
        {
          newid: vmid,
          name: input.hostname,
          full: 1,
          storage: input.storage,
        }
      )
      await waitTask(node, upid)

      await request("PUT", `/nodes/${node}/qemu/${vmid}/config`, {
        cores: input.cores,
        memory: input.memoryMb,
        cipassword: input.password,
        ipconfig0: qemuIpconfig0(net),
        ...(nameserverParam(net.dns) && {
          nameserver: nameserverParam(net.dns)!,
        }),
        onboot: 1,
      })

      // VLAN : on réécrit net0 du clone en conservant modèle et MAC.
      if (net.vlan) {
        const cfg = await request<Record<string, string>>(
          "GET",
          `/nodes/${node}/qemu/${vmid}/config`
        )
        if (cfg.net0) {
          await request("PUT", `/nodes/${node}/qemu/${vmid}/config`, {
            net0: withQemuVlan(cfg.net0, net.vlan),
          })
        }
      }

      // Agrandit le disque principal au volume de l'offre.
      const config = await request<Record<string, string>>(
        "GET",
        `/nodes/${node}/qemu/${vmid}/config`
      )
      const disk = Object.entries(config).find(
        ([k, v]) =>
          /^(scsi|virtio|sata|ide)\d+$/.test(k) &&
          !String(v).includes("media=cdrom") &&
          !String(v).includes("cloudinit")
      )?.[0]
      if (disk) {
        await request("PUT", `/nodes/${node}/qemu/${vmid}/resize`, {
          disk,
          size: `${input.diskGb}G`,
        }).catch(() => {
          // le disque du template est déjà plus grand : on ignore
        })
      }

      const start = await request<string>(
        "POST",
        `/nodes/${node}/qemu/${vmid}/status/start`
      )
      await waitTask(node, start, 60_000)
    }
  } catch (error) {
    // Nettoyage best effort pour ne pas laisser une VM à moitié créée.
    await removeVps(node, virt, vmid).catch(() => {})
    throw error
  }

  return { vmid, node, virt }
}

/* ───────────── Contrôle ───────────── */

export type VpsStatus = {
  state: "running" | "offline"
  cpu: number
  memoryBytes: number
  maxMemoryBytes: number
  diskBytes: number
  maxDiskBytes: number
  networkRx: number
  networkTx: number
  uptimeMs: number
}

export async function getVpsStatus(
  node: string,
  virt: Virt,
  vmid: number
): Promise<VpsStatus> {
  const s = await request<{
    status: string
    cpu?: number
    mem?: number
    maxmem?: number
    disk?: number
    maxdisk?: number
    netin?: number
    netout?: number
    uptime?: number
  }>("GET", `/nodes/${node}/${virt}/${vmid}/status/current`)

  return {
    state: s.status === "running" ? "running" : "offline",
    cpu: (s.cpu ?? 0) * 100,
    memoryBytes: s.mem ?? 0,
    maxMemoryBytes: s.maxmem ?? 0,
    diskBytes: s.disk ?? 0,
    maxDiskBytes: s.maxdisk ?? 0,
    networkRx: s.netin ?? 0,
    networkTx: s.netout ?? 0,
    uptimeMs: (s.uptime ?? 0) * 1000,
  }
}

const POWER_PATH: Record<VpsSignal, string> = {
  start: "start",
  stop: "shutdown",
  restart: "reboot",
  kill: "stop",
}

export async function powerVps(
  node: string,
  virt: Virt,
  vmid: number,
  signal: VpsSignal
) {
  await request(
    "POST",
    `/nodes/${node}/${virt}/${vmid}/status/${POWER_PATH[signal]}`
  )
}

export async function removeVps(node: string, virt: Virt, vmid: number) {
  try {
    const stop = await request<string>(
      "POST",
      `/nodes/${node}/${virt}/${vmid}/status/stop`
    ).catch(() => null)
    if (stop) await waitTask(node, stop, 60_000).catch(() => {})

    const upid = await request<string>(
      "DELETE",
      `/nodes/${node}/${virt}/${vmid}`,
      { purge: 1, "destroy-unreferenced-disks": 1 }
    )
    await waitTask(node, upid, 120_000)
  } catch (error) {
    // Déjà supprimée côté Proxmox : succès.
    if (
      error instanceof ProxmoxError &&
      /does not exist/i.test(error.message)
    ) {
      return
    }
    throw error
  }
}

export type VpsAddresses = { ipv4: string | null; ipv6: string | null }

const isLinkLocal6 = (ip: string) => /^fe[89ab][0-9a-f]:/i.test(ip)
const isLoopback = (ip: string) => ip === "::1" || ip.startsWith("127.")
const stripPrefix = (cidr: string) => cidr.split("/")[0]

/**
 * Adresses IPv4 / IPv6 (globales) du VPS : interfaces LXC ou agent QEMU, avec
 * repli sur l'IP statique de la configuration. Best effort : null si inconnue.
 */
export async function getVpsAddresses(
  node: string,
  virt: Virt,
  vmid: number,
  opts: { configFallback?: boolean } = {}
): Promise<VpsAddresses> {
  const found: VpsAddresses = { ipv4: null, ipv6: null }
  const take = (ip: string | undefined | null, family: 4 | 6) => {
    if (!ip) return
    const clean = stripPrefix(ip)
    if (isLoopback(clean)) return
    if (family === 4 && !found.ipv4) found.ipv4 = clean
    if (family === 6 && !found.ipv6 && !isLinkLocal6(clean)) found.ipv6 = clean
  }

  // 1. Adresses réellement attribuées.
  try {
    if (virt === "lxc") {
      const ifaces = await request<
        { name: string; inet?: string; inet6?: string }[]
      >("GET", `/nodes/${node}/lxc/${vmid}/interfaces`)
      for (const i of ifaces) {
        if (i.name === "lo") continue
        take(i.inet, 4)
        take(i.inet6, 6)
      }
    } else {
      const res = await request<{
        result?: {
          name: string
          "ip-addresses"?: {
            "ip-address": string
            "ip-address-type": string
          }[]
        }[]
      }>("GET", `/nodes/${node}/qemu/${vmid}/agent/network-get-interfaces`)
      for (const i of res.result ?? []) {
        if (i.name === "lo") continue
        for (const a of i["ip-addresses"] ?? []) {
          take(a["ip-address"], a["ip-address-type"] === "ipv6" ? 6 : 4)
        }
      }
    }
  } catch {
    // interface / agent indisponible : on tente la configuration statique
  }

  // 2. Repli : IP statique déclarée dans la configuration (désactivable pour
  //    ne retourner que des adresses réellement observées).
  if ((opts.configFallback ?? true) && (!found.ipv4 || !found.ipv6)) {
    try {
      const config = await request<Record<string, string>>(
        "GET",
        `/nodes/${node}/${virt}/${vmid}/config`
      )
      const line = virt === "lxc" ? config.net0 : config.ipconfig0
      const grab = (key: string) =>
        new RegExp(`(?:^|,)${key}=([^,]+)`).exec(line ?? "")?.[1]
      const v4 = grab("ip")
      const v6 = grab("ip6")
      if (v4 && !["dhcp", "manual"].includes(v4)) take(v4, 4)
      if (v6 && !["auto", "dhcp", "manual"].includes(v6)) take(v6, 6)
    } catch {
      // configuration illisible
    }
  }

  return found
}

export async function checkProxmoxConnection() {
  try {
    await request("GET", "/version")
    return null
  } catch (e) {
    return e instanceof Error ? e.message : "Erreur"
  }
}

/** Accès bas niveau pour les modules internes (audit des permissions). */
export { request as proxmoxRequest }
