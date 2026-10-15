/** Construction des embeds Discord (module pur, limites Discord respectées). */

export type Level = "info" | "success" | "warning" | "error" | "critical"

export const LEVEL_LABEL: Record<Level, string> = {
  info: "INFO",
  success: "SUCCÈS",
  warning: "ATTENTION",
  error: "ERREUR",
  critical: "CRITIQUE",
}

export const LEVEL_COLOR: Record<Level, number> = {
  info: 0x5865f2,
  success: 0x2ecc71,
  warning: 0xf1c40f,
  error: 0xe74c3c,
  critical: 0x9b0000,
}

/** Ordre de gravité (pour les filtres « niveau minimal »). */
export const LEVEL_RANK: Record<Level, number> = {
  info: 0,
  success: 0,
  warning: 1,
  error: 2,
  critical: 3,
}

export const CATEGORY_LABEL: Record<string, string> = {
  proxmox: "Proxmox",
  plesk: "Plesk",
  vps: "VPS",
  provisioning: "Provisionnement",
  renewals: "Renouvellements",
  firewall: "Pare-feu",
  ssh: "Terminal SSH",
  files: "Fichiers",
  maintenance: "Maintenance",
  migration: "Migrations",
  database: "Base de données",
  scheduler: "Tâches planifiées",
  security: "Sécurité",
  support: "Support",
  app: "Application",
  system: "Système",
}

export const RESULT_LABEL = {
  success: "réussi",
  failure: "échec",
  info: "—",
} as const

// Limites de l'API Discord.
const LIMITS = {
  title: 256,
  description: 4096,
  fieldName: 256,
  fieldValue: 1024,
  fields: 25,
  footer: 2048,
  total: 6000,
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s

export type EmbedInput = {
  level: Level
  category: string
  title: string
  message?: string | null
  service?: string | null
  action?: string | null
  result?: "success" | "failure" | "info"
  correlationId?: string | null
  occurrences?: number
  meta?: Record<string, string> | null
  createdAt: Date
  /** Lien vers le panel (https, déjà validé) ; absent = aucun lien. */
  url?: string | null
}

export function buildEmbed(e: EmbedInput) {
  const fields: { name: string; value: string; inline?: boolean }[] = []
  const add = (
    name: string,
    value: string | null | undefined,
    inline = true
  ) => {
    if (!value) return
    if (fields.length >= LIMITS.fields) return
    fields.push({
      name: clip(name, LIMITS.fieldName),
      value: clip(value, LIMITS.fieldValue),
      inline,
    })
  }

  add("Gravité", LEVEL_LABEL[e.level])
  add("Catégorie", CATEGORY_LABEL[e.category] ?? e.category)
  add("Service", e.service)
  add("Action", e.action)
  if (e.result && e.result !== "info") add("Résultat", RESULT_LABEL[e.result])
  add("Heure (UTC)", e.createdAt.toISOString().replace("T", " ").slice(0, 19))
  add("Référence", e.correlationId ? `\`${e.correlationId}\`` : null)
  if ((e.occurrences ?? 1) > 1) add("Occurrences", `${e.occurrences}`)
  for (const [k, v] of Object.entries(e.meta ?? {})) add(k, v)

  const embed = {
    title: clip(e.title, LIMITS.title),
    description: e.message ? clip(e.message, LIMITS.description) : undefined,
    color: LEVEL_COLOR[e.level],
    fields,
    timestamp: e.createdAt.toISOString(),
    footer: { text: clip("Panel d'hébergement", LIMITS.footer) },
    ...(e.url ? { url: e.url } : {}),
  }

  // Total des caractères : on tronque la description si nécessaire.
  const size = () =>
    embed.title.length +
    (embed.description?.length ?? 0) +
    embed.footer.text.length +
    fields.reduce((n, f) => n + f.name.length + f.value.length, 0)
  while (size() > LIMITS.total && fields.length > 6) fields.pop()
  if (size() > LIMITS.total && embed.description) {
    const over = size() - LIMITS.total
    embed.description = clip(
      embed.description,
      Math.max(0, embed.description.length - over - 1)
    )
  }
  return embed
}

/** Payload complet : mentions désactivées en toutes circonstances. */
export function buildPayload(e: EmbedInput) {
  return {
    username: "Panel · supervision",
    embeds: [buildEmbed(e)],
    // Aucune mention (@everyone, rôles, utilisateurs) ne peut être déclenchée.
    allowed_mentions: { parse: [] as [] },
  }
}
