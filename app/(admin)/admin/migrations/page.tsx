import {
  AnnouncementActions,
  AnnouncementForm,
  DeployForm,
} from "@/components/migration-controls"
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
} from "@/components/kit"
import { db, schema } from "@/lib/db"
import {
  MIGRATION_KIND_LABEL,
  MIGRATION_STATUS_LABEL,
  MIGRATION_STATUS_TONE,
  minutesLabel,
} from "@/lib/maintenance/labels"
import { formatInZone } from "@/lib/maintenance/time"
import {
  listAnnouncements,
  notificationHistory,
} from "@/lib/migrations/announcements"
import { summarize } from "@/lib/migrations/analysis"
import { getMigrationState, recentDeployRuns } from "@/lib/migrations/deploy"

export const metadata = { title: "Migrations" }
export const dynamic = "force-dynamic"

function toLocalInput(date: Date) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Paris",
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(date)
  const g = (t: string) => p.find((x) => x.type === t)?.value ?? "00"
  return `${g("year")}-${g("month")}-${g("day")}T${g("hour")}:${g("minute")}`
}

export default async function MigrationsPage() {
  const [state, announcements, runs, servers] = await Promise.all([
    getMigrationState(),
    listAnnouncements(),
    recentDeployRuns(10),
    db
      .select({
        id: schema.servers.id,
        name: schema.servers.name,
        node: schema.servers.node,
      })
      .from(schema.servers)
      .orderBy(schema.servers.name)
      .limit(300),
  ])

  const nodes = [...new Set(servers.map((s) => s.node))]
  const hasDestructive = state.pending.some(
    (p) => p.analysis.destructive.length > 0
  )
  const openDb = announcements.filter(
    (a) =>
      a.kind === "database" &&
      ["scheduled", "notified", "in_progress"].includes(a.status)
  )
  const histories = new Map(
    await Promise.all(
      announcements
        .slice(0, 30)
        .map(async (a) => [a.id, await notificationHistory(a.id)] as const)
    )
  )

  return (
    <>
      <PageHeader
        title="Migrations"
        description="Annonces de migration et déploiement contrôlé des migrations SQL."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Migrations SQL en attente"
          value={state.pending.length}
          tone={state.pending.length > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Appliquées"
          value={`${state.appliedCount} / ${state.total}`}
        />
        <StatCard
          label="Annonces ouvertes"
          value={
            announcements.filter((a) =>
              ["scheduled", "notified", "in_progress"].includes(a.status)
            ).length
          }
        />
      </div>

      <Section
        title="Migrations SQL en attente"
        description="La détection compare le journal Drizzle (drizzle/meta/_journal.json) à la table __drizzle_migrations. Rien n'est appliqué au démarrage du serveur."
      >
        {state.error ? (
          <ErrorState title="État illisible" message={state.error} />
        ) : state.pending.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucune migration en attente : la base est à jour.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            <ul className="divide-y rounded-lg border">
              {state.pending.map((p) => (
                <li key={p.tag} className="flex flex-col gap-1 p-3 text-sm">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono">{p.tag}</span>
                    {p.analysis.destructive.length > 0 ? (
                      <StatusBadge tone="danger">Destructive</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">Additive</StatusBadge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {summarize(p.analysis)}
                    </span>
                  </div>
                  {p.analysis.destructive.length > 0 && (
                    <ul className="list-inside list-disc text-xs text-destructive">
                      {p.analysis.destructive.map((d) => (
                        <li key={d}>{d}</li>
                      ))}
                    </ul>
                  )}
                  {p.analysis.creates.length + p.analysis.additions.length >
                    0 && (
                    <p className="text-xs text-muted-foreground">
                      {[...p.analysis.creates, ...p.analysis.additions]
                        .slice(0, 12)
                        .join(" · ")}
                    </p>
                  )}
                </li>
              ))}
            </ul>

            {hasDestructive && openDb.length === 0 && (
              <ErrorState
                title="Annonce requise"
                message="Une migration destructive exige une annonce de migration de base de données programmée avant d'être appliquée."
              />
            )}
            {openDb.length === 0 && !hasDestructive && (
              <p className="text-xs text-muted-foreground">
                Aucune annonce n&apos;est programmée. C&apos;est autorisé pour
                des migrations additives, mais une interruption reste possible :
                pense à prévenir les utilisateurs.
              </p>
            )}

            <DeployForm
              tags={state.pending.map((p) => p.tag)}
              hasDestructive={hasDestructive}
              announcements={openDb.map((a) => ({
                id: a.id,
                label: `${a.title} — ${formatInZone(a.scheduledAt, "Europe/Paris")}`,
              }))}
            />
            <p className="text-xs text-muted-foreground">
              Avant l&apos;application, une copie cohérente de la base est créée
              dans <span className="font-mono">data/backups/</span> (base
              fichier). Aucune restauration n&apos;est jamais lancée
              automatiquement.
            </p>
          </div>
        )}
      </Section>

      <Section title="Nouvelle annonce">
        <AnnouncementForm
          servers={servers.map((s) => ({
            id: s.id,
            label: `${s.name} (${s.node})`,
          }))}
          nodes={nodes}
        />
      </Section>

      <Section title="Annonces">
        {announcements.length === 0 ? (
          <EmptyState title="Aucune annonce" />
        ) : (
          <ul className="divide-y">
            {announcements.map((a) => {
              const hist = histories.get(a.id) ?? []
              return (
                <li key={a.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <StatusBadge tone={MIGRATION_STATUS_TONE[a.status]}>
                      {MIGRATION_STATUS_LABEL[a.status]}
                    </StatusBadge>
                    <StatusBadge tone="neutral">
                      {MIGRATION_KIND_LABEL[a.kind]}
                    </StatusBadge>
                    {a.isPublic && (
                      <StatusBadge tone="info">Visible clients</StatusBadge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {formatInZone(a.scheduledAt, "Europe/Paris")} · durée{" "}
                    {minutesLabel(a.estimatedMinutes)} · rappel{" "}
                    {a.notifyBeforeMinutes} min avant
                    {a.revision > 1 ? ` · révision ${a.revision}` : ""}
                    {a.kind === "vps" && a.sourceNode
                      ? ` · ${a.sourceNode} → ${a.targetNode} · ${a.serverIds.length} VPS`
                      : ""}
                    {a.finishedAt
                      ? ` · fin réelle ${formatInZone(a.finishedAt, "Europe/Paris")}`
                      : ""}
                  </p>
                  {a.impact && <p className="text-sm">Impact : {a.impact}</p>}
                  {a.result && (
                    <p className="text-xs text-muted-foreground">
                      Résultat : {a.result}
                    </p>
                  )}
                  {hist.length > 0 && (
                    <p className="text-xs text-muted-foreground">
                      Notifications :{" "}
                      {hist
                        .map(
                          (h) =>
                            `${h.kind} r${h.revision} (${h.recipients} dest.)`
                        )
                        .join(" · ")}
                    </p>
                  )}
                  <AnnouncementActions
                    id={a.id}
                    status={a.status}
                    title={a.title}
                    localDate={toLocalInput(a.scheduledAt)}
                    minutes={a.estimatedMinutes}
                  />
                  {a.kind === "vps" && (
                    <p className="text-xs text-muted-foreground">
                      Cette annonce n&apos;exécute aucune migration Proxmox : la
                      migration réelle se fait dans Proxmox après vérification
                      des prérequis (stockage, réseau, compatibilité).
                    </p>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Historique des déploiements SQL">
        {runs.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Aucun déploiement enregistré.
          </p>
        ) : (
          <ul className="divide-y text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-3 py-2">
                <StatusBadge
                  tone={
                    r.status === "success"
                      ? "success"
                      : r.status === "failed"
                        ? "danger"
                        : "warning"
                  }
                >
                  {r.status}
                </StatusBadge>
                <span className="font-mono text-xs">
                  {(r.pending ?? []).join(", ")}
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {r.actor} · {r.startedAt.toLocaleString("fr-FR")}
                </span>
                {r.error && (
                  <span className="basis-full text-xs text-destructive">
                    {r.error}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
