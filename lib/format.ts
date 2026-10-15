export function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} o`
  const units = ["Ko", "Mo", "Go", "To"]
  let value = bytes / 1024
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[i]}`
}

export function formatMb(mb: number) {
  if (mb === 0) return "Illimité"
  return mb >= 1024 ? `${+(mb / 1024).toFixed(1)} Go` : `${mb} Mo`
}

export function formatPrice(cents: number) {
  if (cents === 0) return "Gratuit"
  return `${(cents / 100).toFixed(2).replace(".", ",")} € / mois`
}

export function formatUptime(ms: number) {
  const s = Math.floor(ms / 1000)
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d} j ${h} h`
  if (h > 0) return `${h} h ${m} min`
  return `${m} min`
}
