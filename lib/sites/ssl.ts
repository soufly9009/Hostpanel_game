import "server-only"

import { lookup } from "node:dns/promises"
import net from "node:net"
import tls from "node:tls"

/**
 * Inspection du certificat réellement servi par un domaine (TLS sur :443).
 * Indépendant de l'API Plesk : montre ce que voient les visiteurs.
 */

export type CertState =
  | "valid"
  | "expiring"
  | "expired"
  | "untrusted"
  | "mismatch"
  | "none"
  | "unreachable"

export type CertInfo = {
  state: CertState
  issuer: string | null
  validFrom: string | null
  validTo: string | null
  daysLeft: number | null
  names: string[]
  error: string | null
}

export const EXPIRING_DAYS = 14

/** Refuse les adresses privées/locales : évite d'utiliser le site comme sonde SSRF. */
function isPublicIp(ip: string) {
  if (net.isIPv4(ip)) {
    const [a, b] = ip.split(".").map(Number)
    return !(
      a === 10 ||
      a === 127 ||
      a === 0 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
  }
  const v = ip.toLowerCase()
  return !(
    v === "::1" ||
    v === "::" ||
    v.startsWith("fe80") ||
    v.startsWith("fc") ||
    v.startsWith("fd") ||
    v.startsWith("::ffff:")
  )
}

const empty = (state: CertState, error: string | null): CertInfo => ({
  state,
  issuer: null,
  validFrom: null,
  validTo: null,
  daysLeft: null,
  names: [],
  error,
})

function handshake(host: string, ip: string, verify: boolean) {
  return new Promise<tls.PeerCertificate & { authError: string | null }>(
    (resolve, reject) => {
      const socket = tls.connect({
        host: ip,
        port: 443,
        servername: host,
        rejectUnauthorized: false,
        timeout: 8000,
      })
      socket.once("secureConnect", () => {
        const cert = socket.getPeerCertificate()
        const authError = socket.authorized
          ? null
          : String(socket.authorizationError ?? "non fiable")
        // Vérifie aussi le nom d'hôte quand la chaîne est valide.
        const idErr = verify ? tls.checkServerIdentity(host, cert) : undefined
        socket.end()
        resolve(
          Object.assign(cert, {
            authError: authError ?? (idErr ? idErr.message : null),
          })
        )
      })
      socket.once("timeout", () => {
        socket.destroy()
        reject(new Error("Délai dépassé"))
      })
      socket.once("error", (e) => reject(e))
    }
  )
}

export async function inspectCertificate(domain: string): Promise<CertInfo> {
  let ip: string
  try {
    const addrs = await lookup(domain, { all: true })
    const publicAddr = addrs.find((a) => isPublicIp(a.address))
    if (!publicAddr) {
      return empty(
        "unreachable",
        "Le domaine ne résout vers aucune adresse publique."
      )
    }
    ip = publicAddr.address
  } catch {
    return empty("unreachable", "Le domaine ne résout pas (DNS).")
  }

  try {
    const cert = await handshake(domain, ip, true)
    if (!cert || !cert.valid_to)
      return empty("none", "Aucun certificat présenté.")

    const validTo = new Date(cert.valid_to)
    const daysLeft = Math.floor((validTo.getTime() - Date.now()) / 86_400_000)
    const names = [
      ...String(cert.subjectaltname ?? "")
        .split(",")
        .map((s) => s.trim().replace(/^DNS:/, ""))
        .filter(Boolean),
    ]
    const issuerRaw = cert.issuer as unknown as
      Record<string, string> | undefined

    let state: CertState = "valid"
    let error: string | null = null
    if (daysLeft < 0) state = "expired"
    else if (cert.authError) {
      state = /hostname|altnames|identity/i.test(cert.authError)
        ? "mismatch"
        : "untrusted"
      error = cert.authError
    } else if (daysLeft <= EXPIRING_DAYS) state = "expiring"

    return {
      state,
      issuer: issuerRaw?.O ?? issuerRaw?.CN ?? null,
      validFrom: new Date(cert.valid_from).toISOString(),
      validTo: validTo.toISOString(),
      daysLeft,
      names,
      error,
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Erreur"
    return empty(
      /ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ETIMEDOUT|Délai/.test(msg)
        ? "unreachable"
        : "none",
      msg
    )
  }
}

const cache = new Map<string, { at: number; info: CertInfo }>()

/** Même résultat pendant 30 s : limite les sondes répétées. */
export async function inspectCertificateCached(domain: string) {
  const hit = cache.get(domain)
  if (hit && Date.now() - hit.at < 30_000) return hit.info
  const info = await inspectCertificate(domain)
  cache.set(domain, { at: Date.now(), info })
  if (cache.size > 500) cache.clear()
  return info
}
