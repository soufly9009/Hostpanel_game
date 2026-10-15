import { sql } from "drizzle-orm"
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core"

/** Paramètres Proxmox d'une offre. */
export type ProxmoxPlanConfig = {
  virt: "lxc" | "qemu"
  node: string
  /** Stockage du disque racine (ex. local-lvm). */
  storage: string
  /** Pont réseau (ex. vmbr0). */
  bridge: string
  /** LXC : volid du template (local:vztmpl/…) ; QEMU : VMID du template à cloner. */
  template: string
  cores: number
  /** Templates proposés à la réinstallation (inclut `template`). */
  templates?: { value: string; label: string }[]
}

const id = () =>
  text("id")
    .primaryKey()
    .$defaultFn(() => crypto.randomUUID())

const createdAt = () =>
  integer("created_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`)

export const users = sqliteTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name"),
    passwordHash: text("password_hash"),
    role: text("role", { enum: ["user", "support", "admin"] })
      .notNull()
      .default("user"),
    /** Rôle personnalisé (jeu de permissions) pour le personnel support. */
    roleId: text("role_id"),
    /** Nombre maximum de VPS que ce client peut créer (modifiable par un admin). */
    serverLimit: integer("server_limit").notNull().default(1),
    /** Solde de crédits fictifs, en centimes (mis à jour avec le grand livre). */
    balanceCents: integer("balance_cents").notNull().default(0),
    /** 2FA TOTP : secret (chiffré si APP_SECRET), actif si `totpEnabledAt`. */
    totpSecret: text("totp_secret"),
    totpEnabledAt: integer("totp_enabled_at", { mode: "timestamp" }),
    /** Codes de secours : empreintes SHA-256, consommés une fois. */
    recoveryCodes: text("recovery_codes", { mode: "json" }).$type<string[]>(),
    /** Parrainage : code personnel et parrain éventuel. */
    referralCode: text("referral_code"),
    referredBy: text("referred_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("users_email_idx").on(t.email),
    uniqueIndex("users_referral_idx").on(t.referralCode),
  ]
)

export const sessions = sqliteTable(
  "sessions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    /** Navigateur et adresse IP tronquée (/24, /48), pour l'utilisateur. */
    userAgent: text("user_agent"),
    ipHint: text("ip_hint"),
    lastSeenAt: integer("last_seen_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)]
)

/** Offre commerciale : ressources + paramètres de déploiement Proxmox. */
export const plans = sqliteTable("plans", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  priceCents: integer("price_cents").notNull().default(0),
  memoryMb: integer("memory_mb").notNull(),
  diskMb: integer("disk_mb").notNull(),
  swapMb: integer("swap_mb").notNull().default(0),
  proxmox: text("proxmox", { mode: "json" })
    .$type<ProxmoxPlanConfig>()
    .notNull(),
  /** Durée d'une période de renouvellement ; null = RENEW_PERIOD_DAYS. */
  periodDays: integer("period_days"),
  /** Modes réseau proposés à la commande : dhcp, static ou les deux. */
  networkModes: text("network_modes", { enum: ["dhcp", "static", "both"] })
    .notNull()
    .default("dhcp"),
  /** Snapshots manuels autorisés par VPS (0 = désactivés). */
  snapshotLimit: integer("snapshot_limit").notNull().default(3),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
})

export const servers = sqliteTable(
  "servers",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => plans.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** Proxmox : VMID, nœud et type de virtualisation. */
    vmid: integer("vmid").notNull(),
    node: text("node").notNull(),
    virt: text("virt", { enum: ["lxc", "qemu"] }).notNull(),
    /** Système installé (libellé du template). */
    os: text("os"),
    /** Adresse IPv4 détectée. */
    address: text("address"),
    /** Adresse IPv6 globale détectée. */
    ipv6: text("ipv6"),
    suspended: integer("suspended", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Pourquoi le VPS est suspendu : échéance dépassée ou décision admin. */
    suspendReason: text("suspend_reason", { enum: ["expired", "admin"] }),
    /** Empreinte SHA-256 (hex) de la clé SSH du VPS, mémorisée à la 1re connexion. */
    sshHostKey: text("ssh_host_key"),
    /** Configuration réseau demandée (suivie séparément de l'IPAM). */
    networkMode: text("network_mode", { enum: ["dhcp", "static"] }),
    networkId: text("network_id"),
    /** Adresse IPAM attribuée à ce VPS (mode statique). */
    ipAddressId: text("ip_address_id"),
    /** Ancienne adresse : libérée seulement quand la transition est confirmée. */
    previousIpAddressId: text("previous_ip_address_id"),
    netSyncState: text("net_sync_state", {
      enum: ["pending", "synced", "error"],
    }),
    netError: text("net_error"),
    netUpdatedAt: integer("net_updated_at", { mode: "timestamp" }),
    /** Snapshot quotidien automatique (rétention SNAPSHOT_AUTO_KEEP). */
    autoSnapshot: integer("auto_snapshot", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Échéance de renouvellement ; null = sans expiration. */
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    /** Dernier renouvellement manuel (création comprise) : 1 par période. */
    lastRenewedAt: integer("last_renewed_at", { mode: "timestamp" }),
    /** Annulation validée : supprimé à l'échéance, plus de facture. */
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("servers_vmid_idx").on(t.vmid),
    index("servers_user_idx").on(t.userId),
  ]
)

/** Sites web hébergés sur Plesk. */
export const sites = sqliteTable(
  "sites",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    /** Identifiant du domaine côté Plesk. */
    pleskId: integer("plesk_id").notNull(),
    /** Compte FTP (système) du domaine ; le mot de passe n'est pas conservé. */
    ftpLogin: text("ftp_login").notNull(),
    sslIssuedAt: integer("ssl_issued_at", { mode: "timestamp" }),
    /** Dernière erreur d'émission du certificat (null si la dernière a réussi). */
    sslLastError: text("ssl_last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("sites_domain_idx").on(t.domain),
    index("sites_user_idx").on(t.userId),
  ]
)

export type Site = typeof sites.$inferSelect

/** Journal d'activité : qui a fait quoi (sans données sensibles). */
export const activityLogs = sqliteTable(
  "activity_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: createdAt(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    targetType: text("target_type", {
      enum: [
        "server",
        "site",
        "plan",
        "account",
        "maintenance",
        "migration",
        "network",
        "ticket",
        "role",
        "wallet",
        "legal",
        "api",
        "game",
        "invoice",
        "content",
        "email",
        "security",
        "quote",
        "webhook",
      ],
    }),
    targetId: text("target_id"),
    /** Libellé lisible de la cible (nom du VPS, domaine…). */
    targetLabel: text("target_label"),
  },
  (t) => [
    index("activity_created_idx").on(t.createdAt),
    index("activity_user_idx").on(t.userId),
  ]
)

export type ActivityLog = typeof activityLogs.$inferSelect

/** Notifications de l'espace client. */
export const notifications = sqliteTable(
  "notifications",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    level: text("level", { enum: ["info", "warning", "error"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    body: text("body"),
    href: text("href"),
    /** Une notification par (utilisateur, clé) : évite les doublons. */
    dedupeKey: text("dedupe_key").notNull(),
    readAt: integer("read_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_dedupe_idx").on(t.userId, t.dedupeKey),
    index("notifications_user_idx").on(t.userId, t.createdAt),
  ]
)

export type Notification = typeof notifications.$inferSelect

/** Mémorise la dernière exécution des tâches planifiées (cron). */
export const jobRuns = sqliteTable("job_runs", {
  name: text("name").primaryKey(),
  lastRunAt: integer("last_run_at", { mode: "timestamp" }),
  lastResult: text("last_result", { mode: "json" }).$type<unknown>(),
})

/** Journal des appels à l'API Proxmox (modifications et erreurs). */
export const proxmoxLogs = sqliteTable(
  "proxmox_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: createdAt(),
    /** E-mail de l'utilisateur à l'origine de l'appel, ou "système". */
    actor: text("actor"),
    /** Libellé lisible : « Démarrage de LXC 105 ». */
    action: text("action").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    /** Code HTTP ; 0 = échec réseau. */
    status: integer("status").notNull(),
    durationMs: integer("duration_ms").notNull(),
    error: text("error"),
  },
  (t) => [index("proxmox_logs_created_idx").on(t.createdAt)]
)

export type ProxmoxLog = typeof proxmoxLogs.$inferSelect

export type User = typeof users.$inferSelect
export type Plan = typeof plans.$inferSelect
export type NewPlan = typeof plans.$inferInsert
export type Server = typeof servers.$inferSelect

/* ───────────── IPAM ───────────── */

/** Réseau / sous-réseau géré. Les chevauchements sont permis si `allowOverlap`. */
export const ipNetworks = sqliteTable(
  "ip_networks",
  {
    id: id(),
    name: text("name").notNull(),
    /** Forme canonique : réseau/préfixe. */
    cidr: text("cidr").notNull(),
    family: text("family", { enum: ["ipv4", "ipv6"] }).notNull(),
    gateway: text("gateway"),
    dnsServers: text("dns_servers", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    vlan: integer("vlan"),
    /** Bridge Proxmox ; vide = non contraint. */
    bridge: text("bridge"),
    /** Nœud Proxmox concerné ; vide = tous. */
    node: text("node"),
    /** Plage utilisable (bornes incluses), dans le CIDR. */
    rangeStart: text("range_start"),
    rangeEnd: text("range_end"),
    /** Modes d'attribution proposés pour ce réseau. */
    mode: text("mode", { enum: ["dhcp", "static", "both"] })
      .notNull()
      .default("static"),
    /** Un serveur DHCP est réellement opérationnel sur ce réseau. */
    dhcpAvailable: integer("dhcp_available", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Les clients peuvent choisir ce réseau à la commande. */
    clientAssignable: integer("client_assignable", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Chevauchement documenté avec d'autres réseaux (réseau isolé, etc.). */
    allowOverlap: integer("allow_overlap", { mode: "boolean" })
      .notNull()
      .default(false),
    notes: text("notes"),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("ip_networks_name_idx").on(t.name)]
)

export const IP_STATUSES = [
  "available",
  "reserved",
  "assigned",
  "disabled",
  "conflict",
] as const
export type IpStatus = (typeof IP_STATUSES)[number]

export const ipAddresses = sqliteTable(
  "ip_addresses",
  {
    id: id(),
    networkId: text("network_id")
      .notNull()
      // RESTRICT : un réseau encore peuplé ne peut pas être supprimé.
      .references(() => ipNetworks.id, { onDelete: "restrict" }),
    /** Forme canonique (IPv6 compressée en minuscules). */
    address: text("address").notNull(),
    status: text("status", { enum: IP_STATUSES })
      .notNull()
      .default("available"),
    mode: text("mode", { enum: ["dhcp", "static"] }),
    serverId: text("server_id").references(() => servers.id, {
      onDelete: "set null",
    }),
    siteId: text("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    comment: text("comment"),
    assignedAt: integer("assigned_at", { mode: "timestamp" }),
    releasedAt: integer("released_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    // Unicité garantie par la base : pas de double enregistrement.
    uniqueIndex("ip_addresses_net_addr_idx").on(t.networkId, t.address),
    index("ip_addresses_status_idx").on(t.status),
    index("ip_addresses_server_idx").on(t.serverId),
  ]
)

/** Historique IPAM : une ligne par opération, sans secret. */
export const ipamLogs = sqliteTable(
  "ipam_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: createdAt(),
    addressId: text("address_id"),
    networkId: text("network_id"),
    /** Copie de l'adresse (l'enregistrement peut disparaître). */
    address: text("address"),
    action: text("action").notNull(),
    oldValue: text("old_value"),
    newValue: text("new_value"),
    actor: text("actor").notNull(),
    result: text("result", { enum: ["ok", "refused", "error"] })
      .notNull()
      .default("ok"),
    reason: text("reason"),
  },
  (t) => [
    index("ipamlogs_address_idx").on(t.addressId),
    index("ipamlogs_created_idx").on(t.createdAt),
  ]
)

export type IpNetwork = typeof ipNetworks.$inferSelect
export type IpAddress = typeof ipAddresses.$inferSelect

/* ───────────── Maintenance, incidents, migrations ───────────── */

export const MAINTENANCE_STATUSES = [
  "draft",
  "scheduled",
  "in_progress",
  "completed",
  "cancelled",
] as const
export type MaintenanceStatus = (typeof MAINTENANCE_STATUSES)[number]

export const maintenanceEvents = sqliteTable(
  "maintenance_events",
  {
    id: id(),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type", {
      enum: [
        "network",
        "hardware",
        "proxmox_update",
        "plesk_update",
        "database",
        "vps_migration",
        "panel_update",
        "security",
        "other",
      ],
    }).notNull(),
    status: text("status", { enum: MAINTENANCE_STATUSES })
      .notNull()
      .default("draft"),
    impact: text("impact", {
      enum: ["none", "degraded", "partial", "full"],
    })
      .notNull()
      .default("none"),
    /** Stockés en UTC ; `timezone` n'est qu'un libellé d'affichage (IANA). */
    startsAt: integer("starts_at", { mode: "timestamp" }).notNull(),
    endsAt: integer("ends_at", { mode: "timestamp" }).notNull(),
    timezone: text("timezone").notNull().default("Europe/Paris"),
    /** vps | sites | network | panel */
    services: text("services", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    nodes: text("nodes", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    siteIds: text("site_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    customerMessage: text("customer_message"),
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Incrémenté à chaque changement de planning : nouvelle notification. */
    revision: integer("revision").notNull().default(1),
    /** Quand l'annonce devient visible ; null = dès la programmation. */
    publishedAt: integer("published_at", { mode: "timestamp" }),
    notifyBeforeMinutes: integer("notify_before_minutes")
      .notNull()
      .default(1440),
    createdBy: text("created_by"),
    createdAt: createdAt(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [
    index("maintenance_status_idx").on(t.status),
    index("maintenance_starts_idx").on(t.startsAt),
  ]
)

export const incidents = sqliteTable(
  "incidents",
  {
    id: id(),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["investigating", "identified", "monitoring", "resolved"],
    })
      .notNull()
      .default("investigating"),
    impact: text("impact", { enum: ["degraded", "partial", "full"] })
      .notNull()
      .default("degraded"),
    /** Composants touchés : vps | sites | network | panel */
    components: text("components", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    message: text("message"),
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    maintenanceId: text("maintenance_id").references(
      () => maintenanceEvents.id,
      { onDelete: "set null" }
    ),
    startedAt: integer("started_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    resolvedAt: integer("resolved_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [index("incidents_status_idx").on(t.status)]
)

export const MIGRATION_STATUSES = [
  "draft",
  "scheduled",
  "notified",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const
export type MigrationStatus = (typeof MIGRATION_STATUSES)[number]

export const migrationAnnouncements = sqliteTable(
  "migration_announcements",
  {
    id: id(),
    kind: text("kind", { enum: ["database", "vps"] }).notNull(),
    title: text("title").notNull(),
    status: text("status", { enum: MIGRATION_STATUSES })
      .notNull()
      .default("draft"),
    scheduledAt: integer("scheduled_at", { mode: "timestamp" }).notNull(),
    estimatedMinutes: integer("estimated_minutes").notNull().default(15),
    impact: text("impact"),
    /** Services concernés (libellés libres, affichés tels quels). */
    services: text("services", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    reason: text("reason"),
    sourceNode: text("source_node"),
    targetNode: text("target_node"),
    /** VPS concernés (annonces `vps`). */
    serverIds: text("server_ids", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    isPublic: integer("is_public", { mode: "boolean" })
      .notNull()
      .default(false),
    notifyBeforeMinutes: integer("notify_before_minutes")
      .notNull()
      .default(1440),
    /** Incrémenté quand le planning change. */
    revision: integer("revision").notNull().default(1),
    result: text("result"),
    finishedAt: integer("finished_at", { mode: "timestamp" }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    index("migann_status_idx").on(t.status),
    index("migann_scheduled_idx").on(t.scheduledAt),
  ]
)

/** Historique des notifications envoyées pour une annonce (anti-doublon). */
export const migrationNotifications = sqliteTable(
  "migration_notifications",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    announcementId: text("announcement_id")
      .notNull()
      .references(() => migrationAnnouncements.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "reminder",
        "update",
        "started",
        "completed",
        "failed",
        "cancelled",
      ],
    }).notNull(),
    revision: integer("revision").notNull(),
    recipients: integer("recipients").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("mignotif_unique_idx").on(t.announcementId, t.kind, t.revision),
  ]
)

/** Journal des déploiements de migrations SQL. */
export const dbDeployRuns = sqliteTable("db_deploy_runs", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  startedAt: integer("started_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  finishedAt: integer("finished_at", { mode: "timestamp" }),
  actor: text("actor").notNull(),
  status: text("status", { enum: ["running", "success", "failed"] })
    .notNull()
    .default("running"),
  pending: text("pending", { mode: "json" }).$type<string[]>(),
  error: text("error"),
})

export type MaintenanceEvent = typeof maintenanceEvents.$inferSelect
export type Incident = typeof incidents.$inferSelect
export type MigrationAnnouncement = typeof migrationAnnouncements.$inferSelect

/* ───────────── Supervision : événements et livraison Discord ───────────── */

export const EVENT_LEVELS = [
  "info",
  "success",
  "warning",
  "error",
  "critical",
] as const
export type EventLevel = (typeof EVENT_LEVELS)[number]

export const EVENT_CATEGORIES = [
  "proxmox",
  "plesk",
  "pterodactyl",
  "billing",
  "email",
  "vps",
  "provisioning",
  "renewals",
  "firewall",
  "ssh",
  "files",
  "maintenance",
  "migration",
  "database",
  "scheduler",
  "security",
  "support",
  "app",
  "system",
] as const
export type EventCategory = (typeof EVENT_CATEGORIES)[number]

/**
 * Événements importants du panel. Chaque ligne est aussi l'entrée de la file
 * de livraison Discord : l'état `discordState` survit aux redémarrages.
 * Les données sont expurgées AVANT insertion.
 */
export const systemEvents = sqliteTable(
  "system_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    createdAt: createdAt(),
    level: text("level", { enum: EVENT_LEVELS }).notNull(),
    category: text("category", { enum: EVENT_CATEGORIES }).notNull(),
    /** Service concerné (libellé court : « VPS », « Site web »…). */
    service: text("service"),
    action: text("action"),
    result: text("result", { enum: ["success", "failure", "info"] })
      .notNull()
      .default("info"),
    title: text("title").notNull(),
    message: text("message"),
    /** Identifiant de corrélation (même opération = même identifiant). */
    correlationId: text("correlation_id"),
    /** Métadonnées expurgées (JSON). */
    meta: text("meta", { mode: "json" }).$type<Record<string, string>>(),
    /** Empreinte de déduplication (catégorie + action + motif). */
    fingerprint: text("fingerprint"),
    /** Nombre d'occurrences identiques fusionnées dans cette ligne. */
    occurrences: integer("occurrences").notNull().default(1),
    discordState: text("discord_state", {
      enum: [
        "skipped", // filtré (niveau/catégorie/désactivé) ou non configuré
        "pending", // à envoyer
        "sent", // accepté par Discord
        "failed", // abandonné
        "suppressed", // fusionné dans un doublon récent
      ],
    })
      .notNull()
      .default("skipped"),
    discordAttempts: integer("discord_attempts").notNull().default(0),
    discordNextAttemptAt: integer("discord_next_attempt_at", {
      mode: "timestamp",
    }),
    discordLastError: text("discord_last_error"),
    discordSentAt: integer("discord_sent_at", { mode: "timestamp" }),
  },
  (t) => [
    index("sysevents_created_idx").on(t.createdAt),
    index("sysevents_state_idx").on(t.discordState, t.discordNextAttemptAt),
    index("sysevents_fp_idx").on(t.fingerprint, t.createdAt),
    index("sysevents_corr_idx").on(t.correlationId),
  ]
)

/** Préférences non secrètes (clé → JSON). Jamais de secret ici. */
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).$type<unknown>().notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

export type SystemEvent = typeof systemEvents.$inferSelect

/* ───────────── Rôles, permissions, tickets ───────────── */

/** Catalogue de permissions (les clés « système » sont appliquées par le code). */
export const permissions = sqliteTable("permissions", {
  key: text("key").primaryKey(),
  label: text("label").notNull(),
  description: text("description"),
  /** Permission fournie par le panel (vérifiée dans le code). */
  isSystem: integer("is_system", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
})

/** Rôle personnalisé : un nom + un ensemble de clés de permission. */
export const roles = sqliteTable(
  "roles",
  {
    id: id(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    permissions: text("permissions", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .$defaultFn(() => []),
    /** Rôle livré avec le panel : non supprimable. */
    isSystem: integer("is_system", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("roles_key_idx").on(t.key)]
)

export const TICKET_STATUSES = [
  "open", // en attente du support
  "pending", // en attente du client
  "resolved",
  "closed",
] as const
export type TicketStatus = (typeof TICKET_STATUSES)[number]

export const tickets = sqliteTable(
  "tickets",
  {
    id: id(),
    /** Numéro lisible (T-0001), unique. */
    number: integer("number").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    subject: text("subject").notNull(),
    category: text("category", {
      enum: ["vps", "site", "billing", "network", "account", "other"],
    })
      .notNull()
      .default("other"),
    priority: text("priority", { enum: ["low", "normal", "high", "urgent"] })
      .notNull()
      .default("normal"),
    status: text("status", { enum: TICKET_STATUSES }).notNull().default("open"),
    assignedTo: text("assigned_to").references(() => users.id, {
      onDelete: "set null",
    }),
    /** Service concerné (facultatif) : seulement un identifiant du client. */
    serverId: text("server_id").references(() => servers.id, {
      onDelete: "set null",
    }),
    siteId: text("site_id").references(() => sites.id, {
      onDelete: "set null",
    }),
    lastMessageAt: integer("last_message_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
    closedAt: integer("closed_at", { mode: "timestamp" }),
    /** Satisfaction du client (1 à 5) après résolution. */
    rating: integer("rating"),
    ratingComment: text("rating_comment"),
    ratedAt: integer("rated_at", { mode: "timestamp" }),
  },
  (t) => [
    uniqueIndex("tickets_number_idx").on(t.number),
    index("tickets_user_idx").on(t.userId),
    index("tickets_status_idx").on(t.status, t.lastMessageAt),
    index("tickets_assigned_idx").on(t.assignedTo),
  ]
)

export const ticketMessages = sqliteTable(
  "ticket_messages",
  {
    id: id(),
    ticketId: text("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id").references(() => users.id, {
      onDelete: "set null",
    }),
    /** customer | staff | ai | system */
    authorKind: text("author_kind", {
      enum: ["customer", "staff", "ai", "system"],
    }).notNull(),
    body: text("body").notNull(),
    /** Note interne : jamais visible du client. */
    isInternal: integer("is_internal", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Modèle OpenRouter ayant rédigé le message (messages IA). */
    aiModel: text("ai_model"),
    createdAt: createdAt(),
  },
  (t) => [index("ticket_messages_ticket_idx").on(t.ticketId, t.createdAt)]
)

export type Ticket = typeof tickets.$inferSelect
export type TicketMessage = typeof ticketMessages.$inferSelect
export type Role = typeof roles.$inferSelect

/* ───────────── Portefeuille : crédits fictifs, coupons, cartes cadeaux ───────────── */

export const WALLET_KINDS = [
  "adjustment", // crédit/débit manuel du personnel
  "api", // opération via l'API
  "coupon",
  "gift_card",
  "purchase", // commande d'un VPS
  "renewal", // renouvellement d'un VPS
  "refund",
  "invoice", // règlement d'une facture
] as const
export type WalletKind = (typeof WALLET_KINDS)[number]

/**
 * Grand livre des crédits (monnaie virtuelle sans valeur monétaire).
 * Chaque mouvement de `users.balanceCents` a exactement une ligne ici.
 */
export const walletTransactions = sqliteTable(
  "wallet_transactions",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** Montant signé, en centimes de crédit. */
    amountCents: integer("amount_cents").notNull(),
    balanceAfterCents: integer("balance_after_cents").notNull(),
    kind: text("kind", { enum: WALLET_KINDS }).notNull(),
    description: text("description").notNull(),
    /** Auteur lisible : e-mail du personnel, « api:<clé> » ou « système ». */
    actor: text("actor").notNull(),
    /** Objet lié (VPS, coupon, carte cadeau). */
    reference: text("reference"),
    /** Rejouer une requête avec la même clé ne crée pas de doublon. */
    idempotencyKey: text("idempotency_key"),
    createdAt: createdAt(),
  },
  (t) => [
    index("wallet_tx_user_idx").on(t.userId, t.createdAt),
    uniqueIndex("wallet_tx_idem_idx").on(t.userId, t.idempotencyKey),
  ]
)

/** Code promotionnel réutilisable : crédite un montant fixe. */
export const coupons = sqliteTable(
  "coupons",
  {
    id: id(),
    code: text("code").notNull(),
    description: text("description"),
    amountCents: integer("amount_cents").notNull(),
    /** null = illimité. */
    maxRedemptions: integer("max_redemptions"),
    redemptions: integer("redemptions").notNull().default(0),
    perUserLimit: integer("per_user_limit").notNull().default(1),
    startsAt: integer("starts_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("coupons_code_idx").on(t.code)]
)

export const couponRedemptions = sqliteTable(
  "coupon_redemptions",
  {
    id: id(),
    couponId: text("coupon_id")
      .notNull()
      .references(() => coupons.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    transactionId: text("transaction_id"),
    createdAt: createdAt(),
  },
  (t) => [index("coupon_redemptions_idx").on(t.couponId, t.userId)]
)

/** Carte cadeau : code unique à usage unique. */
export const giftCards = sqliteTable(
  "gift_cards",
  {
    id: id(),
    code: text("code").notNull(),
    amountCents: integer("amount_cents").notNull(),
    note: text("note"),
    status: text("status", { enum: ["active", "redeemed", "disabled"] })
      .notNull()
      .default("active"),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    redeemedBy: text("redeemed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    redeemedAt: integer("redeemed_at", { mode: "timestamp" }),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("gift_cards_code_idx").on(t.code),
    index("gift_cards_status_idx").on(t.status),
  ]
)

export type WalletTransaction = typeof walletTransactions.$inferSelect
export type Coupon = typeof coupons.$inferSelect
export type GiftCard = typeof giftCards.$inferSelect

/* ───────────── Documents légaux (CGU, confidentialité…) et RGPD ───────────── */

/**
 * Document légal. Les sections (`legal_sections`) forment le brouillon ;
 * la publication fige une copie dans `legal_versions` (ce que voit le public).
 */
export const legalDocuments = sqliteTable(
  "legal_documents",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    /** Dernière version publiée (0 = jamais publiée). */
    version: integer("version").notNull().default(0),
    /** Version minimale que l'utilisateur doit avoir acceptée (0 = aucune). */
    acceptanceVersion: integer("acceptance_version").notNull().default(0),
    /** Acceptation obligatoire (inscription + nouvelle version majeure). */
    requiresAcceptance: integer("requires_acceptance", { mode: "boolean" })
      .notNull()
      .default(false),
    /** Visible publiquement (si au moins une version est publiée). */
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(true),
    position: integer("position").notNull().default(0),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    updatedBy: text("updated_by"),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("legal_documents_slug_idx").on(t.slug)]
)

export const legalSections = sqliteTable(
  "legal_sections",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "cascade" }),
    position: integer("position").notNull().default(0),
    heading: text("heading").notNull(),
    body: text("body").notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
  },
  (t) => [index("legal_sections_doc_idx").on(t.documentId, t.position)]
)

export type LegalSectionContent = { heading: string; body: string }

/** Version publiée, figée : preuve de ce qui a été accepté. */
export const legalVersions = sqliteTable(
  "legal_versions",
  {
    id: id(),
    documentId: text("document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    title: text("title").notNull(),
    content: text("content", { mode: "json" })
      .$type<LegalSectionContent[]>()
      .notNull(),
    changeNote: text("change_note"),
    /** Version majeure : nouvelle acceptation exigée. */
    major: integer("major", { mode: "boolean" }).notNull().default(true),
    publishedBy: text("published_by"),
    publishedAt: createdAt(),
  },
  (t) => [uniqueIndex("legal_versions_idx").on(t.documentId, t.version)]
)

export const legalAcceptances = sqliteTable(
  "legal_acceptances",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    documentId: text("document_id")
      .notNull()
      .references(() => legalDocuments.id, { onDelete: "cascade" }),
    version: integer("version").notNull(),
    acceptedAt: createdAt(),
  },
  (t) => [
    uniqueIndex("legal_acceptances_idx").on(t.userId, t.documentId, t.version),
  ]
)

export type LegalDocument = typeof legalDocuments.$inferSelect
export type LegalSection = typeof legalSections.$inferSelect
export type LegalVersion = typeof legalVersions.$inferSelect

/* ───────────── Clés d'API (préfixe sou_) ───────────── */

export const apiKeys = sqliteTable(
  "api_keys",
  {
    id: id(),
    name: text("name").notNull(),
    /** Début de la clé, affichable (ex. sou_ab12cd34). */
    prefix: text("prefix").notNull(),
    /** SHA-256 (hex) de la clé complète : la clé n'est jamais stockée. */
    keyHash: text("key_hash").notNull(),
    scopes: text("scopes", { mode: "json" }).$type<string[]>().notNull(),
    createdBy: text("created_by"),
    lastUsedAt: integer("last_used_at", { mode: "timestamp" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    revokedAt: integer("revoked_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("api_keys_hash_idx").on(t.keyHash)]
)

export type ApiKey = typeof apiKeys.$inferSelect

/* ───────────── Serveurs de jeu (Pterodactyl) ───────────── */

/** Offre de serveur de jeu : egg Pterodactyl + ressources. */
export const gamePlans = sqliteTable("game_plans", {
  id: id(),
  name: text("name").notNull(),
  description: text("description"),
  /** Prix par période (crédits si la facturation est activée). */
  priceCents: integer("price_cents").notNull().default(0),
  nestId: integer("nest_id").notNull(),
  eggId: integer("egg_id").notNull(),
  /** Libellé de l'egg (ex. « Paper »), pour l'affichage. */
  eggName: text("egg_name"),
  /** Emplacement Pterodactyl où déployer (choix automatique du nœud). */
  locationId: integer("location_id").notNull(),
  memoryMb: integer("memory_mb").notNull(),
  diskMb: integer("disk_mb").notNull(),
  /** 100 = un cœur ; 0 = illimité. */
  cpuPercent: integer("cpu_percent").notNull().default(100),
  databases: integer("databases").notNull().default(0),
  backups: integer("backups").notNull().default(0),
  /** Variables d'environnement imposées (sinon valeurs par défaut de l'egg). */
  environment: text("environment", { mode: "json" })
    .$type<Record<string, string>>()
    .notNull()
    .default({}),
  /** null = RENEW_PERIOD_DAYS. */
  periodDays: integer("period_days"),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdAt: createdAt(),
})

export const gameServers = sqliteTable(
  "game_servers",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    planId: text("plan_id").references(() => gamePlans.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    /** Identifiants Pterodactyl : numérique (API Application) et court (API Client). */
    pteroId: integer("ptero_id").notNull(),
    pteroIdentifier: text("ptero_identifier").notNull(),
    pteroUuid: text("ptero_uuid").notNull(),
    /** Adresse de connexion (allocation par défaut). */
    address: text("address"),
    suspended: integer("suspended", { mode: "boolean" })
      .notNull()
      .default(false),
    suspendReason: text("suspend_reason", { enum: ["expired", "admin"] }),
    expiresAt: integer("expires_at", { mode: "timestamp" }),
    lastRenewedAt: integer("last_renewed_at", { mode: "timestamp" }),
    cancelAtPeriodEnd: integer("cancel_at_period_end", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("game_servers_ptero_idx").on(t.pteroId),
    index("game_servers_user_idx").on(t.userId),
  ]
)

export type GamePlan = typeof gamePlans.$inferSelect
export type GameServer = typeof gameServers.$inferSelect

/* ───────────── Facturation (factures, avoirs, paiements, commandes) ───────────── */

/** Coordonnées de facturation du client (mentions obligatoires sur facture). */
export const billingProfiles = sqliteTable("billing_profiles", {
  userId: text("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  fullName: text("full_name"),
  company: text("company"),
  address1: text("address1"),
  address2: text("address2"),
  postalCode: text("postal_code"),
  city: text("city"),
  /** Code pays ISO 3166-1 alpha-2. */
  country: text("country").notNull().default("FR"),
  vatNumber: text("vat_number"),
  phone: text("phone"),
  /** Payer automatiquement les factures avec le solde de crédits. */
  autoPayWithCredits: integer("auto_pay_with_credits", { mode: "boolean" })
    .notNull()
    .default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
})

/** Parties figées sur la facture (une facture émise ne change plus). */
export type InvoiceParty = {
  name: string
  company?: string | null
  lines: string[]
  vatNumber?: string | null
  extra?: string[]
  email?: string | null
}

export const INVOICE_STATUSES = [
  "unpaid",
  "paid",
  "cancelled",
  "refunded",
] as const

/**
 * Facture ou avoir. Numérotation continue par préfixe et année
 * (`invoice_sequences`). Conservée même si le compte est supprimé
 * (obligation légale) : `user_id` passe alors à null.
 */
export const invoices = sqliteTable(
  "invoices",
  {
    id: id(),
    number: text("number").notNull(),
    type: text("type", { enum: ["invoice", "credit_note"] })
      .notNull()
      .default("invoice"),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: INVOICE_STATUSES })
      .notNull()
      .default("unpaid"),
    currency: text("currency").notNull().default("EUR"),
    /** Montants en centimes : HT, taxe, TTC. Négatifs pour un avoir. */
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    /** Taux en points de base (2000 = 20 %). */
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxLabel: text("tax_label").notNull().default("TVA"),
    /** Mentions légales (exonération, pénalités de retard…). */
    legalMentions: text("legal_mentions", { mode: "json" })
      .$type<string[]>()
      .notNull()
      .default([]),
    seller: text("seller", { mode: "json" }).$type<InvoiceParty>().notNull(),
    buyer: text("buyer", { mode: "json" }).$type<InvoiceParty>().notNull(),
    issuedAt: integer("issued_at", { mode: "timestamp" }).notNull(),
    dueAt: integer("due_at", { mode: "timestamp" }).notNull(),
    paidAt: integer("paid_at", { mode: "timestamp" }),
    /** Avoir : facture d'origine. */
    relatedInvoiceId: text("related_invoice_id"),
    notes: text("notes"),
    /** Rappels envoyés (pour ne pas les répéter). */
    remindersSent: integer("reminders_sent").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("invoices_number_idx").on(t.number),
    index("invoices_user_idx").on(t.userId, t.issuedAt),
    index("invoices_status_idx").on(t.status, t.dueAt),
  ]
)

export const invoiceItems = sqliteTable(
  "invoice_items",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "cascade" }),
    description: text("description").notNull(),
    quantity: integer("quantity").notNull().default(1),
    /** Prix unitaire HT (centimes). */
    unitCents: integer("unit_cents").notNull(),
    /** Total HT de la ligne. */
    totalCents: integer("total_cents").notNull(),
    /** Service concerné : prolongé au paiement. */
    serviceType: text("service_type", { enum: ["vps", "game"] }),
    serviceId: text("service_id"),
    kind: text("kind", { enum: ["order", "renewal", "custom"] })
      .notNull()
      .default("custom"),
    /** Renouvellement : échéance couverte (évite deux factures pour la même période). */
    periodKey: integer("period_key"),
    /** Effet sur le service déjà appliqué (paiement traité). */
    applied: integer("applied", { mode: "boolean" }).notNull().default(false),
  },
  (t) => [
    index("invoice_items_invoice_idx").on(t.invoiceId),
    uniqueIndex("invoice_items_period_idx").on(
      t.serviceType,
      t.serviceId,
      t.periodKey
    ),
  ]
)

/** Compteurs de numérotation continue (ex. « FA-2026 » → 123). */
export const invoiceSequences = sqliteTable("invoice_sequences", {
  key: text("key").primaryKey(),
  last: integer("last").notNull().default(0),
})

export const PAYMENT_METHODS = [
  "credits",
  "bank_transfer",
  "manual",
  "card",
  "paypal",
] as const

export const payments = sqliteTable(
  "payments",
  {
    id: id(),
    invoiceId: text("invoice_id")
      .notNull()
      .references(() => invoices.id, { onDelete: "restrict" }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    method: text("method", { enum: PAYMENT_METHODS }).notNull(),
    /** Négatif pour un remboursement. */
    amountCents: integer("amount_cents").notNull(),
    /** Référence externe (virement, transaction de la passerelle). */
    reference: text("reference"),
    note: text("note"),
    createdBy: text("created_by"),
    createdAt: createdAt(),
  },
  (t) => [index("payments_invoice_idx").on(t.invoiceId)]
)

export const orders = sqliteTable(
  "orders",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    invoiceId: text("invoice_id"),
    serviceType: text("service_type", { enum: ["vps", "game"] }).notNull(),
    serviceId: text("service_id"),
    description: text("description").notNull(),
    status: text("status", {
      enum: ["pending", "active", "cancelled", "failed"],
    })
      .notNull()
      .default("pending"),
    createdAt: createdAt(),
  },
  (t) => [index("orders_user_idx").on(t.userId, t.createdAt)]
)

export type BillingProfile = typeof billingProfiles.$inferSelect
export type Invoice = typeof invoices.$inferSelect
export type InvoiceItem = typeof invoiceItems.$inferSelect
export type Payment = typeof payments.$inferSelect
export type Order = typeof orders.$inferSelect

/* ───────────── E-mails ───────────── */

/** Modèle modifiable ; variables {{nom}} remplacées à l'envoi. */
export const emailTemplates = sqliteTable("email_templates", {
  key: text("key").primaryKey(),
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  isEnabled: integer("is_enabled", { mode: "boolean" }).notNull().default(true),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  updatedBy: text("updated_by"),
})

/**
 * File d'envoi persistante. Le corps est conservé jusqu'à l'envoi puis
 * effacé (seuls destinataire, sujet et statut restent pour le suivi).
 */
export const emailQueue = sqliteTable(
  "email_queue",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    toAddress: text("to_address").notNull(),
    template: text("template").notNull(),
    subject: text("subject").notNull(),
    body: text("body"),
    status: text("status", {
      enum: ["pending", "sent", "failed", "skipped"],
    })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    lastError: text("last_error"),
    sentAt: integer("sent_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("email_queue_state_idx").on(t.status, t.nextAttemptAt),
    index("email_queue_created_idx").on(t.createdAt),
  ]
)

/** Jeton de réinitialisation (seule l'empreinte est stockée, usage unique). */
export const passwordResets = sqliteTable(
  "password_resets",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    usedAt: integer("used_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("password_resets_hash_idx").on(t.tokenHash),
    index("password_resets_user_idx").on(t.userId),
  ]
)

export type EmailTemplate = typeof emailTemplates.$inferSelect

/* ───────────── Fiche client : notes internes ───────────── */

export const clientNotes = sqliteTable(
  "client_notes",
  {
    id: id(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    author: text("author").notNull(),
    body: text("body").notNull(),
    isPinned: integer("is_pinned", { mode: "boolean" })
      .notNull()
      .default(false),
    createdAt: createdAt(),
  },
  (t) => [index("client_notes_user_idx").on(t.userId, t.createdAt)]
)

/* ───────────── Annonces et base de connaissances ───────────── */

export const announcements = sqliteTable(
  "announcements",
  {
    id: id(),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    summary: text("summary"),
    body: text("body").notNull(),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    publishedAt: integer("published_at", { mode: "timestamp" }),
    author: text("author"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("announcements_slug_idx").on(t.slug),
    index("announcements_pub_idx").on(t.isPublished, t.publishedAt),
  ]
)

export const kbCategories = sqliteTable(
  "kb_categories",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("kb_categories_slug_idx").on(t.slug)]
)

export const kbArticles = sqliteTable(
  "kb_articles",
  {
    id: id(),
    categoryId: text("category_id").references(() => kbCategories.id, {
      onDelete: "set null",
    }),
    slug: text("slug").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    isPublished: integer("is_published", { mode: "boolean" })
      .notNull()
      .default(false),
    views: integer("views").notNull().default(0),
    author: text("author"),
    updatedAt: integer("updated_at", { mode: "timestamp" })
      .notNull()
      .default(sql`(unixepoch())`),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("kb_articles_slug_idx").on(t.slug),
    index("kb_articles_cat_idx").on(t.categoryId),
  ]
)

export type Announcement = typeof announcements.$inferSelect
export type KbCategory = typeof kbCategories.$inferSelect
export type KbArticle = typeof kbArticles.$inferSelect

/* ───────────── Sécurité : historique des connexions ───────────── */

export const loginEvents = sqliteTable(
  "login_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
    /** success | bad_password | mfa_failed | mfa_required | blocked */
    result: text("result").notNull(),
    ipHint: text("ip_hint"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [index("login_events_user_idx").on(t.userId, t.createdAt)]
)

/* ───────────── Parrainage ───────────── */

/** Récompense versée au parrain (une seule par filleul). */
export const referralRewards = sqliteTable(
  "referral_rewards",
  {
    id: id(),
    referrerId: text("referrer_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refereeId: text("referee_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("referral_rewards_referee_idx").on(t.refereeId),
    index("referral_rewards_referrer_idx").on(t.referrerId),
  ]
)

/* ───────────── Devis ───────────── */

export const quotes = sqliteTable(
  "quotes",
  {
    id: id(),
    number: text("number").notNull(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    status: text("status", {
      enum: ["sent", "accepted", "declined", "cancelled"],
    })
      .notNull()
      .default("sent"),
    currency: text("currency").notNull().default("EUR"),
    subtotalCents: integer("subtotal_cents").notNull(),
    taxCents: integer("tax_cents").notNull(),
    totalCents: integer("total_cents").notNull(),
    taxRateBp: integer("tax_rate_bp").notNull().default(0),
    taxLabel: text("tax_label").notNull().default("TVA"),
    /** Lignes telles que saisies (prix selon le réglage TTC/HT). */
    lines: text("lines", { mode: "json" })
      .$type<
        { description: string; quantity: number; unitPriceCents: number }[]
      >()
      .notNull(),
    notes: text("notes"),
    validUntil: integer("valid_until", { mode: "timestamp" }).notNull(),
    invoiceId: text("invoice_id"),
    createdBy: text("created_by"),
    respondedAt: integer("responded_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("quotes_number_idx").on(t.number),
    index("quotes_user_idx").on(t.userId),
  ]
)

export type Quote = typeof quotes.$inferSelect

/* ───────────── Webhooks sortants ───────────── */

export const webhooks = sqliteTable("webhooks", {
  id: id(),
  name: text("name").notNull(),
  url: text("url").notNull(),
  /** Clé de signature HMAC-SHA256 (en-tête X-Webhook-Signature). */
  secret: text("secret").notNull(),
  events: text("events", { mode: "json" }).$type<string[]>().notNull(),
  isActive: integer("is_active", { mode: "boolean" }).notNull().default(true),
  createdBy: text("created_by"),
  createdAt: createdAt(),
})

export const webhookDeliveries = sqliteTable(
  "webhook_deliveries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    webhookId: text("webhook_id")
      .notNull()
      .references(() => webhooks.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    status: text("status", { enum: ["pending", "sent", "failed"] })
      .notNull()
      .default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: integer("next_attempt_at", { mode: "timestamp" }),
    responseCode: integer("response_code"),
    lastError: text("last_error"),
    createdAt: createdAt(),
  },
  (t) => [
    index("webhook_deliveries_state_idx").on(t.status, t.nextAttemptAt),
    index("webhook_deliveries_hook_idx").on(t.webhookId, t.createdAt),
  ]
)

export type Webhook = typeof webhooks.$inferSelect

/* ───────────── Support : réponses prédéfinies ───────────── */

export const cannedResponses = sqliteTable("canned_responses", {
  id: id(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by"),
  updatedAt: integer("updated_at", { mode: "timestamp" })
    .notNull()
    .default(sql`(unixepoch())`),
  createdAt: createdAt(),
})

/* ───────────── Demandes d'annulation de service ───────────── */

export const cancellationRequests = sqliteTable(
  "cancellation_requests",
  {
    id: id(),
    userId: text("user_id").references(() => users.id, {
      onDelete: "cascade",
    }),
    serviceType: text("service_type", { enum: ["vps", "game"] }).notNull(),
    serviceId: text("service_id").notNull(),
    serviceName: text("service_name").notNull(),
    mode: text("mode", { enum: ["immediate", "end_of_period"] }).notNull(),
    reason: text("reason"),
    status: text("status", {
      enum: ["pending", "approved", "rejected", "withdrawn"],
    })
      .notNull()
      .default("pending"),
    handledBy: text("handled_by"),
    handledAt: integer("handled_at", { mode: "timestamp" }),
    createdAt: createdAt(),
  },
  (t) => [
    index("cancellation_status_idx").on(t.status, t.createdAt),
    index("cancellation_service_idx").on(t.serviceType, t.serviceId),
  ]
)

export type CancellationRequest = typeof cancellationRequests.$inferSelect
