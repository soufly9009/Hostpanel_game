"use client"

import { useActionState, useState, useTransition } from "react"
import { PinIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import {
  addClientNoteAction,
  adminDeleteAccountAction,
  adminResetPasswordAction,
  deleteClientNoteAction,
  impersonateAction,
  stopImpersonationAction,
  togglePinNoteAction,
  type ClientState,
} from "@/lib/admin/client-actions"

export function ClientActions({
  userId,
  email,
  canImpersonate,
}: {
  userId: string
  email: string
  canImpersonate: boolean
}) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<ClientState>(undefined)
  const [confirm, setConfirm] = useState<"impersonate" | "delete" | null>(null)
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {canImpersonate && (
          <Button variant="outline" onClick={() => setConfirm("impersonate")}>
            Se connecter en tant que client
          </Button>
        )}
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            start(async () => setState(await adminResetPasswordAction(userId)))
          }
        >
          Envoyer un lien de réinitialisation
        </Button>
        <Button
          variant="ghost"
          className="text-destructive"
          onClick={() => setConfirm("delete")}
        >
          Supprimer le compte
        </Button>
      </div>
      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.link && (
        <div className="rounded-lg border bg-muted/30 p-3 text-sm">
          <p>
            {state.notice} À transmettre au client si l&apos;e-mail
            n&apos;arrive pas :
          </p>
          <p className="mt-1 flex items-center gap-1 font-mono text-xs break-all">
            {state.link}
            <CopyButton value={state.link} label="Copier le lien" />
          </p>
        </div>
      )}
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "impersonate"
            ? `Se connecter en tant que ${email} ?`
            : `Supprimer le compte ${email} ?`
        }
        description={
          confirm === "impersonate"
            ? "Session de 2 h au nom du client, tracée dans le journal. Un bandeau permet de revenir à l'administration."
            : "Refusé s'il reste des services. Les factures sont conservées (obligation légale), le reste est effacé."
        }
        confirmLabel={confirm === "impersonate" ? "Se connecter" : "Supprimer"}
        requireText={confirm === "delete" ? email : undefined}
        destructive={confirm === "delete"}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r =
              confirm === "impersonate"
                ? await impersonateAction(userId)
                : await adminDeleteAccountAction(userId)
            setConfirm(null)
            setState(r)
          })
        }
      />
    </div>
  )
}

export function NoteForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(
    addClientNoteAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="userId" value={userId} />
      <textarea
        name="body"
        required
        maxLength={2000}
        placeholder="Note interne (jamais visible du client)"
        aria-label="Nouvelle note"
        className="min-h-20 rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={pending}>
          Ajouter
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" name="isPinned" /> Épingler
        </label>
        {state?.error && (
          <span role="alert" className="text-sm text-destructive">
            {state.error}
          </span>
        )}
      </div>
    </form>
  )
}

export function NoteActions({ id, pinned }: { id: string; pinned: boolean }) {
  const [pending, start] = useTransition()
  return (
    <span className="flex gap-1">
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label={pinned ? "Désépingler" : "Épingler"}
        disabled={pending}
        onClick={() => start(() => togglePinNoteAction(id, !pinned))}
      >
        <PinIcon className={pinned ? "fill-current" : ""} />
      </Button>
      <Button
        size="icon-xs"
        variant="ghost"
        aria-label="Supprimer la note"
        disabled={pending}
        onClick={() =>
          start(async () => void (await deleteClientNoteAction(id)))
        }
      >
        <Trash2Icon />
      </Button>
    </span>
  )
}

/** Bandeau affiché pendant une connexion « en tant que ». */
export function ImpersonationBanner({ email }: { email: string }) {
  return (
    <form
      action={stopImpersonationAction}
      className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-2 text-sm"
    >
      <span>
        Tu es connecté en tant que <strong>{email}</strong> (administration).
      </span>
      <Button type="submit" size="sm" variant="outline" className="ml-auto">
        Revenir à l&apos;administration
      </Button>
    </form>
  )
}
