import { count, desc } from "drizzle-orm"

import { EmptyState, PageHeader } from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Activité" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 50

export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const A = schema.activityLogs
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(A),
    db
      .select()
      .from(A)
      .orderBy(desc(A.createdAt), desc(A.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  return (
    <>
      <PageHeader
        title="Activité"
        description="Qui a fait quoi sur la plateforme."
      />

      {rows.length === 0 ? (
        <EmptyState title="Aucune activité enregistrée" />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Date</th>
                <th className="p-3 font-medium">Utilisateur</th>
                <th className="p-3 font-medium">Action</th>
                <th className="p-3 font-medium">Cible</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="p-3 whitespace-nowrap text-muted-foreground">
                    {r.createdAt.toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "medium",
                    })}
                  </td>
                  <td className="p-3">{r.actor}</td>
                  <td className="p-3">{r.action}</td>
                  <td className="p-3 text-muted-foreground">
                    {r.targetLabel ?? "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        basePath="/admin/activity"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
      />
    </>
  )
}
