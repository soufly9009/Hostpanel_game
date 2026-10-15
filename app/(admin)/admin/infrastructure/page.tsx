import Link from "next/link"

import { AutoRefresh } from "@/components/auto-refresh"
import { Gauge, Sparkline, average, peak } from "@/components/charts"
import { proxmoxConfigured } from "@/lib/env"
import { formatBytes, formatUptime } from "@/lib/format"
import {
  getInfrastructure,
  TIMEFRAMES,
  type Infrastructure,
  type NodeStatus,
  type Timeframe,
} from "@/lib/proxmox/status"

export const metadata = { title: "Infrastructure" }
export const dynamic = "force-dynamic"

const TF_LABEL: Record<Timeframe, string> = {
  hour: "1 heure",
  day: "24 heures",
  week: "7 jours",
  month: "30 jours",
}

const pct = (used: number, total: number) =>
  total > 0 ? (used / total) * 100 : 0
const fmt = (v: number | null, unit = "", digits = 1) =>
  v === null ? "—" : `${v.toFixed(digits)}${unit}`

export default async function InfrastructurePage({
  searchParams,
}: {
  searchParams: Promise<{ tf?: string }>
}) {
  const { tf: rawTf } = await searchParams
  const tf: Timeframe = TIMEFRAMES.includes(rawTf as Timeframe)
    ? (rawTf as Timeframe)
    : "hour"

  if (!proxmoxConfigured) {
    return (
      <>
        <h1 className="text-xl font-semibold">Infrastructure</h1>
        <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          Proxmox n&apos;est pas configuré (PROXMOX_URL, PROXMOX_TOKEN_ID,
          PROXMOX_TOKEN_SECRET).
        </p>
      </>
    )
  }

  let infra: Infrastructure
  try {
    infra = await getInfrastructure(tf)
  } catch (e) {
    return (
      <>
        <h1 className="text-xl font-semibold">Infrastructure</h1>
        <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          {e instanceof Error ? e.message : "Proxmox injoignable"}
        </p>
      </>
    )
  }

  return (
    <>
      <AutoRefresh seconds={15} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Infrastructure</h1>
          <p className="text-sm text-muted-foreground">
            État et performances de Proxmox · actualisé toutes les 15 s
          </p>
        </div>
        <nav className="flex gap-1 rounded-lg border p-1 text-sm">
          {TIMEFRAMES.map((t) => (
            <Link
              key={t}
              href={`/admin/infrastructure?tf=${t}`}
              className={`rounded-md px-3 py-1 ${
                t === tf
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted"
              }`}
            >
              {TF_LABEL[t]}
            </Link>
          ))}
        </nav>
      </div>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Summary
          label="Nœuds"
          value={`${infra.nodes.filter((n) => n.online).length} / ${infra.nodes.length} en ligne`}
        />
        <Summary
          label="Machines"
          value={`${infra.vms.running} / ${infra.vms.total} démarrées`}
        />
        <Summary label="Conteneurs LXC" value={String(infra.vms.lxc)} />
        <Summary label="Machines virtuelles" value={String(infra.vms.qemu)} />
      </dl>

      {infra.nodes.map((n) => (
        <NodeCard key={n.node} node={n} tf={tf} />
      ))}

      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">
          Plus gros consommateurs CPU
        </h2>
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Machine</th>
              <th className="p-3 font-medium">Nœud</th>
              <th className="p-3 font-medium">CPU</th>
              <th className="p-3 font-medium">Mémoire</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {infra.vms.top.map((v) => (
              <tr key={v.vmid}>
                <td className="p-3">
                  <span className="font-medium">{v.name}</span>{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {v.type}/{v.vmid}
                  </span>
                </td>
                <td className="p-3">{v.node}</td>
                <td className="p-3 tabular-nums">
                  {v.cpuPercent.toFixed(1)} %
                </td>
                <td className="p-3 tabular-nums">
                  {formatBytes(v.mem)} / {formatBytes(v.maxmem)}
                </td>
              </tr>
            ))}
            {infra.vms.top.length === 0 && (
              <tr>
                <td
                  colSpan={4}
                  className="p-4 text-center text-muted-foreground"
                >
                  Aucune machine démarrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border p-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="mt-1 text-xl font-semibold">{value}</dd>
    </div>
  )
}

function NodeCard({ node: n, tf }: { node: NodeStatus; tf: Timeframe }) {
  const cpuSeries = n.rrd.map((p) => (p.cpu === null ? null : p.cpu * 100))
  const memSeries = n.rrd.map((p) =>
    p.mem !== null && p.maxmem ? (p.mem / p.maxmem) * 100 : null
  )
  const rxSeries = n.rrd.map((p) => p.netin)
  const txSeries = n.rrd.map((p) => p.netout)
  const ioSeries = n.rrd.map((p) => (p.iowait === null ? null : p.iowait * 100))
  const loadSeries = n.rrd.map((p) => p.loadavg)

  return (
    <section className="rounded-xl border">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h2 className="font-medium">{n.node}</h2>
        <span
          className={`rounded-md px-2 py-0.5 text-xs font-medium ${
            n.online
              ? "bg-green-500/10 text-green-600"
              : "bg-destructive/10 text-destructive"
          }`}
        >
          {n.online ? "En ligne" : "Hors ligne"}
        </span>
        {n.online && (
          <span className="text-xs text-muted-foreground">
            disponible depuis {formatUptime(n.uptime * 1000)}
            {n.pveVersion ? ` · ${n.pveVersion}` : ""}
            {n.kernel ? ` · noyau ${n.kernel.split(" ")[1] ?? n.kernel}` : ""}
          </span>
        )}
      </header>

      {n.error && <p className="p-4 text-sm text-destructive">{n.error}</p>}

      {n.online && !n.error && (
        <div className="flex flex-col gap-6 p-4">
          <p className="text-sm text-muted-foreground">
            <strong className="text-foreground">{n.cpuThreads} threads</strong>{" "}
            CPU
            {n.sockets && n.cores
              ? ` (${n.sockets} socket${n.sockets > 1 ? "s" : ""} × ${n.cores} cœurs)`
              : ""}
            {n.cpuModel ? ` · ${n.cpuModel}` : ""}
            {n.mhz ? ` · ${n.mhz} MHz` : ""}
            {" · "}
            <strong className="text-foreground">
              {formatBytes(n.memTotal)}
            </strong>{" "}
            de RAM
          </p>

          <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
            <Gauge
              label="CPU"
              percent={n.cpuPercent}
              detail={`max ${n.cpuThreads} threads · ${((n.cpuPercent / 100) * n.cpuThreads).toFixed(1)} utilisés`}
            />
            <Gauge
              label="Mémoire"
              percent={pct(n.memUsed, n.memTotal)}
              detail={`${formatBytes(n.memUsed)} / ${formatBytes(n.memTotal)}`}
            />
            <Gauge
              label="Swap"
              percent={pct(n.swapUsed, n.swapTotal)}
              detail={
                n.swapTotal
                  ? `${formatBytes(n.swapUsed)} / ${formatBytes(n.swapTotal)}`
                  : "aucun swap"
              }
              warnAt={30}
              critAt={60}
            />
            <Gauge
              label="Disque système"
              percent={pct(n.rootUsed, n.rootTotal)}
              detail={`${formatBytes(n.rootUsed)} / ${formatBytes(n.rootTotal)}`}
            />
          </div>

          <dl className="grid gap-4 text-sm sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">
                Charge moyenne (1 / 5 / 15 min)
              </dt>
              <dd className="font-mono">
                {n.load ? n.load.map((l) => l.toFixed(2)).join(" / ") : "—"}
                {n.load && n.cpuThreads > 0 && (
                  <span className="ml-2 text-xs text-muted-foreground">
                    ({((n.load[0] / n.cpuThreads) * 100).toFixed(0)} % de la
                    capacité)
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Attente disque (I/O delay)
              </dt>
              <dd className="font-mono">{n.ioDelayPercent.toFixed(2)} %</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Stockages</dt>
              <dd className="font-mono">{n.storages.length}</dd>
            </div>
          </dl>

          <div>
            <h3 className="mb-3 text-sm font-medium">
              Performances — {TF_LABEL[tf]}
            </h3>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <Chart
                title="CPU"
                series={cpuSeries}
                max={100}
                stats={`moy. ${fmt(average(cpuSeries), " %")} · pic ${fmt(peak(cpuSeries), " %")}`}
              />
              <Chart
                title="Mémoire"
                series={memSeries}
                max={100}
                stats={`moy. ${fmt(average(memSeries), " %")} · pic ${fmt(peak(memSeries), " %")}`}
              />
              <Chart
                title="Charge"
                series={loadSeries}
                stats={`moy. ${fmt(average(loadSeries), "", 2)} · pic ${fmt(peak(loadSeries), "", 2)}`}
              />
              <Chart
                title="Réseau ↓ (entrant)"
                series={rxSeries}
                stats={`moy. ${bytesRate(average(rxSeries))} · pic ${bytesRate(peak(rxSeries))}`}
              />
              <Chart
                title="Réseau ↑ (sortant)"
                series={txSeries}
                stats={`moy. ${bytesRate(average(txSeries))} · pic ${bytesRate(peak(txSeries))}`}
              />
              <Chart
                title="Attente disque (I/O delay)"
                series={ioSeries}
                stats={`moy. ${fmt(average(ioSeries), " %", 2)} · pic ${fmt(peak(ioSeries), " %", 2)}`}
              />
            </div>
          </div>

          {n.storages.length > 0 && (
            <div>
              <h3 className="mb-3 text-sm font-medium">Stockages</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {n.storages.map((s) => (
                  <Gauge
                    key={s.storage}
                    label={`${s.storage} (${s.type})${s.active ? "" : " — inactif"}`}
                    percent={pct(s.used, s.total)}
                    detail={`${formatBytes(s.used)} / ${formatBytes(s.total)}${
                      s.content ? ` · ${s.content}` : ""
                    }`}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

const bytesRate = (v: number | null) =>
  v === null ? "—" : `${formatBytes(v)}/s`

function Chart({
  title,
  series,
  max,
  stats,
}: {
  title: string
  series: (number | null)[]
  max?: number
  stats: string
}) {
  return (
    <div className="rounded-lg border p-3">
      <p className="text-sm font-medium">{title}</p>
      <div className="my-2">
        <Sparkline values={series} max={max} />
      </div>
      <p className="text-xs text-muted-foreground tabular-nums">{stats}</p>
    </div>
  )
}
