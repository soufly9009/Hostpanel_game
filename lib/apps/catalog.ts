/**
 * Catalogue des applications installables dans un VPS LXC (module pur,
 * partagé serveur/client). Les scripts sont dans `scripts.ts` (serveur).
 */

export type AppDef = {
  id: string
  name: string
  description: string
  category:
    | "Conteneurs"
    | "Web"
    | "Bases de données"
    | "Langages"
    | "Sécurité"
    | "Outils"
  /** Applications à installer avant (dans le même VPS). */
  requires?: string[]
  /** Docker et dérivés : options LXC nesting + keyctl, redémarrage du conteneur. */
  needsNesting?: boolean
  /** Ports à ouvrir dans le pare-feu pour y accéder. */
  ports?: { port: number; label: string }[]
  /** Indication affichée après l'installation. */
  afterInstall?: string
}

export const APPS: AppDef[] = [
  {
    id: "docker",
    name: "Docker",
    description: "Moteur Docker et plugin Compose (docker compose).",
    category: "Conteneurs",
    needsNesting: true,
    afterInstall: "Teste avec : docker run --rm hello-world",
  },
  {
    id: "portainer",
    name: "Portainer",
    description: "Interface web pour gérer tes conteneurs Docker.",
    category: "Conteneurs",
    requires: ["docker"],
    needsNesting: true,
    ports: [{ port: 9443, label: "Interface Portainer (HTTPS)" }],
    afterInstall:
      "Ouvre https://IP-du-VPS:9443 dans les 5 minutes pour créer le compte administrateur.",
  },
  {
    id: "nginx",
    name: "Nginx",
    description: "Serveur web et reverse proxy.",
    category: "Web",
    ports: [
      { port: 80, label: "HTTP" },
      { port: 443, label: "HTTPS" },
    ],
    afterInstall:
      "Site par défaut : /var/www/html. Configuration : /etc/nginx/sites-available.",
  },
  {
    id: "certbot",
    name: "Certbot",
    description:
      "Certificats HTTPS gratuits Let's Encrypt (avec le plugin Nginx).",
    category: "Web",
    requires: ["nginx"],
    afterInstall: "Lance : certbot --nginx -d ton-domaine.fr",
  },
  {
    id: "nodejs",
    name: "Node.js 22 LTS",
    description: "Node.js, npm et le gestionnaire de processus PM2.",
    category: "Langages",
    afterInstall:
      "Lance une application en permanence : pm2 start app.js && pm2 save && pm2 startup",
  },
  {
    id: "python",
    name: "Python 3",
    description: "Python 3, pip et venv pour tes scripts et bots.",
    category: "Langages",
    afterInstall:
      "Crée un environnement : python3 -m venv .venv && . .venv/bin/activate",
  },
  {
    id: "mariadb",
    name: "MariaDB",
    description:
      "Base de données compatible MySQL (écoute en local uniquement).",
    category: "Bases de données",
    afterInstall: "Sécurise l'installation : mariadb-secure-installation",
  },
  {
    id: "postgresql",
    name: "PostgreSQL",
    description: "Base de données relationnelle (écoute en local uniquement).",
    category: "Bases de données",
    afterInstall: "Console : sudo -u postgres psql",
  },
  {
    id: "redis",
    name: "Redis",
    description:
      "Cache et base clé-valeur en mémoire (écoute en local uniquement).",
    category: "Bases de données",
  },
  {
    id: "fail2ban",
    name: "Fail2ban",
    description:
      "Bloque les adresses qui tentent de deviner ton mot de passe SSH.",
    category: "Sécurité",
  },
  {
    id: "tools",
    name: "Outils de base",
    description: "git, curl, wget, htop, unzip, nano, screen.",
    category: "Outils",
  },
]

export const APP_IDS = APPS.map((a) => a.id)
export const appById = (id: string) => APPS.find((a) => a.id === id)

/**
 * Ordre d'installation : les dépendances d'abord, sans doublon.
 * Ex. ["portainer"] → ["docker", "portainer"].
 */
export function withDependencies(ids: string[]) {
  const out: string[] = []
  const visit = (id: string) => {
    const app = appById(id)
    if (!app || out.includes(id)) return
    for (const dep of app.requires ?? []) visit(dep)
    out.push(id)
  }
  for (const id of ids) visit(id)
  return out
}
