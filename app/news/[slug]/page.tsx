import Link from "next/link"
import { notFound } from "next/navigation"
import { and, eq } from "drizzle-orm"

import { LegalBody } from "@/components/legal-body"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

async function load(slug: string) {
  const [a] = await db
    .select()
    .from(schema.announcements)
    .where(
      and(
        eq(schema.announcements.slug, slug),
        eq(schema.announcements.isPublished, true)
      )
    )
  return a ?? null
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const a = await load((await params).slug)
  return { title: a?.title ?? "Annonce" }
}

export default async function NewsItemPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const a = await load((await params).slug)
  if (!a) notFound()
  return (
    <article>
      <Link className="text-sm text-muted-foreground underline" href="/news">
        ← Toutes les annonces
      </Link>
      <h1 className="mt-4 text-2xl font-semibold tracking-tight">{a.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {a.publishedAt?.toLocaleDateString("fr-FR", { dateStyle: "long" })}
      </p>
      <div className="mt-6 text-sm leading-relaxed">
        <LegalBody body={a.body} />
      </div>
    </article>
  )
}
