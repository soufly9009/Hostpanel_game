"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  deleteAnnouncementAction,
  deleteArticleAction,
  deleteCategoryAction,
  saveAnnouncementAction,
  saveArticleAction,
  saveCategoryAction,
  type ContentState,
} from "@/lib/content/actions"

const textareaClass =
  "min-h-48 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
const HELP =
  "Texte brut : paragraphes séparés par une ligne vide ; lignes commençant par « - » en liste."

function Feedback({ state }: { state: ContentState }) {
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

function DeleteButton({
  label,
  run,
}: {
  label: string
  run: () => Promise<ContentState>
}) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  return (
    <>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="text-destructive"
        onClick={() => setOpen(true)}
      >
        Supprimer
      </Button>
      <ConfirmDialog
        open={open}
        title={`Supprimer « ${label} » ?`}
        confirmLabel="Supprimer"
        destructive
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            await run()
            setOpen(false)
          })
        }
      />
    </>
  )
}

type Ann = {
  id: string
  title: string
  slug: string
  summary: string | null
  body: string
  isPublished: boolean
}

export function AnnouncementForm({ item }: { item?: Ann }) {
  const [state, action, pending] = useActionState(
    saveAnnouncementAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Titre</span>
          <Input
            name="title"
            defaultValue={item?.title}
            required
            maxLength={160}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">
            Adresse (/news/…, vide = depuis le titre)
          </span>
          <Input
            name="slug"
            defaultValue={item?.slug}
            maxLength={80}
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm sm:col-span-2">
          <span className="font-medium">Résumé</span>
          <Input
            name="summary"
            defaultValue={item?.summary ?? ""}
            maxLength={300}
          />
        </label>
      </div>
      <textarea
        name="body"
        defaultValue={item?.body}
        required
        aria-label="Contenu"
        placeholder={HELP}
        className={textareaClass}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPublished"
          defaultChecked={item?.isPublished}
        />
        Publiée
      </label>
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" size={item ? "sm" : "default"} disabled={pending}>
          {pending ? "…" : item ? "Enregistrer" : "Créer l'annonce"}
        </Button>
        {item && (
          <DeleteButton
            label={item.title}
            run={() => deleteAnnouncementAction(item.id)}
          />
        )}
      </div>
    </form>
  )
}

type Cat = {
  id: string
  name: string
  slug: string
  description: string | null
  position: number
}

export function CategoryForm({ item }: { item?: Cat }) {
  const [state, action, pending] = useActionState(saveCategoryAction, undefined)
  return (
    <form action={action} className="flex flex-wrap items-end gap-2">
      {item && <input type="hidden" name="id" value={item.id} />}
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Nom</span>
        <Input
          name="name"
          defaultValue={item?.name}
          required
          maxLength={80}
          className="w-48"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Description</span>
        <Input
          name="description"
          defaultValue={item?.description ?? ""}
          maxLength={200}
          className="w-64"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Ordre</span>
        <Input
          name="position"
          type="number"
          min={0}
          max={999}
          defaultValue={item?.position ?? 0}
          className="w-20"
        />
      </label>
      <Button type="submit" size="sm" disabled={pending}>
        {item ? "Enregistrer" : "Ajouter"}
      </Button>
      {item && (
        <DeleteButton
          label={item.name}
          run={() => deleteCategoryAction(item.id)}
        />
      )}
      <div className="basis-full">
        <Feedback state={state} />
      </div>
    </form>
  )
}

type Art = {
  id: string
  title: string
  slug: string
  categoryId: string | null
  body: string
  isPublished: boolean
}

export function ArticleForm({
  item,
  categories,
}: {
  item?: Art
  categories: { id: string; name: string }[]
}) {
  const [state, action, pending] = useActionState(saveArticleAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      {item && <input type="hidden" name="id" value={item.id} />}
      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Titre</span>
          <Input
            name="title"
            defaultValue={item?.title}
            required
            maxLength={160}
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Adresse (/help/…)</span>
          <Input
            name="slug"
            defaultValue={item?.slug}
            maxLength={80}
            className="font-mono"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Catégorie</span>
          <select
            name="categoryId"
            defaultValue={item?.categoryId ?? ""}
            className={selectClass}
          >
            <option value="">Sans catégorie</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <textarea
        name="body"
        defaultValue={item?.body}
        required
        aria-label="Contenu"
        placeholder={HELP}
        className={textareaClass}
      />
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isPublished"
          defaultChecked={item?.isPublished}
        />
        Publié
      </label>
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" size={item ? "sm" : "default"} disabled={pending}>
          {pending ? "…" : item ? "Enregistrer" : "Créer l'article"}
        </Button>
        {item && (
          <DeleteButton
            label={item.title}
            run={() => deleteArticleAction(item.id)}
          />
        )}
      </div>
    </form>
  )
}

/** Ligne repliable : titre + formulaire d'édition. */
export function Editable({
  summary,
  children,
}: {
  summary: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details className="group rounded-lg border p-3">
      <summary className="flex cursor-pointer list-none flex-wrap items-center gap-2 text-sm [&::-webkit-details-marker]:hidden">
        {summary}
        <span className="ml-auto text-xs text-muted-foreground group-open:hidden">
          Modifier
        </span>
      </summary>
      <div className="mt-3">{children}</div>
    </details>
  )
}
