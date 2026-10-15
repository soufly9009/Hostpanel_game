import Link from "next/link"
import { and, asc, desc, eq, isNull } from "drizzle-orm"
import {
  AlertTriangleIcon,
  BellIcon,
  CalendarClockIcon,
  GlobeIcon,
  ServerIcon,
} from "lucide-react"

import { EmptyState, PageHeader, StatCard, StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { pleskConfigured } from "@/lib/env"
import { daysUntil } from "@/lib/expiry"
import { serverStatus } from "@/lib/service-status"

export const metadata = { title: "Tableau de bord" }
export const dynamic = "force-dynamic"

export default async function DashboardPage() {
  const user = await requireUser()

  const [servers, sites, notes] = await Promise.all([
    db
      .select({
        id: schema.servers.id,
        name: schema.servers.name,
        virt: schema.servers.virt,
        address: schema.servers.address,
        suspended: schema.servers.suspended,
        suspendReason: schema.servers.suspendReason,
        expiresAt: schema.servers.expiresAt,
      })
      .from(schema.servers)
      .where(eq(schema.servers.userId, user.id))
      .orderBy(asc(schema.servers.expiresAt)),
    db
      .select()
      .from(schema.sites)
      .where(eq(schema.sites.userId, user.id))
      .orderBy(desc(schema.sites.createdAt)),
    db
      .select()
      .from(schema.notifications)
      .where(
        and(
          eq(schema.notifications.userId, user.id),
          isNull(schema.notifications.readAt)
        )
      )
      .orderBy(desc(schema.notifications.createdAt))
      .limit(5),
  ])

  const withStatus = servers.map((s) => ({ ...s, status: serverStatus(s) }))
  const active = withStatus.filter((s) => s.status.tone === "success").length
  const problems = withStatus.filter(
    (s) => s.status.tone === "danger" || s.status.tone === "warning"
  ).length
  const next = servers.find((s) => s.expiresAt && !s.suspended)

  return (
    <>
      <PageHeader
        title="Tableau de bord"
        description={`Bonjour ${user.name ?? user.email}`}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="VPS actifs"
          value={active}
          hint={`${servers.length} au total`}
          icon={ServerIcon}
          href="/servers"
        />
        <StatCard
          label="Sites web"
          value={sites.length}
          hint={pleskConfigured ? undefined : "Plesk non configuré"}
          icon={GlobeIcon}
          href="/sites"
        />
        <StatCard
          label="À surveiller"
          value={problems}
          hint="Suspendus, expirés ou bientôt échus"
          icon={AlertTriangleIcon}
          tone={problems > 0 ? "warning" : "default"}
          href="/servers"
        />
        <StatCard
          label="Prochaine échéance"
          value={
            next?.expiresAt
              ? `${Math.max(daysUntil(next.expiresAt), 0)} j`
              : "—"
          }
          hint={next ? next.name : "Aucune échéance"}
          icon={CalendarClockIcon}
          href={next ? `/servers/${next.id}` : undefined}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="rounded-xl border bg-card lg:col-span-2">
          <header className="flex items-center justify-between border-b p-4">
            <h2 className="font-medium">VPS</h2>
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="/servers" />}
            >
              Tout voir
            </Button>
          </header>
          {servers.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="Aucun VPS"
                action={{ href: "/servers/new", label: "Créer un VPS" }}
              />
            </div>
          ) : (
            <ul className="divide-y">
              {withStatus.slice(0, 6).map((s) => (
                <li key={s.id}>
                  <Link
                    href={`/servers/${s.id}`}
                    className="flex items-center gap-3 p-4 text-sm transition-colors hover:bg-muted/50"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="font-mono text-xs text-muted-foreground">
                        {s.address ?? "IPv4 en attente…"}
                      </p>
                    </div>
                    <StatusBadge tone={s.status.tone}>
                      {s.status.label}
                    </StatusBadge>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b p-4">
            <h2 className="flex items-center gap-2 font-medium">
              <BellIcon className="size-4" /> Notifications
            </h2>
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="/notifications" />}
            >
              Tout voir
            </Button>
          </header>
          {notes.length === 0 ? (
            <p className="p-4 text-sm text-muted-foreground">
              Aucune notification non lue.
            </p>
          ) : (
            <ul className="divide-y">
              {notes.map((n) => (
                <li key={n.id} className="p-4 text-sm">
                  <p className="font-medium">{n.title}</p>
                  {n.body && (
                    <p className="text-xs text-muted-foreground">{n.body}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {sites.length > 0 && (
        <section className="rounded-xl border bg-card">
          <header className="flex items-center justify-between border-b p-4">
            <h2 className="font-medium">Sites web</h2>
            <Button
              size="sm"
              variant="ghost"
              nativeButton={false}
              render={<Link href="/sites" />}
            >
              Tout voir
            </Button>
          </header>
          <ul className="divide-y">
            {sites.slice(0, 5).map((s) => (
              <li key={s.id}>
                <Link
                  href={`/sites/${s.id}`}
                  className="flex items-center gap-3 p-4 text-sm transition-colors hover:bg-muted/50"
                >
                  <span className="min-w-0 flex-1 truncate font-medium">
                    {s.domain}
                  </span>
                  <StatusBadge
                    tone={
                      s.sslLastError
                        ? "danger"
                        : s.sslIssuedAt
                          ? "success"
                          : "neutral"
                    }
                  >
                    {s.sslLastError
                      ? "Erreur SSL"
                      : s.sslIssuedAt
                        ? "SSL actif"
                        : "Sans SSL"}
                  </StatusBadge>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
