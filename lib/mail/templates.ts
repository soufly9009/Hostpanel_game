/**
 * Modèles d'e-mails par défaut (texte brut). L'administrateur peut les
 * modifier (Admin → E-mails) ; les variables {{nom}} sont remplacées à l'envoi.
 * Module pur, partagé serveur/client.
 */

export type TemplateDef = {
  key: string
  label: string
  variables: string[]
  subject: string
  body: string
}

export const EMAIL_TEMPLATES: TemplateDef[] = [
  {
    key: "welcome",
    label: "Bienvenue (inscription)",
    variables: ["name", "site", "panelUrl"],
    subject: "Bienvenue sur {{site}}",
    body: `Bonjour {{name}},

Ton compte {{site}} est prêt. Tu peux dès maintenant commander tes services depuis ton espace :
{{panelUrl}}

À bientôt,
L'équipe {{site}}`,
  },
  {
    key: "password_reset",
    label: "Mot de passe oublié",
    variables: ["name", "site", "resetUrl", "minutes"],
    subject: "Réinitialisation de ton mot de passe {{site}}",
    body: `Bonjour {{name}},

Une réinitialisation du mot de passe a été demandée pour ton compte. Ce lien est valable {{minutes}} minutes et ne fonctionne qu'une fois :
{{resetUrl}}

Si tu n'es pas à l'origine de cette demande, ignore cet e-mail : ton mot de passe reste inchangé.

L'équipe {{site}}`,
  },
  {
    key: "invoice_created",
    label: "Facture émise",
    variables: ["name", "site", "number", "total", "dueDate", "invoiceUrl"],
    subject: "Facture {{number}} : {{total}}",
    body: `Bonjour {{name}},

La facture {{number}} d'un montant de {{total}} est disponible. Échéance : {{dueDate}}.
{{invoiceUrl}}

L'équipe {{site}}`,
  },
  {
    key: "invoice_paid",
    label: "Paiement reçu",
    variables: ["name", "site", "number", "total", "invoiceUrl"],
    subject: "Paiement reçu : facture {{number}}",
    body: `Bonjour {{name}},

Nous avons bien reçu le paiement de {{total}} pour la facture {{number}}. Merci !
{{invoiceUrl}}

L'équipe {{site}}`,
  },
  {
    key: "invoice_reminder",
    label: "Rappel avant échéance",
    variables: ["name", "site", "number", "total", "dueDate", "invoiceUrl"],
    subject: "Rappel : facture {{number}} à régler avant le {{dueDate}}",
    body: `Bonjour {{name}},

La facture {{number}} ({{total}}) arrive à échéance le {{dueDate}}. Sans règlement, le service concerné sera suspendu.
{{invoiceUrl}}

L'équipe {{site}}`,
  },
  {
    key: "invoice_overdue",
    label: "Facture en retard",
    variables: ["name", "site", "number", "total", "dueDate", "invoiceUrl"],
    subject: "Facture {{number}} en retard de paiement",
    body: `Bonjour {{name}},

La facture {{number}} ({{total}}) était due le {{dueDate}} et reste impayée. Règle-la pour éviter la suspension ou la suppression du service.
{{invoiceUrl}}

L'équipe {{site}}`,
  },
  {
    key: "quote_sent",
    label: "Devis envoyé",
    variables: [
      "name",
      "site",
      "number",
      "title",
      "total",
      "validUntil",
      "quoteUrl",
    ],
    subject: "Devis {{number}} : {{title}}",
    body: `Bonjour {{name}},

Voici notre devis {{number}} « {{title}} » d'un montant de {{total}}, valable jusqu'au {{validUntil}}.
Tu peux l'accepter ou le refuser depuis ton espace :
{{quoteUrl}}

L'équipe {{site}}`,
  },
  {
    key: "service_suspended",
    label: "Service suspendu",
    variables: ["name", "site", "service", "reason", "panelUrl"],
    subject: "Service suspendu : {{service}}",
    body: `Bonjour {{name}},

Le service « {{service}} » a été suspendu. Motif : {{reason}}.
Renouvelle-le depuis ton espace pour le réactiver :
{{panelUrl}}

L'équipe {{site}}`,
  },
  {
    key: "ticket_reply",
    label: "Réponse à un ticket",
    variables: ["name", "site", "ticketRef", "subject", "ticketUrl"],
    subject: "[{{ticketRef}}] Nouvelle réponse : {{subject}}",
    body: `Bonjour {{name}},

Notre équipe a répondu à ton ticket {{ticketRef}} « {{subject}} ».
Consulte la réponse dans ton espace :
{{ticketUrl}}

L'équipe {{site}}`,
  },
]

export const TEMPLATE_KEYS = EMAIL_TEMPLATES.map((t) => t.key)
