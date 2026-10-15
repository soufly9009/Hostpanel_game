/**
 * Catalogue de ports courants (client + serveur). Chaque entrée produit une ou
 * plusieurs règles « entrant / autoriser ». Les plages utilisent la syntaxe
 * Proxmox (`2456:2458`).
 */

export type CatalogCategory =
  | "Jeux"
  | "Bots & musique"
  | "Voix"
  | "Web & applications"
  | "Bases de données"
  | "Accès & réseau"

export type CatalogRule = {
  proto: "tcp" | "udp" | "icmp"
  dport: string | null
}

export type CatalogEntry = {
  id: string
  label: string
  category: CatalogCategory
  rules: CatalogRule[]
  /** Service d'administration/données : à restreindre à une IP. */
  sensitive?: boolean
  note?: string
}

const tcp = (dport: string): CatalogRule => ({ proto: "tcp", dport })
const udp = (dport: string): CatalogRule => ({ proto: "udp", dport })

export const CATALOG_CATEGORIES: CatalogCategory[] = [
  "Jeux",
  "Bots & musique",
  "Voix",
  "Web & applications",
  "Bases de données",
  "Accès & réseau",
]

export const CATALOG: CatalogEntry[] = [
  /* ───── Jeux ───── */
  {
    id: "minecraft-java",
    label: "Minecraft Java",
    category: "Jeux",
    rules: [tcp("25565")],
  },
  {
    id: "minecraft-bedrock",
    label: "Minecraft Bedrock",
    category: "Jeux",
    rules: [udp("19132:19133")],
  },
  {
    id: "minecraft-rcon",
    label: "Minecraft RCON",
    category: "Jeux",
    rules: [tcp("25575")],
    sensitive: true,
  },
  {
    id: "source",
    label: "Source (CS2, CS:GO, GMod, TF2, L4D2)",
    category: "Jeux",
    rules: [tcp("27015"), udp("27015"), udp("27020")],
  },
  { id: "rust", label: "Rust", category: "Jeux", rules: [udp("28015")] },
  {
    id: "rust-rcon",
    label: "Rust RCON",
    category: "Jeux",
    rules: [tcp("28016")],
    sensitive: true,
  },
  {
    id: "valheim",
    label: "Valheim",
    category: "Jeux",
    rules: [udp("2456:2458")],
  },
  {
    id: "ark",
    label: "ARK: Survival",
    category: "Jeux",
    rules: [udp("7777:7778"), udp("27015")],
  },
  { id: "terraria", label: "Terraria", category: "Jeux", rules: [tcp("7777")] },
  {
    id: "fivem",
    label: "FiveM / RedM",
    category: "Jeux",
    rules: [tcp("30120"), udp("30120")],
  },
  { id: "palworld", label: "Palworld", category: "Jeux", rules: [udp("8211")] },
  {
    id: "factorio",
    label: "Factorio",
    category: "Jeux",
    rules: [udp("34197")],
  },
  {
    id: "satisfactory",
    label: "Satisfactory",
    category: "Jeux",
    rules: [udp("7777"), tcp("7777"), tcp("8888")],
  },
  {
    id: "7dtd",
    label: "7 Days to Die",
    category: "Jeux",
    rules: [tcp("26900"), udp("26900:26903")],
  },
  {
    id: "dayz",
    label: "DayZ",
    category: "Jeux",
    rules: [udp("2302:2305"), udp("27016")],
  },
  {
    id: "among-us",
    label: "Among Us (Impostor)",
    category: "Jeux",
    rules: [udp("22023")],
  },

  /* ───── Bots & musique ───── */
  {
    id: "lavalink",
    label: "Lavalink",
    category: "Bots & musique",
    rules: [tcp("2333")],
    note: "Nécessaire seulement si ton bot se connecte à Lavalink depuis une autre machine. Restreins-le à l'IP du bot.",
  },
  {
    id: "bot-dashboard",
    label: "Dashboard / API de bot (3000)",
    category: "Bots & musique",
    rules: [tcp("3000")],
  },
  {
    id: "bot-api-alt",
    label: "API de bot (8080)",
    category: "Bots & musique",
    rules: [tcp("8080")],
  },

  /* ───── Voix ───── */
  {
    id: "teamspeak",
    label: "TeamSpeak (voix + fichiers)",
    category: "Voix",
    rules: [udp("9987"), tcp("30033")],
  },
  {
    id: "teamspeak-query",
    label: "TeamSpeak ServerQuery",
    category: "Voix",
    rules: [tcp("10011")],
    sensitive: true,
  },
  {
    id: "mumble",
    label: "Mumble",
    category: "Voix",
    rules: [tcp("64738"), udp("64738")],
  },

  /* ───── Web & applications ───── */
  {
    id: "http",
    label: "HTTP (80)",
    category: "Web & applications",
    rules: [tcp("80")],
  },
  {
    id: "https",
    label: "HTTPS (443)",
    category: "Web & applications",
    rules: [tcp("443")],
  },
  {
    id: "plex",
    label: "Plex",
    category: "Web & applications",
    rules: [tcp("32400")],
  },

  /* ───── Bases de données ───── */
  {
    id: "mysql",
    label: "MySQL / MariaDB",
    category: "Bases de données",
    rules: [tcp("3306")],
    sensitive: true,
  },
  {
    id: "postgres",
    label: "PostgreSQL",
    category: "Bases de données",
    rules: [tcp("5432")],
    sensitive: true,
  },
  {
    id: "redis",
    label: "Redis",
    category: "Bases de données",
    rules: [tcp("6379")],
    sensitive: true,
  },
  {
    id: "mongodb",
    label: "MongoDB",
    category: "Bases de données",
    rules: [tcp("27017")],
    sensitive: true,
  },

  /* ───── Accès & réseau ───── */
  {
    id: "ssh",
    label: "SSH (22)",
    category: "Accès & réseau",
    rules: [tcp("22")],
  },
  {
    id: "ping",
    label: "Ping (ICMP)",
    category: "Accès & réseau",
    rules: [{ proto: "icmp", dport: null }],
  },
  {
    id: "wireguard",
    label: "WireGuard",
    category: "Accès & réseau",
    rules: [udp("51820")],
  },
  {
    id: "openvpn",
    label: "OpenVPN",
    category: "Accès & réseau",
    rules: [udp("1194")],
  },
  {
    id: "rdp",
    label: "Bureau à distance (RDP)",
    category: "Accès & réseau",
    rules: [tcp("3389")],
    sensitive: true,
  },
  {
    id: "vnc",
    label: "VNC",
    category: "Accès & réseau",
    rules: [tcp("5900")],
    sensitive: true,
  },
]

export const CATALOG_BY_ID = new Map(CATALOG.map((e) => [e.id, e]))

/** Résumé lisible des ports d'une entrée, ex. « TCP 27015 · UDP 27015 ». */
export function summarize(entry: CatalogEntry) {
  return entry.rules
    .map((r) => (r.dport ? `${r.proto.toUpperCase()} ${r.dport}` : "ICMP"))
    .join(" · ")
}
