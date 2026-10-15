"use client"

import { useActionState, useState, useTransition } from "react"
import { PlusIcon, Trash2Icon } from "lucide-react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  acceptQuoteAction,
  cancelQuoteAction,
  createQuoteAction,
  declineQuoteAction,
  type QuoteState,
} from "@/lib/quotes/actions"

function Feedback({ state }: { state: QuoteState }) {
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

export function QuoteForm({ userId }: { userId: string }) {
  const [state, action, pending] = useActionState(createQuoteAction, undefined)
  const [rows, setRows] = useState([0])
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="userId" value={userId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Objet du devis</span>
        <Input
          name="title"
          required
          minLength={3}
          maxLength={160}
          placeholder="Migration et infogérance"
        />
      </label>
      {rows.map((r, i) => (
        <div key={r} className="flex flex-wrap items-end gap-2">
          <label className="flex min-w-60 flex-1 flex-col gap-1.5 text-sm">
            {i === 0 && <span className="font-medium">Désignation</span>}
            <Input
              name="description"
              required={i === 0}
              maxLength={200}
              aria-label="Désignation"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            {i === 0 && <span className="font-medium">Qté</span>}
            <Input
              name="quantity"
              type="number"
              min={1}
              max={1000}
              defaultValue={1}
              className="w-20"
              aria-label="Quantité"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm">
            {i === 0 && <span className="font-medium">Prix unitaire</span>}
            <Input
              name="price"
              inputMode="decimal"
              placeholder="49,00"
              className="w-28"
              aria-label="Prix unitaire"
            />
          </label>
          {rows.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Retirer la ligne"
              onClick={() => setRows(rows.filter((x) => x !== r))}
            >
              <Trash2Icon />
            </Button>
          )}
        </div>
      ))}
      <div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setRows([...rows, Math.max(...rows) + 1])}
        >
          <PlusIcon /> Ligne
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Validité (jours)</span>
          <Input
            name="validDays"
            type="number"
            min={1}
            max={180}
            defaultValue={30}
            className="w-28"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">Conditions / notes</span>
          <Input name="notes" maxLength={1000} />
        </label>
      </div>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Envoyer le devis"}
        </Button>
      </div>
    </form>
  )
}

export function QuoteResponse({ id, total }: { id: string; total: string }) {
  const [pending, start] = useTransition()
  const [state, setState] = useState<QuoteState>(undefined)
  const [confirm, setConfirm] = useState<"accept" | "decline" | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setConfirm("accept")}>Accepter le devis</Button>
        <Button variant="outline" onClick={() => setConfirm("decline")}>
          Refuser
        </Button>
      </div>
      <Feedback state={state} />
      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm === "accept" ? "Accepter ce devis ?" : "Refuser ce devis ?"
        }
        description={
          confirm === "accept"
            ? `Une facture de ${total} sera émise (réglée par ton solde si possible). Ton acceptation est horodatée.`
            : "Le devis ne pourra plus être accepté."
        }
        confirmLabel={confirm === "accept" ? "Accepter" : "Refuser"}
        destructive={confirm === "decline"}
        pending={pending}
        onCancel={() => setConfirm(null)}
        onConfirm={() =>
          start(async () => {
            const r =
              confirm === "accept"
                ? await acceptQuoteAction(id)
                : await declineQuoteAction(id)
            setConfirm(null)
            setState(r)
          })
        }
      />
    </div>
  )
}

export function CancelQuoteButton({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive"
      disabled={pending}
      onClick={() => start(async () => void (await cancelQuoteAction(id)))}
    >
      Annuler
    </Button>
  )
}
