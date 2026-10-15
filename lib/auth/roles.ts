/**
 * Rôles et catalogue de permissions (module pur, partagé serveur/client).
 *
 * - `user`    : client.
 * - `support` : personnel support ; ses droits viennent de son rôle
 *               personnalisé (table `roles`) ou, à défaut, de DEFAULT_SUPPORT.
 * - `admin`   : toutes les permissions, toujours.
 */

export type RoleName = "user" | "support" | "admin"

export const ROLE_LABEL: Record<RoleName, string> = {
  user: "Client",
  support: "Support",
  admin: "Administrateur",
}

export type PermissionDef = {
  key: string
  label: string
  description: string
}

/** Permissions fournies par le panel : chacune est vérifiée dans le code. */
export const SYSTEM_PERMISSIONS: PermissionDef[] = [
  {
    key: "tickets.view_all",
    label: "Voir tous les tickets",
    description: "Accéder à la file complète des tickets de tous les clients.",
  },
  {
    key: "tickets.reply",
    label: "Répondre aux tickets",
    description: "Envoyer des réponses visibles par le client.",
  },
  {
    key: "tickets.internal_note",
    label: "Notes internes",
    description: "Ajouter des notes visibles uniquement du personnel.",
  },
  {
    key: "tickets.assign",
    label: "Assigner les tickets",
    description: "S'assigner un ticket ou l'assigner à un collègue.",
  },
  {
    key: "tickets.close",
    label: "Résoudre et fermer",
    description: "Changer le statut d'un ticket (résolu, fermé, rouvert).",
  },
  {
    key: "tickets.ai",
    label: "Assistant IA",
    description: "Générer des brouillons de réponse avec l'assistant IA.",
  },
  {
    key: "tickets.macros",
    label: "Gérer les réponses prédéfinies",
    description: "Créer, modifier et supprimer les réponses types du support.",
  },
  {
    key: "users.view",
    label: "Voir les clients",
    description: "Consulter le profil du client lié à un ticket.",
  },
  {
    key: "services.view",
    label: "Voir les services (lecture seule)",
    description:
      "Voir le nom et le statut des VPS et sites du client d'un ticket.",
  },
  {
    key: "wallet.view",
    label: "Voir les soldes",
    description: "Consulter le solde de crédits et l'historique des clients.",
  },
  {
    key: "wallet.adjust",
    label: "Créditer / débiter",
    description: "Ajuster manuellement le solde de crédits d'un client.",
  },
  {
    key: "coupons.manage",
    label: "Coupons et cartes cadeaux",
    description: "Créer, modifier, désactiver et supprimer coupons et cartes.",
  },
  {
    key: "billing.view",
    label: "Voir les factures",
    description:
      "Consulter les factures, avoirs et paiements de tous les clients.",
  },
  {
    key: "billing.manage",
    label: "Gérer les factures",
    description:
      "Enregistrer un paiement, émettre un avoir, créer une facture manuelle.",
  },
  {
    key: "content.manage",
    label: "Annonces et aide",
    description:
      "Créer, modifier et supprimer les annonces et les articles d'aide.",
  },
  {
    key: "legal.edit",
    label: "Modifier les documents légaux",
    description:
      "Créer des documents et modifier leurs sections (brouillon non public).",
  },
  {
    key: "legal.publish",
    label: "Publier les documents légaux",
    description:
      "Publier une nouvelle version (peut exiger une nouvelle acceptation).",
  },
  {
    key: "legal.delete",
    label: "Supprimer documents et sections",
    description: "Supprimer une section ou un document légal entier.",
  },
]

export const SYSTEM_PERMISSION_KEYS = SYSTEM_PERMISSIONS.map((p) => p.key)

/** Droits d'un membre du support sans rôle personnalisé. */
export const DEFAULT_SUPPORT: string[] = [
  "tickets.view_all",
  "tickets.reply",
  "tickets.internal_note",
  "tickets.assign",
  "tickets.close",
  "tickets.ai",
  "users.view",
  "services.view",
]

export const isStaffRole = (role: RoleName) =>
  role === "support" || role === "admin"

/** Page d'accueil de l'espace correspondant au rôle. */
export const homeFor = (role: RoleName) =>
  role === "admin" ? "/admin" : role === "support" ? "/support" : "/dashboard"

/** Forme d'une clé de permission personnalisée : « domaine.action ». */
export const PERMISSION_KEY_RE = /^[a-z][a-z0-9_]{1,24}\.[a-z][a-z0-9_]{1,30}$/
