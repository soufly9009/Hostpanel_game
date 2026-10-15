import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { CancellationDecision } from "@/components/cancellation-controls"
import { EmptyState, PageHeader, Section, StatusBadge } from "@/components/kit"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Annulations" }
export const dynamic = "force-dynamic"

const STATUS = {
  pending: { label: "En attente", tone: "warning" },
  approved: { label: "Validée", tone: "success" },
  rejected: { label: "Refusée", tone: "neutral" },
  withdrawn: { label: "Retirée", tone: "neutral" },
} as const

export default async function CancellationsPage() {
  const C = schema.cancellationRequests
  const rows = await db
    .select({ r: C, email: schema.users.email })
    .from(C)
    .leftJoin(schema.users, eq(schema.users.id, C.userId))
    .orderBy(desc(C.createdAt))
    .limit(200)
  const pending = rows.filter((x) => x.r.status === "pending")
  const done = rows.filter((x) => x.r.status !== "pending")

  const line = ({ r, email }: (typeof rows)[number]) => (
    <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
      <StatusBadge tone="info">
        {r.serviceType === "vps" ? "VPS" : "Jeu"}
      </StatusBadge>
      <Link
        className="font-medium hover:underline"
        href={
          r.serviceType === "vps"
            ? `/servers/${r.serviceId}`
            : `/games/${r.serviceId}`
        }
      >
        {r.serviceName}
      </Link>
      {r.userId && (
        <Link
          className="text-muted-foreground hover:underline"
          href={`/admin/users/${r.userId}`}
        >
          {email}
        </Link>
      )}
      <StatusBadge tone={r.mode === "immediate" ? "danger" : "warning"}>
        {r.mode === "immediate" ? "Immédiate" : "À l'échéance"}
      </StatusBadge>
      {r.reason && (
        <span className="text-xs text-muted-foreground">« {r.reason} »</span>
      )}
      <span className="ml-auto text-xs text-muted-foreground">
        {r.createdAt.toLocaleString("fr-FR", {
          dateStyle: "short",
          timeStyle: "short",
        })}
      </span>
      {r.status === "pending" ? (
        <CancellationDecision id={r.id} />
      ) : (
        <StatusBadge tone={STATUS[r.status].tone}>
          {STATUS[r.status].label}
          {r.handledBy ? ` · ${r.handledBy}` : ""}
        </StatusBadge>
      )}
    </li>
  )

  return (
    <>
      <PageHeader
        title="Demandes d'annulation"
        description="Immédiate : le service est supprimé dès la validation. À l'échéance : il reste actif, n'est plus facturé, puis est supprimé."
      />
      <Section title={`En attente (${pending.length})`}>
        {pending.length === 0 ? (
          <EmptyState title="Aucune demande en attente" />
        ) : (
          <ul className="divide-y">{pending.map(line)}</ul>
        )}
      </Section>
      <Section title="Historique">
        {done.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune.</p>
        ) : (
          <ul className="divide-y">{done.map(line)}</ul>
        )}
      </Section>
    </>
  )
}
