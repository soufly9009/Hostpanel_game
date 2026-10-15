"use client"

import { useActionState, useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import { SparklesIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  aiDraftAction,
  createTicketAction,
  customerCloseAction,
  customerReplyAction,
  staffAssignAction,
  staffReplyAction,
  staffStatusAction,
} from "@/lib/tickets/actions"

const selectClass =
  "h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const textareaClass =
  "min-h-28 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function NewTicketForm({
  servers,
  sites,
  defaultServerId,
}: {
  servers: { id: string; name: string }[]
  sites: { id: string; domain: string }[]
  defaultServerId?: string
}) {
  const [state, action, pending] = useActionState(createTicketAction, undefined)
  return (
    <form action={action} className="flex max-w-2xl flex-col gap-4">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Sujet</span>
        <Input name="subject" required minLength={3} maxLength={120} />
      </label>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Catégorie</span>
          <select name="category" defaultValue="vps" className={selectClass}>
            <option value="vps">VPS</option>
            <option value="site">Site web</option>
            <option value="network">Réseau</option>
            <option value="billing">Facturation</option>
            <option value="account">Compte</option>
            <option value="other">Autre</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Priorité</span>
          <select name="priority" defaultValue="normal" className={selectClass}>
            <option value="low">Basse</option>
            <option value="normal">Normale</option>
            <option value="high">Haute</option>
          </select>
        </label>
        {servers.length > 0 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">VPS concerné (facultatif)</span>
            <select
              name="serverId"
              defaultValue={defaultServerId ?? ""}
              className={selectClass}
            >
              <option value="">Aucun</option>
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        )}
        {sites.length > 0 && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Site concerné (facultatif)</span>
            <select name="siteId" defaultValue="" className={selectClass}>
              <option value="">Aucun</option>
              {sites.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.domain}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Décris ton problème</span>
        <textarea
          name="body"
          required
          minLength={2}
          maxLength={4000}
          className={textareaClass}
        />
        <span className="text-xs text-muted-foreground">
          N&apos;écris jamais de mot de passe ni de clé dans un ticket.
        </span>
      </label>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Envoi…" : "Créer le ticket"}
        </Button>
      </div>
    </form>
  )
}

export function CustomerReplyForm({
  ticketId,
  closed,
}: {
  ticketId: string
  closed: boolean
}) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [confirmClose, setConfirmClose] = useState(false)

  if (closed) {
    return (
      <p className="rounded-xl border border-dashed p-4 text-sm text-muted-foreground">
        Ce ticket est fermé. Ouvre un nouveau ticket si besoin.
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          setError(null)
          start(async () => {
            const res = await customerReplyAction(ticketId, text)
            if (res?.error) setError(res.error)
            else {
              setText("")
              router.refresh()
            }
          })
        }}
      >
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Ta réponse</span>
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={4000}
            required
            className={textareaClass}
          />
        </label>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" disabled={pending || text.trim().length < 2}>
            {pending ? "Envoi…" : "Envoyer"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => setConfirmClose(true)}
          >
            Fermer le ticket
          </Button>
        </div>
      </form>
      <ConfirmDialog
        open={confirmClose}
        title="Fermer ce ticket ?"
        description="Tu ne pourras plus y répondre ; ouvre un nouveau ticket si le problème revient."
        confirmLabel="Fermer le ticket"
        pending={pending}
        onCancel={() => setConfirmClose(false)}
        onConfirm={() =>
          start(async () => {
            await customerCloseAction(ticketId)
            setConfirmClose(false)
            router.refresh()
          })
        }
      />
    </div>
  )
}

export function StaffReplyForm({
  ticketId,
  canReply,
  canInternal,
  canAi,
  canned = [],
  customerName = "",
}: {
  ticketId: string
  canReply: boolean
  canInternal: boolean
  canAi: boolean
  /** Réponses prédéfinies insérables. */
  canned?: { id: string; title: string; body: string }[]
  customerName?: string
}) {
  const router = useRouter()
  const [text, setText] = useState("")
  const [internal, setInternal] = useState(!canReply)
  const [error, setError] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [pending, start] = useTransition()
  const [drafting, startDraft] = useTransition()

  if (!canReply && !canInternal) {
    return (
      <p className="text-sm text-muted-foreground">
        Ton rôle ne permet pas de répondre à ce ticket.
      </p>
    )
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        setError(null)
        start(async () => {
          const res = await staffReplyAction(ticketId, text, internal)
          if (res?.error) setError(res.error)
          else {
            setText("")
            setNote(null)
            router.refresh()
          }
        })
      }}
    >
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">
          {internal
            ? "Note interne (invisible du client)"
            : "Réponse au client"}
        </span>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={4000}
          required
          className={textareaClass}
        />
      </label>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        {canned.length > 0 && (
          <select
            aria-label="Insérer une réponse prédéfinie"
            value=""
            onChange={(e) => {
              const c = canned.find((x) => x.id === e.target.value)
              if (!c) return
              const body = c.body.replace(/\{\{\s*name\s*\}\}/g, customerName)
              setText((t) => (t.trim() ? `${t.trimEnd()}\n\n${body}` : body))
            }}
            className="h-8 rounded-lg border border-input bg-transparent px-2 text-sm"
          >
            <option value="">Réponse prédéfinie…</option>
            {canned.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        )}
        {canReply && canInternal && (
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={internal}
              onChange={(e) => setInternal(e.target.checked)}
            />
            Note interne
          </label>
        )}
        {canAi && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={drafting || pending}
            onClick={() =>
              startDraft(async () => {
                setError(null)
                const res = await aiDraftAction(ticketId)
                if (res?.error) setError(res.error)
                else if (res?.draft) {
                  setInternal(false)
                  setText(res.draft)
                  setNote(
                    `Brouillon IA${res.notice ? ` (${res.notice})` : ""} : relis-le et corrige-le avant d'envoyer.`
                  )
                }
              })
            }
          >
            <SparklesIcon aria-hidden />
            {drafting ? "Génération…" : "Brouillon IA"}
          </Button>
        )}
      </div>

      {note && (
        <p role="status" className="text-xs text-muted-foreground">
          {note}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending || text.trim().length < 2}>
          {pending ? "Envoi…" : internal ? "Ajouter la note" : "Envoyer"}
        </Button>
      </div>
    </form>
  )
}

export function StaffControls({
  ticketId,
  status,
  assignedTo,
  staff,
  canClose,
  canAssign,
}: {
  ticketId: string
  status: "open" | "pending" | "resolved" | "closed"
  assignedTo: string | null
  staff: { id: string; label: string }[]
  canClose: boolean
  canAssign: boolean
}) {
  const router = useRouter()
  const [pending, start] = useTransition()
  const [error, setError] = useState<string | null>(null)

  return (
    <div className="flex flex-wrap items-end gap-4">
      <label className="flex flex-col gap-1.5 text-xs">
        Statut
        <select
          defaultValue={status}
          disabled={pending || !canClose}
          className={`${selectClass} w-48`}
          onChange={(e) =>
            start(async () => {
              setError(null)
              const r = await staffStatusAction(
                ticketId,
                e.target.value as typeof status
              )
              if (r?.error) setError(r.error)
              router.refresh()
            })
          }
        >
          <option value="open">Ouvert</option>
          <option value="pending">En attente du client</option>
          <option value="resolved">Résolu</option>
          <option value="closed">Fermé</option>
        </select>
      </label>
      <label className="flex flex-col gap-1.5 text-xs">
        Assigné à
        <select
          defaultValue={assignedTo ?? ""}
          disabled={pending || !canAssign}
          className={`${selectClass} w-56`}
          onChange={(e) =>
            start(async () => {
              setError(null)
              const r = await staffAssignAction(
                ticketId,
                e.target.value || null
              )
              if (r?.error) setError(r.error)
              router.refresh()
            })
          }
        >
          <option value="">Non assigné</option>
          {staff.map((s) => (
            <option key={s.id} value={s.id}>
              {s.label}
            </option>
          ))}
        </select>
      </label>
      {error && (
        <p role="alert" className="basis-full text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}
