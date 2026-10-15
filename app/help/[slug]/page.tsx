import Link from "next/link"
import { notFound } from "next/navigation"
import { and, eq, sql } from "drizzle-orm"

import { LegalBody } from "@/components/legal-body"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

async function load(slug: string) {
  const [row] = await db
    .select({ a: schema.kbArticles, category: schema.kbCategories.name })
    .from(schema.kbArticles)
    .leftJoin(
      schema.kbCategories,
      eq(schema.kbCategories.id, schema.kbArticles.categoryId)
    )
    .where(
      and(
        eq(schema.kbArticles.slug, slug),
        eq(schema.kbArticles.isPublished, true)
      )
    )
  return row ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const row = await load((await params).slug)
  return { title: row?.a.title ?? "Aide" }
}

export default async function HelpArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const row = await load((await params).slug)
  if (!row) notFound()
  await db
    .update(schema.kbArticles)
    .set({ views: sql`${schema.kbArticles.views} + 1` })
    .where(eq(schema.kbArticles.id, row.a.id))

  return (
    <article>
      <Link className="text-sm text-muted-foreground underline" href="/help">
        ← Centre d&apos;aide{row.category ? ` · ${row.category}` : ""}
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">
        {row.a.title}
      </h1>
      <p className="mt-1 text-xs text-muted-foreground">
        Mis à jour le{" "}
        {row.a.updatedAt.toLocaleDateString("fr-FR", { dateStyle: "long" })}
      </p>
      <div className="mt-6 text-sm leading-relaxed">
        <LegalBody body={row.a.body} />
      </div>
      <p className="mt-10 rounded-xl border p-4 text-sm text-muted-foreground">
        Cet article ne t&apos;a pas aidé ?{" "}
        <Link className="underline" href="/tickets/new">
          Contacte le support
        </Link>
        .
      </p>
    </article>
  )
}
