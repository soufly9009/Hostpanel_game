import { Sparkline, average, peak } from "@/components/charts"
import { formatBytes } from "@/lib/format"
import type { Virt } from "@/lib/proxmox/client"
import { ErrorState } from "@/components/kit"
import { getVpsPerformance, type Timeframe } from "@/lib/proxmox/status"

const TF_LABEL: Record<Timeframe, string> = {
  hour: "dernière heure",
  day: "dernières 24 heures",
  week: "7 derniers jours",
  month: "30 derniers jours",
}

const rate = (v: number | null) => (v === null ? "—" : `${formatBytes(v)}/s`)
const pct = (v: number | null) => (v === null ? "—" : `${v.toFixed(1)} %`)

/** Graphiques de performances d'un VPS sur la dernière heure (rendu serveur). */
export async function VpsPerformance({
  node,
  virt,
  vmid,
  timeframe = "hour",
}: {
  node: string
  virt: Virt
  vmid: number
  timeframe?: Timeframe
}) {
  let points
  try {
    points = await getVpsPerformance(node, virt, vmid, timeframe)
  } catch (e) {
    return (
      <ErrorState
        title="Performances indisponibles"
        message={e instanceof Error ? e.message : "Erreur de collecte"}
      />
    )
  }
  if (points.length < 2) {
    return (
      <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Pas assez de données sur cette période (le VPS vient peut-être
        d&apos;être créé ou est arrêté).
      </p>
    )
  }

  const cpu = points.map((p) => (p.cpu === null ? null : p.cpu * 100))
  const mem = points.map((p) =>
    p.mem !== null && p.maxmem ? (p.mem / p.maxmem) * 100 : null
  )
  const rx = points.map((p) => p.netin)
  const tx = points.map((p) => p.netout)
  const dr = points.map((p) => p.diskread)
  const dw = points.map((p) => p.diskwrite)

  const charts = [
    {
      title: "CPU",
      s: cpu,
      max: 100,
      stat: `moy. ${pct(average(cpu))} · pic ${pct(peak(cpu))}`,
    },
    {
      title: "Mémoire",
      s: mem,
      max: 100,
      stat: `moy. ${pct(average(mem))} · pic ${pct(peak(mem))}`,
    },
    {
      title: "Réseau ↓",
      s: rx,
      stat: `moy. ${rate(average(rx))} · pic ${rate(peak(rx))}`,
    },
    {
      title: "Réseau ↑",
      s: tx,
      stat: `moy. ${rate(average(tx))} · pic ${rate(peak(tx))}`,
    },
    {
      title: "Disque lecture",
      s: dr,
      stat: `moy. ${rate(average(dr))} · pic ${rate(peak(dr))}`,
    },
    {
      title: "Disque écriture",
      s: dw,
      stat: `moy. ${rate(average(dw))} · pic ${rate(peak(dw))}`,
    },
  ]

  return (
    <section className="rounded-xl border">
      <h2 className="border-b p-4 font-medium">
        Performances{" "}
        <span className="text-xs font-normal text-muted-foreground">
          · {TF_LABEL[timeframe]}
        </span>
      </h2>
      <div className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-3">
        {charts.map((c) => (
          <div key={c.title} className="rounded-lg border p-3">
            <p className="text-sm font-medium">{c.title}</p>
            <div className="my-2">
              <Sparkline values={c.s} max={c.max} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {c.stat}
            </p>
          </div>
        ))}
      </div>
    </section>
  )
}
