"use client"

import { useActionState, useState, useTransition } from "react"

import { CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createWebhookAction,
  deleteWebhookAction,
  pingWebhookAction,
  rotateWebhookSecretAction,
  toggleWebhookAction,
  type WebhookState,
} from "@/lib/webhooks/actions"
import { WEBHOOK_EVENTS } from "@/lib/webhooks/events"

function SecretBox({ state }: { state: WebhookState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (!state?.ok) return null
  return (
    <div role="status" className="rounded-lg border bg-muted/30 p-3 text-sm">
      <p>{state.notice}</p>
      {state.secret && (
        <p className="mt-1 flex items-center gap-1 font-mono text-xs break-all">
          {state.secret}
          <CopyButton value={state.secret} label="Copier la clé" />
        </p>
      )}
    </div>
  )
}

export function CreateWebhookForm() {
  const [state, action, pending] = useActionState(
    createWebhookAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Nom</span>
          <Input
            name="name"
            required
            maxLength={60}
            placeholder="Comptabilité, Zapier, bot Discord…"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">URL (https)</span>
          <Input
            name="url"
            type="url"
            required
            placeholder="https://exemple.com/webhooks/panel"
          />
        </label>
      </div>
      <fieldset className="grid gap-2 text-sm sm:grid-cols-2">
        <legend className="mb-1 font-medium">Événements</legend>
        {WEBHOOK_EVENTS.map((e) => (
          <label key={e.key} className="flex items-center gap-2">
            <input type="checkbox" name="events" value={e.key} />
            {e.label}{" "}
            <span className="font-mono text-xs text-muted-foreground">
              {e.key}
            </span>
          </label>
        ))}
      </fieldset>
      <SecretBox state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          Créer le webhook
        </Button>
      </div>
    </form>
  )
}

export function WebhookActions({
  id,
  active,
}: {
  id: string
  active: boolean
}) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<WebhookState>(undefined)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-1">
        <Button
          size="xs"
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => setState(await pingWebhookAction(id)))
          }
        >
          Ping
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() => start(() => toggleWebhookAction(id, !active))}
        >
          {active ? "Désactiver" : "Activer"}
        </Button>
        <Button
          size="xs"
          variant="ghost"
          disabled={pending}
          onClick={() =>
            start(async () => setState(await rotateWebhookSecretAction(id)))
          }
        >
          Nouvelle clé
        </Button>
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          disabled={pending}
          onClick={() => start(() => deleteWebhookAction(id))}
        >
          Supprimer
        </Button>
      </div>
      <SecretBox state={state} />
    </div>
  )
}
