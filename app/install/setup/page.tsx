import Link from "next/link"

import {
  CreateAdminForm,
  DatabaseTestForm,
  EnvForm,
  MigrateButton,
  UnlockForm,
} from "@/components/install-controls"
import { ErrorState, Section, StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { env } from "@/lib/env"
import { installAccess, userCount } from "@/lib/install/access"
import { readEnvFile } from "@/lib/install/envfile"
import { ENV_FIELDS } from "@/lib/install/fields"
import { getMigrationState } from "@/lib/migrations/deploy"

export const metadata = { title: "Installation", robots: { index: false } }
export const dynamic = "force-dynamic"

/** URL de base affichable (sans jeton ni identifiants). */
function safeUrl(u: string) {
  try {
    if (u.startsWith("file:")) return u
    const x = new URL(u)
    return `${x.protocol}//${x.host}${x.pathname}`
  } catch {
    return "(URL invalide)"
  }
}

function Step({
  n,
  title,
  done,
  children,
  description,
}: {
  n: number
  title: string
  done?: boolean
  description?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <Section
      title={`${n}. ${title}${done ? " ✓" : ""}`}
      description={description}
    >
      {children}
    </Section>
  )
}

export default async function InstallSetupPage() {
  const access = await installAccess()

  if (access.mode === "locked") {
    return access.installed ? (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Installation terminée
        </h1>
        <p className="text-sm text-muted-foreground">
          Le panel est déjà installé. Connecte-toi avec un compte administrateur
          pour revenir sur cet assistant (configuration, migrations).
        </p>
        <div>
          <Button nativeButton={false} render={<Link href="/login" />}>
            Se connecter
          </Button>
        </div>
      </>
    ) : (
      <>
        <h1 className="text-2xl font-semibold tracking-tight">
          Bienvenue : installons le panel
        </h1>
        <p className="text-sm text-muted-foreground">
          Pour prouver que tu es l&apos;exploitant du serveur, saisis le code
          d&apos;installation. Il est affiché dans la console du serveur au
          démarrage (ligne « [install] ») et enregistré dans{" "}
          <code className="font-mono">data/install-code.txt</code>. Si{" "}
          <code className="font-mono">ADMIN_TOKEN</code> est défini dans le
          .env, c&apos;est sa valeur.
        </p>
        <Section title="Déverrouiller l'assistant">
          <UnlockForm />
        </Section>
      </>
    )
  }

  const [users, migrations, file] = await Promise.all([
    userCount(),
    getMigrationState(),
    readEnvFile(),
  ])
  const dbReady = users !== null
  const pending = migrations.pending.length

  const fields = ENV_FIELDS.map((f) => {
    const value = file.values[f.key] ?? ""
    return { ...f, value, configured: value !== "" }
  })
  const missing = fields.filter((f) => f.recommended && !f.configured)
  // Valeurs du fichier différentes de celles chargées : redémarrage requis.
  const stale = fields.filter(
    (f) => (file.values[f.key] ?? "") !== (process.env[f.key] ?? "")
  )

  return (
    <>
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          Assistant d&apos;installation
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {access.mode === "admin"
            ? `Connecté en administrateur (${access.user.email}). Tu peux revoir la configuration à tout moment.`
            : "Configure la base de données et l'environnement, puis crée le compte administrateur."}
        </p>
      </div>

      {stale.length > 0 && (
        <ErrorState
          title="Redémarrage nécessaire"
          message={`.env.local a été modifié (${stale.map((f) => f.key).join(", ")}) : redémarre le serveur (npm run dev / npm start) pour appliquer.`}
        />
      )}

      <Step n={1} title="Diagnostic" done={file.exists && missing.length === 0}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">Fichier .env.local</dt>
            <dd>
              {file.exists ? (
                <StatusBadge tone="success">Présent</StatusBadge>
              ) : (
                <StatusBadge tone="warning">Absent : il sera créé</StatusBadge>
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Environnement</dt>
            <dd>
              Node {process.version} · {process.env.NODE_ENV ?? "?"}
            </dd>
          </div>
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Variables configurées</dt>
            <dd className="mt-1 flex flex-wrap gap-1.5">
              {fields.map((f) => (
                <StatusBadge
                  key={f.key}
                  tone={
                    f.configured
                      ? "success"
                      : f.recommended
                        ? "warning"
                        : "neutral"
                  }
                >
                  <span className="font-mono">{f.key}</span>
                </StatusBadge>
              ))}
            </dd>
          </div>
        </dl>
      </Step>

      <Step
        n={2}
        title="Base de données"
        done={dbReady && pending === 0}
        description={
          <>
            Base utilisée actuellement :{" "}
            <code className="font-mono">{safeUrl(env.DATABASE_URL)}</code>. Pour
            en changer, teste la nouvelle URL, enregistre-la à l&apos;étape 3,
            redémarre, puis applique les migrations.
          </>
        }
      >
        <div className="flex flex-col gap-6">
          <DatabaseTestForm defaultUrl={env.DATABASE_URL} />
          <div className="flex flex-col gap-2 border-t pt-4">
            <p className="text-sm">
              Migrations : {migrations.appliedCount} / {migrations.total}{" "}
              appliquée(s)
              {pending > 0 && (
                <>
                  {" · "}
                  <StatusBadge tone="warning">{pending} en attente</StatusBadge>
                </>
              )}
              {migrations.error && (
                <span className="text-destructive"> · {migrations.error}</span>
              )}
            </p>
            {pending > 0 && (
              <ul className="font-mono text-xs text-muted-foreground">
                {migrations.pending.map((m) => (
                  <li key={m.tag}>
                    {m.tag}
                    {m.analysis.destructive.length > 0 && " (destructive)"}
                  </li>
                ))}
              </ul>
            )}
            <MigrateButton pending={pending} />
          </div>
        </div>
      </Step>

      <Step
        n={3}
        title="Configuration (.env.local)"
        done={missing.length === 0}
        description="Les secrets ne sont jamais réaffichés : laisse le champ vide pour les conserver. Une copie .env.local.bak est faite à chaque enregistrement."
      >
        <EnvForm fields={fields} />
      </Step>

      <Step n={4} title="Compte administrateur" done={(users ?? 0) > 0}>
        {access.mode === "admin" ? (
          <div className="flex flex-col gap-3 text-sm">
            <p>Installation terminée. Étapes suivantes conseillées :</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <Link className="underline" href="/admin/plans">
                  Créer les offres
                </Link>{" "}
                (Proxmox doit être configuré)
              </li>
              <li>
                <Link className="underline" href="/support/legal">
                  Compléter les documents légaux
                </Link>{" "}
                (passages entre crochets), puis les publier
              </li>
              <li>
                <Link className="underline" href="/admin/roles">
                  Configurer les rôles du personnel
                </Link>
              </li>
              <li>
                <Link className="underline" href="/support/wallet">
                  Régler les crédits
                </Link>{" "}
                et{" "}
                <Link className="underline" href="/admin/api">
                  les clés d&apos;API
                </Link>
              </li>
              <li>
                <Link className="underline" href="/admin/integrations/discord">
                  Tester le webhook Discord
                </Link>
              </li>
            </ul>
          </div>
        ) : !dbReady || pending > 0 ? (
          <p className="text-sm text-muted-foreground">
            Applique d&apos;abord les migrations (étape 2).
          </p>
        ) : (
          <CreateAdminForm />
        )}
      </Step>
    </>
  )
}
