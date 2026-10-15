import "server-only"

import { headers } from "next/headers"

/**
 * Informations de la requête pour l'historique de connexion. L'adresse IP est
 * TRONQUÉE (IPv4 /24, IPv6 /48) : suffisant pour reconnaître un réseau,
 * sans conserver l'adresse exacte (minimisation RGPD).
 */
export function truncateIp(ip: string | null | undefined) {
  if (!ip) return null
  const v = ip.trim().replace(/^::ffff:/, "")
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(v)) {
    return v.split(".").slice(0, 3).join(".") + ".x"
  }
  if (v.includes(":")) {
    return v.split(":").slice(0, 3).join(":") + "::/48"
  }
  return null
}

/** Résumé lisible du navigateur (« Firefox · Windows »). */
export function describeAgent(ua: string | null | undefined) {
  if (!ua) return "Appareil inconnu"
  const browser = /Edg\//.test(ua)
    ? "Edge"
    : /OPR\//.test(ua)
      ? "Opera"
      : /Firefox\//.test(ua)
        ? "Firefox"
        : /Chrome\//.test(ua)
          ? "Chrome"
          : /Safari\//.test(ua)
            ? "Safari"
            : /curl|wget|python|node/i.test(ua)
              ? "Script"
              : "Navigateur"
  const os = /Windows/.test(ua)
    ? "Windows"
    : /Android/.test(ua)
      ? "Android"
      : /iPhone|iPad/.test(ua)
        ? "iOS"
        : /Mac OS X/.test(ua)
          ? "macOS"
          : /Linux/.test(ua)
            ? "Linux"
            : ""
  return os ? `${browser} · ${os}` : browser
}

/** Adresse brute du client (en-têtes du proxy, sinon inconnue). */
export async function clientIp() {
  const h = await headers()
  return (
    h.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    h.get("x-real-ip") ||
    null
  )
}

export async function requestInfo() {
  const h = await headers()
  return {
    ipHint: truncateIp(await clientIp()),
    userAgent: h.get("user-agent")?.slice(0, 300) ?? null,
  }
}
