"use client"

import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { createSite } from "@/lib/sites/actions"

export function CreateSiteForm({ disabled }: { disabled: boolean }) {
  const [state, action, pending] = useActionState(createSite, undefined)

  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <div className="flex flex-col gap-1.5">
        <label htmlFor="site-domain" className="text-sm font-medium">
          Nom de domaine
        </label>
        <Input
          id="site-domain"
          name="domain"
          placeholder="exemple.com"
          autoComplete="off"
          className="w-72"
          required
        />
      </div>
      <Button type="submit" disabled={pending || disabled}>
        {pending ? "Création…" : "Créer le site"}
      </Button>
      {state?.error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {state.error}
        </p>
      )}
    </form>
  )
}
