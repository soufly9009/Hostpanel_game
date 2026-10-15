import Link from "next/link"

import { StatusBadge } from "@/components/kit"
import { listPublicDocuments } from "@/lib/legal/service"

export const metadata = { title: "Documents légaux" }
export const dynamic = "force-dynamic"

export default async function LegalIndexPage() {
  const docs = await listPublicDocuments()

  return (
    <>
      <h1 className="text-2xl font-semibold tracking-tight">
        Documents légaux
      </h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Conditions, confidentialité et informations légales du service.
      </p>
      <ul className="mt-8 divide-y rounded-xl border bg-card">
        {docs.map((d) => (
          <li key={d.id}>
            <Link
              href={`/legal/${d.slug}`}
              className="flex flex-col gap-1 p-4 outline-none hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <span className="flex flex-wrap items-center gap-2 font-medium">
                {d.title}
                {d.requiresAcceptance && (
                  <StatusBadge tone="info">Acceptation requise</StatusBadge>
                )}
              </span>
              {d.summary && (
                <span className="text-sm text-muted-foreground">
                  {d.summary}
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                Version {d.version}
                {d.publishedAt &&
                  ` · ${d.publishedAt.toLocaleDateString("fr-FR", { dateStyle: "long" })}`}
              </span>
            </Link>
          </li>
        ))}
        {docs.length === 0 && (
          <li className="p-6 text-center text-sm text-muted-foreground">
            Aucun document publié.
          </li>
        )}
      </ul>
    </>
  )
}
