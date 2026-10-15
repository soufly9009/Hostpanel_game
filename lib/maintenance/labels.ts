/** Libellés partagés (serveur et client). */

export const MAINTENANCE_TYPE_LABEL = {
  network: "Maintenance réseau",
  hardware: "Maintenance matérielle",
  proxmox_update: "Mise à jour Proxmox",
  plesk_update: "Mise à jour Plesk",
  database: "Maintenance de base de données",
  vps_migration: "Migration de VPS",
  panel_update: "Mise à jour du panel",
  security: "Maintenance de sécurité",
  other: "Autre",
} as const
export type MaintenanceType = keyof typeof MAINTENANCE_TYPE_LABEL

export const IMPACT_LABEL = {
  none: "Aucun impact prévu",
  degraded: "Dégradation possible",
  partial: "Indisponibilité partielle",
  full: "Indisponibilité complète",
} as const
export type Impact = keyof typeof IMPACT_LABEL

export const STATUS_LABEL = {
  draft: "Brouillon",
  scheduled: "Programmée",
  in_progress: "En cours",
  completed: "Terminée",
  cancelled: "Annulée",
} as const

export const STATUS_TONE = {
  draft: "neutral",
  scheduled: "info",
  in_progress: "warning",
  completed: "success",
  cancelled: "danger",
} as const

export const IMPACT_TONE = {
  none: "neutral",
  degraded: "warning",
  partial: "warning",
  full: "danger",
} as const

export const SERVICE_LABEL = {
  vps: "VPS",
  sites: "Sites web",
  network: "Réseau",
  panel: "Panel",
} as const
export type ServiceKey = keyof typeof SERVICE_LABEL
export const SERVICE_KEYS = Object.keys(SERVICE_LABEL) as ServiceKey[]

export const INCIDENT_STATUS_LABEL = {
  investigating: "Investigation",
  identified: "Cause identifiée",
  monitoring: "Surveillance",
  resolved: "Résolu",
} as const

export const MIGRATION_KIND_LABEL = {
  database: "Migration de base de données",
  vps: "Migration de VPS",
} as const

export const MIGRATION_STATUS_LABEL = {
  draft: "Brouillon",
  scheduled: "Programmée",
  notified: "Notification envoyée",
  in_progress: "En cours",
  completed: "Terminée",
  failed: "Échouée",
  cancelled: "Annulée",
} as const

export const MIGRATION_STATUS_TONE = {
  draft: "neutral",
  scheduled: "info",
  notified: "info",
  in_progress: "warning",
  completed: "success",
  failed: "danger",
  cancelled: "neutral",
} as const

export const minutesLabel = (m: number) =>
  m < 60
    ? `${m} min`
    : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ""}`
