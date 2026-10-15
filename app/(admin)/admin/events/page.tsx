import Link from "next/link"
import { and, count, desc, eq, gte, like, lte, or } from "drizzle-orm"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { Button } from "@/components/ui/button"
import { db, schema } from "@/lib/db"
import { CATEGORY_LABEL, LEVEL_LABEL, type Level } from "@/lib/discord/embed"

export const metadata = { title: "Événements" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 40

const LEVEL_TONE = {
  info: "info",
  success: "success",
  warning: "warning",
  error: "danger",
  critical: "danger",
} as const

const DISCORD_LABEL = {
  skipped: ["Non transmis", "neutral"],
  pending: ["En attente", "warning"],
  sent: ["Envoyé", "success"],
  failed: ["Échec", "danger"],
  suppressed: ["Fusionné", "neutral"],
} as const

type SP = {
  level?: string
  category?: string
  service?: string
  result?: string
  ref?: string
  q?: string
  from?: string
  to?: string
  discord?: string
  page?: string
}

const field =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

const parseDay = (v: string | undefined, endOfDay: boolean) => {
  if (!v || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return undefined
  const d = new Date(`${v}T${endOfDay ? "23:59:59" : "00:00:00"}Z`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

export default async function EventsPage({
  searchParams,
}: {
  searchParams: Promise<SP>
}) {
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const E = schema.systemEvents

  const levels = schema.EVENT_LEVELS as readonly string[]
  const cats = schema.EVENT_CATEGORIES as readonly string[]
  const q = (sp.q ?? "").trim().slice(0, 80)
  const service = (sp.service ?? "").trim().slice(0, 60)
  const ref = (sp.ref ?? "").trim().slice(0, 20)
  const from = parseDay(sp.from, false)
  const to = parseDay(sp.to, true)

  const conds = [
    sp.level && levels.includes(sp.level)
      ? eq(E.level, sp.level as Level)
      : undefined,
    sp.category && cats.includes(sp.category)
      ? eq(E.category, sp.category as (typeof schema.EVENT_CATEGORIES)[number])
      : undefined,
    sp.result === "success" || sp.result === "failure" || sp.result === "info"
      ? eq(E.result, sp.result)
      : undefined,
    service ? like(E.service, `%${service}%`) : undefined,
    ref ? eq(E.correlationId, ref) : undefined,
    q ? or(like(E.title, `%${q}%`), like(E.message, `%${q}%`)) : undefined,
    from ? gte(E.createdAt, from) : undefined,
    to ? lte(E.createdAt, to) : undefined,
    sp.discord && sp.discord in DISCORD_LABEL
      ? eq(E.discordState, sp.discord as keyof typeof DISCORD_LABEL)
      : undefined,
  ].filter(Boolean)
  const where = conds.length ? and(...conds) : undefined

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(E).where(where),
    db
      .select()
      .from(E)
      .where(where)
      .orderBy(desc(E.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
  ])

  const params = Object.fromEntries(
    Object.entries(sp).filter(([k]) => k !== "page")
  ) as Record<string, string | undefined>

  return (
    <>
      <PageHeader
        title="Événements"
        description="Journal local des événements importants (conservé 90 jours). Les données sensibles sont expurgées avant enregistrement."
      />

      <form
        method="GET"
        action="/admin/events"
        className="flex flex-wrap items-end gap-2"
      >
        <input
          name="q"
          defaultValue={q}
          placeholder="Rechercher…"
          aria-label="Recherche"
          className={`${field} w-48`}
        />
        <select
          name="level"
          defaultValue={sp.level ?? ""}
          className={field}
          aria-label="Gravité"
        >
          <option value="">Toutes gravités</option>
          {schema.EVENT_LEVELS.map((l) => (
            <option key={l} value={l}>
              {LEVEL_LABEL[l]}
            </option>
          ))}
        </select>
        <select
          name="category"
          defaultValue={sp.category ?? ""}
          className={field}
          aria-label="Catégorie"
        >
          <option value="">Toutes catégories</option>
          {schema.EVENT_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <select
          name="result"
          defaultValue={sp.result ?? ""}
          className={field}
          aria-label="Résultat"
        >
          <option value="">Tous résultats</option>
          <option value="success">Réussi</option>
          <option value="failure">Échec</option>
          <option value="info">Information</option>
        </select>
        <select
          name="discord"
          defaultValue={sp.discord ?? ""}
          className={field}
          aria-label="Livraison Discord"
        >
          <option value="">Livraison : toutes</option>
          {Object.entries(DISCORD_LABEL).map(([k, [label]]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
        <input
          name="service"
          defaultValue={service}
          placeholder="Service"
          aria-label="Service"
          className={`${field} w-32`}
        />
        <input
          name="ref"
          defaultValue={ref}
          placeholder="Référence"
          aria-label="Identifiant de corrélation"
          className={`${field} w-32 font-mono`}
        />
        <input
          type="date"
          name="from"
          defaultValue={sp.from ?? ""}
          className={field}
          aria-label="Du"
        />
        <input
          type="date"
          name="to"
          defaultValue={sp.to ?? ""}
          className={field}
          aria-label="Au"
        />
        <Button type="submit" size="sm">
          Filtrer
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          nativeButton={false}
          render={<Link href="/admin/events" />}
        >
          Réinitialiser
        </Button>
      </form>

      <p className="text-xs text-muted-foreground">{total} événement(s)</p>

      {rows.length === 0 ? (
        <EmptyState
          title="Aucun événement"
          description="Aucun événement ne correspond à ces filtres."
        />
      ) : (
        <ul className="divide-y rounded-xl border bg-card">
          {rows.map((e) => {
            const [dl, dt] = DISCORD_LABEL[e.discordState]
            return (
              <li key={e.id} className="p-3 text-sm">
                <details>
                  <summary className="flex cursor-pointer flex-wrap items-center gap-2">
                    <StatusBadge tone={LEVEL_TONE[e.level]}>
                      {LEVEL_LABEL[e.level]}
                    </StatusBadge>
                    <span className="font-medium">{e.title}</span>
                    <span className="text-xs text-muted-foreground">
                      {CATEGORY_LABEL[e.category]}
                      {e.service ? ` · ${e.service}` : ""}
                      {e.occurrences > 1 ? ` · ×${e.occurrences}` : ""}
                    </span>
                    <span className="ml-auto flex items-center gap-2">
                      <StatusBadge tone={dt}>{dl}</StatusBadge>
                      <span className="text-xs text-muted-foreground">
                        {e.createdAt.toLocaleString("fr-FR")}
                      </span>
                    </span>
                  </summary>
                  <dl className="mt-3 grid gap-2 rounded-lg bg-muted/30 p-3 text-xs sm:grid-cols-2">
                    {e.message && (
                      <div className="sm:col-span-2">
                        <dt className="text-muted-foreground">Détail</dt>
                        <dd className="break-words">{e.message}</dd>
                      </div>
                    )}
                    <div>
                      <dt className="text-muted-foreground">Action</dt>
                      <dd>{e.action ?? "—"}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Résultat</dt>
                      <dd>{e.result}</dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Référence</dt>
                      <dd className="font-mono">
                        {e.correlationId ? (
                          <Link
                            href={`/admin/events?ref=${e.correlationId}`}
                            className="underline underline-offset-4"
                          >
                            {e.correlationId}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">Discord</dt>
                      <dd>
                        {dl}
                        {e.discordAttempts > 0
                          ? ` · ${e.discordAttempts} tentative(s)`
                          : ""}
                        {e.discordLastError ? ` · ${e.discordLastError}` : ""}
                      </dd>
                    </div>
                    {Object.entries(e.meta ?? {}).map(([k, v]) => (
                      <div key={k}>
                        <dt className="text-muted-foreground">{k}</dt>
                        <dd className="break-all">{v}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              </li>
            )
          })}
        </ul>
      )}

      <Pagination
        basePath="/admin/events"
        page={page}
        pageCount={Math.ceil(total / PAGE_SIZE)}
        params={params}
      />
    </>
  )
}
