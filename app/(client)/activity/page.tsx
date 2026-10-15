import { count, desc, eq } from "drizzle-orm"

import { EmptyState, PageHeader } from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Activité" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const A = schema.activityLogs
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(A).where(eq(A.userId, user.id)),
    db
      .select()
      .from(A)
      .where(eq(A.userId, user.id))
      .orderBy(desc(A.createdAt), desc(A.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  return (
    <>
      <PageHeader
        title="Activité"
        description="Les actions effectuées avec ton compte."
      />

      {rows.length === 0 ? (
        <EmptyState title="Aucune activité enregistrée" />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((r) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline gap-x-3 p-3 text-sm"
            >
              <span className="font-medium">{r.action}</span>
              {r.targetLabel && (
                <span className="text-muted-foreground">{r.targetLabel}</span>
              )}
              <span className="ml-auto text-xs text-muted-foreground">
                {r.createdAt.toLocaleString("fr-FR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </span>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/activity"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
      />
    </>
  )
}
