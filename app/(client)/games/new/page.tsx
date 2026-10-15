import { asc, eq } from "drizzle-orm"

import { OrderGameForm } from "@/components/game-controls"
import { EmptyState, ErrorState, PageHeader, Section } from "@/components/kit"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { env, pterodactylConfigured } from "@/lib/env"
import { formatMb } from "@/lib/format"
import { formatCredits } from "@/lib/wallet/format"
import { getWalletSettings } from "@/lib/wallet/settings"

export const metadata = { title: "Nouveau serveur de jeu" }
export const dynamic = "force-dynamic"

export default async function NewGamePage() {
  await requireUser()
  if (!pterodactylConfigured) {
    return (
      <>
        <PageHeader title="Nouveau serveur de jeu" />
        <ErrorState
          title="Indisponible"
          message="Les serveurs de jeu ne sont pas encore disponibles."
        />
      </>
    )
  }

  const [plans, settings] = await Promise.all([
    db
      .select()
      .from(schema.gamePlans)
      .where(eq(schema.gamePlans.isActive, true))
      .orderBy(asc(schema.gamePlans.priceCents)),
    getWalletSettings(),
  ])

  const days = (p: (typeof plans)[number]) =>
    p.periodDays ?? env.RENEW_PERIOD_DAYS

  return (
    <>
      <PageHeader
        title="Nouveau serveur de jeu"
        description={
          settings.billingEnabled
            ? "Le prix de l'offre est débité de ton solde de crédits à la création, puis à chaque renouvellement."
            : "Choisis une offre et donne un nom à ton serveur."
        }
      />
      {plans.length === 0 ? (
        <EmptyState
          title="Aucune offre disponible"
          description="Reviens bientôt : les offres sont en préparation."
        />
      ) : (
        <Section title="Commande">
          <OrderGameForm
            plans={plans.map((p) => ({
              id: p.id,
              name: p.name,
              description: p.description,
              eggName: p.eggName,
              price:
                p.priceCents > 0
                  ? `${formatCredits(p.priceCents)} / ${days(p)} j`
                  : `Gratuit · ${days(p)} j`,
              specs: [
                `${formatMb(p.memoryMb)} de mémoire`,
                `${formatMb(p.diskMb)} de disque`,
                p.cpuPercent === 0
                  ? "Processeur illimité"
                  : `${p.cpuPercent / 100} cœur(s)`,
                ...(p.databases ? [`${p.databases} base(s) de données`] : []),
                ...(p.backups ? [`${p.backups} sauvegarde(s)`] : []),
              ],
            }))}
          />
        </Section>
      )}
    </>
  )
}
