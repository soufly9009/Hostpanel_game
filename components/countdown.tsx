"use client"

import { useEffect, useState } from "react"

function format(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60_000))
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mi = m % 60
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${mi} min`
  return `${mi} min`
}

/** Compte à rebours jusqu'à `to` (ISO). Rendu côté client pour éviter l'écart horloge serveur. */
export function Countdown({
  to,
  pastLabel = "à l'instant prévu",
}: {
  to: string
  pastLabel?: string
}) {
  const [now, setNow] = useState<number | null>(null)

  useEffect(() => {
    const tick = () => setNow(Date.now())
    tick()
    const t = setInterval(tick, 30_000)
    return () => clearInterval(t)
  }, [])

  if (now === null) return null
  const diff = new Date(to).getTime() - now
  return <span>{diff > 0 ? `dans ${format(diff)}` : pastLabel}</span>
}
