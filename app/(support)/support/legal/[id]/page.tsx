import Link from "next/link"
import { notFound } from "next/navigation"
import { asc, desc, eq } from "drizzle-orm"

import {
  AddSectionForm,
  EditDocumentForm,
  PublishForm,
  SectionEditor,
} from "@/components/legal-controls"
import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { permissionsFor, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Document légal" }
export const dynamic = "force-dynamic"

export default async function LegalDocumentEditorPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const user = await requireStaff()
  const perms = await permissionsFor(user)
  const canEdit = perms.has("legal.edit")
  const canPublish = perms.has("legal.publish")
  const canDelete = perms.has("legal.delete")
  if (!canEdit && !canPublish && !canDelete) {
    return (
      <ErrorState
        title="Accès limité"
        message="Ton rôle ne donne pas accès aux documents légaux."
      />
    )
  }

  const [doc] = await db
    .select()
    .from(schema.legalDocuments)
    .where(eq(schema.legalDocuments.id, id))
  if (!doc) notFound()

  const [sections, versions] = await Promise.all([
    db
      .select()
      .from(schema.legalSections)
      .where(eq(schema.legalSections.documentId, doc.id))
      .orderBy(asc(schema.legalSections.position)),
    db
      .select()
      .from(schema.legalVersions)
      .where(eq(schema.legalVersions.documentId, doc.id))
      .orderBy(desc(schema.legalVersions.version)),
  ])

  return (
    <>
      <PageHeader
        title={doc.title}
        description={
          <>
            <Link className="underline" href="/support/legal">
              Documents légaux
            </Link>{" "}
            ·{" "}
            {doc.version > 0 ? (
              <Link
                className="underline"
                href={`/legal/${doc.slug}`}
                target="_blank"
              >
                version publique v{doc.version}
              </Link>
            ) : (
              "jamais publié"
            )}
            {doc.updatedBy && ` · modifié par ${doc.updatedBy}`}
          </>
        }
      />

      <Section title="Paramètres">
        <EditDocumentForm
          canDelete={canDelete}
          doc={{
            id: doc.id,
            title: doc.title,
            slug: doc.slug,
            summary: doc.summary,
            position: doc.position,
            requiresAcceptance: doc.requiresAcceptance,
            isPublished: doc.isPublished,
          }}
        />
        {!canEdit && (
          <p className="mt-2 text-xs text-muted-foreground">
            Lecture seule : permission « legal.edit » requise pour modifier.
          </p>
        )}
      </Section>

      <Section
        title={`Sections du brouillon (${sections.length})`}
        description="Texte brut : paragraphes séparés par une ligne vide, lignes commençant par « - » en liste à puces. Les modifications ne sont visibles qu'après publication."
      >
        <ol className="flex flex-col gap-6">
          {sections.map((s, i) => (
            <li key={s.id} className="rounded-lg border p-3">
              <SectionEditor
                section={{ id: s.id, heading: s.heading, body: s.body }}
                canEdit={canEdit}
                canDelete={canDelete}
                first={i === 0}
                last={i === sections.length - 1}
              />
            </li>
          ))}
        </ol>
        {canEdit && (
          <div className="mt-6 border-t pt-4">
            <h3 className="mb-3 text-sm font-medium">Nouvelle section</h3>
            <AddSectionForm documentId={doc.id} />
          </div>
        )}
      </Section>

      {canPublish && (
        <Section
          title="Publier"
          description="Fige le brouillon actuel dans une nouvelle version publique, conservée comme preuve de ce qui a été accepté."
        >
          <PublishForm
            documentId={doc.id}
            nextVersion={doc.version + 1}
            requiresAcceptance={doc.requiresAcceptance}
          />
        </Section>
      )}

      <Section title={`Versions publiées (${versions.length})`}>
        {versions.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune version.</p>
        ) : (
          <ul className="divide-y text-sm">
            {versions.map((v) => (
              <li key={v.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  className="font-medium underline-offset-2 hover:underline"
                  href={`/legal/${doc.slug}?v=${v.version}`}
                  target="_blank"
                >
                  Version {v.version}
                </Link>
                <StatusBadge tone={v.major ? "info" : "neutral"}>
                  {v.major ? "Majeure" : "Mineure"}
                </StatusBadge>
                <span className="text-muted-foreground">
                  {v.publishedAt.toLocaleString("fr-FR", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                  {v.publishedBy && ` · ${v.publishedBy}`}
                  {v.changeNote && ` · ${v.changeNote}`}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
