import Link from "next/link"
import { and, count, desc, eq, like, or, sql } from "drizzle-orm"

import {
  EmptyState,
  ErrorState,
  PageHeader,
  StatCard,
  StatusBadge,
} from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import {
  CATEGORY_LABEL,
  PRIORITY_LABEL,
  PRIORITY_TONE,
  STATUS_LABEL,
  STATUS_TONE,
  ticketRef,
} from "@/lib/tickets/labels"

export const metadata = { title: "Tickets" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

type SP = {
  status?: string
  priority?: string
  assignee?: string
  q?: string
  page?: string
  denied?: string
}

const field =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export default async function SupportQueuePage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const user = await requireStaff()
  const sp = await searchParams

  if (!(await can(user, "tickets.view_all"))) {
    return (
      <>
        <PageHeader title="Tickets" />
        <ErrorState
          title="Accès limité"
          message="Ton rôle ne donne pas accès à la file des tickets."
        />
      </>
    )
  }

  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const q = (sp.q ?? "").trim().slice(0, 80)
  const T = schema.tickets

  const status = (schema.TICKET_STATUSES as readonly string[]).includes(
    sp.status ?? ""
  )
    ? (sp.status as (typeof schema.TICKET_STATUSES)[number])
    : undefined
  // Par défaut : tout ce qui n'est pas fermé.
  const statusCond = status
    ? eq(T.status, status)
    : sp.status === "all"
      ? undefined
      : or(eq(T.status, "open"), eq(T.status, "pending"))

  const number = /^t?-?0*(\d{1,6})$/i.exec(q)?.[1]
  const where = and(
    statusCond,
    ["low", "normal", "high", "urgent"].includes(sp.priority ?? "")
      ? eq(T.priority, sp.priority as "low" | "normal" | "high" | "urgent")
      : undefined,
    sp.assignee === "me"
      ? eq(T.assignedTo, user.id)
      : sp.assignee === "none"
        ? sql`${T.assignedTo} is null`
        : undefined,
    q
      ? or(
          like(T.subject, `%${q}%`),
          number ? eq(T.number, Number(number)) : undefined
        )
      : undefined
  )

  const [[{ total }], rows, [openCount], [urgentCount], [mineCount]] =
    await Promise.all([
      db.select({ total: count() }).from(T).where(where),
      db
        .select({
          id: T.id,
          number: T.number,
          subject: T.subject,
          category: T.category,
          priority: T.priority,
          status: T.status,
          lastMessageAt: T.lastMessageAt,
          assignedTo: T.assignedTo,
          customer: schema.users.email,
        })
        .from(T)
        .innerJoin(schema.users, eq(schema.users.id, T.userId))
        .where(where)
        .orderBy(
          sql`case ${T.priority} when 'urgent' then 0 when 'high' then 1 when 'normal' then 2 else 3 end`,
          desc(T.lastMessageAt)
        )
        .limit(PAGE_SIZE)
        .offset((page - 1) * PAGE_SIZE),
      db.select({ n: count() }).from(T).where(eq(T.status, "open")),
      db
        .select({ n: count() })
        .from(T)
        .where(and(eq(T.status, "open"), eq(T.priority, "urgent"))),
      db
        .select({ n: count() })
        .from(T)
        .where(and(eq(T.assignedTo, user.id), eq(T.status, "open"))),
    ])

  const params = Object.fromEntries(
    Object.entries(sp).filter(([k]) => k !== "page" && k !== "denied")
  ) as Record<string, string | undefined>

  return (
    <>
      <PageHeader title="Tickets" description="File d'attente du support." />

      {sp.denied && (
        <ErrorState
          title="Permission manquante"
          message="Ton rôle ne permet pas d'accéder à cette page."
        />
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard label="Ouverts" value={openCount.n} />
        <StatCard
          label="Urgents ouverts"
          value={urgentCount.n}
          tone={urgentCount.n > 0 ? "danger" : "default"}
        />
        <StatCard label="Qui me sont assignés" value={mineCount.n} />
      </div>

      <form
        method="GET"
        action="/support"
        className="flex flex-wrap items-end gap-2"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Sujet ou T-0001…"
          aria-label="Recherche"
          className={`${field} w-52`}
        />
        <select
          name="status"
          defaultValue={sp.status ?? ""}
          className={field}
          aria-label="Statut"
        >
          <option value="">Actifs (ouverts + en attente)</option>
          <option value="all">Tous</option>
          {schema.TICKET_STATUSES.map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <select
          name="priority"
          defaultValue={sp.priority ?? ""}
          className={field}
          aria-label="Priorité"
        >
          <option value="">Toutes priorités</option>
          {Object.entries(PRIORITY_LABEL).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <select
          name="assignee"
          defaultValue={sp.assignee ?? ""}
          className={field}
          aria-label="Assignation"
        >
          <option value="">Toutes assignations</option>
          <option value="me">Assignés à moi</option>
          <option value="none">Non assignés</option>
        </select>
        <Button type="submit" size="sm">
          Filtrer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/support" />}
        >
          Réinitialiser
        </Button>
      </form>

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun ticket"
          description="Aucun ticket ne correspond à ces filtres."
        />
      ) : (
        <div className="overflow-x-auto rounded-xl border bg-card">
          <table className="w-full text-sm">
            <thead className="border-b text-left text-muted-foreground">
              <tr>
                <th className="p-3 font-medium">Réf.</th>
                <th className="p-3 font-medium">Sujet</th>
                <th className="p-3 font-medium">Client</th>
                <th className="p-3 font-medium">Priorité</th>
                <th className="p-3 font-medium">Statut</th>
                <th className="p-3 font-medium">Dernier message</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((t) => (
                <tr key={t.id} className="hover:bg-muted/40">
                  <td className="p-3 font-mono text-xs">
                    {ticketRef(t.number)}
                  </td>
                  <td className="p-3">
                    <Link
                      href={`/support/tickets/${t.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {t.subject}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {CATEGORY_LABEL[t.category]}
                      {t.assignedTo === user.id
                        ? " · à moi"
                        : t.assignedTo
                          ? " · assigné"
                          : ""}
                    </p>
                  </td>
                  <td className="p-3 text-xs">{t.customer}</td>
                  <td className="p-3">
                    <StatusBadge tone={PRIORITY_TONE[t.priority]}>
                      {PRIORITY_LABEL[t.priority]}
                    </StatusBadge>
                  </td>
                  <td className="p-3">
                    <StatusBadge tone={STATUS_TONE[t.status]}>
                      {STATUS_LABEL[t.status]}
                    </StatusBadge>
                  </td>
                  <td className="p-3 text-xs text-muted-foreground">
                    {t.lastMessageAt.toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Pagination
        basePath="/support"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        params={params}
      />
    </>
  )
}
