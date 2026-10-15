/**
 * Variables proposées par l'assistant d'installation (module pur, partagé
 * serveur/client). `secret` : jamais réaffiché, champ vide = inchangé.
 */

export type EnvField = {
  key: string
  label: string
  group: string
  help?: string
  placeholder?: string
  secret?: boolean
  kind?: "text" | "bool" | "number"
  /** Bouton « Générer » : préfixe éventuel de la valeur aléatoire. */
  generate?: { prefix?: string; length: number }
  /** Champ attendu pour un premier démarrage. */
  recommended?: boolean
}

export const ENV_FIELDS: EnvField[] = [
  {
    key: "SITE_NAME",
    label: "Nom du site",
    group: "Général",
    placeholder: "VPSHost",
    recommended: true,
  },
  {
    key: "PANEL_PUBLIC_URL",
    label: "URL publique (https)",
    group: "Général",
    placeholder: "https://panel.exemple.com",
    help: "Liens dans les messages Discord.",
  },
  {
    key: "DATABASE_URL",
    label: "URL de la base",
    group: "Base de données",
    placeholder: "file:./data/app.db",
    help: "SQLite local : file:./data/app.db — Turso : libsql://<base>.turso.io",
    recommended: true,
  },
  {
    key: "DATABASE_AUTH_TOKEN",
    label: "Jeton Turso / libsql",
    group: "Base de données",
    secret: true,
    help: "Uniquement pour une base distante libsql://.",
  },
  {
    key: "ADMIN_TOKEN",
    label: "ADMIN_TOKEN",
    group: "Sécurité",
    secret: true,
    generate: { length: 40 },
    help: "Déploiement des migrations par API et code d'installation (16 caractères min.).",
    recommended: true,
  },
  {
    key: "CRON_SECRET",
    label: "CRON_SECRET",
    group: "Sécurité",
    secret: true,
    generate: { length: 40 },
    help: "Déclenchement externe des renouvellements (POST /api/cron/renewals).",
  },
  {
    key: "SOU_API_KEY",
    label: "Clé maîtresse de l'API",
    group: "Sécurité",
    secret: true,
    generate: { prefix: "sou_", length: 40 },
    help: "Toutes les portées. Préfère des clés dédiées dans Admin → API.",
  },
  {
    key: "PROXMOX_URL",
    label: "URL Proxmox",
    group: "Proxmox",
    placeholder: "https://pve.exemple.com:8006",
  },
  {
    key: "PROXMOX_TOKEN_ID",
    label: "Identifiant du jeton",
    group: "Proxmox",
    placeholder: "root@pam!panel",
  },
  {
    key: "PROXMOX_TOKEN_SECRET",
    label: "Secret du jeton",
    group: "Proxmox",
    secret: true,
  },
  {
    key: "PROXMOX_INSECURE_TLS",
    label: "Certificat auto-signé",
    group: "Proxmox",
    kind: "bool",
  },
  {
    key: "PROXMOX_SSH_HOST",
    label: "Hôte SSH (défaut : hôte de l'URL)",
    group: "Proxmox",
  },
  {
    key: "PROXMOX_SSH_PORT",
    label: "Port SSH",
    group: "Proxmox",
    kind: "number",
    placeholder: "22",
  },
  {
    key: "PROXMOX_SSH_USER",
    label: "Utilisateur SSH",
    group: "Proxmox",
    placeholder: "root",
  },
  {
    key: "PROXMOX_SSH_PASSWORD",
    label: "Mot de passe SSH",
    group: "Proxmox",
    secret: true,
  },
  {
    key: "PLESK_URL",
    label: "URL Plesk",
    group: "Plesk",
    placeholder: "https://plesk.exemple.com:8443",
  },
  {
    key: "PLESK_API_KEY",
    label: "Clé API Plesk",
    group: "Plesk",
    secret: true,
  },
  {
    key: "PLESK_INSECURE_TLS",
    label: "Certificat auto-signé",
    group: "Plesk",
    kind: "bool",
  },
  {
    key: "DISCORD_LOG_WEBHOOK_URL",
    label: "Webhook Discord",
    group: "Discord",
    secret: true,
    help: "Salon → Paramètres → Intégrations → Webhooks → Copier l'URL.",
  },
  {
    key: "OPENROUTER_API_KEY",
    label: "Clé OpenRouter",
    group: "Assistant IA",
    secret: true,
  },
  {
    key: "OPENROUTER_MODEL",
    label: "Modèle gratuit (:free)",
    group: "Assistant IA",
    placeholder: "meta-llama/llama-3.3-70b-instruct:free",
  },
  {
    key: "RENEW_PERIOD_DAYS",
    label: "Durée d'une période (jours)",
    group: "Renouvellements",
    kind: "number",
    placeholder: "7",
  },
  {
    key: "RENEW_CHECK_EVERY_DAYS",
    label: "Vérification tous les (jours)",
    group: "Renouvellements",
    kind: "number",
    placeholder: "3",
  },
  {
    key: "RENEW_DELETE_AFTER_DAYS",
    label: "Suppression après expiration (jours, vide = jamais)",
    group: "Renouvellements",
    kind: "number",
  },
]
