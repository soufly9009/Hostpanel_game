"use client"

import { useEffect, useRef, useState } from "react"
import { usePathname, useRouter, useSearchParams } from "next/navigation"
import { CheckIcon, CopyIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** Copie une valeur dans le presse-papiers. */
export function CopyButton({
  value,
  label = "Copier",
}: {
  value: string
  label?: string
}) {
  const [done, setDone] = useState(false)
  return (
    <Button
      type="button"
      size="icon-xs"
      variant="ghost"
      aria-label={label}
      title={label}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value)
          setDone(true)
          setTimeout(() => setDone(false), 1500)
        } catch {
          // presse-papiers indisponible
        }
      }}
    >
      {done ? <CheckIcon /> : <CopyIcon />}
    </Button>
  )
}

/**
 * Confirmation explicite via <dialog> natif (focus piégé, Échap, accessible).
 * `requireText` : l'utilisateur doit recopier ce texte pour valider.
 */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = "Confirmer",
  requireText,
  destructive = false,
  pending = false,
  onConfirm,
  onCancel,
}: {
  open: boolean
  title: string
  description?: React.ReactNode
  confirmLabel?: string
  requireText?: string
  destructive?: boolean
  pending?: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const [typed, setTyped] = useState("")

  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  const blocked = pending || (requireText ? typed !== requireText : false)

  return (
    <dialog
      ref={ref}
      onClose={() => {
        setTyped("")
        if (open) onCancel()
      }}
      className="m-auto w-[min(28rem,calc(100vw-2rem))] rounded-xl border bg-popover p-5 text-popover-foreground backdrop:bg-black/50"
    >
      <h2 className="font-medium">{title}</h2>
      {description && (
        <div className="mt-2 text-sm text-muted-foreground">{description}</div>
      )}
      {requireText && (
        <label className="mt-3 flex flex-col gap-1.5 text-sm">
          <span>
            Tape <strong className="font-mono">{requireText}</strong> pour
            confirmer
          </span>
          <Input
            value={typed}
            onChange={(e) => setTyped(e.target.value)}
            autoComplete="off"
          />
        </label>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <Button variant="ghost" size="sm" disabled={pending} onClick={onCancel}>
          Annuler
        </Button>
        <Button
          size="sm"
          variant={destructive ? "destructive" : "default"}
          disabled={blocked}
          onClick={onConfirm}
        >
          {pending ? "…" : confirmLabel}
        </Button>
      </div>
    </dialog>
  )
}

/** Champ de recherche synchronisé avec le paramètre d'URL `q`. */
export function SearchInput({
  placeholder = "Rechercher…",
}: {
  placeholder?: string
}) {
  const router = useRouter()
  const pathname = usePathname()
  const params = useSearchParams()
  const [value, setValue] = useState(params.get("q") ?? "")

  useEffect(() => {
    const t = setTimeout(() => {
      const next = new URLSearchParams(params.toString())
      if (value) next.set("q", value)
      else next.delete("q")
      next.delete("page")
      const qs = next.toString()
      if (qs !== params.toString()) {
        router.replace(qs ? `${pathname}?${qs}` : pathname)
      }
    }, 300)
    return () => clearTimeout(t)
  }, [value, params, pathname, router])

  return (
    <div className="relative w-full max-w-xs">
      <SearchIcon className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
      <Input
        type="search"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="pl-8"
      />
    </div>
  )
}
