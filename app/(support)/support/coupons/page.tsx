import { desc, eq } from "drizzle-orm"

import { ErrorState, PageHeader, Section, StatusBadge } from "@/components/kit"
import {
  CouponForm,
  CouponRowActions,
  GiftCardForm,
  GiftCardRowActions,
} from "@/components/wallet-controls"
import { can, requireStaff } from "@/lib/auth/permissions"
import { db, schema } from "@/lib/db"
import { formatCredits } from "@/lib/wallet/format"
import { isPast } from "@/lib/expiry"

export const metadata = { title: "Coupons et cartes cadeaux" }
export const dynamic = "force-dynamic"

const GIFT_STATUS = {
  active: { label: "Active", tone: "success" },
  redeemed: { label: "Utilisée", tone: "neutral" },
  disabled: { label: "Désactivée", tone: "warning" },
} as const

const fmtDate = (d: Date | null) =>
  d ? d.toLocaleDateString("fr-FR", { dateStyle: "medium" }) : null

export default async function CouponsPage({
  searchParams,
}: {
  searchParams: Promise<{ gift?: string }>
}) {
  const staff = await requireStaff()
  if (!(await can(staff, "coupons.manage"))) {
    return (
      <>
        <PageHeader title="Coupons et cartes cadeaux" />
        <ErrorState
          title="Accès limité"
          message="Ton rôle ne donne pas accès aux coupons (permission coupons.manage)."
        />
      </>
    )
  }
  const sp = await searchParams
  const giftFilter = (["active", "redeemed", "disabled"] as const).find(
    (s) => s === sp.gift
  )

  const G = schema.giftCards
  const [coupons, cards] = await Promise.all([
    db.select().from(schema.coupons).orderBy(desc(schema.coupons.createdAt)),
    db
      .select({
        card: G,
        redeemer: schema.users.email,
      })
      .from(G)
      .leftJoin(schema.users, eq(schema.users.id, G.redeemedBy))
      .where(giftFilter ? eq(G.status, giftFilter) : undefined)
      .orderBy(desc(G.createdAt))
      .limit(200),
  ])

  return (
    <>
      <PageHeader
        title="Coupons et cartes cadeaux"
        description="Un coupon est un code réutilisable (limites globale et par compte) ; une carte cadeau est un code unique à usage unique. Les deux créditent le solde."
      />

      <Section title={`Coupons (${coupons.length})`}>
        {coupons.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun coupon.</p>
        ) : (
          <ul className="divide-y">
            {coupons.map((c) => {
              const expired = c.expiresAt && isPast(c.expiresAt)
              const exhausted =
                c.maxRedemptions !== null && c.redemptions >= c.maxRedemptions
              return (
                <li key={c.id} className="flex flex-col gap-2 py-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm">
                    <span className="font-mono font-medium">{c.code}</span>
                    <span>{formatCredits(c.amountCents, { sign: true })}</span>
                    {!c.isActive ? (
                      <StatusBadge tone="neutral">Désactivé</StatusBadge>
                    ) : expired ? (
                      <StatusBadge tone="warning">Expiré</StatusBadge>
                    ) : exhausted ? (
                      <StatusBadge tone="warning">Épuisé</StatusBadge>
                    ) : (
                      <StatusBadge tone="success">Actif</StatusBadge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {c.redemptions}
                      {c.maxRedemptions !== null &&
                        ` / ${c.maxRedemptions}`}{" "}
                      utilisation(s) · {c.perUserLimit} par compte
                      {c.startsAt && ` · dès le ${fmtDate(c.startsAt)}`}
                      {c.expiresAt && ` · jusqu'au ${fmtDate(c.expiresAt)}`}
                    </span>
                  </div>
                  {c.description && (
                    <p className="text-xs text-muted-foreground">
                      {c.description}
                    </p>
                  )}
                  <CouponRowActions
                    coupon={{
                      id: c.id,
                      code: c.code,
                      description: c.description,
                      amountCents: c.amountCents,
                      maxRedemptions: c.maxRedemptions,
                      perUserLimit: c.perUserLimit,
                      startsAt: c.startsAt,
                      expiresAt: c.expiresAt,
                      isActive: c.isActive,
                    }}
                  />
                </li>
              )
            })}
          </ul>
        )}
        <div className="mt-6 border-t pt-4">
          <h3 className="mb-3 text-sm font-medium">Nouveau coupon</h3>
          <CouponForm />
        </div>
      </Section>

      <Section
        title="Cartes cadeaux"
        description="Les codes sont des secrets au porteur : ne les transmets qu'à leur destinataire."
      >
        <GiftCardForm />
        <nav aria-label="Filtrer" className="mt-6 flex flex-wrap gap-2 text-sm">
          {[
            { v: undefined, label: "Toutes" },
            { v: "active", label: "Actives" },
            { v: "redeemed", label: "Utilisées" },
            { v: "disabled", label: "Désactivées" },
          ].map((f) => (
            <a
              key={f.label}
              href={f.v ? `/support/coupons?gift=${f.v}` : "/support/coupons"}
              className={`rounded-md px-2 py-1 ${giftFilter === f.v ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"}`}
            >
              {f.label}
            </a>
          ))}
        </nav>
        {cards.length === 0 ? (
          <p className="mt-3 text-sm text-muted-foreground">Aucune carte.</p>
        ) : (
          <ul className="mt-2 divide-y text-sm">
            {cards.map(({ card: g, redeemer }) => {
              const expired =
                g.status === "active" && g.expiresAt && isPast(g.expiresAt)
              const st = GIFT_STATUS[g.status]
              return (
                <li
                  key={g.id}
                  className="flex flex-wrap items-center gap-2 py-2"
                >
                  <span className="font-mono">{g.code}</span>
                  <span>{formatCredits(g.amountCents)}</span>
                  {expired ? (
                    <StatusBadge tone="warning">Expirée</StatusBadge>
                  ) : (
                    <StatusBadge tone={st.tone}>{st.label}</StatusBadge>
                  )}
                  <span className="text-xs text-muted-foreground">
                    {g.status === "redeemed"
                      ? `par ${redeemer ?? "compte supprimé"} le ${fmtDate(g.redeemedAt)}`
                      : g.expiresAt
                        ? `expire le ${fmtDate(g.expiresAt)}`
                        : "sans expiration"}
                    {g.note && ` · ${g.note}`}
                  </span>
                  <span className="ml-auto">
                    <GiftCardRowActions
                      id={g.id}
                      code={g.code}
                      status={g.status}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>
    </>
  )
}
