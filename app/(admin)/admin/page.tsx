import { count, desc, eq, gte, lt, or, and, isNotNull } from "drizzle-orm"

import { ProxmoxPermissions } from "@/components/proxmox-permissions"
import { RunRenewalsButton } from "@/components/run-renewals-button"
import { getRenewalStatus } from "@/lib/renewals"
import { db, schema } from "@/lib/db"
import { inDays } from "@/lib/expiry"
import { pleskConfigured, proxmoxConfigured } from "@/lib/env"
import { checkProxmoxPermissions } from "@/lib/proxmox/permissions"

export const metadata = { title: "Administration" }
export const dynamic = "force-dynamic"

export default async function AdminOverviewPage() {
  const soon = inDays(7)
  const [
    [users],
    [servers],
    [plans],
    [suspended],
    report,
    [sites],
    [expiring],
    jobs,
    recentErrors,
  ] = await Promise.all([
    db.select({ n: count() }).from(schema.users),
    db.select({ n: count() }).from(schema.servers),
    db
      .select({ n: count() })
      .from(schema.plans)
      .where(eq(schema.plans.isActive, true)),
    db
      .select({ n: count() })
      .from(schema.servers)
      .where(eq(schema.servers.suspended, true)),
    proxmoxConfigured ? checkProxmoxPermissions() : null,
    db.select({ n: count() }).from(schema.sites),
    db
      .select({ n: count() })
      .from(schema.servers)
      .where(
        and(
          isNotNull(schema.servers.expiresAt),
          lt(schema.servers.expiresAt, soon),
          eq(schema.servers.suspended, false)
        )
      ),
    db.select().from(schema.jobRuns),
    db
      .select()
      .from(schema.proxmoxLogs)
      .where(
        or(
          eq(schema.proxmoxLogs.status, 0),
          gte(schema.proxmoxLogs.status, 400)
        )
      )
      .orderBy(desc(schema.proxmoxLogs.createdAt))
      .limit(5),
  ])

  const renewals = await getRenewalStatus()

  const stats = [
    { label: "Clients", value: users.n },
    { label: "VPS", value: servers.n },
    { label: "Suspendus", value: suspended.n },
    { label: "Offres actives", value: plans.n },
    { label: "Sites web", value: sites.n },
    { label: "Échéances sous 7 jours", value: expiring.n },
  ]

  return (
    <>
      <h1 className="text-xl font-semibold">Vue d&apos;ensemble</h1>

      <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl border p-4">
            <dt className="text-sm text-muted-foreground">{s.label}</dt>
            <dd className="mt-1 text-3xl font-semibold">{s.value}</dd>
          </div>
        ))}
      </dl>

      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">Renouvellements</h2>
        <div className="flex flex-col gap-3 p-4 text-sm">
          <p className="text-muted-foreground">
            Chaque VPS doit être renouvelé tous les{" "}
            <strong className="text-foreground">
              {renewals.periodDays} jours
            </strong>
            . Une vérification automatique tourne tous les{" "}
            <strong className="text-foreground">
              {renewals.everyDays} jours
            </strong>{" "}
            : les VPS expirés sont suspendus
            {renewals.deleteAfterDays
              ? ` puis supprimés après ${renewals.deleteAfterDays} jours`
              : " (jamais supprimés automatiquement)"}
            .
          </p>
          <dl className="grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-muted-foreground">Dernière vérification</dt>
              <dd>
                {renewals.lastRunAt
                  ? renewals.lastRunAt.toLocaleString("fr-FR")
                  : "jamais"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Prochaine</dt>
              <dd>
                {renewals.nextRunAt
                  ? renewals.nextRunAt.toLocaleString("fr-FR")
                  : "au prochain passage du planificateur"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Résultat</dt>
              <dd>
                {renewals.result
                  ? `${renewals.result.checked} vérifiés · ${renewals.result.suspended} suspendus · ${renewals.result.expiringSoon} bientôt à renouveler`
                  : "—"}
              </dd>
            </div>
          </dl>
          {renewals.result && renewals.result.errors.length > 0 && (
            <ul className="rounded-lg bg-destructive/5 p-3 text-xs text-destructive">
              {renewals.result.errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          )}
          <RunRenewalsButton />
        </div>
      </section>

      <section className="rounded-xl border">
        <h2 className="border-b p-4 font-medium">Intégrations et tâches</h2>
        <div className="grid gap-4 p-4 text-sm md:grid-cols-2">
          <ul className="space-y-1">
            <li>
              Proxmox :{" "}
              <strong>
                {proxmoxConfigured ? "configuré" : "non configuré"}
              </strong>
            </li>
            <li>
              Plesk :{" "}
              <strong>{pleskConfigured ? "configuré" : "non configuré"}</strong>
            </li>
          </ul>
          <ul className="space-y-1">
            {jobs.length === 0 && (
              <li className="text-muted-foreground">Aucune tâche exécutée.</li>
            )}
            {jobs.map((j) => (
              <li key={j.name}>
                <span className="font-mono">{j.name}</span> :{" "}
                {j.lastRunAt ? j.lastRunAt.toLocaleString("fr-FR") : "jamais"}
              </li>
            ))}
          </ul>
        </div>
        {recentErrors.length > 0 && (
          <div className="border-t p-4">
            <p className="mb-2 text-sm font-medium">
              Dernières erreurs Proxmox
            </p>
            <ul className="space-y-1 text-xs text-destructive">
              {recentErrors.map((e) => (
                <li key={e.id}>
                  {e.createdAt.toLocaleString("fr-FR")} · {e.action} :{" "}
                  {e.error ?? e.status}
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {report ? (
        <ProxmoxPermissions report={report} />
      ) : (
        <p className="rounded-xl border border-destructive/40 p-4 text-sm text-destructive">
          Proxmox n&apos;est pas configuré : renseigne PROXMOX_URL,
          PROXMOX_TOKEN_ID et PROXMOX_TOKEN_SECRET dans .env.local.
        </p>
      )}
    </>
  )
}
