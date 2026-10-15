import type { RuleShape } from "./rules"

/** Profils de configuration automatique du pare-feu (client + serveur). */

export type FirewallProfileId = "minimal" | "web" | "open"

export type FirewallProfile = {
  id: FirewallProfileId
  label: string
  description: string
  /** Politique entrante appliquée une fois les règles en place. */
  policyIn: "ACCEPT" | "DROP"
  rules: (RuleShape & { comment: string })[]
}

const inAccept = (
  proto: string,
  dport: string | null,
  comment: string
): FirewallProfile["rules"][number] => ({
  type: "in",
  action: "ACCEPT",
  proto,
  dport,
  source: null,
  comment,
})

const SSH = inAccept("tcp", "22", "SSH")
const PING = inAccept("icmp", null, "Ping")
const HTTP = inAccept("tcp", "80", "HTTP")
const HTTPS = inAccept("tcp", "443", "HTTPS")

export const FIREWALL_PROFILES: FirewallProfile[] = [
  {
    id: "minimal",
    label: "Sécurisé (SSH + ping)",
    description:
      "Bloque tout le trafic entrant sauf SSH (22) et le ping. Recommandé pour un serveur personnel.",
    policyIn: "DROP",
    rules: [SSH, PING],
  },
  {
    id: "web",
    label: "Serveur web (SSH, HTTP, HTTPS)",
    description:
      "Bloque tout le trafic entrant sauf SSH (22), HTTP (80), HTTPS (443) et le ping.",
    policyIn: "DROP",
    rules: [SSH, PING, HTTP, HTTPS],
  },
  {
    id: "open",
    label: "Ouvert (tout autoriser)",
    description:
      "Active le pare-feu en autorisant tout le trafic entrant. Aucun blocage, utile pour ajouter tes propres règles.",
    policyIn: "ACCEPT",
    rules: [],
  },
]

export function getProfile(id: string) {
  return FIREWALL_PROFILES.find((p) => p.id === id)
}
