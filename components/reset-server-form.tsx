"use client"

import { useActionState, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { resetServer } from "@/lib/servers/actions"

export function ResetServerForm({
  serverId,
  templates,
  current,
  disabled,
}: {
  serverId: string
  templates: { value: string; label: string }[]
  current: string | null
  disabled: boolean
}) {
  const [open, setOpen] = useState(false)
  const [state, action, pending] = useActionState(resetServer, undefined)

  if (!open) {
    return (
      <Button
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => setOpen(true)}
      >
        Réinstaller le VPS
      </Button>
    )
  }

  return (
    <form
      action={action}
      className="flex max-w-xl flex-col gap-4 rounded-xl border border-destructive/40 p-4"
    >
      <div>
        <h2 className="font-medium">Réinstaller le VPS</h2>
        <p className="text-sm text-muted-foreground">
          Le VPS est recréé avec le système choisi.{" "}
          <strong>Toutes les données seront effacées</strong>
          {current ? ` (système actuel : ${current})` : ""}.
        </p>
      </div>

      <input type="hidden" name="serverId" value={serverId} />

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-template" className="text-sm font-medium">
          Système
        </label>
        <select
          id="reset-template"
          name="template"
          required
          defaultValue=""
          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <option value="" disabled>
            Choisir un système…
          </option>
          {templates.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>

      <div className="flex flex-col gap-1.5">
        <label htmlFor="reset-password" className="text-sm font-medium">
          Nouveau mot de passe root
        </label>
        <Input
          id="reset-password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </div>

      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="confirm" required className="mt-1" />
        <span>
          Je comprends que toutes les données du VPS seront supprimées.
        </span>
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Réinstallation…" : "Réinstaller"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          disabled={pending}
          onClick={() => setOpen(false)}
        >
          Annuler
        </Button>
        {pending && (
          <span className="text-xs text-muted-foreground">
            Cela peut prendre une à deux minutes.
          </span>
        )}
      </div>
    </form>
  )
}
