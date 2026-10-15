"use client"

import { useActionState, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  approveCancellationAction,
  keepServiceAction,
  rejectCancellationAction,
  requestCancellationAction,
  withdrawCancellationAction,
  type CancelState,
} from "@/lib/cancellations/actions"

function Feedback({ state }: { state: CancelState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state?.ok && state.notice) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {state.notice}
      </p>
    )
  }
  return null
}

/**
 * Bloc « Annuler le service » : demande, demande en attente, ou annulation
 * programmée à l'échéance.
 */
export function CancellationBox({
  serviceType,
  serviceId,
  pendingId,
  scheduled,
  expiresAt,
}: {
  serviceType: "vps" | "game"
  serviceId: string
  pendingId: string | null
  scheduled: boolean
  expiresAt: string | null
}) {
  const [state, action, pending] = useActionState(
    requestCancellationAction,
    undefined
  )
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<CancelState>(undefined)
  const end = expiresAt ? new Date(expiresAt).toLocaleDateString("fr-FR") : null

  if (scheduled) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>
          Annulation programmée : le service sera supprimé à l&apos;échéance
          {end ? ` (${end})` : ""}. Aucune facture ne sera émise.
        </p>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              start(async () =>
                setMsg(await keepServiceAction(serviceType, serviceId))
              )
            }
          >
            Conserver le service
          </Button>
        </div>
        <Feedback state={msg} />
      </div>
    )
  }
  if (pendingId) {
    return (
      <div className="flex flex-col gap-2 text-sm">
        <p>Ta demande d&apos;annulation est en cours de traitement.</p>
        <div>
          <Button
            variant="outline"
            size="sm"
            disabled={busy}
            onClick={() =>
              start(async () =>
                setMsg(await withdrawCancellationAction(pendingId))
              )
            }
          >
            Retirer la demande
          </Button>
        </div>
        <Feedback state={msg} />
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="serviceType" value={serviceType} />
      <input type="hidden" name="serviceId" value={serviceId} />
      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Quand ?</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="mode"
            value="end_of_period"
            defaultChecked
            className="mt-1"
          />
          <span>
            À l&apos;échéance{end ? ` (${end})` : ""} : tu profites de la
            période déjà payée
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input type="radio" name="mode" value="immediate" className="mt-1" />
          <span>
            Immédiatement : le service et ses données sont supprimés, sans
            remboursement
          </span>
        </label>
      </fieldset>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          Motif (facultatif, nous aide à nous améliorer)
        </span>
        <Input name="reason" maxLength={500} />
      </label>
      <Feedback state={state} />
      <div>
        <Button
          type="submit"
          variant="outline"
          className="text-destructive"
          disabled={pending}
        >
          Demander l&apos;annulation
        </Button>
      </div>
    </form>
  )
}

export function CancellationDecision({ id }: { id: string }) {
  const [busy, start] = useTransition()
  const [msg, setMsg] = useState<CancelState>(undefined)
  return (
    <span className="flex flex-wrap items-center gap-1">
      <Button
        size="xs"
        disabled={busy}
        onClick={() =>
          start(async () => setMsg(await approveCancellationAction(id)))
        }
      >
        Valider
      </Button>
      <Button
        size="xs"
        variant="ghost"
        disabled={busy}
        onClick={() =>
          start(async () => setMsg(await rejectCancellationAction(id)))
        }
      >
        Refuser
      </Button>
      {msg?.error && (
        <span role="alert" className="text-xs text-destructive">
          {msg.error}
        </span>
      )}
    </span>
  )
}
