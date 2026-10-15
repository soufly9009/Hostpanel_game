import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import {
  AdminGameActions,
  GamePlanForm,
  GamePlanRowActions,
} from "@/components/game-controls"
import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { db, schema } from "@/lib/db"
import { errorText } from "@/lib/discord/logging"
import { env, pterodactylConfigured } from "@/lib/env"
import { isPast } from "@/lib/expiry"
import { formatMb } from "@/lib/format"
import {
  checkConnection,
  listEggs,
  listLocations,
} from "@/lib/pterodactyl/client"
import { formatCredits } from "@/lib/wallet/format"

export const metadata = { title: "Serveurs de jeu" }
export const dynamic = "force-dynamic"

export default async function AdminGamesPage() {
  if (!pterodactylConfigured) {
    return (
      <>
        <PageHeader title="Serveurs de jeu (Pterodactyl)" />
        <ErrorState
          title="Pterodactyl non configuré"
          message={
            <>
              Renseigne PTERODACTYL_URL, PTERODACTYL_APP_KEY (ptla_…),
              PTERODACTYL_CLIENT_KEY (ptlc_… d&apos;un compte administrateur) et
              PTERODACTYL_OWNER_ID dans{" "}
              <Link className="underline" href="/install/setup">
                l&apos;assistant d&apos;installation
              </Link>
              , puis redémarre le serveur.
            </>
          }
        />
      </>
    )
  }

  let catalogError: string | null = null
  let eggs: { value: string; label: string }[] = []
  let locations: { id: number; label: string }[] = []
  const [connection, plans, games] = await Promise.all([
    checkConnection(),
    db
      .select()
      .from(schema.gamePlans)
      .orderBy(desc(schema.gamePlans.createdAt)),
    db
      .select({ game: schema.gameServers, email: schema.users.email })
      .from(schema.gameServers)
      .innerJoin(schema.users, eq(schema.users.id, schema.gameServers.userId))
      .orderBy(desc(schema.gameServers.createdAt)),
  ])
  try {
    const [e, l] = await Promise.all([listEggs(), listLocations()])
    eggs = e
      .map((x) => ({
        value: `${x.nest}:${x.id}`,
        label: `${x.nestName} · ${x.name}`,
      }))
      .sort((a, b) => a.label.localeCompare(b.label))
    locations = l.map((x) => ({
      id: x.id,
      label: x.long ? `${x.short} — ${x.long}` : x.short,
    }))
  } catch (e) {
    catalogError = errorText(e)
  }
  const locName = new Map(locations.map((l) => [l.id, l.label]))

  return (
    <>
      <PageHeader
        title="Serveurs de jeu (Pterodactyl)"
        description={`Tous les serveurs appartiennent au compte Pterodactyl #${env.PTERODACTYL_OWNER_ID} ; les clients n'ont aucun accès direct à Pterodactyl. Limite : ${env.PTERODACTYL_SERVER_LIMIT} par client.`}
      />

      <Section title="Connexion">
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">API Application (ptla_)</dt>
            <dd>
              <StatusBadge
                tone={
                  connection.application.startsWith("OK") ? "success" : "danger"
                }
              >
                {connection.application}
              </StatusBadge>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">API Client (ptlc_)</dt>
            <dd>
              <StatusBadge
                tone={connection.client === "OK" ? "success" : "danger"}
              >
                {connection.client}
              </StatusBadge>
            </dd>
          </div>
        </dl>
      </Section>

      {catalogError && (
        <ErrorState
          title="Catalogue Pterodactyl illisible"
          message={catalogError}
        />
      )}

      <Section title={`Offres (${plans.length})`}>
        {plans.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune offre.</p>
        ) : (
          <ul className="divide-y">
            {plans.map((p) => (
              <li key={p.id} className="flex flex-col gap-2 py-3">
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{p.name}</span>
                  <span className="text-muted-foreground">{p.eggName}</span>
                  {!p.isActive && (
                    <StatusBadge tone="neutral">Masquée</StatusBadge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {formatMb(p.memoryMb)} · {formatMb(p.diskMb)} · CPU{" "}
                    {p.cpuPercent || "∞"} % ·{" "}
                    {locName.get(p.locationId) ??
                      `emplacement #${p.locationId}`}{" "}
                    · {p.priceCents ? formatCredits(p.priceCents) : "gratuit"}
                  </span>
                </div>
                <GamePlanRowActions
                  plan={{ ...p }}
                  eggs={eggs}
                  locations={locations}
                />
              </li>
            ))}
          </ul>
        )}
        {!catalogError && (
          <div className="mt-6 border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Nouvelle offre</h3>
            <GamePlanForm eggs={eggs} locations={locations} />
          </div>
        )}
      </Section>

      <Section title={`Serveurs (${games.length})`}>
        {games.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun serveur.</p>
        ) : (
          <ul className="divide-y text-sm">
            {games.map(({ game: g, email }) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  className="font-medium underline-offset-2 hover:underline"
                  href={`/games/${g.id}`}
                >
                  {g.name}
                </Link>
                <span className="text-muted-foreground">{email}</span>
                <span className="font-mono text-xs">{g.address ?? "—"}</span>
                <span className="font-mono text-xs text-muted-foreground">
                  #{g.pteroId} · {g.pteroIdentifier}
                </span>
                {g.suspended && (
                  <StatusBadge tone="danger">
                    {g.suspendReason === "expired" ? "Expiré" : "Suspendu"}
                  </StatusBadge>
                )}
                {!g.suspended && g.expiresAt && isPast(g.expiresAt) && (
                  <StatusBadge tone="warning">Échéance dépassée</StatusBadge>
                )}
                <span className="ml-auto">
                  <AdminGameActions id={g.id} suspended={g.suspended} />
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
