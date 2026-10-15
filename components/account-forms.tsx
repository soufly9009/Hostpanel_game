"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  changePassword,
  deleteAccount,
  logoutEverywhere,
} from "@/lib/account/actions"

export function PasswordForm() {
  const [state, action, pending] = useActionState(changePassword, undefined)
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        Mot de passe actuel
        <Input
          name="current"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        Nouveau mot de passe
        <Input
          name="next"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={128}
          required
        />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          Mot de passe modifié.
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Changer le mot de passe"}
        </Button>
      </div>
    </form>
  )
}

export function LogoutEverywhere() {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Se déconnecter partout
      </Button>
      <ConfirmDialog
        open={open}
        title="Fermer toutes les sessions ?"
        description="Tous tes appareils connectés seront déconnectés, y compris celui-ci."
        confirmLabel="Se déconnecter partout"
        destructive
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() => start(() => logoutEverywhere())}
      />
    </>
  )
}

export function DeleteAccountForm({ blocker }: { blocker: string | null }) {
  const [state, action, pending] = useActionState(deleteAccount, undefined)
  if (blocker) {
    return <p className="text-sm text-muted-foreground">{blocker}</p>
  }
  return (
    <form action={action} className="flex max-w-sm flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        Mot de passe
        <Input
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span>
          Tape <strong className="font-mono">SUPPRIMER</strong> pour confirmer
        </span>
        <Input name="confirm" autoComplete="off" required />
      </label>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" variant="destructive" disabled={pending}>
          {pending ? "Suppression…" : "Supprimer définitivement mon compte"}
        </Button>
      </div>
    </form>
  )
}
