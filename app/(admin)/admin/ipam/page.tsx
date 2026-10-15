import Link from "next/link"
import { and, count, desc, eq, like, or, sql } from "drizzle-orm"

import {
  AddAddressForm,
  AddressActions,
  DetectConflictsButton,
  NetworkActions,
  NetworkForm,
} from "@/components/ipam-controls"
import {
  EmptyState,
  PageHeader,
  Section,
  StatCard,
  StatusBadge,
} from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { db, schema } from "@/lib/db"
import { addressHistory, ipamStats } from "@/lib/ipam/service"

export const metadata = { title: "IPAM" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

const STATUS_LABEL = {
  available: ["Disponible", "success"],
  reserved: ["Réservée", "info"],
  assigned: ["Attribuée", "neutral"],
  disabled: ["Désactivée", "warning"],
  conflict: ["En conflit", "danger"],
} as const

type SP = {
  q?: string
  family?: string
  net?: string
  status?: string
  mode?: string
  node?: string
  vlan?: string
  server?: string
  page?: string
  history?: string
}

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export default async function IpamPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const q = (sp.q ?? "").trim().slice(0, 80)

  const A = schema.ipAddresses
  const N = schema.ipNetworks

  const conditions = [
    q
      ? or(
          like(A.address, `%${q}%`),
          like(N.cidr, `%${q}%`),
          like(N.name, `%${q}%`),
          like(A.serverId, `%${q}%`)
        )
      : undefined,
    sp.family === "ipv4" || sp.family === "ipv6"
      ? eq(N.family, sp.family)
      : undefined,
    sp.net ? eq(A.networkId, sp.net) : undefined,
    sp.status && sp.status in STATUS_LABEL
      ? eq(A.status, sp.status as keyof typeof STATUS_LABEL)
      : undefined,
    sp.mode === "dhcp" || sp.mode === "static"
      ? eq(A.mode, sp.mode)
      : undefined,
    sp.node ? eq(N.node, sp.node) : undefined,
    sp.vlan && /^\d+$/.test(sp.vlan) ? eq(N.vlan, Number(sp.vlan)) : undefined,
    sp.server === "linked" ? sql`${A.serverId} is not null` : undefined,
    sp.server === "none" ? sql`${A.serverId} is null` : undefined,
  ].filter(Boolean)
  const where = conditions.length ? and(...conditions) : undefined

  const [stats, networks, serverRows, [{ total }], rows, history] =
    await Promise.all([
      ipamStats(),
      db.select().from(N).orderBy(desc(N.createdAt)),
      db
        .select({
          id: schema.servers.id,
          name: schema.servers.name,
          address: schema.servers.address,
        })
        .from(schema.servers)
        .orderBy(schema.servers.name)
        .limit(300),
      db
        .select({ total: count() })
        .from(A)
        .innerJoin(N, eq(N.id, A.networkId))
        .where(where),
      db
        .select({
          id: A.id,
          address: A.address,
          status: A.status,
          mode: A.mode,
          reason: A.reason,
          comment: A.comment,
          assignedAt: A.assignedAt,
          releasedAt: A.releasedAt,
          serverId: A.serverId,
          serverName: schema.servers.name,
          networkName: N.name,
          cidr: N.cidr,
          vlan: N.vlan,
          node: N.node,
        })
        .from(A)
        .innerJoin(N, eq(N.id, A.networkId))
        .leftJoin(schema.servers, eq(schema.servers.id, A.serverId))
        .where(where)
        .orderBy(N.name, A.address)
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      sp.history ? addressHistory(sp.history) : Promise.resolve(null),
    ])

  const nodes = [
    ...new Set(networks.map((n) => n.node).filter((v): v is string => !!v)),
  ]
  const bridges = [
    ...new Set(networks.map((n) => n.bridge).filter((v): v is string => !!v)),
  ]
  const servers = serverRows.map((s) => ({
    id: s.id,
    label: `${s.name}${s.address ? ` · ${s.address}` : ""}`,
  }))

  const used =
    stats.total.assigned + stats.total.reserved + stats.total.conflict
  const params = Object.fromEntries(
    Object.entries(sp).filter(([k]) => k !== "page" && k !== "history")
  ) as Record<string, string | undefined>

  return (
    <>
      <PageHeader
        title="IPAM"
        description="Réseaux et adresses IP : disponibilité, attributions et conflits."
        actions={<DetectConflictsButton />}
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <StatCard label="Adresses" value={stats.all} />
        <StatCard label="Disponibles" value={stats.total.available} />
        <StatCard label="Attribuées" value={stats.total.assigned} />
        <StatCard label="Réservées" value={stats.total.reserved} />
        <StatCard label="Désactivées" value={stats.total.disabled} />
        <StatCard
          label="Conflits"
          value={stats.total.conflict}
          tone={stats.total.conflict > 0 ? "danger" : "default"}
          href={
            stats.total.conflict > 0 ? "/admin/ipam?status=conflict" : undefined
          }
        />
      </div>
      <p className="-mt-2 text-xs text-muted-foreground">
        Utilisation globale :{" "}
        {stats.all ? Math.round((used / stats.all) * 100) : 0} % ({used} /{" "}
        {stats.all}).
      </p>

      <Section title="Réseaux">
        {networks.length === 0 ? (
          <EmptyState
            title="Aucun réseau"
            description="Crée un réseau ci-dessous puis génère ses adresses."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Réseau</th>
                  <th className="p-2 font-medium">Passerelle · DNS</th>
                  <th className="p-2 font-medium">Portée</th>
                  <th className="p-2 font-medium">Mode</th>
                  <th className="p-2 font-medium">Utilisation</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {networks.map((n) => {
                  const s = stats.perNetwork.get(n.id) ?? {}
                  const all = Object.values(s).reduce((a, b) => a + b, 0)
                  const u =
                    (s.assigned ?? 0) + (s.reserved ?? 0) + (s.conflict ?? 0)
                  const pct = all ? Math.round((u / all) * 100) : 0
                  return (
                    <tr key={n.id} className={n.isActive ? "" : "opacity-60"}>
                      <td className="p-2">
                        <Link
                          href={`/admin/ipam?net=${n.id}`}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {n.name}
                        </Link>
                        <p className="font-mono text-xs text-muted-foreground">
                          {n.cidr}
                          {n.allowOverlap ? " · chevauchement documenté" : ""}
                        </p>
                      </td>
                      <td className="p-2 font-mono text-xs">
                        {n.gateway ?? "—"}
                        <br />
                        <span className="text-muted-foreground">
                          {n.dnsServers.join(", ") || "—"}
                        </span>
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {n.node ?? "tous nœuds"} · {n.bridge ?? "tous ponts"}
                        {n.vlan ? ` · VLAN ${n.vlan}` : ""}
                      </td>
                      <td className="p-2 text-xs">
                        {n.mode === "both"
                          ? "DHCP + statique"
                          : n.mode === "dhcp"
                            ? "DHCP"
                            : "Statique"}
                        {n.clientAssignable ? " · clients" : " · interne"}
                      </td>
                      <td className="p-2 text-xs">
                        {all === 0 ? (
                          <span className="text-muted-foreground">
                            aucune adresse
                          </span>
                        ) : (
                          <>
                            <div
                              role="progressbar"
                              aria-valuenow={pct}
                              aria-valuemin={0}
                              aria-valuemax={100}
                              className="h-1.5 w-24 overflow-hidden rounded bg-muted"
                            >
                              <div
                                className="h-full bg-primary"
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-muted-foreground">
                              {u} / {all} ({pct} %)
                            </span>
                          </>
                        )}
                      </td>
                      <td className="p-2">
                        <NetworkActions
                          networkId={n.id}
                          name={n.name}
                          active={n.isActive}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Nouveau réseau">
        <NetworkForm nodes={nodes} bridges={bridges} />
      </Section>

      <Section title="Ajouter une adresse">
        <AddAddressForm
          networks={networks.map((n) => ({ id: n.id, name: n.name }))}
        />
      </Section>

      <Section title="Adresses">
        <form
          method="GET"
          action="/admin/ipam"
          className="mb-4 flex flex-wrap items-end gap-2"
        >
          <input
            name="q"
            defaultValue={q}
            placeholder="IP, CIDR, réseau, id VPS…"
            aria-label="Recherche"
            className={`${selectClass} w-56`}
          />
          <select
            name="family"
            defaultValue={sp.family ?? ""}
            className={selectClass}
            aria-label="Famille"
          >
            <option value="">IPv4 + IPv6</option>
            <option value="ipv4">IPv4</option>
            <option value="ipv6">IPv6</option>
          </select>
          <select
            name="net"
            defaultValue={sp.net ?? ""}
            className={selectClass}
            aria-label="Réseau"
          >
            <option value="">Tous les réseaux</option>
            {networks.map((n) => (
              <option key={n.id} value={n.id}>
                {n.name}
              </option>
            ))}
          </select>
          <select
            name="status"
            defaultValue={sp.status ?? ""}
            className={selectClass}
            aria-label="Statut"
          >
            <option value="">Tous statuts</option>
            {Object.entries(STATUS_LABEL).map(([k, [label]]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
          <select
            name="mode"
            defaultValue={sp.mode ?? ""}
            className={selectClass}
            aria-label="Type d'attribution"
          >
            <option value="">DHCP + statique</option>
            <option value="static">Statique</option>
            <option value="dhcp">DHCP</option>
          </select>
          <select
            name="node"
            defaultValue={sp.node ?? ""}
            className={selectClass}
            aria-label="Nœud"
          >
            <option value="">Tous nœuds</option>
            {nodes.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <input
            name="vlan"
            defaultValue={sp.vlan ?? ""}
            placeholder="VLAN"
            aria-label="VLAN"
            inputMode="numeric"
            className={`${selectClass} w-24`}
          />
          <select
            name="server"
            defaultValue={sp.server ?? ""}
            className={selectClass}
            aria-label="Service associé"
          >
            <option value="">Avec ou sans VPS</option>
            <option value="linked">Associée à un VPS</option>
            <option value="none">Sans VPS</option>
          </select>
          <Button type="submit" size="sm">
            Filtrer
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            nativeButton={false}
            render={<Link href="/admin/ipam" />}
          >
            Réinitialiser
          </Button>
        </form>

        {rows.length === 0 ? (
          <EmptyState
            title="Aucune adresse"
            description="Aucune adresse ne correspond. Génère les adresses d'un réseau ou ajuste les filtres."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="border-b text-left text-muted-foreground">
                <tr>
                  <th className="p-2 font-medium">Adresse</th>
                  <th className="p-2 font-medium">Réseau</th>
                  <th className="p-2 font-medium">Statut</th>
                  <th className="p-2 font-medium">Mode</th>
                  <th className="p-2 font-medium">Service</th>
                  <th className="p-2 font-medium">Détail</th>
                  <th className="p-2" />
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r) => {
                  const [label, tone] = STATUS_LABEL[r.status]
                  return (
                    <tr key={r.id}>
                      <td className="p-2 font-mono text-xs break-all">
                        {r.address}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {r.networkName}
                        {r.vlan ? ` · VLAN ${r.vlan}` : ""}
                      </td>
                      <td className="p-2">
                        <StatusBadge tone={tone}>{label}</StatusBadge>
                      </td>
                      <td className="p-2 text-xs">{r.mode ?? "—"}</td>
                      <td className="p-2 text-xs">
                        {r.serverId ? (
                          <Link
                            href={`/servers/${r.serverId}`}
                            className="underline underline-offset-4"
                          >
                            {r.serverName ?? r.serverId.slice(0, 8)}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2 text-xs text-muted-foreground">
                        {[r.reason, r.comment].filter(Boolean).join(" · ") ||
                          (r.assignedAt
                            ? `attribuée le ${r.assignedAt.toLocaleDateString("fr-FR")}`
                            : r.releasedAt
                              ? `libérée le ${r.releasedAt.toLocaleDateString("fr-FR")}`
                              : "")}
                      </td>
                      <td className="p-2">
                        <AddressActions
                          addressId={r.id}
                          status={r.status}
                          historyHref={`/admin/ipam?${new URLSearchParams({
                            ...Object.fromEntries(
                              Object.entries(params).filter(
                                (e): e is [string, string] => !!e[1]
                              )
                            ),
                            history: r.id,
                          }).toString()}`}
                          servers={servers}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        <div className="mt-4">
          <Pagination
            basePath="/admin/ipam"
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
            params={params}
          />
        </div>
      </Section>

      {history && (
        <Section title="Historique de l'adresse">
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucune opération.</p>
          ) : (
            <ul className="divide-y text-sm">
              {history.map((h) => (
                <li key={h.id} className="flex flex-wrap gap-x-3 py-2">
                  <span className="font-mono text-xs">{h.action}</span>
                  <span className="text-xs">
                    {h.oldValue ?? "—"} → {h.newValue ?? "—"}
                  </span>
                  <StatusBadge
                    tone={
                      h.result === "ok"
                        ? "success"
                        : h.result === "refused"
                          ? "warning"
                          : "danger"
                    }
                  >
                    {h.result}
                  </StatusBadge>
                  {h.reason && (
                    <span className="text-xs text-muted-foreground">
                      {h.reason}
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {h.actor} ·{" "}
                    {h.createdAt.toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>
      )}
    </>
  )
}
