import "server-only"

/**
 * Scripts d'installation (bash, Debian / Ubuntu), exécutés en root dans le
 * conteneur via `pct exec`. Aucun paramètre fourni par l'utilisateur n'y est
 * injecté : ce sont des textes fixes.
 */

const PRELUDE = `set -e
export DEBIAN_FRONTEND=noninteractive
. /etc/os-release
case "$ID $ID_LIKE" in
  *debian*|*ubuntu*) ;;
  *) echo "Système non pris en charge : $PRETTY_NAME (Debian ou Ubuntu requis)"; exit 3 ;;
esac
# Le réseau du conteneur peut mettre quelques secondes à monter.
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  apt-get update -qq && break
  echo "apt-get update : nouvel essai dans 10 s…"; sleep 10
done
apt_install() { apt-get install -y -qq --no-install-recommends "$@"; }
`

const SCRIPTS: Record<string, string> = {
  docker: `
if command -v docker >/dev/null 2>&1; then echo "Docker déjà installé"; docker --version; exit 0; fi
apt_install ca-certificates curl
curl -fsSL https://get.docker.com -o /tmp/get-docker.sh
sh /tmp/get-docker.sh
rm -f /tmp/get-docker.sh
systemctl enable --now docker
docker --version
docker compose version
docker run --rm hello-world >/dev/null && echo "Test hello-world : OK"
`,
  portainer: `
command -v docker >/dev/null 2>&1 || { echo "Docker est requis"; exit 4; }
if docker ps -a --format '{{.Names}}' | grep -qx portainer; then echo "Portainer déjà présent"; docker start portainer >/dev/null; exit 0; fi
docker volume create portainer_data >/dev/null
docker run -d -p 9443:9443 --name portainer --restart=always \\
  -v /var/run/docker.sock:/var/run/docker.sock \\
  -v portainer_data:/data portainer/portainer-ce:lts
echo "Portainer démarré sur le port 9443"
`,
  nginx: `
apt_install nginx
systemctl enable --now nginx
nginx -v
`,
  certbot: `
apt_install certbot python3-certbot-nginx
certbot --version
`,
  nodejs: `
apt_install ca-certificates curl gnupg
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -q '^v22'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh
  bash /tmp/nodesource.sh
  rm -f /tmp/nodesource.sh
  apt_install nodejs
fi
npm install -g pm2 --silent
echo "node $(node -v) · npm $(npm -v) · pm2 $(pm2 -v)"
`,
  python: `
apt_install python3 python3-pip python3-venv
python3 --version
`,
  mariadb: `
apt_install mariadb-server
systemctl enable --now mariadb
mariadb --version
`,
  postgresql: `
apt_install postgresql
systemctl enable --now postgresql
psql --version
`,
  redis: `
apt_install redis-server
systemctl enable --now redis-server
redis-server --version
`,
  fail2ban: `
apt_install fail2ban
systemctl enable --now fail2ban
fail2ban-client --version
`,
  tools: `
apt_install git curl wget htop unzip nano screen ca-certificates
git --version
`,
}

export function installScript(appId: string) {
  const body = SCRIPTS[appId]
  return body ? `${PRELUDE}\n${body}` : null
}
