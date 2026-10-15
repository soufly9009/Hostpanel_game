import { z } from "zod"

// Une variable vide (`KEY=`) est traitée comme absente.
const optional = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (v === "" ? undefined : v), s.optional())

export const envSchema = z.object({
  DATABASE_URL: z.string().min(1).default("file:./data/app.db"),
  DATABASE_AUTH_TOKEN: optional(z.string()),
  ADMIN_TOKEN: optional(z.string().min(16)),
  /**
   * Clé maîtresse de l'API REST /api/v1 (toutes les portées). Format
   * « sou_… ». Les autres clés se créent dans /admin/api.
   */
  SOU_API_KEY: optional(
    z
      .string()
      .regex(/^sou_[A-Za-z0-9_-]{24,}$/, "format sou_… (24+ caractères)")
  ),

  SITE_NAME: z.string().default("VPSHost"),

  /** Durée d'un renouvellement, en jours. */
  RENEW_PERIOD_DAYS: z.coerce.number().int().min(1).max(365).default(7),
  /** Fréquence de la vérification automatique, en jours. */
  RENEW_CHECK_EVERY_DAYS: z.coerce.number().int().min(1).max(60).default(3),
  /** Supprime un VPS expiré depuis N jours ; absent = jamais supprimé. */
  RENEW_DELETE_AFTER_DAYS: optional(z.coerce.number().int().min(1).max(365)),
  /** Jeton pour déclencher la vérification via POST /api/cron/renewals. */
  CRON_SECRET: optional(z.string().min(16)),

  /** URL de Proxmox VE, ex. https://pve.exemple.com:8006 */
  PROXMOX_URL: optional(z.url().transform((u) => u.replace(/\/+$/, ""))),
  /** Jeton API complet : user@realm!tokenid */
  PROXMOX_TOKEN_ID: optional(z.string()),
  PROXMOX_TOKEN_SECRET: optional(z.string()),
  /**
   * Accès SSH à l'hôte Proxmox (pour `pct exec` dans les LXC : l'API REST
   * ne sait pas exécuter de commande). Hôte par défaut : celui de PROXMOX_URL.
   */
  PROXMOX_SSH_HOST: optional(z.string()),
  PROXMOX_SSH_PORT: z.coerce.number().int().min(1).max(65535).default(22),
  PROXMOX_SSH_USER: z.string().default("root"),
  PROXMOX_SSH_PASSWORD: optional(z.string()),
  /** Clé privée OpenSSH ; les retours à la ligne peuvent être écrits \n. */
  PROXMOX_SSH_PRIVATE_KEY: optional(z.string()),
  /** Plesk : URL du panneau (https://plesk.exemple.com:8443) et clé API. */
  PLESK_URL: optional(z.url().transform((u) => u.replace(/\/+$/, ""))),
  PLESK_API_KEY: optional(z.string()),
  PLESK_INSECURE_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** Plan de service Plesk appliqué aux nouveaux domaines. */
  PLESK_SERVICE_PLAN: z.string().default("Default Domain"),
  /** Hôte/port FTP pour l'envoi de fichiers (défaut : hôte de PLESK_URL). */
  PLESK_FTP_HOST: optional(z.string()),
  PLESK_FTP_PORT: z.coerce.number().int().min(1).max(65535).default(21),
  /** Nombre maximal de sites par client (les admins n'ont pas de limite). */
  PLESK_SITE_LIMIT: z.coerce.number().int().min(1).max(500).default(3),
  /**
   * Webhook Discord entrant pour les alertes (URL secrète, serveur uniquement).
   * Absent ou vide = notifications Discord désactivées.
   */
  DISCORD_LOG_WEBHOOK_URL: optional(z.url()),
  /**
   * URL publique du panel (https), pour les liens dans les messages Discord.
   * Absente = aucun lien n'est ajouté.
   */
  PANEL_PUBLIC_URL: optional(
    z
      .url()
      .refine((u) => u.startsWith("https://"), "https requis")
      .transform((u) => u.replace(/\/+$/, ""))
  ),
  /**
   * OpenRouter (assistant IA des tickets). Seuls les modèles gratuits
   * (identifiants se terminant par « :free ») sont utilisés.
   */
  OPENROUTER_API_KEY: optional(z.string().min(10)),
  /** Modèle gratuit préféré (ex. meta-llama/llama-3.3-70b-instruct:free). */
  OPENROUTER_MODEL: optional(
    z.string().regex(/^[\w.-]+\/[\w.:-]+:free$/, "modèle :free requis")
  ),
  /** Snapshots automatiques conservés par VPS. */
  SNAPSHOT_AUTO_KEEP: z.coerce.number().int().min(1).max(30).default(3),
  /** true : journalise aussi les lectures (très verbeux). */
  PROXMOX_LOG_READS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
  /** true si le certificat de Proxmox est auto-signé. */
  PROXMOX_INSECURE_TLS: z
    .enum(["true", "false"])
    .default("false")
    .transform((v) => v === "true"),
})

export const env = envSchema.parse(process.env)

export const pleskConfigured = Boolean(env.PLESK_URL && env.PLESK_API_KEY)

export const proxmoxConfigured = Boolean(
  env.PROXMOX_URL && env.PROXMOX_TOKEN_ID && env.PROXMOX_TOKEN_SECRET
)
