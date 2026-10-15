"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createApiKeyAction,
  deleteApiKeyAction,
  revokeApiKeyAction,
} from "@/lib/api/actions"
import { API_SCOPES } from "@/lib/api/scopes"

export function CreateApiKeyForm() {
  const [state, action, pending] = useActionState(createApiKeyAction, undefined)
  return (
    <div className="flex flex-col gap-4">
      {state?.key && (
        <div
          role="status"
          className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
        >
          <p className="font-medium">
            Clé « {state.name} » créée : copie-la maintenant, elle ne sera plus
            jamais affichée.
          </p>
          <div className="mt-2 flex items-center gap-2">
            <code className="rounded bg-muted px-2 py-1 font-mono text-xs break-all">
              {state.key}
            </code>
            <CopyButton value={state.key} label="Copier la clé" />
          </div>
        </div>
      )}
      <form action={action} className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Nom</span>
            <Input
              name="name"
              required
              minLength={2}
              maxLength={60}
              placeholder="Boutique, bot Discord…"
              className="w-64"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Expire dans (jours, 0 = jamais)</span>
            <Input
              name="expiresInDays"
              type="number"
              min={0}
              max={3650}
              defaultValue={0}
              className="w-32"
            />
          </label>
        </div>
        <fieldset className="flex flex-col gap-2 text-sm">
          <legend className="mb-1 font-medium">Portées</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {API_SCOPES.map((s) => (
              <label key={s.key} className="flex items-start gap-2">
                <input
                  type="checkbox"
                  name="scopes"
                  value={s.key}
                  className="mt-1"
                />
                <span>
                  {s.label}{" "}
                  <span className="font-mono text-xs text-muted-foreground">
                    {s.key}
                  </span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
        {state?.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending ? "…" : "Créer la clé"}
          </Button>
        </div>
      </form>
    </div>
  )
}

export function ApiKeyActions({
  id,
  name,
  revoked,
}: {
  id: string
  name: string
  revoked: boolean
}) {
  const [busy, start] = useTransition()
  const [confirm, setConfirm] = useState<"revoke" | "delete" | null>(null)
  return (
    <div className="flex gap-1">
      {!revoked && (
        <Button
          size="xs"
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirm("revoke")}
        >
          Révoquer
        </Button>
      )}
      <Button
        size="xs"
        variant="ghost"
        className="text-destructive"
        onClick={() => setConfirm("delete")}
      >
        Supprimer
      </Button>
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "revoke"
            ? `Révoquer la clé « ${name} » ?`
            : `Supprimer la clé « ${name} » ?`
        }
        description={
          confirm === "revoke"
            ? "Les intégrations qui l'utilisent cesseront immédiatement de fonctionner. La clé reste listée pour l'historique."
            : "La clé est révoquée et retirée de la liste."
        }
        confirmLabel={confirm === "revoke" ? "Révoquer" : "Supprimer"}
        destructive
        pending={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            if (confirm === "revoke") await revokeApiKeyAction(id)
            else await deleteApiKeyAction(id)
            setConfirm(null)
          })
        }
      />
    </div>
  )
}
