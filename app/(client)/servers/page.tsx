import Link from "next/link"
import { and, count, desc, eq, like, or } from "drizzle-orm"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { SearchInput } from "@/components/kit-client"
import { Pagination } from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { serverStatus } from "@/lib/service-status"

export const metadata = { title: "Mes VPS" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 12

export default async function ServersPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const q = (sp.q ?? "").trim().slice(0, 60)
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const S = schema.servers
  const where = and(
    eq(S.userId, user.id),
    q
      ? or(
          like(S.name, `%${q}%`),
          like(S.address, `%${q}%`),
          like(S.os, `%${q}%`)
        )
      : undefined
  )

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(S).where(where),
    db
      .select({
        id: S.id,
        name: S.name,
        address: S.address,
        ipv6: S.ipv6,
        os: S.os,
        virt: S.virt,
        suspended: S.suspended,
        suspendReason: S.suspendReason,
        expiresAt: S.expiresAt,
        plan: schema.plans.name,
      })
      .from(S)
      .leftJoin(schema.plans, eq(schema.plans.id, S.planId))
      .where(where)
      .orderBy(desc(S.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  return (
    <>
      <PageHeader
        title="Mes VPS"
        description={`${total} VPS${q ? ` pour « ${q} »` : ""} · limite ${user.serverLimit}`}
        actions={
          <Button nativeButton={false} render={<Link href="/servers/new" />}>
            Nouveau VPS
          </Button>
        }
      />
      <SearchInput placeholder="Rechercher un VPS, une IP, un système…" />

      {rows.length === 0 ? (
        <EmptyState
          title={q ? "Aucun résultat" : "Aucun VPS"}
          description={
            q
              ? "Aucun VPS ne correspond à cette recherche."
              : "Commande ton premier VPS pour commencer."
          }
          action={
            q ? undefined : { href: "/servers/new", label: "Créer un VPS" }
          }
        />
      ) : (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((s) => {
            const st = serverStatus(s)
            return (
              <li key={s.id}>
                <Link
                  href={`/servers/${s.id}`}
                  className="block h-full rounded-xl border bg-card p-4 transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="truncate font-medium">{s.name}</p>
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {s.virt === "qemu" ? "VM" : "LXC"}
                    {s.os ? ` · ${s.os}` : ""} · {s.plan ?? "Offre supprimée"}
                  </p>
                  <div className="mt-3 space-y-0.5 font-mono text-xs">
                    <p>{s.address ?? "IPv4 en attente…"}</p>
                    {s.ipv6 && <p className="break-all">{s.ipv6}</p>}
                  </div>
                  {s.expiresAt && (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Échéance : {s.expiresAt.toLocaleDateString("fr-FR")}
                    </p>
                  )}
                </Link>
              </li>
            )
          })}
        </ul>
      )}

      <Pagination
        basePath="/servers"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        params={{ q: q || undefined }}
      />
    </>
  )
}
