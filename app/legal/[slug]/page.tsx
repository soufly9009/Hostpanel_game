import Link from "next/link"
import { notFound } from "next/navigation"

import { StatusBadge } from "@/components/kit"
import { LegalSections } from "@/components/legal-body"
import { getPublishedDocument } from "@/lib/legal/service"

export const dynamic = "force-dynamic"

type Props = {
  params: Promise<{ slug: string }>
  searchParams: Promise<{ v?: string }>
}

export async function generateMetadata({ params }: Props) {
  const { slug } = await params
  const data = await getPublishedDocument(slug)
  return { title: data?.ver.title ?? "Document légal" }
}

export default async function LegalDocumentPage({
  params,
  searchParams,
}: Props) {
  const { slug } = await params
  const { v } = await searchParams
  const requested = v ? Number.parseInt(v, 10) || undefined : undefined
  const data = await getPublishedDocument(slug, requested)
  if (!data) notFound()
  const { doc, ver, history } = data
  const isCurrent = ver.version === doc.version

  return (
    <article>
      <h1 className="text-2xl font-semibold tracking-tight">{ver.title}</h1>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
        Version {ver.version} · publiée le{" "}
        {ver.publishedAt.toLocaleDateString("fr-FR", { dateStyle: "long" })}
        {!isCurrent && (
          <StatusBadge tone="warning">
            Ancienne version ·{" "}
            <Link className="underline" href={`/legal/${doc.slug}`}>
              voir la version en vigueur
            </Link>
          </StatusBadge>
        )}
      </p>
      {ver.changeNote && (
        <p className="mt-2 text-xs text-muted-foreground">
          Changements : {ver.changeNote}
        </p>
      )}

      <div className="mt-8">
        <LegalSections sections={ver.content} />
      </div>

      {history.length > 1 && (
        <details className="mt-12 rounded-xl border p-4 text-sm">
          <summary className="cursor-pointer font-medium">
            Historique des versions
          </summary>
          <ul className="mt-3 space-y-1">
            {history.map((h) => (
              <li key={h.version}>
                <Link
                  className="underline-offset-2 hover:underline"
                  href={`/legal/${doc.slug}?v=${h.version}`}
                >
                  Version {h.version}
                </Link>{" "}
                <span className="text-muted-foreground">
                  ·{" "}
                  {h.publishedAt.toLocaleDateString("fr-FR", {
                    dateStyle: "medium",
                  })}
                  {h.major ? "" : " · modification mineure"}
                  {h.changeNote ? ` · ${h.changeNote}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  )
}
