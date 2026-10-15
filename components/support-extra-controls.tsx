"use client"

import { useActionState, useState, useTransition } from "react"
import { StarIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  deleteCannedAction,
  rateTicketAction,
  saveCannedAction,
  type ExtraState,
} from "@/lib/tickets/extra-actions"

function Feedback({ state }: { state: ExtraState }) {
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

export function CannedForm({
  item,
}: {
  item?: { id: string; title: string; body: string }
}) {
  const [state, action, pending] = useActionState(saveCannedAction, undefined)
  const [deleting, start] = useTransition()
  return (
    <form action={action} className="flex flex-col gap-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <Input
        name="title"
        defaultValue={item?.title}
        required
        maxLength={100}
        placeholder="Titre (ex. Réinitialiser un mot de passe root)"
        aria-label="Titre"
      />
      <textarea
        name="body"
        defaultValue={item?.body}
        required
        maxLength={4000}
        aria-label="Contenu"
        placeholder="Texte inséré dans la réponse. {{name}} est remplacé par le nom du client."
        className="min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          {item ? "Enregistrer" : "Ajouter"}
        </Button>
        {item && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="text-destructive"
            disabled={deleting}
            onClick={() =>
              start(async () => void (await deleteCannedAction(item.id)))
            }
          >
            Supprimer
          </Button>
        )}
      </div>
    </form>
  )
}

/** Note 1-5 + commentaire, après résolution. */
export function RatingForm({ ticketId }: { ticketId: string }) {
  const [state, action, pending] = useActionState(rateTicketAction, undefined)
  const [rating, setRating] = useState(0)
  if (state?.ok) return <Feedback state={state} />
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="ticketId" value={ticketId} />
      <input type="hidden" name="rating" value={rating || ""} />
      <div className="flex gap-1" role="radiogroup" aria-label="Note de 1 à 5">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            role="radio"
            aria-checked={rating === n}
            aria-label={`${n} sur 5`}
            onClick={() => setRating(n)}
            className="rounded p-1 outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            <StarIcon
              className={`size-6 ${n <= rating ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
            />
          </button>
        ))}
      </div>
      <Input
        name="comment"
        maxLength={1000}
        placeholder="Un commentaire ? (facultatif)"
        aria-label="Commentaire"
      />
      <Feedback state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending || rating === 0}>
          Envoyer mon avis
        </Button>
      </div>
    </form>
  )
}

export function Stars({ value }: { value: number }) {
  return (
    <span className="inline-flex" aria-label={`${value} sur 5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <StarIcon
          key={n}
          className={`size-4 ${n <= value ? "fill-amber-400 text-amber-400" : "text-muted-foreground"}`}
        />
      ))}
    </span>
  )
}
