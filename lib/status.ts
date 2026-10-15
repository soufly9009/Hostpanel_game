import "server-only"

import { and, desc, eq, gte, inArray, isNotNull, or } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import {
  IMPACT_LABEL,
  MAINTENANCE_TYPE_LABEL,
  SERVICE_KEYS,
  SERVICE_LABEL,
  type ServiceKey,
} from "@/lib/maintenance/labels"

export type ComponentState =
  "operational" | "degraded" | "partial_outage" | "major_outage" | "maintenance"

export type PublicStatus = {
  generatedAt: string
  overall: ComponentState
  components: { key: ServiceKey; label: string; state: ComponentState }[]
  upcoming: PublicEvent[]
  active: PublicEvent[]
  incidents: {
    title: string
    status: string
    impact: string
    message: string | null
    startedAt: string
    resolvedAt: string | null
  }[]
  history: PublicEvent[]
}

type PublicEvent = {
  title: string
  type: string
  impact: string
  impactKey: string
  status: string
  startsAt: string
  endsAt: string
  timezone: string
  /** Seul texte publié : le message destiné aux clients. */
  message: string | null
  components: string[]
}

const SEVERITY: Record<ComponentState, number> = {
  operational: 0,
  maintenance: 1,
  degraded: 2,
  partial_outage: 3,
  major_outage: 4,
}

const fromImpact = (i: string): ComponentState =>
  i === "full"
    ? "major_outage"
    : i === "partial"
      ? "partial_outage"
      : "degraded"

/**
 * Données de la page publique. Ne retourne QUE ce que l'administrateur a
 * explicitement publié (isPublic) et jamais : nœuds, identifiants, IP,
 * descriptions internes ou données clients.
 */
export async function getPublicStatus(): Promise<PublicStatus> {
  const now = new Date()
  const since = new Date(now.getTime() - 30 * 86_400_000)
  const M = schema.maintenanceEvents

  const [events, openIncidents] = await Promise.all([
    db
      .select()
      .from(M)
      .where(
        and(
          eq(M.isPublic, true),
          or(
            inArray(M.status, ["scheduled", "in_progress"]),
            and(
              inArray(M.status, ["completed", "cancelled"]),
              gte(M.updatedAt, since)
            )
          )
        )
      )
      .orderBy(M.startsAt)
      .limit(100),
    db
      .select()
      .from(schema.incidents)
      .where(
        and(
          eq(schema.incidents.isPublic, true),
          inArray(schema.incidents.status, [
            "investigating",
            "identified",
            "monitoring",
          ])
        )
      ),
  ])

  const state = new Map<ServiceKey, ComponentState>(
    SERVICE_KEYS.map((k) => [k, "operational" as ComponentState])
  )
  const raise = (key: string, s: ComponentState) => {
    if (!(SERVICE_KEYS as string[]).includes(key)) return
    const k = key as ServiceKey
    if (SEVERITY[s] > SEVERITY[state.get(k)!]) state.set(k, s)
  }

  for (const e of events) {
    if (e.status !== "in_progress") continue
    // Maintenance en cours : « maintenance », ou état dégradé selon l'impact.
    const s = e.impact === "none" ? "maintenance" : fromImpact(e.impact)
    for (const c of e.services) raise(c, s)
  }
  for (const i of openIncidents) {
    for (const c of i.components) raise(c, fromImpact(i.impact))
  }

  const toPublic = (e: (typeof events)[number]): PublicEvent => ({
    title: e.title,
    type: MAINTENANCE_TYPE_LABEL[e.type],
    impact: IMPACT_LABEL[e.impact],
    impactKey: e.impact,
    status: e.status,
    startsAt: e.startsAt.toISOString(),
    endsAt: e.endsAt.toISOString(),
    timezone: e.timezone,
    message: e.customerMessage,
    components: e.services
      .filter((s): s is ServiceKey => (SERVICE_KEYS as string[]).includes(s))
      .map((s) => SERVICE_LABEL[s]),
  })

  const components = SERVICE_KEYS.map((key) => ({
    key,
    label: SERVICE_LABEL[key],
    state: state.get(key)!,
  }))
  const worst = components.reduce<ComponentState>(
    (acc, c) => (SEVERITY[c.state] > SEVERITY[acc] ? c.state : acc),
    "operational"
  )

  return {
    generatedAt: now.toISOString(),
    overall: worst,
    components,
    upcoming: events.filter((e) => e.status === "scheduled").map(toPublic),
    active: events.filter((e) => e.status === "in_progress").map(toPublic),
    incidents: openIncidents.map((i) => ({
      title: i.title,
      status: i.status,
      impact: i.impact,
      message: i.message,
      startedAt: i.startedAt.toISOString(),
      resolvedAt: null,
    })),
    history: [
      ...events
        .filter((e) => e.status === "completed" || e.status === "cancelled")
        .map(toPublic),
    ].reverse(),
  }
}

// Incidents résolus : exposés via la même structure mais séparés.
export async function getResolvedIncidents() {
  const since = new Date(Date.now() - 30 * 86_400_000)
  const rows = await db
    .select()
    .from(schema.incidents)
    .where(
      and(
        eq(schema.incidents.isPublic, true),
        eq(schema.incidents.status, "resolved"),
        isNotNull(schema.incidents.resolvedAt),
        gte(schema.incidents.resolvedAt, since)
      )
    )
    .orderBy(desc(schema.incidents.resolvedAt))
    .limit(20)
  return rows.map((i) => ({
    title: i.title,
    impact: i.impact,
    message: i.message,
    startedAt: i.startedAt.toISOString(),
    resolvedAt: i.resolvedAt!.toISOString(),
  }))
}
