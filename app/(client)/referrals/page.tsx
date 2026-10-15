import { desc, eq } from "drizzle-orm"
import { GiftIcon, UsersIcon } from "lucide-react"

import { CopyButton } from "@/components/kit-client"
import { PageHeader, Section, StatCard } from "@/components/kit"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { panelUrl } from "@/lib/mail/service"
import { ensureReferralCode, referralStats } from "@/lib/referrals/service"
import { formatCredits } from "@/lib/wallet/format"
import { getWalletSettings } from "@/lib/wallet/settings"

export const metadata = { title: "Parrainage" }
export const dynamic = "force-dynamic"

export default async function ReferralsPage() {
  const user = await requireUser()
  const [code, stats, settings, rewards] = await Promise.all([
    ensureReferralCode(user.id),
    referralStats(user.id),
    getWalletSettings(),
    db
      .select()
      .from(schema.referralRewards)
      .where(eq(schema.referralRewards.referrerId, user.id))
      .orderBy(desc(schema.referralRewards.createdAt))
      .limit(20),
  ])
  const link = `${panelUrl() ?? ""}/register?ref=${code}`
  const active = settings.referralBonusCents > 0

  return (
    <>
      <PageHeader
        title="Parrainage"
        description={
          active
            ? `Invite tes amis : tu reçois ${formatCredits(settings.referralBonusCents)} ${settings.referralTrigger === "signup" ? "à leur inscription" : "quand ils règlent leur première facture"}.`
            : "Le programme de parrainage n'est pas actif pour le moment."
        }
      />
      <div className="grid gap-4 sm:grid-cols-2">
        <StatCard label="Filleuls" value={stats.referees} icon={UsersIcon} />
        <StatCard
          label="Crédits gagnés"
          value={formatCredits(stats.earned)}
          icon={GiftIcon}
        />
      </div>
      <Section title="Ton lien">
        <div className="flex flex-col gap-2 text-sm">
          <p className="flex flex-wrap items-center gap-1 font-mono break-all">
            {link}
            <CopyButton value={link} label="Copier le lien" />
          </p>
          <p className="text-muted-foreground">
            Code : <strong className="font-mono">{code}</strong>
          </p>
        </div>
      </Section>
      {rewards.length > 0 && (
        <Section title="Récompenses">
          <ul className="divide-y text-sm">
            {rewards.map((r) => (
              <li key={r.id} className="flex justify-between py-1.5">
                <span>{r.createdAt.toLocaleDateString("fr-FR")}</span>
                <span className="tabular-nums">
                  {formatCredits(r.amountCents, { sign: true })}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}
    </>
  )
}
