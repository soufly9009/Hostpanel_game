import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { db, schema } from "@/lib/db"

export const metadata = { title: "Annonces" }
export const dynamic = "force-dynamic"

export default async function NewsPage() {
  const items = await db
    .select()
    .from(schema.announcements)
    .where(eq(schema.announcements.isPublished, true))
    .orderBy(desc(schema.announcements.publishedAt))
    .limit(50)

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">Annonces</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Nouveautés et informations du service. Pour les incidents en cours,
        consulte{" "}
        <Link className="underline" href="/status">
          l&apos;état du service
        </Link>
        .
      </p>
      {items.length === 0 ? (
        <p className="mt-8 rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Aucune annonce pour le moment.
        </p>
      ) : (
        <ul className="mt-8 flex flex-col gap-4">
          {items.map((a) => (
            <li key={a.id}>
              <Link
                href={`/news/${a.slug}`}
                className="block rounded-xl border bg-card p-5 hover:bg-muted/40"
              >
                <p className="text-xs text-muted-foreground">
                  {a.publishedAt?.toLocaleDateString("fr-FR", {
                    dateStyle: "long",
                  })}
                </p>
                <h2 className="mt-1 font-medium">{a.title}</h2>
                {a.summary && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    {a.summary}
                  </p>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
