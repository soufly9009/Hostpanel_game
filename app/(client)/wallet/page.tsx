import Link from "next/link"
import { count, desc, eq } from "drizzle-orm"
import { CoinsIcon } from "lucide-react"

import { EmptyState, PageHeader, Section, StatCard } from "@/components/kit"
import { Pagination } from "@/components/pagination"
import { RedeemForm } from "@/components/wallet-controls"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { formatCredits, KIND_LABEL } from "@/lib/wallet/format"
import { getWalletSettings } from "@/lib/wallet/settings"

export const metadata = { title: "Mon solde" }
export const dynamic = "force-dynamic"

const PAGE_SIZE = 20

export default async function WalletPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>
}) {
  const user = await requireUser()
  const sp = await searchParams
  const page = Math.max(1, Number.parseInt(sp.page ?? "1", 10) || 1)
  const T = schema.walletTransactions

  const [[account], [{ total }], rows, settings] = await Promise.all([
    db
      .select({ balanceCents: schema.users.balanceCents })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)),
    db.select({ total: count() }).from(T).where(eq(T.userId, user.id)),
    db
      .select()
      .from(T)
      .where(eq(T.userId, user.id))
      .orderBy(desc(T.createdAt), desc(T.id))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    getWalletSettings(),
  ])

  return (
    <>
      <PageHeader
        title="Mon solde"
        description={
          <>
            Crédits virtuels sans valeur monétaire, utilisables uniquement sur
            le panel.{" "}
            <Link className="underline" href="/legal/conditions-credits">
              Conditions des crédits
            </Link>
          </>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard
          label="Solde disponible"
          value={formatCredits(account?.balanceCents ?? 0)}
          icon={CoinsIcon}
          tone={(account?.balanceCents ?? 0) < 0 ? "danger" : "default"}
          hint={
            settings.billingEnabled
              ? "Débité à la commande et au renouvellement de tes VPS."
              : "La facturation en crédits n'est pas activée."
          }
        />
      </div>

      <Section
        title="Utiliser un coupon ou une carte cadeau"
        description="Le montant est ajouté immédiatement à ton solde."
      >
        <RedeemForm />
      </Section>

      <Section title="Historique">
        {rows.length === 0 ? (
          <EmptyState
            title="Aucun mouvement"
            description="Tes crédits, coupons et débits apparaîtront ici."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 pr-3 font-medium">Date</th>
                  <th className="py-2 pr-3 font-medium">Type</th>
                  <th className="py-2 pr-3 font-medium">Libellé</th>
                  <th className="py-2 pr-3 text-right font-medium">Montant</th>
                  <th className="py-2 text-right font-medium">Solde</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((t) => (
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
                    <td
                      className={`py-2 pr-3 text-right whitespace-nowrap tabular-nums ${t.amountCents < 0 ? "text-destructive" : "text-emerald-600 dark:text-emerald-400"}`}
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
        <div className="mt-3">
          <Pagination
            basePath="/wallet"
            page={page}
            pageCount={Math.ceil(total / PAGE_SIZE)}
          />
        </div>
      </Section>
    </>
  )
}
