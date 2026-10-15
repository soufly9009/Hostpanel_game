/** Libellés partagés (serveur et client). */

export const STATUS_LABEL = {
  open: "Ouvert",
  pending: "En attente du client",
  resolved: "Résolu",
  closed: "Fermé",
} as const

export const STATUS_TONE = {
  open: "info",
  pending: "warning",
  resolved: "success",
  closed: "neutral",
} as const

export const PRIORITY_LABEL = {
  low: "Basse",
  normal: "Normale",
  high: "Haute",
  urgent: "Urgente",
} as const

export const PRIORITY_TONE = {
  low: "neutral",
  normal: "neutral",
  high: "warning",
  urgent: "danger",
} as const

export const CATEGORY_LABEL = {
  vps: "VPS",
  site: "Site web",
  billing: "Facturation",
  network: "Réseau",
  account: "Compte",
  other: "Autre",
} as const

export const ticketRef = (n: number) => `T-${String(n).padStart(4, "0")}`

export const MAX_BODY = 4000
export const MAX_SUBJECT = 120
