"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  adminDeleteServer,
  deletePlan,
  setServerSuspended,
  togglePlan,
} from "@/lib/admin/actions"

export function PlanActions({
  planId,
  isActive,
}: {
  planId: string
  isActive: boolean
}) {
  const [pending, start] = useTransition()
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => start(() => togglePlan(planId, !isActive))}
      >
        {isActive ? "Désactiver" : "Activer"}
      </Button>
      <Button
        size="sm"
        variant="outline"
        className="text-destructive"
        disabled={pending}
        onClick={() => {
          if (confirm("Supprimer cette offre ?"))
            start(() => deletePlan(planId))
        }}
      >
        Supprimer
      </Button>
    </div>
  )
}

export function ServerActions({
  serverId,
  suspended,
}: {
  serverId: string
  suspended: boolean
}) {
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  const run = (fn: () => Promise<{ error?: string } | undefined>) =>
    start(async () => setError((await fn())?.error ?? null))

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() => run(() => setServerSuspended(serverId, !suspended))}
        >
          {suspended ? "Réactiver" : "Suspendre"}
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="text-destructive"
          disabled={pending}
          onClick={() => {
            if (confirm("Supprimer ce serveur et ses données ?")) {
              run(() => adminDeleteServer(serverId))
            }
          }}
        >
          Supprimer
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
