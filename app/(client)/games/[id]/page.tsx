import { notFound } from "next/navigation"
import { and, eq } from "drizzle-orm"

import {
  AddressCopy,
  GameConsole,
  GameDangerZone,
  GameLive,
} from "@/components/game-controls"
import { CancellationBox } from "@/components/cancellation-controls"
import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { RenewBox } from "@/components/renew-box"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { renewGameAction } from "@/lib/games/actions"
import { checkEveryMs, nextRenewalAt, periodMs } from "@/lib/renewals"

export const dynamic = "force-dynamic"

export default async function GamePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const user = await requireUser()
  const { id } = await params

  const [row] = await db
    .select({ game: schema.gameServers, plan: schema.gamePlans })
    .from(schema.gameServers)
    .leftJoin(
      schema.gamePlans,
      eq(schema.gamePlans.id, schema.gameServers.planId)
    )
    .where(eq(schema.gameServers.id, id))
  if (!row || (row.game.userId !== user.id && user.role !== "admin")) {
    notFound()
  }
  const { game, plan } = row
  const [pendingCancel] = await db
    .select({ id: schema.cancellationRequests.id })
    .from(schema.cancellationRequests)
    .where(
      and(
        eq(schema.cancellationRequests.serviceId, game.id),
        eq(schema.cancellationRequests.status, "pending")
      )
    )
  const periodDays = plan?.periodDays ?? null

  return (
    <>
      <PageHeader
        title={game.name}
        description={
          <span className="flex flex-wrap items-center gap-2">
            {plan?.eggName ?? plan?.name ?? "Offre supprimée"}
            {game.address && (
              <>
                {" · "}
                <AddressCopy address={game.address} />
              </>
            )}
            {game.suspended && (
              <StatusBadge tone="danger">
                {game.suspendReason === "expired"
                  ? "Suspendu : échéance dépassée"
                  : "Suspendu par un administrateur"}
              </StatusBadge>
            )}
          </span>
        }
      />

      <RenewBox
        renew={renewGameAction}
        noun="serveur"
        serverId={game.id}
        expiresAt={game.expiresAt?.toISOString() ?? null}
        suspendedForExpiry={game.suspended && game.suspendReason === "expired"}
        nextRenewalAt={
          nextRenewalAt(game.lastRenewedAt, periodDays)?.toISOString() ?? null
        }
        periodDays={Math.round(periodMs(periodDays) / 86_400_000)}
        checkEveryDays={Math.round(checkEveryMs() / 86_400_000)}
      />

      <Section title="État">
        <GameLive
          id={game.id}
          memoryLimitMb={plan?.memoryMb ?? 0}
          diskLimitMb={plan?.diskMb ?? 0}
          disabled={game.suspended}
        />
      </Section>

      <Section
        title="Console"
        description="Sortie en direct du serveur ; les commandes sont envoyées telles quelles."
      >
        <GameConsole id={game.id} disabled={game.suspended} />
      </Section>

      <Section title="Annuler le service" tone="danger">
        <CancellationBox
          serviceType="game"
          serviceId={game.id}
          pendingId={pendingCancel?.id ?? null}
          scheduled={game.cancelAtPeriodEnd}
          expiresAt={game.expiresAt?.toISOString() ?? null}
        />
      </Section>

      <Section title="Zone dangereuse" tone="danger">
        <GameDangerZone id={game.id} name={game.name} />
      </Section>
    </>
  )
}
