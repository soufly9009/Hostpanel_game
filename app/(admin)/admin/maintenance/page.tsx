import { desc } from "drizzle-orm"

import {
  IncidentForm,
  IncidentStatusSelect,
  MaintenanceActions,
  MaintenanceForm,
} from "@/components/maintenance-controls"
import {
  EmptyState,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
} from "@/components/kit"
import { db, schema } from "@/lib/db"
import {
  IMPACT_LABEL,
  IMPACT_TONE,
  MAINTENANCE_TYPE_LABEL,
  SERVICE_LABEL,
  STATUS_LABEL,
  STATUS_TONE,
  type ServiceKey,
} from "@/lib/maintenance/labels"
import { listEvents } from "@/lib/maintenance/service"
import { formatInZone, formatUtc } from "@/lib/maintenance/time"

export const metadata = { title: "Maintenance" }
export const dynamic = "force-dynamic"

/** « YYYY-MM-DDTHH:mm » dans le fuseau de l'événement (valeur d'un datetime-local). */
function toLocalInput(date: Date, tz: string) {
  const p = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
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

export default async function MaintenancePage() {
  const [events, incidents, serverNodes] = await Promise.all([
    listEvents(),
    db
      .select()
      .from(schema.incidents)
      .orderBy(desc(schema.incidents.startedAt))
      .limit(30),
    db.selectDistinct({ node: schema.servers.node }).from(schema.servers),
  ])
  const nodes = serverNodes.map((n) => n.node)
  const now = new Date()

  const by = (s: string) => events.filter((e) => e.status === s)
  const upcoming = by("scheduled")
  const running = by("in_progress")
  const drafts = by("draft")
  const done = events.filter(
    (e) => e.status === "completed" || e.status === "cancelled"
  )
  const openIncidents = incidents.filter((i) => i.status !== "resolved")

  const Row = ({ e }: { e: (typeof events)[number] }) => (
    <li className="flex flex-col gap-2 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{e.title}</span>
        <StatusBadge tone={STATUS_TONE[e.status]}>
          {STATUS_LABEL[e.status]}
        </StatusBadge>
        <StatusBadge tone={IMPACT_TONE[e.impact]}>
          {IMPACT_LABEL[e.impact]}
        </StatusBadge>
        {e.isPublic && <StatusBadge tone="info">Publique</StatusBadge>}
        {e.status === "scheduled" && e.startsAt < now && (
          <StatusBadge tone="warning">À démarrer ou replanifier</StatusBadge>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        {MAINTENANCE_TYPE_LABEL[e.type]} ·{" "}
        {formatInZone(e.startsAt, e.timezone)} →{" "}
        {formatInZone(e.endsAt, e.timezone)} ({e.timezone}) ·{" "}
        {formatUtc(e.startsAt)}
      </p>
      <p className="text-xs text-muted-foreground">
        Services :{" "}
        {e.services
          .map((s) => SERVICE_LABEL[s as ServiceKey] ?? s)
          .join(", ") || "—"}
        {e.nodes.length > 0 ? ` · Nœuds : ${e.nodes.join(", ")}` : ""}
        {` · Rappel ${e.notifyBeforeMinutes} min avant`}
        {e.revision > 1 ? ` · révision ${e.revision}` : ""}
      </p>
      {e.customerMessage && <p className="text-sm">{e.customerMessage}</p>}
      <MaintenanceActions
        id={e.id}
        status={e.status}
        title={e.title}
        timezone={e.timezone}
        startsLocal={toLocalInput(e.startsAt, e.timezone)}
        endsLocal={toLocalInput(e.endsAt, e.timezone)}
        overdue={e.status === "scheduled" && e.startsAt < now}
      />
    </li>
  )

  const group = (title: string, list: typeof events, empty: string) => (
    <Section title={`${title} (${list.length})`}>
      {list.length === 0 ? (
        <p className="text-sm text-muted-foreground">{empty}</p>
      ) : (
        <ul className="divide-y">
          {list.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}
    </Section>
  )

  return (
    <>
      <PageHeader
        title="Maintenance"
        description="Annonces de maintenance et incidents. Programmer une maintenance ne déclenche aucune opération système."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <StatCard
          label="En cours"
          value={running.length}
          tone={running.length > 0 ? "warning" : "default"}
        />
        <StatCard label="Programmées" value={upcoming.length} />
        <StatCard label="Brouillons" value={drafts.length} />
        <StatCard label="Terminées / annulées" value={done.length} />
        <StatCard
          label="Incidents ouverts"
          value={openIncidents.length}
          tone={openIncidents.length > 0 ? "danger" : "default"}
        />
      </div>

      {group("En cours", running, "Aucune maintenance en cours.")}
      {group("Programmées", upcoming, "Aucune maintenance programmée.")}
      {group("Brouillons", drafts, "Aucun brouillon.")}

      <Section title="Nouvelle maintenance">
        <MaintenanceForm nodes={nodes} />
      </Section>

      {group("Terminées et annulées", done.slice(0, 30), "Historique vide.")}

      <Section title="Incidents">
        {incidents.length === 0 ? (
          <EmptyState title="Aucun incident" />
        ) : (
          <ul className="divide-y">
            {incidents.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-medium">{i.title}</p>
                  <p className="text-xs text-muted-foreground">
                    {i.components
                      .map((c) => SERVICE_LABEL[c as ServiceKey] ?? c)
                      .join(", ")}{" "}
                    · depuis {formatUtc(i.startedAt)}
                    {i.isPublic ? " · publique" : ""}
                  </p>
                  {i.message && <p className="text-sm">{i.message}</p>}
                </div>
                <IncidentStatusSelect id={i.id} status={i.status} />
              </li>
            ))}
          </ul>
        )}
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Ouvrir un incident</h3>
          <IncidentForm />
        </div>
      </Section>
    </>
  )
}
