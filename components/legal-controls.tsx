"use client"

import { useActionState, useState, useTransition } from "react"
import { ArrowDownIcon, ArrowUpIcon } from "lucide-react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  acceptPendingAction,
  addSectionAction,
  createDocumentAction,
  deleteDocumentAction,
  deleteSectionAction,
  moveSectionAction,
  publishDocumentAction,
  updateDocumentAction,
  updateSectionAction,
  type LegalState,
} from "@/lib/legal/actions"

const textareaClass =
  "min-h-40 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Feedback({ state }: { state: LegalState }) {
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

/* ───────────── Utilisateur ───────────── */

export function AcceptTermsForm({
  docs,
}: {
  docs: { id: string; version: number }[]
}) {
  const [state, action, pending] = useActionState(
    acceptPendingAction,
    undefined
  )
  return (
    <form action={action} className="mt-6 flex flex-col gap-3">
      {docs.map((d) => (
        <input
          key={d.id}
          type="hidden"
          name="doc"
          value={`${d.id}:${d.version}`}
        />
      ))}
      <label className="flex items-start gap-2 text-sm">
        <input type="checkbox" name="accept" required className="mt-1" />
        <span>J&apos;ai lu et j&apos;accepte ces documents.</span>
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Accepter et continuer"}
        </Button>
      </div>
    </form>
  )
}

/* ───────────── Personnel : documents ───────────── */

type DocValues = {
  id?: string
  title: string
  slug: string
  summary: string | null
  position: number
  requiresAcceptance: boolean
  isPublished: boolean
}

function DocFields({ doc }: { doc?: DocValues }) {
  return (
    <>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Titre</span>
          <Input
            name="title"
            defaultValue={doc?.title}
            required
            maxLength={120}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Adresse (/legal/…)</span>
          <Input
            name="slug"
            defaultValue={doc?.slug}
            required
            maxLength={60}
            pattern="[a-z0-9]+(-[a-z0-9]+)*"
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Résumé</span>
          <Input
            name="summary"
            defaultValue={doc?.summary ?? ""}
            maxLength={300}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Ordre d&apos;affichage</span>
          <Input
            name="position"
            type="number"
            min={0}
            max={999}
            defaultValue={doc?.position ?? 0}
            className="w-28"
          />
        </label>
      </div>
      <div className="flex flex-col gap-2 text-sm">
        <label className="flex items-start gap-2">
          <input
            type="checkbox"
            name="requiresAcceptance"
            defaultChecked={doc?.requiresAcceptance}
            className="mt-1"
          />
          <span>
            Acceptation obligatoire (inscription et nouvelles versions majeures)
          </span>
        </label>
        {doc && (
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              name="isPublished"
              defaultChecked={doc.isPublished}
              className="mt-1"
            />
            <span>Visible publiquement</span>
          </label>
        )}
      </div>
    </>
  )
}

export function CreateDocumentForm() {
  const [state, action, pending] = useActionState(
    createDocumentAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      <DocFields />
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer le document"}
        </Button>
      </div>
    </form>
  )
}

export function EditDocumentForm({
  doc,
  canDelete,
}: {
  doc: DocValues & { id: string }
  canDelete: boolean
}) {
  const [state, action, pending] = useActionState(
    updateDocumentAction,
    undefined
  )
  const [confirm, setConfirm] = useState(false)
  const [deleting, start] = useTransition()
  const [err, setErr] = useState<string | null>(null)
  return (
    <form action={action} className="flex flex-col gap-4">
      <input type="hidden" name="id" value={doc.id} />
      <DocFields doc={doc} />
      <Feedback state={state} />
      {err && (
        <p role="alert" className="text-sm text-destructive">
          {err}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Enregistrer"}
        </Button>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            className="text-destructive"
            onClick={() => setConfirm(true)}
          >
            Supprimer le document
          </Button>
        )}
      </div>
      <ConfirmDialog
        open={confirm}
        title={`Supprimer « ${doc.title} » ?`}
        description="Le document, ses sections, toutes ses versions publiées et les preuves d'acceptation associées seront supprimés définitivement."
        confirmLabel="Supprimer"
        requireText={doc.slug}
        destructive
        pending={deleting}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            const r = await deleteDocumentAction(doc.id)
            setConfirm(false)
            if (r?.error) setErr(r.error)
          })
        }
      />
    </form>
  )
}

/* ───────────── Personnel : sections ───────────── */

export function SectionEditor({
  section,
  canEdit,
  canDelete,
  first,
  last,
}: {
  section: { id: string; heading: string; body: string }
  canEdit: boolean
  canDelete: boolean
  first: boolean
  last: boolean
}) {
  const [state, action, pending] = useActionState(
    updateSectionAction,
    undefined
  )
  const [busy, start] = useTransition()
  const [confirm, setConfirm] = useState(false)
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={section.id} />
      <div className="flex items-center gap-2">
        <Input
          name="heading"
          defaultValue={section.heading}
          disabled={!canEdit}
          required
          maxLength={200}
          aria-label="Titre de la section"
          className="font-medium"
        />
        {canEdit && (
          <>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Monter"
              disabled={first || busy}
              onClick={() =>
                start(() => moveSectionAction(section.id, "up").then(() => {}))
              }
            >
              <ArrowUpIcon />
            </Button>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              aria-label="Descendre"
              disabled={last || busy}
              onClick={() =>
                start(() =>
                  moveSectionAction(section.id, "down").then(() => {})
                )
              }
            >
              <ArrowDownIcon />
            </Button>
          </>
        )}
      </div>
      <textarea
        name="body"
        defaultValue={section.body}
        disabled={!canEdit}
        required
        maxLength={20000}
        aria-label="Contenu de la section"
        className={textareaClass}
      />
      <Feedback state={state} />
      {(canEdit || canDelete) && (
        <div className="flex flex-wrap gap-2">
          {canEdit && (
            <Button type="submit" size="sm" disabled={pending}>
              {pending ? "…" : "Enregistrer la section"}
            </Button>
          )}
          {canDelete && (
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="text-destructive"
              onClick={() => setConfirm(true)}
            >
              Supprimer
            </Button>
          )}
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        title={`Supprimer la section « ${section.heading} » ?`}
        description="Elle disparaît du brouillon ; les versions déjà publiées ne changent pas."
        confirmLabel="Supprimer"
        destructive
        pending={busy}
        onCancel={() => setConfirm(false)}
        onConfirm={() =>
          start(async () => {
            await deleteSectionAction(section.id)
            setConfirm(false)
          })
        }
      />
    </form>
  )
}

export function AddSectionForm({ documentId }: { documentId: string }) {
  const [state, action, pending] = useActionState(addSectionAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="documentId" value={documentId} />
      <Input
        name="heading"
        placeholder="Titre de la section"
        required
        maxLength={200}
        aria-label="Titre de la nouvelle section"
      />
      <textarea
        name="body"
        required
        maxLength={20000}
        placeholder={
          "Paragraphes séparés par une ligne vide.\n- Une ligne commençant par un tiret devient une puce."
        }
        aria-label="Contenu de la nouvelle section"
        className={textareaClass}
      />
      <Feedback state={state} />
      <div>
        <Button type="submit" size="sm" disabled={pending}>
          {pending ? "…" : "Ajouter la section"}
        </Button>
      </div>
    </form>
  )
}

export function PublishForm({
  documentId,
  nextVersion,
  requiresAcceptance,
}: {
  documentId: string
  nextVersion: number
  requiresAcceptance: boolean
}) {
  const [state, action, pending] = useActionState(
    publishDocumentAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <input type="hidden" name="id" value={documentId} />
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Note de version (publique)</span>
        <Input
          name="changeNote"
          maxLength={300}
          placeholder="Ex. : précision sur la durée de conservation"
        />
      </label>
      {nextVersion > 1 && (
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" name="minor" className="mt-1" />
          <span>
            Modification mineure (coquille, mise en forme) : pas de nouvelle
            acceptation
            {requiresAcceptance
              ? ". Sinon, tous les utilisateurs devront accepter la version " +
                nextVersion +
                "."
              : "."}
          </span>
        </label>
      )}
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Publication…" : `Publier la version ${nextVersion}`}
        </Button>
      </div>
    </form>
  )
}
