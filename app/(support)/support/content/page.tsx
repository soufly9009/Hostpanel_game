import Link from "next/link"
import { asc, desc } from "drizzle-orm"

import {
  AnnouncementForm,
  ArticleForm,
  CategoryForm,
  Editable,
} from "@/components/content-controls"
import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Annonces et aide" }
export const dynamic = "force-dynamic"

export default async function ContentPage() {
  const user = await requireStaff()
  if (!(await can(user, "content.manage"))) {
    return (
      <>
        <PageHeader title="Annonces et aide" />
        <ErrorState
          title="Accès limité"
          message="Permission content.manage requise."
        />
      </>
    )
  }

  const [news, categories, articles] = await Promise.all([
    db
      .select()
      .from(schema.announcements)
      .orderBy(desc(schema.announcements.createdAt)),
    db
      .select()
      .from(schema.kbCategories)
      .orderBy(
        asc(schema.kbCategories.position),
        asc(schema.kbCategories.name)
      ),
    db
      .select()
      .from(schema.kbArticles)
      .orderBy(desc(schema.kbArticles.updatedAt)),
  ])
  const catName = new Map(categories.map((c) => [c.id, c.name]))
  const catOptions = categories.map((c) => ({ id: c.id, name: c.name }))

  return (
    <>
      <PageHeader
        title="Annonces et aide"
        description={
          <>
            Contenus publics :{" "}
            <Link className="underline" href="/news" target="_blank">
              /news
            </Link>{" "}
            et{" "}
            <Link className="underline" href="/help" target="_blank">
              /help
            </Link>
            .
          </>
        }
      />

      <Section title={`Annonces (${news.length})`}>
        <div className="flex flex-col gap-2">
          {news.map((a) => (
            <Editable
              key={a.id}
              summary={
                <>
                  <span className="font-medium">{a.title}</span>
                  {a.isPublished ? (
                    <StatusBadge tone="success">
                      Publiée {a.publishedAt?.toLocaleDateString("fr-FR")}
                    </StatusBadge>
                  ) : (
                    <StatusBadge tone="neutral">Brouillon</StatusBadge>
                  )}
                </>
              }
            >
              <AnnouncementForm item={a} />
            </Editable>
          ))}
        </div>
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Nouvelle annonce</h3>
          <AnnouncementForm />
        </div>
      </Section>

      <Section title={`Catégories d'aide (${categories.length})`}>
        <div className="flex flex-col gap-3">
          {categories.map((c) => (
            <CategoryForm key={c.id} item={c} />
          ))}
          <div className="border-t pt-3">
            <CategoryForm />
          </div>
        </div>
      </Section>

      <Section title={`Articles d'aide (${articles.length})`}>
        <div className="flex flex-col gap-2">
          {articles.map((a) => (
            <Editable
              key={a.id}
              summary={
                <>
                  <span className="font-medium">{a.title}</span>
                  <span className="text-xs text-muted-foreground">
                    {a.categoryId
                      ? catName.get(a.categoryId)
                      : "Sans catégorie"}{" "}
                    · {a.views} vue(s)
                  </span>
                  {!a.isPublished && (
                    <StatusBadge tone="neutral">Brouillon</StatusBadge>
                  )}
                </>
              }
            >
              <ArticleForm item={a} categories={catOptions} />
            </Editable>
          ))}
        </div>
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Nouvel article</h3>
          <ArticleForm categories={catOptions} />
        </div>
      </Section>
    </>
  )
}
