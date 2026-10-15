import Link from "next/link"
import { CheckCircle2Icon, AlertTriangleIcon, WrenchIcon } from "lucide-react"

import { StatusBadge } from "@/components/kit"
import { siteConfig } from "@/lib/config/site"
import { IMPACT_TONE, type Impact } from "@/lib/maintenance/labels"
import { formatInZone } from "@/lib/maintenance/time"
import { getPublicStatus, getResolvedIncidents } from "@/lib/status"

export const metadata = { title: "État du service" }
// Données publiques : pas de cache statique (état en temps réel).
export const dynamic = "force-dynamic"

const STATE = {
  operational: { label: "Opérationnel", tone: "success" },
  maintenance: { label: "Maintenance", tone: "info" },
  degraded: { label: "Dégradé", tone: "warning" },
  partial_outage: { label: "Panne partielle", tone: "danger" },
  major_outage: { label: "Panne majeure", tone: "danger" },
} as const

const OVERALL = {
  operational: "Tous les systèmes sont opérationnels.",
  maintenance: "Une maintenance est en cours.",
  degraded: "Certains services sont dégradés.",
  partial_outage: "Une partie des services est indisponible.",
  major_outage: "Une panne majeure est en cours.",
} as const

const INCIDENT_STATUS: Record<string, string> = {
  investigating: "Investigation",
  identified: "Cause identifiée",
  monitoring: "Surveillance",
}

async function loadStatus() {
  const [status, resolved] = await Promise.all([
    getPublicStatus(),
    getResolvedIncidents(),
  ])
  return { status, resolved }
}

export default async function StatusPage() {
  let data: Awaited<ReturnType<typeof loadStatus>> | null = null
  try {
    data = await loadStatus()
  } catch {
    // Aucun détail interne n'est exposé publiquement.
    data = null
  }

  if (!data) {
    return (
      <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-4 px-6 py-10">
        <h1 className="text-xl font-semibold">
          {siteConfig.name} · État du service
        </h1>
        <p className="rounded-xl border p-4 text-sm text-muted-foreground">
          L&apos;état du service est momentanément indisponible. Réessaie dans
          quelques instants.
        </p>
      </div>
    )
  }
  const { status, resolved } = data

  const ok = status.overall === "operational"

  return (
    <div className="mx-auto flex min-h-svh max-w-3xl flex-col gap-6 px-6 py-10">
      <header className="flex items-center justify-between">
        <h1 className="text-xl font-semibold">
          {siteConfig.name} · État du service
        </h1>
        <Link
          href="/"
          className="text-sm text-muted-foreground underline underline-offset-4"
        >
          Accueil
        </Link>
      </header>

      <section
        className={`flex items-center gap-3 rounded-xl border p-4 ${
          ok
            ? "border-emerald-500/40 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5"
        }`}
      >
        {ok ? (
          <CheckCircle2Icon className="size-5 text-emerald-500" />
        ) : (
          <AlertTriangleIcon className="size-5 text-amber-500" />
        )}
        <p className="font-medium">{OVERALL[status.overall]}</p>
      </section>

      <section className="rounded-xl border bg-card">
        <h2 className="border-b p-4 font-medium">Services</h2>
        <ul className="divide-y">
          {status.components.map((c) => (
            <li
              key={c.key}
              className="flex items-center justify-between p-4 text-sm"
            >
              <span>{c.label}</span>
              <StatusBadge tone={STATE[c.state].tone}>
                {STATE[c.state].label}
              </StatusBadge>
            </li>
          ))}
        </ul>
      </section>

      {status.incidents.length > 0 && (
        <section className="rounded-xl border bg-card">
          <h2 className="border-b p-4 font-medium">Incidents en cours</h2>
          <ul className="divide-y">
            {status.incidents.map((i) => (
              <li
                key={`${i.title}-${i.startedAt}`}
                className="flex flex-col gap-1 p-4 text-sm"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{i.title}</span>
                  <StatusBadge tone="warning">
                    {INCIDENT_STATUS[i.status] ?? i.status}
                  </StatusBadge>
                </div>
                {i.message && <p>{i.message}</p>}
                <p className="text-xs text-muted-foreground">
                  Depuis {formatInZone(new Date(i.startedAt), "Europe/Paris")}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {[
        { title: "Maintenances en cours", list: status.active },
        { title: "Maintenances programmées", list: status.upcoming },
      ].map(
        ({ title, list }) =>
          list.length > 0 && (
            <section key={title} className="rounded-xl border bg-card">
              <h2 className="flex items-center gap-2 border-b p-4 font-medium">
                <WrenchIcon className="size-4" /> {title}
              </h2>
              <ul className="divide-y">
                {list.map((e) => (
                  <li
                    key={`${e.title}-${e.startsAt}`}
                    className="flex flex-col gap-1 p-4 text-sm"
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{e.title}</span>
                      <StatusBadge
                        tone={IMPACT_TONE[e.impactKey as Impact] ?? "neutral"}
                      >
                        {e.impact}
                      </StatusBadge>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {e.type} ·{" "}
                      {formatInZone(new Date(e.startsAt), e.timezone)} →{" "}
                      {formatInZone(new Date(e.endsAt), e.timezone)} (
                      {e.timezone})
                      {e.components.length > 0
                        ? ` · ${e.components.join(", ")}`
                        : ""}
                    </p>
                    {e.message && <p>{e.message}</p>}
                  </li>
                ))}
              </ul>
            </section>
          )
      )}

      {(status.history.length > 0 || resolved.length > 0) && (
        <section className="rounded-xl border bg-card">
          <h2 className="border-b p-4 font-medium">Historique (30 jours)</h2>
          <ul className="divide-y">
            {resolved.map((i) => (
              <li key={`r-${i.title}-${i.startedAt}`} className="p-4 text-sm">
                <p className="font-medium">
                  {i.title}{" "}
                  <span className="font-normal text-muted-foreground">
                    · incident résolu
                  </span>
                </p>
                {i.message && (
                  <p className="text-xs text-muted-foreground">{i.message}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {formatInZone(new Date(i.startedAt), "Europe/Paris")} →{" "}
                  {formatInZone(new Date(i.resolvedAt), "Europe/Paris")}
                </p>
              </li>
            ))}
            {status.history.map((e) => (
              <li key={`h-${e.title}-${e.startsAt}`} className="p-4 text-sm">
                <p className="font-medium">
                  {e.title}{" "}
                  <span className="font-normal text-muted-foreground">
                    ·{" "}
                    {e.status === "cancelled"
                      ? "maintenance annulée"
                      : "maintenance terminée"}
                  </span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {formatInZone(new Date(e.startsAt), e.timezone)} ({e.timezone}
                  )
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p className="text-xs text-muted-foreground">
        Mis à jour le{" "}
        {formatInZone(new Date(status.generatedAt), "Europe/Paris")}.
      </p>
    </div>
  )
}
