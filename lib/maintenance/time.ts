/**
 * Conversion d'une date « murale » dans un fuseau IANA vers un instant UTC,
 * sans dépendance. Les dates sont stockées en UTC ; le fuseau n'est qu'un
 * contexte de saisie et d'affichage.
 */

export const TIMEZONES = [
  "Europe/Paris",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Madrid",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "America/Montreal",
  "Asia/Tokyo",
  "Asia/Singapore",
  "Australia/Sydney",
] as const

export function isValidTimezone(tz: string) {
  try {
    new Intl.DateTimeFormat("fr-FR", { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Décalage (ms) du fuseau par rapport à UTC à l'instant `ts`. */
function offsetMs(tz: string, ts: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(ts))
  const get = (t: string) =>
    Number(parts.find((p) => p.type === t)?.value ?? "0")
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second")
  )
  return asUtc - Math.floor(ts / 1000) * 1000
}

/**
 * « 2026-10-20T14:30 » interprété dans `tz` → Date UTC.
 * Retourne null si le format ou le fuseau est invalide.
 */
export function zonedToUtc(local: string, tz: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local.trim())
  if (!m || !isValidTimezone(tz)) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number)
  const wall = Date.UTC(y, mo - 1, d, h, mi)
  let utc = wall - offsetMs(tz, wall)
  // Deuxième passe : le décalage peut changer autour d'un passage à l'heure d'été.
  const second = offsetMs(tz, utc)
  utc = wall - second
  return new Date(utc)
}

/** Affichage dans un fuseau donné. */
export function formatInZone(date: Date, tz: string) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: isValidTimezone(tz) ? tz : "UTC",
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date)
}

export const formatUtc = (date: Date) =>
  `${new Intl.DateTimeFormat("fr-FR", {
    timeZone: "UTC",
    dateStyle: "short",
    timeStyle: "short",
  }).format(date)} UTC`
