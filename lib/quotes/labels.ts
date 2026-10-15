export const QUOTE_STATUS = {
  sent: { label: "En attente de réponse", tone: "info" },
  accepted: { label: "Accepté", tone: "success" },
  declined: { label: "Refusé", tone: "neutral" },
  cancelled: { label: "Annulé", tone: "neutral" },
} as const
