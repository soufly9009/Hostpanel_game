import { daysUntil, isPast } from "@/lib/expiry"

export type ServiceTone = "success" | "warning" | "danger" | "neutral"

/** Statut d'un VPS déduit de la base (l'état live est chargé sur la page du VPS). */
export function serverStatus(s: {
  suspended: boolean
  suspendReason: "expired" | "admin" | null
  expiresAt: Date | null
}): { label: string; tone: ServiceTone } {
  if (s.suspended) {
    return {
      label: s.suspendReason === "expired" ? "Expiré" : "Suspendu",
      tone: "danger",
    }
  }
  if (s.expiresAt) {
    if (isPast(s.expiresAt))
      return { label: "Échéance dépassée", tone: "danger" }
    const days = daysUntil(s.expiresAt)
    if (days <= 3) {
      return { label: `Expire dans ${Math.max(days, 0)} j`, tone: "warning" }
    }
  }
  return { label: "Actif", tone: "success" }
}
