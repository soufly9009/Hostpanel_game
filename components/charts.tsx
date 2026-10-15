/** Mini-graphiques SVG rendus côté serveur (aucun JS client). */

export function Sparkline({
  values,
  max,
  className = "text-primary",
  height = 48,
}: {
  values: (number | null)[]
  /** Échelle haute fixe (ex. 100 pour des pourcentages) ; sinon le pic. */
  max?: number
  className?: string
  height?: number
}) {
  const pts = values.filter((v): v is number => v !== null)
  if (pts.length < 2) {
    return (
      <div
        className="flex items-center justify-center rounded-md bg-muted/40 text-xs text-muted-foreground"
        style={{ height }}
      >
        Pas assez de données
      </div>
    )
  }

  const top = max ?? Math.max(...pts, 1e-9)
  const W = 100
  const step = W / (values.length - 1)
  let line = ""
  let area = ""
  let started = false
  values.forEach((v, i) => {
    if (v === null) return
    const x = (i * step).toFixed(2)
    const y = (100 - Math.min(Math.max(v / top, 0), 1) * 100).toFixed(2)
    line += `${started ? "L" : "M"}${x},${y} `
    if (!started) area = `M${x},100 L${x},${y} `
    else area += `L${x},${y} `
    started = true
  })
  const lastX = ((values.length - 1) * step).toFixed(2)
  area += `L${lastX},100 Z`

  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="none"
      className={className}
      style={{ width: "100%", height }}
      role="img"
      aria-label="Graphique de performance"
    >
      <path d={area} fill="currentColor" opacity={0.15} />
      <path
        d={line}
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  )
}

/** Barre de progression avec valeur et limite. */
export function Gauge({
  label,
  percent,
  detail,
  warnAt = 75,
  critAt = 90,
}: {
  label: string
  percent: number
  detail?: string
  warnAt?: number
  critAt?: number
}) {
  const p = Math.min(Math.max(percent, 0), 100)
  const color =
    p >= critAt
      ? "bg-destructive"
      : p >= warnAt
        ? "bg-amber-500"
        : "bg-green-500"
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium tabular-nums">{p.toFixed(1)} %</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${p}%` }} />
      </div>
      {detail && (
        <p className="mt-1 text-xs text-muted-foreground tabular-nums">
          {detail}
        </p>
      )}
    </div>
  )
}

export function peak(values: (number | null)[]) {
  const pts = values.filter((v): v is number => v !== null)
  return pts.length ? Math.max(...pts) : null
}

export function average(values: (number | null)[]) {
  const pts = values.filter((v): v is number => v !== null)
  return pts.length ? pts.reduce((a, b) => a + b, 0) / pts.length : null
}
