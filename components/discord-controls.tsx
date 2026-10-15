"use client"

import { useActionState, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  flushDiscordQueueAction,
  saveDiscordSettingsAction,
} from "@/lib/discord/actions"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

export function DiscordSettingsForm({
  initial,
  categories,
  labels,
}: {
  initial: {
    enabled: boolean
    minLevel: "info" | "warning" | "error" | "critical"
    categories: string[]
  }
  categories: string[]
  labels: Record<string, string>
}) {
  const [state, action, pending] = useActionState(
    saveDiscordSettingsAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-4">
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="enabled"
          defaultChecked={initial.enabled}
        />
        Envoyer les notifications vers Discord
      </label>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Gravité minimale transmise</span>
        <select
          name="minLevel"
          defaultValue={initial.minLevel}
          className={`${selectClass} w-60`}
        >
          <option value="info">Tout (info et au-dessus)</option>
          <option value="warning">Attention et au-dessus</option>
          <option value="error">Erreurs et critiques</option>
          <option value="critical">Critiques uniquement</option>
        </select>
      </label>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 font-medium">Catégories transmises</legend>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {categories.map((c) => (
            <label key={c} className="flex items-center gap-2">
              <input
                type="checkbox"
                name="categories"
                value={c}
                defaultChecked={initial.categories.includes(c)}
              />
              {labels[c] ?? c}
            </label>
          ))}
        </div>
      </fieldset>

      {state?.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="text-sm text-muted-foreground">
          {state.notice}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>
    </form>
  )
}

const RESULT_TEXT: Record<string, { text: string; ok: boolean }> = {
  accepted: { text: "Test accepté par Discord.", ok: true },
  rejected: { text: "Test refusé par Discord.", ok: false },
  timeout: { text: "Délai dépassé : Discord n'a pas répondu.", ok: false },
  not_configured: { text: "Webhook non configuré.", ok: false },
  rate_limited: {
    text: "Limite de débit : réessaie dans un instant.",
    ok: false,
  },
  network_error: { text: "Erreur réseau.", ok: false },
}

export function DiscordTestButton({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false)
  const [result, setResult] = useState<{ text: string; ok: boolean } | null>(
    null
  )

  async function run() {
    setPending(true)
    setResult(null)
    try {
      const res = await fetch("/api/admin/discord/test", { method: "POST" })
      const json = (await res.json().catch(() => null)) as {
        result?: string
        message?: string
      } | null
      const known = json?.result ? RESULT_TEXT[json.result] : undefined
      setResult(
        known
          ? { ...known, text: json?.message ?? known.text }
          : { text: `Erreur ${res.status}`, ok: false }
      )
    } catch {
      setResult({ text: "Erreur réseau.", ok: false })
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button variant="outline" disabled={pending || disabled} onClick={run}>
        {pending ? "Envoi…" : "Envoyer une notification de test"}
      </Button>
      {result && (
        <span
          role={result.ok ? "status" : "alert"}
          className={`text-sm ${result.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {result.text}
        </span>
      )}
    </div>
  )
}

export function FlushQueueButton({ pendingCount }: { pendingCount: number }) {
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        size="sm"
        disabled={pending || pendingCount === 0}
        onClick={() =>
          start(async () => {
            const r = await flushDiscordQueueAction()
            setMsg(r?.notice ?? null)
          })
        }
      >
        {pending ? "Traitement…" : "Traiter la file maintenant"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}
