/** Événements diffusés par les webhooks sortants (module pur). */
export const WEBHOOK_EVENTS = [
  { key: "user.registered", label: "Nouveau compte" },
  { key: "invoice.created", label: "Facture émise" },
  { key: "invoice.paid", label: "Facture réglée" },
  { key: "service.created", label: "Service créé (VPS, jeu)" },
  { key: "service.suspended", label: "Service suspendu" },
  { key: "service.cancelled", label: "Service annulé" },
  { key: "ticket.created", label: "Ticket ouvert" },
  { key: "quote.accepted", label: "Devis accepté" },
] as const

export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number]["key"]
export const WEBHOOK_EVENT_KEYS: string[] = WEBHOOK_EVENTS.map((e) => e.key)
