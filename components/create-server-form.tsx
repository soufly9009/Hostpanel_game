"use client"

import { useActionState, useState } from "react"

import { NetworkPicker } from "@/components/network-picker"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createServer } from "@/lib/servers/actions"
import { cn } from "@/lib/utils"

export type PlanOption = {
  id: string
  name: string
  description: string | null
  price: string
  specs: string[]
}

export function CreateServerForm({ plans }: { plans: PlanOption[] }) {
  const [state, action, pending] = useActionState(createServer, undefined)
  const [planId, setPlanId] = useState(plans[0]?.id ?? "")

  return (
    <form action={action} className="flex max-w-3xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <label htmlFor="name" className="text-sm font-medium">
          Nom du VPS
        </label>
        <Input
          id="name"
          name="name"
          placeholder="Mon serveur web"
          minLength={2}
          maxLength={60}
          required
        />
      </div>

      <fieldset className="flex flex-col gap-3">
        <legend className="mb-1 text-sm font-medium">Offre</legend>
        <input type="hidden" name="planId" value={planId} />
        <div className="grid gap-3 sm:grid-cols-2">
          {plans.map((p) => (
            <button
              key={p.id}
              type="button"
              onClick={() => setPlanId(p.id)}
              aria-pressed={planId === p.id}
              className={cn(
                "rounded-xl border p-4 text-left transition-colors hover:bg-muted/50",
                planId === p.id && "border-primary ring-2 ring-primary/20"
              )}
            >
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{p.name}</span>
                <span className="text-sm text-muted-foreground">{p.price}</span>
              </div>
              {p.description && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {p.description}
                </p>
              )}
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {p.specs.map((s) => (
                  <li
                    key={s}
                    className="rounded-md bg-muted px-2 py-0.5 text-xs"
                  >
                    {s}
                  </li>
                ))}
              </ul>
            </button>
          ))}
        </div>
      </fieldset>

      <NetworkPicker
        key={planId}
        endpoint={planId ? `/api/plans/${planId}/network` : null}
      />

      <div className="flex flex-col gap-2">
        <label htmlFor="password" className="text-sm font-medium">
          Mot de passe root
        </label>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
        <p className="text-xs text-muted-foreground">
          8 caractères minimum. Il n&apos;est pas conservé par le site :
          garde-le précieusement.
        </p>
      </div>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div>
        <Button type="submit" disabled={pending || !planId}>
          {pending ? "Création en cours…" : "Créer le VPS"}
        </Button>
        {pending && (
          <span className="ml-3 text-xs text-muted-foreground">
            Le déploiement peut prendre une minute.
          </span>
        )}
      </div>
    </form>
  )
}
