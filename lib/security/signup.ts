import "server-only"

/**
 * Anti-abus des inscriptions : adresses jetables refusées, 5 inscriptions par
 * heure et par adresse IP (mémoire, instance unique), champ piège invisible.
 */

const DISPOSABLE = new Set([
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
  "mailinator.com",
  "guerrillamail.com",
  "guerrillamail.net",
  "sharklasers.com",
  "10minutemail.com",
  "10minutemail.net",
  "tempmail.com",
  "temp-mail.org",
  "temp-mail.io",
  "tempmailo.com",
  "trashmail.com",
  "trashmail.de",
  "getnada.com",
  "nada.email",
  "dispostable.com",
  "maildrop.cc",
  "mailnesia.com",
  "throwawaymail.com",
  "fakeinbox.com",
  "mohmal.com",
  "emailondeck.com",
  "mintemail.com",
  "spamgourmet.com",
  "jetable.org",
  "moakt.com",
  "tmpmail.org",
  "burnermail.io",
  "inboxkitten.com",
  "mailpoof.com",
  "33mail.com",
  "discard.email",
  "mail.tm",
])

export function isDisposableEmail(email: string) {
  const domain = email.split("@")[1]?.toLowerCase() ?? ""
  return [...DISPOSABLE].some((d) => domain === d || domain.endsWith(`.${d}`))
}

const g = globalThis as unknown as {
  __signupByIp?: Map<string, number[]>
}
const hits = (g.__signupByIp ??= new Map())
const WINDOW = 60 * 60_000
const MAX = 5

/** true si l'IP peut encore créer un compte (et enregistre l'essai). */
export function allowSignup(ip: string | null) {
  if (!ip) return true
  const now = Date.now()
  const recent = (hits.get(ip) ?? []).filter((t: number) => now - t < WINDOW)
  if (recent.length >= MAX) {
    hits.set(ip, recent)
    return false
  }
  recent.push(now)
  hits.set(ip, recent)
  return true
}
