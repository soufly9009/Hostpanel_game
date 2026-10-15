/**
 * Expurgation des secrets (module pur, sans dépendance à l'environnement).
 * Appliquée AVANT toute écriture locale ou envoi vers Discord.
 */

const MASK = "[masqué]"

/** Clés d'objet dont la valeur n'est jamais conservée. */
const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|authorization|cookie|session|api[-_]?key|private|credential|webhook|set-cookie|x-api-key/i

const PATTERNS: [RegExp, string][] = [
  // Webhooks Discord (URL entière, y compris le jeton).
  [
    /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/(?:v\d+\/)?webhooks\/[\w/.-]+/gi,
    "[webhook Discord masqué]",
  ],
  // En-têtes d'authentification.
  [/\b(authorization\s*[:=]\s*)(bearer|basic)?\s*[^\s,;"']+/gi, `$1${MASK}`],
  [/\bbearer\s+[\w.~+/=-]{8,}/gi, `Bearer ${MASK}`],
  [/\bPVEAPIToken=[^\s,;"']+/gi, `PVEAPIToken=${MASK}`],
  [/\b(x-api-key\s*[:=]\s*)[^\s,;"']+/gi, `$1${MASK}`],
  // Cookies.
  [/\b(set-cookie|cookie)\s*[:=]\s*[^\n]+/gi, `$1: ${MASK}`],
  [/\bsession=[^\s;,"']+/gi, `session=${MASK}`],
  // paire clé=valeur ou "clé":"valeur" avec nom sensible.
  [
    /(["']?\b[\w.-]*(?:pass(?:word|wd)?|secret|token|api[-_]?key|private[-_]?key)[\w.-]*\b["']?\s*[:=]\s*)(["']?)[^\s"',;}&]+\2/gi,
    `$1${MASK}`,
  ],
  // Clés privées PEM.
  [
    /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
    "[clé privée masquée]",
  ],
  // Jetons Proxmox « user@realm!id=secret » (UUID après =).
  [
    /(![\w-]+=)[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi,
    `$1${MASK}`,
  ],
  // URL avec identifiants : https://user:pass@hôte
  [/(\bhttps?:\/\/)[^\s/:@]+:[^\s/@]+@/gi, `$1${MASK}@`],
]

/** IPv4 → dernier octet masqué (on préfère les identifiants internes). */
const IPV4 = /\b(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}\b/g

export type RedactOptions = {
  /** Valeurs secrètes exactes à masquer (variables d'environnement…). */
  secrets?: string[]
  /** Masquer le dernier octet des IPv4 (défaut : oui). */
  maskIps?: boolean
  maxLength?: number
}

export function redactText(input: unknown, opts: RedactOptions = {}): string {
  let s = typeof input === "string" ? input : String(input ?? "")

  // 1. Valeurs exactes connues (les plus fiables) — du plus long au plus court.
  const secrets = (opts.secrets ?? [])
    .filter((v) => v && v.length >= 6)
    .sort((a, b) => b.length - a.length)
  for (const secret of secrets) {
    s = s.split(secret).join(MASK)
  }

  // 2. Motifs génériques.
  for (const [re, to] of PATTERNS) s = s.replace(re, to)

  if (opts.maskIps !== false) s = s.replace(IPV4, "$1.x")

  if (opts.maxLength && s.length > opts.maxLength) {
    s = `${s.slice(0, opts.maxLength - 1)}…`
  }
  return s
}

/**
 * Réduit une erreur à un message sûr : jamais de pile d'appels, jamais de
 * contenu de requête. Seules les deux premières lignes sont conservées.
 */
export function safeErrorMessage(err: unknown, opts: RedactOptions = {}) {
  const raw =
    err instanceof Error
      ? err.message
      : typeof err === "string"
        ? err
        : "Erreur inconnue"
  // Pas de pile : on coupe à la première ligne qui ressemble à « at … ».
  const lines = raw
    .split("\n")
    .filter((l) => !/^\s+at\s+/.test(l))
    .slice(0, 2)
    .join(" ")
  return redactText(lines, { ...opts, maxLength: opts.maxLength ?? 300 })
}

/** Expurge un objet de métadonnées plat : valeurs en chaînes courtes. */
export function redactMeta(
  meta: Record<string, unknown> | undefined,
  opts: RedactOptions = {}
): Record<string, string> {
  const out: Record<string, string> = {}
  if (!meta) return out
  let n = 0
  for (const [key, value] of Object.entries(meta)) {
    if (n++ >= 15) break
    if (value === undefined || value === null) continue
    const k = key.slice(0, 40)
    if (SENSITIVE_KEY.test(key)) {
      out[k] = MASK
      continue
    }
    const text =
      typeof value === "string"
        ? value
        : typeof value === "number" || typeof value === "boolean"
          ? String(value)
          : "[objet]" // pas de sérialisation d'objets arbitraires
    out[k] = redactText(text, { ...opts, maxLength: opts.maxLength ?? 200 })
  }
  return out
}

export const REDACTION_MASK = MASK
