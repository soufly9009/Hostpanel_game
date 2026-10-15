# Hébergement de VPS — Proxmox VE

Next.js 16 + shadcn/ui + Drizzle (SQLite/libsql). Les clients commandent et
gèrent leurs VPS (conteneurs LXC ou VM QEMU) ; tout est provisionné via l'API
Proxmox VE.

## Démarrage

```bash
npm install
npm run dev
```

Puis ouvre **`/install/setup`** (`/login` et `/register` y redirigent tant
qu'aucun compte n'existe). L'assistant demande le **code d'installation**
affiché dans la console (`[install] …`) et écrit dans
`data/install-code.txt` (ou la valeur de `ADMIN_TOKEN` si elle est définie),
puis :

1. affiche un diagnostic de la configuration ;
2. teste la base de données (SQLite `file:` ou Turso `libsql://`) et
   applique les migrations ;
3. écrit `.env.local` (copie `.env.local.bak`, secrets jamais réaffichés,
   boutons pour générer `ADMIN_TOKEN`, `CRON_SECRET`, `SOU_API_KEY`) ;
4. crée le compte administrateur et termine l'installation.

Ensuite, l'assistant reste accessible aux administrateurs connectés. Après une
modification du `.env.local`, redémarre le serveur.

Sans l'assistant : `cp .env.example .env.local`, `npm run db:migrate`.

## Configuration Proxmox

| Variable | Valeur |
| --- | --- |
| `PROXMOX_URL` | `https://pve.exemple.com:8006` |
| `PROXMOX_TOKEN_ID` | `user@realm!nomdujeton` (Datacenter → Permissions → API Tokens) |
| `PROXMOX_TOKEN_SECRET` | secret du jeton |
| `PROXMOX_INSECURE_TLS` | `true` si le certificat est auto-signé |

Droits requis : `VM.Allocate`, `VM.Clone`, `VM.PowerMgmt`, `VM.Audit`,
`VM.Config.{CPU,Memory,Disk,Network,Options,Cloudinit}`,
`Datastore.AllocateSpace`, `Datastore.Audit`, `Sys.Audit` (et `SDN.Use` sur
Proxmox 8+). Rôles prêts à l'emploi : `PVEVMAdmin`, `PVEDatastoreUser`,
`PVEAuditor`, `PVESDNUser`.

> Si « Privilege Separation » est activé sur le jeton, il n'hérite pas des
> droits de son utilisateur (même `root@pam`) : donne-lui les rôles
> explicitement, ou recrée-le sans séparation de privilèges.

`/admin` affiche un audit des droits (privilèges effectifs + tests réels) ;
la même information est disponible via `GET /api/admin/proxmox/permissions`.

## Fonctionnement

1. L'admin crée des **offres** (`/admin/plans`) : type (LXC/QEMU), nœud,
   template, stockage, pont réseau, vCPU, RAM, disque. Les listes sont chargées
   en direct depuis Proxmox.
2. Un client choisit une offre (`/servers/new`) et un mot de passe root (non
   conservé). Le VPS est créé :
   - **LXC** : depuis l'archive du template, DHCP, démarrage automatique ;
   - **QEMU** : clone d'un template cloud-init, mot de passe et réseau injectés,
     disque agrandi.
3. Le client démarre / arrête / redémarre, voit CPU, RAM, disque, réseau et IP
   (`/servers/[id]`).
4. L'admin peut suspendre / supprimer des VPS et fixer la limite par client.

## Structure

- `lib/proxmox/client.ts` — client API Proxmox ; `permissions.ts` — audit des droits
- `lib/provision.ts` — état, power, suppression, suspension
- `lib/servers/actions.ts`, `lib/admin/actions.ts` — server actions
- `lib/auth/` — inscription, connexion, sessions
- `lib/db/schema.ts` — users, sessions, plans, servers
- `app/(client)/` — espace client ; `app/(admin)/admin/` — administration
