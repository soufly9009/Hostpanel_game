import { randomUUID } from "node:crypto"
import Link from "next/link"
import { and, count, desc, eq, like, or, sum } from "drizzle-orm"

import {
  EmptyState,
  ErrorState,
  PageHeader,
  Section,
  StatCard,
} from "@/components/kit"
import { SearchInput } from "@/components/kit-client"
import { Pagination } from "@/components/pagination"
import {
  AdjustBalanceForm,
  WalletSettingsForm,
} from "@/components/wallet-controls"
import { permissionsFor, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import { formatCredits, KIND_LABEL } from "@/lib/wallet/format"
import { getWalletSettings } from "@/lib/wallet/settings"

export const metadata = { title: "Soldes" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 25

export default async function StaffWalletPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; page?: string; user?: string }>
}) {
  const staff = await requireStaff()
  const perms = await permissionsFor(staff)
  if (!perms.has("wallet.view")) {
    return (
      <>
        <PageHeader title="Soldes" />
        <ErrorState
          title="Accès limité"
          message="Ton rôle ne donne pas accès aux soldes (permission wallet.view)."
        />
      </>
    )
  }

  const sp = await searchParams
  const q = (sp.q ?? "").trim().slice(0, 80)
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const U = schema.users
  const where = q
    ? or(like(U.email, `%${q}%`), like(U.name, `%${q}%`))
    : undefined

  const [[{ total }], users, [stats], settings] = await Promise.all([
    db.select({ total: count() }).from(U).where(where),
    db
      .select({
        id: U.id,
        email: U.email,
        name: U.name,
        balanceCents: U.balanceCents,
      })
      .from(U)
      .where(where)
      .orderBy(desc(U.balanceCents), U.email)
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select({ circulating: sum(U.balanceCents) }).from(U),
    getWalletSettings(),
  ])

  const selectedId = sp.user?.slice(0, 64)
  const [selected] = selectedId
    ? await db
        .select({
          id: U.id,
          email: U.email,
          name: U.name,
          balanceCents: U.balanceCents,
        })
        .from(U)
        .where(eq(U.id, selectedId))
    : []
  const T = schema.walletTransactions
  const history = selected
    ? await db
        .select()
        .from(T)
        .where(and(eq(T.userId, selected.id)))
        .orderBy(desc(T.createdAt), desc(T.id))
        .limit(50)
    : []

  return (
    <>
      <PageHeader
        title="Soldes de crédits"
        description="Crédits virtuels sans valeur monétaire. Chaque mouvement est tracé avec son auteur et son motif."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <StatCard
          label="Crédits en circulation"
          value={formatCredits(Number(stats?.circulating ?? 0))}
        />
        <StatCard
          label="Facturation en crédits"
          value={settings.billingEnabled ? "Activée" : "Désactivée"}
        />
        <StatCard
          label="Bonus de bienvenue"
          value={formatCredits(settings.signupBonusCents)}
        />
      </div>

      {selected && (
        <Section
          title={`${selected.name ?? selected.email} · ${formatCredits(selected.balanceCents)}`}
          description={
            <>
              {selected.email} ·{" "}
              <Link
                className="underline"
                href={`/support/wallet?${new URLSearchParams({ ...(q ? { q } : {}) })}`}
              >
                fermer
              </Link>
            </>
          }
        >
          {perms.has("wallet.adjust") && (
            <div className="mb-6">
              <AdjustBalanceForm userId={selected.id} nonce={randomUUID()} />
            </div>
          )}
          {history.length === 0 ? (
            <p className="text-sm text-muted-foreground">Aucun mouvement.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr className="border-b">
                    <th className="py-2 pr-3 font-medium">Date</th>
                    <th className="py-2 pr-3 font-medium">Type</th>
                    <th className="py-2 pr-3 font-medium">Libellé</th>
                    <th className="py-2 pr-3 font-medium">Auteur</th>
                    <th className="py-2 pr-3 text-right font-medium">
                      Montant
                    </th>
                    <th className="py-2 text-right font-medium">Solde</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {history.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-3 whitespace-nowrap text-muted-foreground">
                        {t.createdAt.toLocaleString("fr-FR", {
                          dateStyle: "short",
                          timeStyle: "short",
                        })}
                      </td>
                      <td className="py-2 pr-3">
                        {KIND_LABEL[t.kind] ?? t.kind}
                      </td>
                      <td className="py-2 pr-3">{t.description}</td>
                      <td className="py-2 pr-3 text-xs text-muted-foreground">
                        {t.actor}
                      </td>
                      <td
                        className={`py-2 pr-3 text-right whitespace-nowrap tabular-nums ${t.amountCents < 0 ? "text-destructive" : ""}`}
                      >
                        {formatCredits(t.amountCents, { sign: true })}
                      </td>
                      <td className="py-2 text-right whitespace-nowrap tabular-nums">
                        {formatCredits(t.balanceAfterCents)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>
      )}

      <Section title={`Comptes (${total})`}>
        <div className="mb-3">
          <SearchInput placeholder="E-mail ou nom…" />
        </div>
        {users.length === 0 ? (
          <EmptyState title="Aucun compte" />
        ) : (
          <ul className="divide-y text-sm">
            {users.map((u) => (
              <li key={u.id}>
                <Link
                  href={`/support/wallet?${new URLSearchParams({ ...(q ? { q } : {}), ...(page > 1 ? { page: String(page) } : {}), user: u.id })}`}
                  className="flex flex-wrap items-center gap-2 py-2 hover:bg-muted/40"
                >
                  <span className="font-medium">{u.name ?? u.email}</span>
                  <span className="text-muted-foreground">{u.email}</span>
                  <span
                    className={`ml-auto tabular-nums ${u.balanceCents < 0 ? "text-destructive" : ""}`}
                  >
                    {formatCredits(u.balanceCents)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        <div className="mt-3">
          <Pagination
            basePath="/support/wallet"
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
            params={{ q: q || undefined }}
          />
        </div>
      </Section>

      {staff.role === "admin" && (
        <Section
          title="Réglages (administrateur)"
          description="Ces réglages s'appliquent immédiatement à tous les clients."
        >
          <WalletSettingsForm settings={settings} />
        </Section>
      )}
    </>
  )
}
