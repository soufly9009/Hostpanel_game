"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { daysUntil, isPast } from "@/lib/expiry"
import { renewServer } from "@/lib/servers/actions"

export function RenewBox({
  serverId,
  expiresAt,
  suspendedForExpiry,
  nextRenewalAt,
  periodDays,
  checkEveryDays,
}: {
  /** ISO ; date du prochain renouvellement permis (1 par période). */
  nextRenewalAt: string | null
  serverId: string
  /** ISO ; null = sans expiration. */
  expiresAt: string | null
  suspendedForExpiry: boolean
  periodDays: number
  checkEveryDays: number
}) {
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()

  if (!expiresAt) return null

  const exp = new Date(expiresAt)
  const expired = isPast(exp)
  const daysLeft = daysUntil(exp)
  const soon = !expired && daysLeft <= checkEveryDays
  const next = nextRenewalAt ? new Date(nextRenewalAt) : null
  const locked = next !== null && !isPast(next)

  const tone = expired
    ? "border-destructive/40 bg-destructive/5"
    : soon
      ? "border-amber-500/40 bg-amber-500/5"
      : ""

  return (
    <section
      className={`flex flex-wrap items-center gap-x-6 gap-y-3 rounded-xl border p-4 text-sm ${tone}`}
    >
      <div>
        <p className="font-medium">
          {expired
            ? suspendedForExpiry
              ? "Expiré — VPS suspendu"
              : "Échéance dépassée — suspension à la prochaine vérification"
            : `Expire dans ${daysLeft} jour${daysLeft > 1 ? "s" : ""}`}
        </p>
        <p className="text-xs text-muted-foreground">
          {exp.toLocaleString("fr-FR", {
            dateStyle: "long",
            timeStyle: "short",
          })}
          {" · "}renouvellement de {periodDays} jours, vérification tous les{" "}
          {checkEveryDays} jours
        </p>
      </div>
      <div className="ml-auto flex items-center gap-3">
        {error && (
          <span role="alert" className="text-xs text-destructive">
            {error}
          </span>
        )}
        <Button
          size="sm"
          variant={expired || soon ? "default" : "outline"}
          disabled={pending || locked}
          title={
            locked && next
              ? `Prochain renouvellement le ${next.toLocaleString("fr-FR", { dateStyle: "long", timeStyle: "short" })}`
              : undefined
          }
          onClick={() => {
            setError(null)
            start(async () => {
              const res = await renewServer(serverId)
              if (res?.error) setError(res.error)
            })
          }}
        >
          {pending
            ? "…"
            : locked && next
              ? `Renouvelable le ${next.toLocaleDateString("fr-FR")}`
              : `Renouveler (+${periodDays} j)`}
        </Button>
      </div>
    </section>
  )
}
