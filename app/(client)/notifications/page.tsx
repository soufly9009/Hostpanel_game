import Link from "next/link"
import { count, desc, eq } from "drizzle-orm"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { MarkReadButton } from "@/components/mark-read-button"
import { Pagination } from "@/components/pagination"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Notifications" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

const TONE = { info: "info", warning: "warning", error: "danger" } as const

export default async function NotificationsPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const N = schema.notifications
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(N).where(eq(N.userId, user.id)),
    db
      .select()
      .from(N)
      .where(eq(N.userId, user.id))
      .orderBy(desc(N.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])
  const unread = rows.filter((n) => !n.readAt).length

  return (
    <>
      <PageHeader
        title="Notifications"
        description={`${total} notification(s)`}
        actions={
          unread > 0 && (
            <MarkReadButton id={null} label="Tout marquer comme lu" />
          )
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          title="Aucune notification"
          description="Les échéances, certificats et incidents apparaîtront ici."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((n) => (
            <li
              key={n.id}
              className={`flex flex-wrap items-start gap-3 p-4 text-sm ${n.readAt ? "opacity-70" : ""}`}
            >
              <StatusBadge tone={TONE[n.level]}>
                {n.level === "error"
                  ? "Erreur"
                  : n.level === "warning"
                    ? "Attention"
                    : "Info"}
              </StatusBadge>
              <div className="min-w-0 flex-1">
                <p className="font-medium">{n.title}</p>
                {n.body && (
                  <p className="text-xs text-muted-foreground">{n.body}</p>
                )}
                <p className="mt-1 text-xs text-muted-foreground">
                  {n.createdAt.toLocaleString("fr-FR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {n.href && (
                    <>
                      {" · "}
                      <Link
                        href={n.href}
                        className="underline underline-offset-4"
                      >
                        Ouvrir
                      </Link>
                    </>
                  )}
                </p>
              </div>
              {!n.readAt && (
                <MarkReadButton id={n.id} label="Marquer comme lu" />
              )}
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/notifications"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
      />
    </>
  )
}
