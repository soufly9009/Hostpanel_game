import Link from "next/link"
import { and, avg, count, eq, gte, isNotNull, sql } from "drizzle-orm"
import { DownloadIcon } from "lucide-react"

import { PageHeader, Section, StatCard } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { formatMoney } from "@/lib/billing/money"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"

export const metadata = { title: "Rapports" }
export const dynamic = "force-dynamic"

/** Clés des 12 derniers mois (AAAA-MM), du plus ancien au plus récent. */
function lastMonths(n = 12) {
  const out: string[] = []
  const d = new Date()
  d.setDate(1)
  for (let i = n - 1; i >= 0; i--) {
    const x = new Date(d.getFullYear(), d.getMonth() - i, 1)
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}`)
  }
  return out
}

const monthLabel = (k: string) => {
  const [y, m] = k.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("fr-FR", {
    month: "short",
    year: "2-digit",
  })
}

function Bars({
  data,
  format,
}: {
  data: { key: string; value: number }[]
  format: (v: number) => string
}) {
  const max = Math.max(1, ...data.map((d) => d.value))
  return (
    <ul className="flex flex-col gap-1.5 text-xs">
      {data.map((d) => (
        <li
          key={d.key}
          className="grid grid-cols-[4rem_1fr_7rem] items-center gap-2"
        >
          <span className="text-muted-foreground">{monthLabel(d.key)}</span>
          <span className="h-3 rounded bg-muted">
            <span
              className="block h-3 rounded bg-primary"
              style={{ width: `${(d.value / max) * 100}%` }}
            />
          </span>
          <span className="text-right tabular-nums">{format(d.value)}</span>
        </li>
      ))}
    </ul>
  )
}

export default async function ReportsPage() {
  const months = lastMonths()
  const since = new Date(
    Number(months[0].slice(0, 4)),
    Number(months[0].slice(5)) - 1,
    1
  )
  const I = schema.invoices
  const monthOf = (
    col: typeof I.paidAt | typeof I.issuedAt | typeof schema.users.createdAt
  ) => sql<string>`strftime('%Y-%m', ${col}, 'unixepoch', 'localtime')`

  const [
    settings,
    paid,
    refunds,
    signups,
    [clients],
    vps,
    games,
    sites,
    plansVps,
    plansGames,
    [rating],
    [unpaid],
  ] = await Promise.all([
    getBillingSettings(),
    db
      .select({
        m: monthOf(I.paidAt),
        total: sql<number>`sum(${I.totalCents})`,
      })
      .from(I)
      .where(
        and(eq(I.type, "invoice"), isNotNull(I.paidAt), gte(I.paidAt, since))
      )
      .groupBy(monthOf(I.paidAt)),
    db
      .select({
        m: monthOf(I.issuedAt),
        total: sql<number>`sum(${I.totalCents})`,
      })
      .from(I)
      .where(
        and(
          eq(I.type, "credit_note"),
          eq(I.status, "refunded"),
          gte(I.issuedAt, since)
        )
      )
      .groupBy(monthOf(I.issuedAt)),
    db
      .select({ m: monthOf(schema.users.createdAt), n: count() })
      .from(schema.users)
      .where(gte(schema.users.createdAt, since))
      .groupBy(monthOf(schema.users.createdAt)),
    db
      .select({ n: count() })
      .from(schema.users)
      .where(eq(schema.users.role, "user")),
    db.select({ n: count() }).from(schema.servers),
    db.select({ n: count() }).from(schema.gameServers),
    db.select({ n: count() }).from(schema.sites),
    db
      .select({
        name: schema.plans.name,
        price: schema.plans.priceCents,
        period: schema.plans.periodDays,
        n: count(),
      })
      .from(schema.servers)
      .innerJoin(schema.plans, eq(schema.plans.id, schema.servers.planId))
      .where(eq(schema.servers.suspended, false))
      .groupBy(schema.plans.id),
    db
      .select({
        name: schema.gamePlans.name,
        price: schema.gamePlans.priceCents,
        period: schema.gamePlans.periodDays,
        n: count(),
      })
      .from(schema.gameServers)
      .innerJoin(
        schema.gamePlans,
        eq(schema.gamePlans.id, schema.gameServers.planId)
      )
      .where(eq(schema.gameServers.suspended, false))
      .groupBy(schema.gamePlans.id),
    db
      .select({
        avg: avg(schema.tickets.rating),
        n: count(schema.tickets.rating),
      })
      .from(schema.tickets),
    db
      .select({
        total: sql<number>`coalesce(sum(${I.totalCents}), 0)`,
        n: count(),
      })
      .from(I)
      .where(and(eq(I.status, "unpaid"), eq(I.type, "invoice"))),
  ])

  const byMonth = (
    rows: { m: string; total?: number; n?: number }[],
    key: "total" | "n"
  ) => {
    const map = new Map(rows.map((r) => [r.m, Number(r[key] ?? 0)]))
    return months.map((m) => ({ key: m, value: map.get(m) ?? 0 }))
  }
  const revenue = byMonth(paid, "total").map((r, i) => ({
    ...r,
    value: r.value + (byMonth(refunds, "total")[i]?.value ?? 0),
  }))
  const money = (c: number) => formatMoney(c, settings.currency)
  // Revenu mensuel récurrent estimé : prix ramené à 30 jours, services actifs.
  const mrr = [...plansVps, ...plansGames].reduce(
    (s, p) => s + (p.price * p.n * 30) / (p.period ?? env.RENEW_PERIOD_DAYS),
    0
  )
  const top = [
    ...plansVps.map((p) => ({ ...p, kind: "VPS" })),
    ...plansGames.map((p) => ({ ...p, kind: "Jeu" })),
  ]
    .sort((a, b) => b.n - a.n)
    .slice(0, 8)

  return (
    <>
      <PageHeader
        title="Rapports"
        description="Chiffre d'affaires encaissé (factures réglées, avoirs déduits), inscriptions et services."
        actions={
          <div className="flex flex-wrap gap-2">
            {[
              ["invoices", "Factures"],
              ["clients", "Clients"],
              ["transactions", "Crédits"],
            ].map(([k, l]) => (
              <Button
                key={k}
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={`/api/admin/export/${k}`} download />}
              >
                <DownloadIcon /> {l} (CSV)
              </Button>
            ))}
          </div>
        }
      />
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard
          label="Revenu récurrent estimé / mois"
          value={money(Math.round(mrr))}
          hint="Services actifs, prix ramené à 30 jours"
        />
        <StatCard
          label="Encaissé (12 mois)"
          value={money(revenue.reduce((s, r) => s + r.value, 0))}
        />
        <StatCard
          label="À encaisser"
          value={money(Number(unpaid?.total ?? 0))}
          hint={`${unpaid?.n ?? 0} facture(s)`}
          tone={(unpaid?.n ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Satisfaction support"
          value={rating?.n ? `${Number(rating.avg).toFixed(1)} / 5` : "—"}
          hint={`${rating?.n ?? 0} avis`}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Clients" value={clients?.n ?? 0} href="/admin/users" />
        <StatCard label="VPS" value={vps[0]?.n ?? 0} href="/admin/servers" />
        <StatCard
          label="Serveurs de jeu"
          value={games[0]?.n ?? 0}
          href="/admin/games"
        />
        <StatCard label="Sites web" value={sites[0]?.n ?? 0} />
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title="Encaissements par mois">
          <Bars data={revenue} format={money} />
        </Section>
        <Section title="Inscriptions par mois">
          <Bars data={byMonth(signups, "n")} format={(v) => String(v)} />
        </Section>
      </div>
      <Section title="Offres les plus actives">
        {top.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun service actif.</p>
        ) : (
          <ul className="divide-y text-sm">
            {top.map((p) => (
              <li
                key={`${p.kind}-${p.name}`}
                className="flex flex-wrap items-center gap-2 py-1.5"
              >
                <span className="w-12 text-xs text-muted-foreground">
                  {p.kind}
                </span>
                <span className="font-medium">{p.name}</span>
                <span className="ml-auto tabular-nums">{p.n} actif(s)</span>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Détail des factures :{" "}
          <Link className="underline" href="/support/invoices">
            Factures
          </Link>
        </p>
      </Section>
    </>
  )
}
