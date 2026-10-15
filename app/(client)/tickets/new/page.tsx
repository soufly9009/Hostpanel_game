import { eq } from "drizzle-orm"

import { PageHeader } from "@/components/kit"
import { NewTicketForm } from "@/components/ticket-forms"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Nouveau ticket" }
export const dynamic = "force-dynamic"

export default async function NewTicketPage({
  searchParams,
}: {
  searchParams: Promise<{ server?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams

  const [servers, sites] = await Promise.all([
    db
      .select({ id: schema.servers.id, name: schema.servers.name })
      .from(schema.servers)
      .where(eq(schema.servers.userId, user.id)),
    db
      .select({ id: schema.sites.id, domain: schema.sites.domain })
      .from(schema.sites)
      .where(eq(schema.sites.userId, user.id)),
  ])

  return (
    <>
      <PageHeader
        title="Nouveau ticket"
        description="Décris ton problème : l'assistant IA et notre équipe te répondent ici."
      />
      <NewTicketForm
        servers={servers}
        sites={sites}
        defaultServerId={
          servers.some((s) => s.id === sp.server) ? sp.server : undefined
        }
      />
    </>
  )
}
