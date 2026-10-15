import { randomUUID } from "node:crypto"
import Link from "next/link"
import { notFound } from "next/navigation"
import { and, desc, eq, sum } from "drizzle-orm"

import {
  BillingProfileForm,
  CustomInvoiceForm,
} from "@/components/billing-controls"
import {
  ClientActions,
  NoteActions,
  NoteForm,
} from "@/components/client-admin-controls"
import { PageHeader, Section, StatCard, StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { AdjustBalanceForm } from "@/components/wallet-controls"
import { CancelQuoteButton, QuoteForm } from "@/components/quote-controls"
import { AdminDisable2faButton } from "@/components/security-controls"
import { QUOTE_STATUS } from "@/lib/quotes/labels"
import { referralStats } from "@/lib/referrals/service"
import { setServerLimit } from "@/lib/admin/actions"
import { ROLE_LABEL } from "@/lib/auth/roles"
import { requireAdmin } from "@/lib/auth/session"
import {
  formatMoney,
  INVOICE_STATUS_LABEL,
  INVOICE_STATUS_TONE,
} from "@/lib/billing/money"
import { getBillingSettings } from "@/lib/billing/settings"
import { db, schema } from "@/lib/db"
import { isPast } from "@/lib/expiry"
import { STATUS_LABEL, STATUS_TONE, ticketRef } from "@/lib/tickets/labels"
import { formatCredits, KIND_LABEL } from "@/lib/wallet/format"

export const metadata = { title: "Fiche client" }
export const dynamic = "force-dynamic"

const fmt = (d: Date) => d.toLocaleDateString("fr-FR")

function Expiry({ at, suspended }: { at: Date | null; suspended: boolean }) {
  if (suspended) return <StatusBadge tone="danger">Suspendu</StatusBadge>
  if (!at) return <span className="text-muted-foreground">sans échéance</span>
  return (
    <span className={isPast(at) ? "text-destructive" : "text-muted-foreground"}>
      échéance {fmt(at)}
    </span>
  )
}

export default async function ClientFilePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const admin = await requireAdmin()
  const { id } = await params
  const [user] = await db
    .select()
    .from(schema.users)
    .where(eq(schema.users.id, id))
  if (!user) notFound()

  const I = schema.invoices
  const [
    [profile],
    servers,
    sites,
    games,
    invoices,
    [due],
    transactions,
    tickets,
    notes,
    activity,
    settings,
  ] = await Promise.all([
    db
      .select()
      .from(schema.billingProfiles)
      .where(eq(schema.billingProfiles.userId, id)),
    db.select().from(schema.servers).where(eq(schema.servers.userId, id)),
    db.select().from(schema.sites).where(eq(schema.sites.userId, id)),
    db
      .select()
      .from(schema.gameServers)
      .where(eq(schema.gameServers.userId, id)),
    db
      .select()
      .from(I)
      .where(eq(I.userId, id))
      .orderBy(desc(I.issuedAt))
      .limit(20),
    db
      .select({ amount: sum(I.totalCents) })
      .from(I)
      .where(
        and(eq(I.userId, id), eq(I.status, "unpaid"), eq(I.type, "invoice"))
      ),
    db
      .select()
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, id))
      .orderBy(desc(schema.walletTransactions.createdAt))
      .limit(15),
    db
      .select()
      .from(schema.tickets)
      .where(eq(schema.tickets.userId, id))
      .orderBy(desc(schema.tickets.lastMessageAt))
      .limit(15),
    db
      .select()
      .from(schema.clientNotes)
      .where(eq(schema.clientNotes.userId, id))
      .orderBy(
        desc(schema.clientNotes.isPinned),
        desc(schema.clientNotes.createdAt)
      ),
    db
      .select()
      .from(schema.activityLogs)
      .where(eq(schema.activityLogs.userId, id))
      .orderBy(desc(schema.activityLogs.createdAt))
      .limit(15),
    getBillingSettings(),
  ])
  const [quotes, referral, referrer] = await Promise.all([
    db
      .select()
      .from(schema.quotes)
      .where(eq(schema.quotes.userId, id))
      .orderBy(desc(schema.quotes.createdAt))
      .limit(10),
    referralStats(id),
    user.referredBy
      ? db
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, user.referredBy))
      : Promise.resolve([]),
  ])

  return (
    <>
      <PageHeader
        title={user.name ?? user.email}
        description={
          <>
            <Link className="underline" href="/admin/users">
              Clients
            </Link>{" "}
            · {user.email} · {ROLE_LABEL[user.role]} · inscrit le{" "}
            {fmt(user.createdAt)}
            {user.totpEnabledAt ? " · 2FA active" : ""}
            {referrer[0] && (
              <>
                {" · parrainé par "}
                <Link
                  className="underline"
                  href={`/admin/users/${referrer[0].id}`}
                >
                  {referrer[0].email}
                </Link>
              </>
            )}
            {referral.referees > 0 && ` · ${referral.referees} filleul(s)`}
          </>
        }
      />

      {notes.some((n) => n.isPinned) && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          {notes
            .filter((n) => n.isPinned)
            .map((n) => (
              <p key={n.id}>📌 {n.body}</p>
            ))}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-4">
        <StatCard label="Solde" value={formatCredits(user.balanceCents)} />
        <StatCard
          label="À payer"
          value={formatMoney(Number(due?.amount ?? 0), settings.currency)}
          tone={Number(due?.amount ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Services"
          value={servers.length + sites.length + games.length}
        />
        <StatCard label="Tickets" value={tickets.length} />
      </div>

      <Section title="Actions">
        <div className="flex flex-col gap-4">
          <ClientActions
            userId={user.id}
            email={user.email}
            canImpersonate={user.role !== "admin" && user.id !== admin.id}
          />
          {user.totpEnabledAt && (
            <div>
              <AdminDisable2faButton userId={user.id} />
            </div>
          )}
          <form
            action={setServerLimit.bind(null, user.id)}
            className="flex items-end gap-2"
          >
            <label className="flex flex-col gap-1.5 text-sm">
              <span className="font-medium">Limite de VPS</span>
              <Input
                name="serverLimit"
                type="number"
                min={0}
                max={1000}
                defaultValue={user.serverLimit}
                className="w-24"
              />
            </label>
            <Button type="submit" variant="outline" size="sm">
              Appliquer
            </Button>
          </form>
        </div>
      </Section>

      <Section title="Services">
        {servers.length + sites.length + games.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun service.</p>
        ) : (
          <ul className="divide-y text-sm">
            {servers.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <StatusBadge tone="info">VPS</StatusBadge>
                <Link
                  className="font-medium hover:underline"
                  href={`/servers/${s.id}`}
                >
                  {s.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {s.address ?? "—"} · VMID {s.vmid}
                </span>
                <span className="ml-auto text-xs">
                  <Expiry at={s.expiresAt} suspended={s.suspended} />
                </span>
              </li>
            ))}
            {games.map((g) => (
              <li key={g.id} className="flex flex-wrap items-center gap-2 py-2">
                <StatusBadge tone="info">Jeu</StatusBadge>
                <Link
                  className="font-medium hover:underline"
                  href={`/games/${g.id}`}
                >
                  {g.name}
                </Link>
                <span className="font-mono text-xs text-muted-foreground">
                  {g.address ?? "—"}
                </span>
                <span className="ml-auto text-xs">
                  <Expiry at={g.expiresAt} suspended={g.suspended} />
                </span>
              </li>
            ))}
            {sites.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
                <StatusBadge tone="info">Site</StatusBadge>
                <Link
                  className="font-medium hover:underline"
                  href={`/sites/${s.id}`}
                >
                  {s.domain}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Factures">
        {invoices.length === 0 ? (
          <p className="mb-4 text-sm text-muted-foreground">Aucune facture.</p>
        ) : (
          <ul className="mb-4 divide-y text-sm">
            {invoices.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  className="font-mono hover:underline"
                  href={`/invoices/${i.id}`}
                >
                  {i.number}
                </Link>
                <span>{formatMoney(i.totalCents, i.currency)}</span>
                <StatusBadge tone={INVOICE_STATUS_TONE[i.status]}>
                  {INVOICE_STATUS_LABEL[i.status]}
                </StatusBadge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmt(i.issuedAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Nouvelle facture manuelle
          </summary>
          <div className="mt-3">
            <CustomInvoiceForm userId={user.id} />
          </div>
        </details>
      </Section>

      <Section title="Devis">
        {quotes.length > 0 && (
          <ul className="mb-4 divide-y text-sm">
            {quotes.map((q) => (
              <li key={q.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  className="font-mono hover:underline"
                  href={`/quotes/${q.id}`}
                >
                  {q.number}
                </Link>
                <span>{q.title}</span>
                <span>{formatMoney(q.totalCents, q.currency)}</span>
                <StatusBadge tone={QUOTE_STATUS[q.status].tone}>
                  {QUOTE_STATUS[q.status].label}
                </StatusBadge>
                {q.status === "sent" && (
                  <span className="ml-auto">
                    <CancelQuoteButton id={q.id} />
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <details className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm font-medium">
            Nouveau devis
          </summary>
          <div className="mt-3">
            <QuoteForm userId={user.id} />
          </div>
        </details>
      </Section>

      <Section
        title="Coordonnées de facturation"
        description="Utilisées pour les prochaines factures (les factures émises restent figées)."
      >
        <BillingProfileForm profile={profile ?? null} userId={user.id} />
      </Section>

      <Section title="Solde de crédits">
        <AdjustBalanceForm userId={user.id} nonce={randomUUID()} />
        {transactions.length > 0 && (
          <ul className="mt-4 divide-y text-sm">
            {transactions.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center gap-2 py-1.5"
              >
                <span className="w-28 text-xs text-muted-foreground">
                  {t.createdAt.toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span className="text-xs">{KIND_LABEL[t.kind] ?? t.kind}</span>
                <span>{t.description}</span>
                <span
                  className={`ml-auto tabular-nums ${t.amountCents < 0 ? "text-destructive" : ""}`}
                >
                  {formatCredits(t.amountCents, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Tickets">
        {tickets.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun ticket.</p>
        ) : (
          <ul className="divide-y text-sm">
            {tickets.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2 py-2">
                <Link
                  className="font-mono hover:underline"
                  href={`/support/tickets/${t.id}`}
                >
                  {ticketRef(t.number)}
                </Link>
                <span>{t.subject}</span>
                <StatusBadge tone={STATUS_TONE[t.status]}>
                  {STATUS_LABEL[t.status]}
                </StatusBadge>
                <span className="ml-auto text-xs text-muted-foreground">
                  {fmt(t.lastMessageAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Notes internes" description="Jamais visibles du client.">
        <NoteForm userId={user.id} />
        {notes.length > 0 && (
          <ul className="mt-4 divide-y text-sm">
            {notes.map((n) => (
              <li key={n.id} className="flex gap-3 py-2">
                <div className="flex-1">
                  <p className="whitespace-pre-wrap">{n.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {n.author} ·{" "}
                    {n.createdAt.toLocaleString("fr-FR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })}
                  </p>
                </div>
                <NoteActions id={n.id} pinned={n.isPinned} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="Activité récente">
        {activity.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune activité.</p>
        ) : (
          <ul className="divide-y text-sm">
            {activity.map((a) => (
              <li key={a.id} className="flex flex-wrap gap-2 py-1.5">
                <span className="w-28 text-xs text-muted-foreground">
                  {a.createdAt.toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
                <span>{a.action}</span>
                {a.targetLabel && (
                  <span className="text-muted-foreground">{a.targetLabel}</span>
                )}
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
