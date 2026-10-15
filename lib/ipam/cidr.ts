/**
 * Calculs d'adresses IPv4 / IPv6 en BigInt (sans dépendance).
 * Module pur : utilisable côté serveur comme dans les tests.
 */

export type Family = "ipv4" | "ipv6"

export type ParsedIp = { family: Family; value: bigint }

const V4_BITS = 32
const V6_BITS = 128

const bitsOf = (f: Family) => (f === "ipv4" ? V4_BITS : V6_BITS)

export function parseIp(input: string): ParsedIp | null {
  const s = input.trim()
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const parts = s.split(".").map(Number)
    if (parts.some((p) => p > 255)) return null
    // Zéros non significatifs refusés (ambiguïté octal).
    if (s.split(".").some((p) => p.length > 1 && p.startsWith("0"))) return null
    return {
      family: "ipv4",
      value: parts.reduce((acc, p) => (acc << 8n) | BigInt(p), 0n),
    }
  }
  if (!s.includes(":") || !/^[0-9a-fA-F:]+$/.test(s)) return null
  const halves = s.split("::")
  if (halves.length > 2) return null
  const toGroups = (h: string) => (h === "" ? [] : h.split(":"))
  const head = toGroups(halves[0])
  const tail = halves.length === 2 ? toGroups(halves[1]) : []
  if (halves.length === 1 && head.length !== 8) return null
  if (halves.length === 2 && head.length + tail.length > 7) return null
  const groups = [
    ...head,
    ...Array(halves.length === 2 ? 8 - head.length - tail.length : 0).fill("0"),
    ...tail,
  ]
  if (groups.length !== 8) return null
  let value = 0n
  for (const g of groups) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    value = (value << 16n) | BigInt(Number.parseInt(g, 16))
  }
  return { family: "ipv6", value }
}

export function formatIp(value: bigint, family: Family): string {
  if (family === "ipv4") {
    return [24n, 16n, 8n, 0n]
      .map((shift) => Number((value >> shift) & 0xffn))
      .join(".")
  }
  const groups: number[] = []
  for (let i = 7; i >= 0; i--) {
    groups.push(Number((value >> BigInt(i * 16)) & 0xffffn))
  }
  // Plus longue suite de zéros (≥ 2) compressée en « :: ».
  let bestStart = -1
  let bestLen = 0
  for (let i = 0; i < 8;) {
    if (groups[i] !== 0) {
      i++
      continue
    }
    let j = i
    while (j < 8 && groups[j] === 0) j++
    if (j - i > bestLen) {
      bestStart = i
      bestLen = j - i
    }
    i = j
  }
  const hex = groups.map((g) => g.toString(16))
  if (bestLen < 2) return hex.join(":")
  const left = hex.slice(0, bestStart).join(":")
  const right = hex.slice(bestStart + bestLen).join(":")
  return `${left}::${right}`
}

/** Forme canonique d'une adresse, ou null si invalide. */
export function canonicalIp(input: string): string | null {
  const p = parseIp(input)
  return p ? formatIp(p.value, p.family) : null
}

export type Cidr = {
  family: Family
  /** Adresse réseau (bits hôte à zéro). */
  network: bigint
  prefix: number
  /** Dernière adresse du bloc (broadcast en IPv4). */
  last: bigint
}

const mask = (family: Family, prefix: number) => {
  const bits = bitsOf(family)
  const hostBits = BigInt(bits - prefix)
  return ((1n << BigInt(bits)) - 1n) ^ ((1n << hostBits) - 1n)
}

export type CidrResult =
  { ok: true; cidr: Cidr; canonical: string } | { ok: false; error: string }

/**
 * Valide un CIDR « réseau/préfixe ». L'adresse doit être celle du réseau
 * (bits hôte à zéro) : un CIDR ambigu est refusé plutôt que corrigé en silence.
 */
export function parseCidr(input: string): CidrResult {
  const [addr, pfx, ...rest] = input.trim().split("/")
  if (rest.length > 0 || pfx === undefined || !/^\d{1,3}$/.test(pfx)) {
    return { ok: false, error: "Format attendu : adresse/préfixe" }
  }
  const ip = parseIp(addr)
  if (!ip) return { ok: false, error: "Adresse invalide" }
  const prefix = Number(pfx)
  const bits = bitsOf(ip.family)
  if (prefix > bits) {
    return { ok: false, error: `Préfixe invalide (0 à ${bits})` }
  }
  // Limites de bon sens pour un réseau géré.
  if (ip.family === "ipv4" && (prefix < 8 || prefix > 30)) {
    return { ok: false, error: "IPv4 : préfixe entre /8 et /30" }
  }
  if (ip.family === "ipv6" && (prefix < 32 || prefix > 126)) {
    return { ok: false, error: "IPv6 : préfixe entre /32 et /126" }
  }
  const m = mask(ip.family, prefix)
  const network = ip.value & m
  if (network !== ip.value) {
    return {
      ok: false,
      error: `Ce n'est pas une adresse réseau (attendu ${formatIp(network, ip.family)}/${prefix})`,
    }
  }
  const last = network | (~m & ((1n << BigInt(bits)) - 1n))
  return {
    ok: true,
    cidr: { family: ip.family, network, prefix, last },
    canonical: `${formatIp(network, ip.family)}/${prefix}`,
  }
}

export const inCidr = (c: Cidr, ip: ParsedIp) =>
  ip.family === c.family && ip.value >= c.network && ip.value <= c.last

export const overlaps = (a: Cidr, b: Cidr) =>
  a.family === b.family && a.network <= b.last && b.network <= a.last

/** Première et dernière adresse attribuable (hors réseau et broadcast IPv4). */
export function usableBounds(c: Cidr): { first: bigint; last: bigint } {
  if (c.family === "ipv4") {
    return { first: c.network + 1n, last: c.last - 1n }
  }
  // IPv6 : l'adresse « subnet-router anycast » (::0 du bloc) reste réservée.
  return { first: c.network + 1n, last: c.last }
}

export type NetworkValidation =
  | { ok: true; gateway: string | null; start: string; end: string }
  | { ok: false; error: string }

/** Valide passerelle et plage utilisable d'un réseau. */
export function validateNetwork(
  c: Cidr,
  opts: {
    gateway?: string | null
    rangeStart?: string | null
    rangeEnd?: string | null
  }
): NetworkValidation {
  const b = usableBounds(c)

  let gateway: string | null = null
  if (opts.gateway) {
    const g = parseIp(opts.gateway)
    if (!g) return { ok: false, error: "Passerelle invalide" }
    if (g.family !== c.family) {
      return { ok: false, error: "La passerelle n'est pas de la même famille" }
    }
    if (!inCidr(c, g)) {
      return { ok: false, error: "La passerelle n'est pas dans le sous-réseau" }
    }
    if (g.value < b.first || g.value > b.last) {
      return {
        ok: false,
        error:
          c.family === "ipv4"
            ? "La passerelle ne peut pas être l'adresse réseau ou broadcast"
            : "La passerelle ne peut pas être l'adresse du sous-réseau",
      }
    }
    gateway = formatIp(g.value, g.family)
  }

  let start = b.first
  let end = b.last
  if (opts.rangeStart) {
    const p = parseIp(opts.rangeStart)
    if (!p || !inCidr(c, p)) {
      return { ok: false, error: "Début de plage invalide ou hors réseau" }
    }
    start = p.value
  }
  if (opts.rangeEnd) {
    const p = parseIp(opts.rangeEnd)
    if (!p || !inCidr(c, p)) {
      return { ok: false, error: "Fin de plage invalide ou hors réseau" }
    }
    end = p.value
  }
  if (start < b.first || end > b.last) {
    return {
      ok: false,
      error: "La plage inclut l'adresse réseau ou broadcast",
    }
  }
  if (start > end) return { ok: false, error: "Plage inversée" }

  return {
    ok: true,
    gateway,
    start: formatIp(start, c.family),
    end: formatIp(end, c.family),
  }
}

/** Nombre d'adresses d'une plage (BigInt, peut être énorme en IPv6). */
export const rangeSize = (start: bigint, end: bigint) => end - start + 1n

/** Énumère les adresses d'une plage, en s'arrêtant à `limit`. */
export function* enumerate(
  family: Family,
  start: bigint,
  end: bigint,
  limit: number
) {
  let n = 0
  for (let v = start; v <= end && n < limit; v++, n++) {
    yield formatIp(v, family)
  }
}

export const prefixOf = (cidr: string) => Number(cidr.split("/")[1])
