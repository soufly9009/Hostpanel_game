import "server-only"

import { proxmoxRequest, type Virt } from "./client"

/** État et performances de l'infrastructure Proxmox (Sys.Audit / VM.Audit). */

export type Timeframe = "hour" | "day" | "week" | "month"
export const TIMEFRAMES: Timeframe[] = ["hour", "day", "week", "month"]

export type RrdPoint = {
  time: number
  /** Fraction d'utilisation CPU (0–1). */
  cpu: number | null
  mem: number | null
  maxmem: number | null
  netin: number | null
  netout: number | null
  iowait: number | null
  loadavg: number | null
  diskread: number | null
  diskwrite: number | null
}

type RawRrd = Partial<
  Record<
    | "time"
    | "cpu"
    | "memused"
    | "mem"
    | "memtotal"
    | "maxmem"
    | "netin"
    | "netout"
    | "iowait"
    | "loadavg"
    | "diskread"
    | "diskwrite",
    number | null
  >
>

const num = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? v : null

function normalizeRrd(rows: RawRrd[]): RrdPoint[] {
  return rows
    .filter((r) => typeof r.time === "number")
    .map((r) => ({
      time: r.time as number,
      cpu: num(r.cpu),
      // Nœuds : memused/memtotal ; VM : mem/maxmem.
      mem: num(r.memused ?? r.mem),
      maxmem: num(r.memtotal ?? r.maxmem),
      netin: num(r.netin),
      netout: num(r.netout),
      iowait: num(r.iowait),
      loadavg: num(r.loadavg),
      diskread: num(r.diskread),
      diskwrite: num(r.diskwrite),
    }))
}

export type StorageStatus = {
  storage: string
  type: string
  content: string
  used: number
  total: number
  active: boolean
  shared: boolean
}

export type NodeStatus = {
  node: string
  online: boolean
  error: string | null
  uptime: number
  cpuPercent: number
  /** Threads logiques disponibles (maximum de CPU). */
  cpuThreads: number
  cpuModel: string | null
  sockets: number | null
  cores: number | null
  mhz: number | null
  memUsed: number
  memTotal: number
  swapUsed: number
  swapTotal: number
  rootUsed: number
  rootTotal: number
  load: [number, number, number] | null
  ioDelayPercent: number
  pveVersion: string | null
  kernel: string | null
  rrd: RrdPoint[]
  storages: StorageStatus[]
}

export type TopVm = {
  vmid: number
  name: string
  type: string
  node: string
  status: string
  cpuPercent: number
  mem: number
  maxmem: number
}

export type Infrastructure = {
  nodes: NodeStatus[]
  vms: {
    total: number
    running: number
    lxc: number
    qemu: number
    top: TopVm[]
  }
}

const errText = (e: unknown) => (e instanceof Error ? e.message : "Erreur")

async function nodeStatus(
  name: string,
  listed: { status?: string; maxcpu?: number } | undefined,
  tf: Timeframe
): Promise<NodeStatus> {
  const empty: NodeStatus = {
    node: name,
    online: listed?.status === "online",
    error: null,
    uptime: 0,
    cpuPercent: 0,
    cpuThreads: listed?.maxcpu ?? 0,
    cpuModel: null,
    sockets: null,
    cores: null,
    mhz: null,
    memUsed: 0,
    memTotal: 0,
    swapUsed: 0,
    swapTotal: 0,
    rootUsed: 0,
    rootTotal: 0,
    load: null,
    ioDelayPercent: 0,
    pveVersion: null,
    kernel: null,
    rrd: [],
    storages: [],
  }
  if (!empty.online) return { ...empty, error: "Nœud hors ligne" }

  const [status, rrd, storages] = await Promise.allSettled([
    proxmoxRequest<{
      cpu?: number
      uptime?: number
      wait?: number
      loadavg?: string[]
      kversion?: string
      pveversion?: string
      cpuinfo?: {
        cpus?: number
        cores?: number
        sockets?: number
        model?: string
        mhz?: string
      }
      memory?: { total?: number; used?: number }
      swap?: { total?: number; used?: number }
      rootfs?: { total?: number; used?: number }
    }>("GET", `/nodes/${name}/status`),
    proxmoxRequest<RawRrd[]>("GET", `/nodes/${name}/rrddata`, {
      timeframe: tf,
      cf: "AVERAGE",
    }),
    proxmoxRequest<
      {
        storage: string
        type?: string
        content?: string
        used?: number
        total?: number
        active?: number
        shared?: number
      }[]
    >("GET", `/nodes/${name}/storage`),
  ])

  const out = { ...empty }
  if (status.status === "fulfilled") {
    const s = status.value
    out.uptime = s.uptime ?? 0
    out.cpuPercent = (s.cpu ?? 0) * 100
    out.cpuThreads = s.cpuinfo?.cpus ?? out.cpuThreads
    out.cpuModel = s.cpuinfo?.model ?? null
    out.sockets = s.cpuinfo?.sockets ?? null
    out.cores = s.cpuinfo?.cores ?? null
    out.mhz = s.cpuinfo?.mhz ? Math.round(Number(s.cpuinfo.mhz)) : null
    out.memUsed = s.memory?.used ?? 0
    out.memTotal = s.memory?.total ?? 0
    out.swapUsed = s.swap?.used ?? 0
    out.swapTotal = s.swap?.total ?? 0
    out.rootUsed = s.rootfs?.used ?? 0
    out.rootTotal = s.rootfs?.total ?? 0
    out.ioDelayPercent = (s.wait ?? 0) * 100
    out.pveVersion = s.pveversion ?? null
    out.kernel = s.kversion ?? null
    const l = (s.loadavg ?? []).map(Number)
    out.load =
      l.length === 3 && l.every(Number.isFinite) ? [l[0], l[1], l[2]] : null
  } else {
    out.error = errText(status.reason)
  }
  if (rrd.status === "fulfilled") out.rrd = normalizeRrd(rrd.value)
  if (storages.status === "fulfilled") {
    out.storages = storages.value
      .map((s) => ({
        storage: s.storage,
        type: s.type ?? "?",
        content: s.content ?? "",
        used: s.used ?? 0,
        total: s.total ?? 0,
        active: s.active !== 0,
        shared: Boolean(s.shared),
      }))
      .sort((a, b) => a.storage.localeCompare(b.storage))
  }
  return out
}

export async function getInfrastructure(
  tf: Timeframe = "hour"
): Promise<Infrastructure> {
  const [nodes, resources] = await Promise.all([
    proxmoxRequest<{ node: string; status?: string; maxcpu?: number }[]>(
      "GET",
      "/nodes"
    ),
    proxmoxRequest<
      {
        vmid?: number
        name?: string
        type: string
        node?: string
        status?: string
        cpu?: number
        mem?: number
        maxmem?: number
        template?: number
      }[]
    >("GET", "/cluster/resources", { type: "vm" }).catch(() => []),
  ])

  const nodeStatuses = await Promise.all(
    nodes.map((n) => nodeStatus(n.node, n, tf))
  )

  const vms = resources.filter((r) => r.template !== 1)
  return {
    nodes: nodeStatuses.sort((a, b) => a.node.localeCompare(b.node)),
    vms: {
      total: vms.length,
      running: vms.filter((v) => v.status === "running").length,
      lxc: vms.filter((v) => v.type === "lxc").length,
      qemu: vms.filter((v) => v.type === "qemu").length,
      top: vms
        .filter((v) => v.status === "running" && v.vmid != null)
        .map((v) => ({
          vmid: v.vmid as number,
          name: v.name ?? `VM ${v.vmid}`,
          type: v.type,
          node: v.node ?? "?",
          status: v.status ?? "?",
          cpuPercent: (v.cpu ?? 0) * 100,
          mem: v.mem ?? 0,
          maxmem: v.maxmem ?? 0,
        }))
        .sort((a, b) => b.cpuPercent - a.cpuPercent)
        .slice(0, 5),
    },
  }
}

/** Historique de performances d'un VPS (CPU, RAM, réseau, disque). */
export async function getVpsPerformance(
  node: string,
  virt: Virt,
  vmid: number,
  tf: Timeframe = "hour"
): Promise<RrdPoint[]> {
  const rows = await proxmoxRequest<RawRrd[]>(
    "GET",
    `/nodes/${node}/${virt}/${vmid}/rrddata`,
    { timeframe: tf, cf: "AVERAGE" }
  )
  return normalizeRrd(rows)
}
