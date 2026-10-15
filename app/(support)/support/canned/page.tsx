import { asc } from "drizzle-orm"

import { ErrorState, PageHeader, Section } from "@/components/kit"
import { CannedForm } from "@/components/support-extra-controls"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Réponses prédéfinies" }
export const dynamic = "force-dynamic"

export default async function CannedPage() {
  const user = await requireStaff()
  if (!(await can(user, "tickets.macros"))) {
    return (
      <>
        <PageHeader title="Réponses prédéfinies" />
        <ErrorState
          title="Accès limité"
          message="Permission tickets.macros requise."
        />
      </>
    )
  }
  const items = await db
    .select()
    .from(schema.cannedResponses)
    .orderBy(asc(schema.cannedResponses.title))
  return (
    <>
      <PageHeader
        title="Réponses prédéfinies"
        description="Insérables en un clic dans une réponse à un ticket. {{name}} est remplacé par le nom du client."
      />
      <Section title={`Réponses (${items.length})`}>
        <div className="flex flex-col gap-3">
          {items.map((c) => (
            <details key={c.id} className="rounded-lg border p-3">
              <summary className="cursor-pointer text-sm font-medium">
                {c.title}
              </summary>
              <div className="mt-3">
                <CannedForm item={c} />
              </div>
            </details>
          ))}
        </div>
      </Section>
      <Section title="Nouvelle réponse">
        <CannedForm />
      </Section>
    </>
  )
}
