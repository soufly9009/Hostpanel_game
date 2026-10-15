import Link from "next/link"
import { eq, like, or } from "drizzle-orm"

import { EmptyState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { SearchInput } from "@/components/kit-client"
import { formatMoney, INVOICE_STATUS_LABEL } from "@/lib/billing/money"
import { db, schema } from "@/lib/db"
import { ticketRef } from "@/lib/tickets/labels"

export const metadata = { title: "Recherche" }
export const dynamic = "force-dynamic"

const LIMIT = 10

/** Recherche transversale : clients, VPS, jeux, sites, factures, tickets, devis. */
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80)
  const p = `%${q}%`
  const ticketNo = /^t-?0*(\d{1,6})$/i.exec(q)?.[1]

  const results =
    q.length < 2
      ? null
      : await Promise.all([
          db
            .select({
              id: schema.users.id,
              email: schema.users.email,
              name: schema.users.name,
            })
            .from(schema.users)
            .where(
              or(
                like(schema.users.email, p),
                like(schema.users.name, p),
                eq(schema.users.id, q)
              )
            )
            .limit(LIMIT),
          db
            .select({
              id: schema.servers.id,
              name: schema.servers.name,
              address: schema.servers.address,
              vmid: schema.servers.vmid,
            })
            .from(schema.servers)
            .where(
              or(
                like(schema.servers.name, p),
                like(schema.servers.address, p),
                like(schema.servers.ipv6, p),
                /^\d+$/.test(q)
                  ? eq(schema.servers.vmid, Number(q))
                  : undefined,
                eq(schema.servers.id, q)
              )
            )
            .limit(LIMIT),
          db
            .select({
              id: schema.gameServers.id,
              name: schema.gameServers.name,
              address: schema.gameServers.address,
            })
            .from(schema.gameServers)
            .where(
              or(
                like(schema.gameServers.name, p),
                like(schema.gameServers.address, p),
                like(schema.gameServers.pteroIdentifier, p)
              )
            )
            .limit(LIMIT),
          db
            .select({ id: schema.sites.id, domain: schema.sites.domain })
            .from(schema.sites)
            .where(like(schema.sites.domain, p))
            .limit(LIMIT),
          db
            .select({
              id: schema.invoices.id,
              number: schema.invoices.number,
              status: schema.invoices.status,
              total: schema.invoices.totalCents,
              currency: schema.invoices.currency,
            })
            .from(schema.invoices)
            .where(like(schema.invoices.number, `%${q.toUpperCase()}%`))
            .limit(LIMIT),
          db
            .select({
              id: schema.tickets.id,
              number: schema.tickets.number,
              subject: schema.tickets.subject,
            })
            .from(schema.tickets)
            .where(
              or(
                like(schema.tickets.subject, p),
                ticketNo
                  ? eq(schema.tickets.number, Number(ticketNo))
                  : undefined
              )
            )
            .limit(LIMIT),
          db
            .select({
              id: schema.quotes.id,
              number: schema.quotes.number,
              title: schema.quotes.title,
            })
            .from(schema.quotes)
            .where(
              or(
                like(schema.quotes.number, `%${q.toUpperCase()}%`),
                like(schema.quotes.title, p)
              )
            )
            .limit(LIMIT),
        ])

  const [users, servers, games, sites, invoices, tickets, quotes] = results ?? [
    [],
    [],
    [],
    [],
    [],
    [],
    [],
  ]
  const total =
    users.length +
    servers.length +
    games.length +
    sites.length +
    invoices.length +
    tickets.length +
    quotes.length
  const group = (title: string, items: React.ReactNode[]) =>
    items.length > 0 && (
      <Section title={`${title} (${items.length})`}>
        <ul className="divide-y text-sm">{items}</ul>
      </Section>
    )

  return (
    <>
      <PageHeader
        title="Recherche"
        description="E-mail, nom, IP, VMID, domaine, n° de facture, de devis ou de ticket (T-0042)…"
      />
      <SearchInput placeholder="Rechercher partout…" />
      {results && total === 0 && <EmptyState title="Aucun résultat" />}
      {group(
        "Clients",
        users.map((u) => (
          <li key={u.id} className="py-2">
            <Link
              className="font-medium hover:underline"
              href={`/admin/users/${u.id}`}
            >
              {u.name ?? u.email}
            </Link>{" "}
            <span className="text-muted-foreground">{u.email}</span>
          </li>
        ))
      )}
      {group(
        "VPS",
        servers.map((s) => (
          <li key={s.id} className="py-2">
            <Link
              className="font-medium hover:underline"
              href={`/servers/${s.id}`}
            >
              {s.name}
            </Link>{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {s.address ?? "—"} · VMID {s.vmid}
            </span>
          </li>
        ))
      )}
      {group(
        "Serveurs de jeu",
        games.map((g) => (
          <li key={g.id} className="py-2">
            <Link
              className="font-medium hover:underline"
              href={`/games/${g.id}`}
            >
              {g.name}
            </Link>{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {g.address ?? "—"}
            </span>
          </li>
        ))
      )}
      {group(
        "Sites",
        sites.map((s) => (
          <li key={s.id} className="py-2">
            <Link
              className="font-medium hover:underline"
              href={`/sites/${s.id}`}
            >
              {s.domain}
            </Link>
          </li>
        ))
      )}
      {group(
        "Factures",
        invoices.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
            <Link
              className="font-mono hover:underline"
              href={`/invoices/${i.id}`}
            >
              {i.number}
            </Link>{" "}
            <span>{formatMoney(i.total, i.currency)}</span>{" "}
            <StatusBadge tone="neutral">
              {INVOICE_STATUS_LABEL[i.status]}
            </StatusBadge>
          </li>
        ))
      )}
      {group(
        "Devis",
        quotes.map((d) => (
          <li key={d.id} className="py-2">
            <Link
              className="font-mono hover:underline"
              href={`/quotes/${d.id}`}
            >
              {d.number}
            </Link>{" "}
            <span>{d.title}</span>
          </li>
        ))
      )}
      {group(
        "Tickets",
        tickets.map((t) => (
          <li key={t.id} className="py-2">
            <Link
              className="font-mono hover:underline"
              href={`/support/tickets/${t.id}`}
            >
              {ticketRef(t.number)}
            </Link>{" "}
            <span>{t.subject}</span>
          </li>
        ))
      )}
    </>
  )
}
