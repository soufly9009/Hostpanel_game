import Link from "next/link"
import { and, asc, desc, eq, like, or } from "drizzle-orm"

import { SearchInput } from "@/components/kit-client"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Aide" }
export const dynamic = "force-dynamic"

export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>
}) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 80)
  const A = schema.kbArticles
  const [categories, articles] = await Promise.all([
    db
      .select()
      .from(schema.kbCategories)
      .orderBy(
        asc(schema.kbCategories.position),
        asc(schema.kbCategories.name)
      ),
    db
      .select({
        id: A.id,
        slug: A.slug,
        title: A.title,
        categoryId: A.categoryId,
      })
      .from(A)
      .where(
        and(
          eq(A.isPublished, true),
          q ? or(like(A.title, `%${q}%`), like(A.body, `%${q}%`)) : undefined
        )
      )
      .orderBy(desc(A.views), asc(A.title)),
  ])
  const groups = [
    ...categories.map((c) => ({
      key: c.id,
      name: c.name,
      description: c.description,
      items: articles.filter((a) => a.categoryId === c.id),
    })),
    {
      key: "other",
      name: "Autres articles",
      description: null,
      items: articles.filter(
        (a) => !a.categoryId || !categories.some((c) => c.id === a.categoryId)
      ),
    },
  ].filter((g) => g.items.length > 0)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Centre d&apos;aide
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Guides et réponses aux questions fréquentes. Tu ne trouves pas ?{" "}
        <Link className="underline" href="/tickets/new">
          Ouvre un ticket
        </Link>
        .
      </p>
      <div className="mt-6">
        <SearchInput placeholder="Rechercher un article…" />
      </div>
      {groups.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          {q ? "Aucun article ne correspond." : "Aucun article pour le moment."}
        </p>
      ) : (
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {groups.map((g) => (
            <section key={g.key} className="rounded-xl border bg-card p-5">
              <h2 className="font-medium">{g.name}</h2>
              {g.description && (
                <p className="mt-1 text-xs text-muted-foreground">
                  {g.description}
                </p>
              )}
              <ul className="mt-3 space-y-1.5 text-sm">
                {g.items.map((a) => (
                  <li key={a.id}>
                    <Link
                      className="underline-offset-2 hover:underline"
                      href={`/help/${a.slug}`}
                    >
                      {a.title}
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </>
  )
}
