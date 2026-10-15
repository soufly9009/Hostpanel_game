import Link from "next/link"
import { desc, eq } from "drizzle-orm"
import { PlusIcon } from "lucide-react"

import { EmptyState, PageHeader, StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { env, pterodactylConfigured } from "@/lib/env"
import { daysUntil, isPast } from "@/lib/expiry"

export const metadata = { title: "Serveurs de jeu" }
export const dynamic = "force-dynamic"

export default async function GamesPage() {
  const user = await requireUser()
  const games = await db
    .select({ game: schema.gameServers, plan: schema.gamePlans })
    .from(schema.gameServers)
    .leftJoin(
      schema.gamePlans,
      eq(schema.gamePlans.id, schema.gameServers.planId)
    )
    .where(eq(schema.gameServers.userId, user.id))
    .orderBy(desc(schema.gameServers.createdAt))

  const canOrder =
    pterodactylConfigured &&
    (user.role === "admin" || games.length < env.PTERODACTYL_SERVER_LIMIT)

  return (
    <>
      <PageHeader
        title="Serveurs de jeu"
        description={`${games.length} / ${env.PTERODACTYL_SERVER_LIMIT} serveur(s). Tout se gère ici : alimentation, console et renouvellement.`}
        actions={
          canOrder && (
            <Button nativeButton={false} render={<Link href="/games/new" />}>
              <PlusIcon /> Nouveau serveur
            </Button>
          )
        }
      />
      {games.length === 0 ? (
        <EmptyState
          title="Aucun serveur de jeu"
          description={
            pterodactylConfigured
              ? "Crée ton premier serveur en quelques secondes."
              : "Les serveurs de jeu ne sont pas encore disponibles."
          }
          action={
            canOrder
              ? { href: "/games/new", label: "Créer un serveur" }
              : undefined
          }
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {games.map(({ game: g, plan }) => (
            <li key={g.id}>
              <Link
                href={`/games/${g.id}`}
                className="flex h-full flex-col gap-1 rounded-xl border bg-card p-4 hover:bg-muted/40"
              >
                <span className="flex items-center gap-2 font-medium">
                  {g.name}
                  {g.suspended && (
                    <StatusBadge tone="danger">Suspendu</StatusBadge>
                  )}
                </span>
                <span className="text-xs text-muted-foreground">
                  {plan?.eggName ?? plan?.name ?? "Offre supprimée"}
                </span>
                {g.address && (
                  <span className="font-mono text-sm">{g.address}</span>
                )}
                {g.expiresAt && (
                  <span
                    className={`text-xs ${isPast(g.expiresAt) ? "text-destructive" : "text-muted-foreground"}`}
                  >
                    {isPast(g.expiresAt)
                      ? "Expiré"
                      : `Expire dans ${daysUntil(g.expiresAt)} j`}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
