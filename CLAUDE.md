# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

@AGENTS.md

## Projet

Panel d'hébergement (UI en français, tutoiement) : les clients commandent/gèrent des VPS Proxmox (LXC ou QEMU) et des sites web Plesk. Next.js 16 App Router, React 19, shadcn/ui sur **base-ui** (un `Button` avec `render={<Link/>}` exige `nativeButton={false}`), Tailwind 4, Drizzle + libsql (SQLite `data/app.db`), zod 4. Le README décrit la configuration Proxmox et les droits requis.

## Commandes

```bash
npm run dev            # serveur de dev (une seule instance par dossier : « Another next dev server is already running »)
npm run build          # build de production
npm run lint           # eslint (le build ne lint pas)
npm run typecheck      # tsc --noEmit
npx prettier --write <fichiers>   # format (LF, sans point-virgule, guillemets doubles)
npm run db:generate    # génère une migration drizzle/ après modif de lib/db/schema.ts
npm run db:migrate     # applique les migrations (ou /install/setup, Admin → Migrations, POST /api/admin/db/deploy avec ADMIN_TOKEN)
```

Pas de suite de tests. La logique a été vérifiée avec de faux serveurs (HTTPS Proxmox/Plesk, ssh2) ou en isolant un module : le copier dans un dossier temporaire en retirant `import "server-only"` et les alias `@/`, lancer avec `node --experimental-strip-types`, puis supprimer. Node strip-types ne gère pas les « parameter properties » de classes. Les scripts Node hors du projet trouvent `@libsql/client` via `NODE_PATH=<projet>/node_modules` (CommonJS).

Après un changement de schéma : `db:generate` puis `db:migrate`, et redémarrer `npm run dev`. Les migrations de remplissage se font en éditant le SQL généré dans `drizzle/`. En cas d'erreur d'import fantôme (« Export X doesn't exist ») : supprimer `.next` et relancer.

## Architecture

**Base de données** (`lib/db/index.ts`, `serialize.ts`) : en SQLite local, toutes les opérations du client libsql sont SÉRIALISÉES dans le processus (le pilote est synchrone : une écriture qui croise une transaction ouverte échoue en SQLITE_BUSY, un busy timeout ne peut pas aider). Conséquence : dans un `db.transaction(async (tx) => …)`, n'utiliser QUE `tx` — un appel à `db` attendrait la fin de la transaction (blocage).

**Env** : tout passe par `lib/env.ts` (`envSchema` zod ; une variable vide = absente). Exporte `proxmoxConfigured` / `pleskConfigured`. Voir `.env.example`.

**Installation** (`app/install/setup`, `lib/install/`) : sans aucun compte, accès par code d'installation (`ADMIN_TOKEN`, sinon aléatoire dans `data/install-code.txt` + console au démarrage via `instrumentation.ts`) mis en cookie `install_token` ; ensuite admin connecté seulement. Le 1er administrateur se crée UNIQUEMENT ici (`/register` refuse si 0 compte ; `/login` et `/register` redirigent). `envfile.ts` réécrit `.env.local` : seulement les clés de `fields.ts`, validées par `envSchema`, `$` échappé (dotenv-expand), sauvegarde `.bak`.

**Auth** (`lib/auth/`) : hash scrypt, cookie `session` (jeton dont le SHA-256 est stocké), `requireUser` / `requireAdmin`. Espaces séparés : `app/(client)/`, `app/(support)/support/`, `app/(admin)/admin/`. Les pages publiques hors espace : `/legal`, `/install`, `/status`.

**Rôles et permissions** : `users.role` = user | support | admin ; `lib/auth/roles.ts` (catalogue `SYSTEM_PERMISSIONS`, défauts du support), `lib/auth/permissions.ts` (`permissionsFor`, `can`, `requireStaff`, `requirePermission`, rôles système semés par `ensureRbacSeed`). L'admin a tout ; un support dépend de `users.roleId` (table `roles`) sinon des défauts ; rôle introuvable = aucun droit. Une permission personnalisée n'a d'effet que si du code la vérifie. Les pages personnel vivent sous `/support/*` (aussi liées depuis le menu admin) et vérifient la permission ; `supportNav` filtre ses entrées par `permissions`.

**Proxmox** (`lib/proxmox/`) : `client.ts` est la seule porte d'entrée vers l'API (`node:https`, jeton API). `request()` journalise les écritures et erreurs dans `proxmox_logs` (jamais les corps) ; `rawRequest()` ne journalise pas. LXC = création depuis template ; QEMU = clone d'un template cloud-init. `status.ts`, `firewall.ts` (+ `lib/firewall/`), `permissions.ts` (audit des droits, privilege separation), `exec.ts` (`pct exec` via SSH sur l'hôte : l'API REST ne sait pas exécuter dans un LXC).

**Couche métier** : `lib/provision.ts` (statut live + IP, power, suppression, suspension), `lib/servers/actions.ts` et `lib/admin/actions.ts` (server actions ; état de retour `{error?, ok?, notice?} | undefined` consommé par `useActionState`), `lib/servers/access.ts` (propriétaire ou admin).

**Renouvellements** : chaque VPS a `expiresAt` ; 1 renouvellement manuel par période (`lastRenewedAt`) ; plafond de 2 périodes d'avance. `lib/scheduler.ts` (démarré par `instrumentation.ts`) vérifie toutes les `RENEW_CHECK_EVERY_DAYS` jours ; exécution réservée atomiquement en base (`job_runs`). Déclenchable via `POST /api/cron/renewals` (CRON_SECRET) ou l'admin. `lib/jobs.ts` : tâches quotidiennes (snapshots auto, notifications d'échéance/certificat) avec la même réservation.

**Terminal SSH web** (`lib/ssh/sessions.ts`) : connexion `ssh2` vers l'IP du VPS **lue en base** (jamais fournie par le client) ; sessions en mémoire sur `globalThis` (instance unique), sortie SSE base64, entrées en POST. Empreinte d'hôte TOFU dans `servers.sshHostKey`. `ssh2` est dans `serverExternalPackages`.

**Snapshots** : `lib/proxmox/snapshots.ts` + `lib/servers/snapshot-actions.ts` (limite `plans.snapshotLimit`, auto `auto-YYYYMMDD` purgés selon SNAPSHOT_AUTO_KEEP).

**Plesk** (`lib/plesk/client.ts`, `lib/sites/`) : API REST v2 (`X-API-Key`) ; SSL Let's Encrypt via la passerelle CLI ; fichiers par FTP (`basic-ftp`) avec mot de passe régénéré à chaque envoi (jamais stocké) ; certificat servi inspecté par sonde TLS (refuse les IP privées). Envoi via route handler `app/api/sites/[id]/files` (server actions limitées à 1 Mo).

**Serveurs de jeu / Pterodactyl** (`lib/pterodactyl/`, `lib/games/`, `/games`, `/admin/games`) : les clients n'ont AUCUN compte ni accès Pterodactyl (pas de SFTP) ; tous les serveurs appartiennent à `PTERODACTYL_OWNER_ID`. `client.ts` est la seule porte d'entrée : API Application (`ptla_`, création avec `deploy.locations`, variables d'egg par défaut + celles de l'offre, suspension, suppression) et API Client (`ptlc_` d'un compte ADMIN Pterodactyl : power, commandes, ressources, jeton websocket). Alerte Discord seulement pour 401 / panne réseau / 5xx sans corps Pterodactyl (un 502 « serveur éteint » est métier). `console.ts` : le serveur du panel ouvre le websocket Wings (en-tête `Origin` = PTERODACTYL_URL, renouvelle le jeton sur « token expiring ») et diffuse en SSE (`/api/games/[id]/console`) ; une connexion partagée par serveur, fermée 30 s après le dernier spectateur. Échéances traitées par `processGameExpiries` depuis `runRenewalCheck` ; facturation en crédits via `chargeForPlan`.

**Facturation façon WHMCS** (`lib/billing/`) : mode `off` (crédits débités directement si activé) ou `invoices` (réglages `app_settings.billing` dans `/admin/billing`). Factures prêtes pour l'argent réel : numérotation continue par préfixe+année (`invoice_sequences`, attribuée dans la transaction), vendeur/acheteur figés, jamais modifiées ni supprimées — annulation = AVOIR (`credit_note`, montants négatifs). `markPaid` (transition atomique unpaid→paid) puis `applyPaidEffects` prolonge les services (commande : période depuis le paiement ; renouvellement : `extendedExpiry`), une fois par ligne (`applied`). Doublon de renouvellement empêché par l'index unique `(service_type, service_id, period_key)` (libéré par un avoir). Commande en mode factures : service actif jusqu'à `orderDueDays`, facture + `tryAutoPay` (solde de crédits). `lib/billing/jobs.ts` (horaire) : factures de renouvellement N jours avant, paiement auto, rappel puis relance. La suspension reste celle de l'échéance. Factures conservées à la suppression du compte (`user_id` → null). PDF = page `/print/invoices/[id]` + impression navigateur.

**E-mails** (`lib/mail/`) : `queueUserEmail(userId, modèle, vars)` n'échoue jamais ; file `email_queue` (corps effacé après envoi ou 5 échecs), traitée chaque minute par le planificateur ; sans SMTP, statut « skipped ». Modèles par défaut dans `templates.ts`, surcharges dans `email_templates` (`/admin/emails`). Liens via `PANEL_PUBLIC_URL`. Mot de passe oublié : `lib/auth/reset.ts` (jeton SHA-256, 30 min, usage unique, 3/h, réponse identique que le compte existe ou non).

**Fiche client et contenus** : `/admin/users/[id]` (services, factures, solde, tickets, notes internes `client_notes`, connexion « en tant que » : session client de 2 h, session admin mise de côté dans le cookie `admin_return`, jamais vers un autre admin). Annonces (`/news`) et base de connaissances (`/help`) éditées dans `/support/content` (permission `content.manage`) ; pages publiques via `components/public-shell.tsx`.

**Sécurité des comptes** (`lib/security/`) : 2FA TOTP maison (`totp.ts`, RFC 6238, ±1 pas, rejeu refusé via le dernier pas en mémoire) ; secret chiffré AES-256-GCM avec `APP_SECRET` (`crypto.ts`, sinon préfixe `plain:`) ; codes de secours stockés en SHA-256, consommés atomiquement. Connexion : mot de passe OK + 2FA → jeton en mémoire (cookie `mfa_pending`, 5 min, 5 essais) puis `/login/2fa`. Sessions : navigateur + IP TRONQUÉE (`request.ts`), `login_events` purgés à 90 j. Inscription : champ piège `website`, adresses jetables, 5/h par IP (`signup.ts`).

**Autres modules** : parrainage (`lib/referrals/`, bonus une seule fois par filleul : index unique + clé d'idempotence, déclencheur dans les réglages des crédits) ; devis (`lib/quotes/`, numéros `DV-AAAA-…` via `nextNumber`, acceptation atomique → facture) ; webhooks sortants (`lib/webhooks/`, `emitEvent` n'échoue jamais, file `webhook_deliveries`, HMAC `sha256=` sur `${timestamp}.${corps}`, 6 essais) ; annulations (`lib/cancellations/`, validées par un admin : immédiate = `removeService`, sinon `cancelAtPeriodEnd` → plus de facture et suppression à l'échéance dans `renewals.ts`) ; réponses prédéfinies et note de satisfaction des tickets (`lib/tickets/extra-actions.ts`) ; rapports, exports CSV (`/api/admin/export/[kind]`, admin, formules neutralisées) et recherche globale (`/admin/search`).

**IPAM et réseau** : `lib/ipam/` (CIDR en BigInt ; transitions d'adresse = `UPDATE … WHERE status IN (…)` atomiques + index unique). `lib/servers/network-plan.ts` revalide DHCP/statique côté serveur (réservation avant `createVps`, annulation seulement si `vpsExists` est faux) ; `network-verify.ts` ne marque « synced » que sur adresses OBSERVÉES. IPAM et configuration Proxmox sont suivis séparément (`servers.netSyncState`).

**Maintenance et migrations** : `lib/maintenance/` (dates en UTC, fuseau = libellé), `lib/status.ts` (page `/status` : seuls `isPublic` / `customerMessage`). Programmer n'exécute jamais rien. `lib/migrations/deploy.ts` : migrations en attente (journal Drizzle vs `__drizzle_migrations`), annonce + confirmation pour les destructives, sauvegarde `VACUUM INTO data/backups/`, journal `db_deploy_runs`. Jamais de `db:migrate` au démarrage.

**Supervision Discord** (`lib/discord/`) : `logging.ts` écrit TOUJOURS l'événement (expurgé par `redact.ts`) dans `system_events`, qui sert de file persistante (`flushPending` chaque minute). Déduplication, 20 envois/min, `Retry-After`, abandon après 6 tentatives. Règle : UN événement par opération métier ; les clients Proxmox/Plesk n'émettent que les pannes de connectivité. `auditSensitive` pour les changements sensibles. Webhook dans `DISCORD_LOG_WEBHOOK_URL`, préférences dans `app_settings`.

**Tickets** : `/tickets` (client), `/support` (file). Note interne (`isInternal`) jamais lue côté client (requête filtrée). `lib/ai/openrouter.ts` : modèles « :free » uniquement, entrée expurgée, repli de modèle. Numérotation dans l'INSERT (sous-requête). Conflit d'unicité : `isUniqueViolation` (Drizzle enveloppe l'erreur).

**Crédits, coupons, cartes cadeaux** (`lib/wallet/`) : monnaie virtuelle SANS valeur monétaire, en centimes. `users.balanceCents` ne bouge QUE via `moveBalance` (`service.ts`) : UPDATE conditionnel (jamais négatif sauf `allowNegative`, plafond) + ligne `wallet_transactions` dans la même transaction ; idempotence par index unique `(user_id, idempotency_key)`. Coupon = code réutilisable (la clé `coupon:<id>:<n>` bloque les doubles utilisations concurrentes) ; carte cadeau = code `XXXX-XXXX-XXXX-XXXX` passé atomiquement active→redeemed. `billing.ts` (désactivé par défaut, `app_settings.wallet`) : débit avant création/renouvellement d'un VPS, remboursement si échec ; admins jamais débités.

**Documents légaux et RGPD** (`lib/legal/`, `lib/account/privacy.ts`) : `legal_sections` = brouillon ; publier fige une copie dans `legal_versions` (seule source publique, `/legal/[slug]?v=`). Version majeure d'un document `requiresAcceptance` → `acceptanceVersion` relevée → le layout client redirige vers `/legal/accept`. Modèles par défaut publiés une fois (`app_settings` `legal.seeded`). `/legal/my-data` (hors layout client, donc accessible sans acceptation) : export JSON (`/api/account/export`) et suppression (refusée s'il reste VPS/sites ; journal d'activité anonymisé ; suppressions explicites, sans compter sur les clés étrangères SQLite).

**API REST** (`app/api/v1/`, `lib/api/`) : `Authorization: Bearer sou_…` ; clés créées dans `/admin/api` (seul le SHA-256 est stocké, portées `users:*`, `wallet:*`, `coupons:*`) + clé maîtresse `SOU_API_KEY`. 120 req/min par clé (mémoire). Montants en `amountCents` ; `Idempotency-Key` sur les mouvements de solde. La logique métier est partagée avec les server actions (`lib/wallet/service.ts`).

**UI** : briques partagées dans `components/kit.tsx` (PageHeader, StatCard, StatusBadge, EmptyState, ErrorState, Section), `kit-client.tsx` (ConfirmDialog avec `requireText`, CopyButton, SearchInput), `tab-nav.tsx`, `pagination.tsx`. Les formulaires d'un domaine vivent dans `components/<domaine>-controls.tsx`. Thème sombre par défaut.

## Conventions

- Next 16 : `params`/`searchParams` sont des `Promise` ; `react-hooks/purity` interdit `Date.now()` en rendu (helpers `lib/expiry.ts` : `isPast`, `daysUntil`…).
- Les route handlers sensibles renvoient 404 (pas 401) pour un utilisateur non connecté ou non propriétaire ; l'API v1 renvoie 401/403 JSON.
- Journal d'activité via `logActivity` (jamais de secret). Ne jamais afficher/journaliser `PROXMOX_TOKEN_SECRET`, `PLESK_API_KEY`, mots de passe SSH/FTP, clés `sou_`.
- État partagé en mémoire (sessions SSH, limites de débit, verrous) sur `globalThis` : le panel suppose une instance unique.
- Projet sous Windows, versionné avec git (`.env*`, `/data` et `.next` ignorés ; seul `.env.example` est suivi) ; tuer un processus avec PowerShell `Stop-Process`.
