"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { clearProxmoxLogs, type LogClearScope } from "@/lib/admin/actions"

const OPTIONS: { value: LogClearScope; label: string }[] = [
  { value: "all", label: "Tout vider" },
  { value: "older7d", label: "Plus de 7 jours" },
  { value: "older1d", label: "Plus de 24 heures" },
  { value: "errors", label: "Erreurs seulement" },
]

export function ClearLogs({
  total,
  errors,
}: {
  total: number
  errors: number
}) {
  const [scope, setScope] = useState<LogClearScope>("all")
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="flex flex-wrap items-center gap-2">
      <select
        aria-label="Quoi effacer"
        value={scope}
        disabled={pending}
        onChange={(e) => setScope(e.target.value as LogClearScope)}
        className="h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        {OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <Button
        size="sm"
        variant="destructive"
        disabled={pending || total === 0}
        onClick={() => {
          const what = OPTIONS.find(
            (o) => o.value === scope
          )?.label.toLowerCase()
          const n = scope === "errors" ? errors : total
          if (
            !confirm(
              `Effacer définitivement les journaux (${what}) ? Jusqu'à ${n} entrée(s) seront supprimées.`
            )
          ) {
            return
          }
          setMsg(null)
          start(async () => {
            const res = await clearProxmoxLogs(scope)
            setMsg(res?.error ?? res?.notice ?? null)
          })
        }}
      >
        {pending ? "Suppression…" : "Effacer"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}
