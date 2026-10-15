import Link from "next/link"
import { asc, count } from "drizzle-orm"

import { CreateDocumentForm } from "@/components/legal-controls"
import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { permissionsFor, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import { ensureLegalSeed } from "@/lib/legal/service"

export const metadata = { title: "Documents légaux" }
export const dynamic = "force-dynamic"

export default async function LegalAdminPage() {
  const user = await requireStaff()
  const perms = await permissionsFor(user)
  if (
    !["legal.edit", "legal.publish", "legal.delete"].some((p) => perms.has(p))
  ) {
    return (
      <>
        <PageHeader title="Documents légaux" />
        <ErrorState
          title="Accès limité"
          message="Ton rôle ne donne pas accès aux documents légaux."
        />
      </>
    )
  }

  await ensureLegalSeed()
  const D = schema.legalDocuments
  const [docs, acceptances] = await Promise.all([
    db.select().from(D).orderBy(asc(D.position), asc(D.title)),
    db
      .select({ documentId: schema.legalAcceptances.documentId, n: count() })
      .from(schema.legalAcceptances)
      .groupBy(schema.legalAcceptances.documentId),
  ])
  const accepted = new Map(acceptances.map((a) => [a.documentId, a.n]))

  return (
    <>
      <PageHeader
        title="Documents légaux"
        description={
          <>
            CGU, confidentialité, mentions légales… Les sections forment un
            brouillon ; seule la publication met à jour la page publique{" "}
            <Link className="underline" href="/legal" target="_blank">
              /legal
            </Link>
            .
          </>
        }
      />

      <Section title={`Documents (${docs.length})`}>
        <ul className="divide-y">
          {docs.map((d) => {
            const draft = d.updatedAt > (d.publishedAt ?? new Date(0))
            return (
              <li key={d.id}>
                <Link
                  href={`/support/legal/${d.id}`}
                  className="flex flex-wrap items-center gap-2 py-3 hover:bg-muted/40"
                >
                  <span className="font-medium">{d.title}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    /legal/{d.slug}
                  </span>
                  {d.version === 0 ? (
                    <StatusBadge tone="warning">Jamais publié</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">v{d.version}</StatusBadge>
                  )}
                  {d.version > 0 && draft && (
                    <StatusBadge tone="info">Brouillon modifié</StatusBadge>
                  )}
                  {!d.isPublished && (
                    <StatusBadge tone="neutral">Masqué</StatusBadge>
                  )}
                  {d.requiresAcceptance && (
                    <StatusBadge tone="info">
                      Acceptation obligatoire
                    </StatusBadge>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {accepted.get(d.id) ?? 0} acceptation(s)
                  </span>
                </Link>
              </li>
            )
          })}
        </ul>
      </Section>

      {perms.has("legal.edit") && (
        <Section title="Nouveau document">
          <CreateDocumentForm />
        </Section>
      )}
    </>
  )
}
