import Link from "next/link"
import { and, count, desc, eq, gte, or, type SQL } from "drizzle-orm"

import { AutoRefresh } from "@/components/auto-refresh"
import { ClearLogs } from "@/components/clear-logs"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Journaux Proxmox" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 50
const VIEWS = {
  all: "Tout",
  errors: "Erreurs",
  writes: "Modifications",
} as const
type View = keyof typeof VIEWS

export default async function LogsPage({
  searchParams,
}: {
  searchParams: Promise<{ view?: string; page?: string }>
}) {
  const sp = await searchParams
  const view: View = sp.view && sp.view in VIEWS ? (sp.view as View) : "all"
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)

  const L = schema.proxmoxLogs
  const isError = or(eq(L.status, 0), gte(L.status, 400)) as SQL
  const where: SQL | undefined =
    view === "errors"
      ? isError
      : view === "writes"
        ? and(
            or(
              eq(L.method, "POST"),
              eq(L.method, "PUT"),
              eq(L.method, "DELETE")
            )
          )
        : undefined

  const [rows, [{ total }], [{ errors }], [{ all }]] = await Promise.all([
    db
      .select()
      .from(L)
      .where(where)
      .orderBy(desc(L.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ total: count() }).from(L).where(where),
    db.select({ errors: count() }).from(L).where(isError),
    db.select({ all: count() }).from(L),
  ])

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE))
  const href = (v: View, p = 1) =>
    `/admin/logs?view=${v}${p > 1 ? `&page=${p}` : ""}`

  return (
    <>
      <AutoRefresh seconds={10} />

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Journaux Proxmox</h1>
          <p className="text-sm text-muted-foreground">
            {all} entrée{all > 1 ? "s" : ""} · {errors} erreur
            {errors > 1 ? "s" : ""} · modifications et erreurs uniquement, les
            mots de passe ne sont jamais enregistrés
          </p>
        </div>
        <ClearLogs total={all} errors={errors} />
      </div>

      <nav className="flex w-fit gap-1 rounded-lg border p-1 text-sm">
        {(Object.keys(VIEWS) as View[]).map((v) => (
          <Link
            key={v}
            href={href(v)}
            className={`rounded-md px-3 py-1 ${
              v === view
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted"
            }`}
          >
            {VIEWS[v]}
          </Link>
        ))}
      </nav>

      <div className="overflow-x-auto rounded-xl border">
        <table className="w-full text-sm">
          <thead className="border-b text-left text-muted-foreground">
            <tr>
              <th className="p-3 font-medium">Date</th>
              <th className="p-3 font-medium">Acteur</th>
              <th className="p-3 font-medium">Action</th>
              <th className="p-3 font-medium">Requête</th>
              <th className="p-3 font-medium">Statut</th>
              <th className="p-3 font-medium">Durée</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {rows.map((r) => {
              const failed = r.status === 0 || r.status >= 400
              return (
                <tr key={r.id} className={failed ? "bg-destructive/5" : ""}>
                  <td className="p-3 text-xs whitespace-nowrap tabular-nums">
                    {r.createdAt.toLocaleString("fr-FR")}
                  </td>
                  <td className="p-3 text-xs">{r.actor ?? "—"}</td>
                  <td className="p-3">
                    <p className="font-medium">{r.action}</p>
                    {r.error && (
                      <p className="mt-0.5 max-w-md text-xs break-words text-destructive">
                        {r.error}
                      </p>
                    )}
                  </td>
                  <td className="p-3 font-mono text-xs break-all">
                    {r.method} {r.path}
                  </td>
                  <td className="p-3">
                    <span
                      className={`rounded-md px-2 py-0.5 text-xs font-medium ${
                        failed
                          ? "bg-destructive/10 text-destructive"
                          : "bg-green-500/10 text-green-600"
                      }`}
                    >
                      {r.status === 0 ? "réseau" : r.status}
                    </span>
                  </td>
                  <td className="p-3 text-xs tabular-nums">
                    {r.durationMs} ms
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr>
                <td
                  colSpan={6}
                  className="p-6 text-center text-muted-foreground"
                >
                  Aucune entrée.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">
            Page {page} / {pages}
          </span>
          <div className="flex gap-2">
            {page > 1 && (
              <Link
                className="rounded-md border px-3 py-1 hover:bg-muted"
                href={href(view, page - 1)}
              >
                ← Plus récents
              </Link>
            )}
            {page < pages && (
              <Link
                className="rounded-md border px-3 py-1 hover:bg-muted"
                href={href(view, page + 1)}
              >
                Plus anciens →
              </Link>
            )}
          </div>
        </div>
      )}
    </>
  )
}
