"use client"

import { useActionState, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import {
  saveTicketSettingsAction,
  testAiAction,
} from "@/lib/tickets/admin-actions"

export function TicketSettingsForm({ aiAutoReply }: { aiAutoReply: boolean }) {
  const [state, action, pending] = useActionState(
    saveTicketSettingsAction,
    undefined
  )
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          name="aiAutoReply"
          defaultChecked={aiAutoReply}
          className="mt-1"
        />
        <span>
          Répondre automatiquement au premier message d&apos;un ticket avec
          l&apos;assistant IA (modèles gratuits OpenRouter). Les tickets urgents
          sont toujours laissés à un humain, et la réponse est clairement
          signalée comme générée automatiquement.
        </span>
      </label>
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

export function AiTestButton({ disabled }: { disabled: boolean }) {
  const [pending, start] = useTransition()
  const [res, setRes] = useState<{ ok: boolean; text: string } | null>(null)
  return (
    <div className="flex flex-wrap items-center gap-3">
      <Button
        variant="outline"
        disabled={pending || disabled}
        onClick={() =>
          start(async () => {
            setRes(null)
            const r = await testAiAction()
            setRes(
              r?.error
                ? { ok: false, text: r.error }
                : { ok: true, text: r?.notice ?? "OK" }
            )
          })
        }
      >
        {pending ? "Test en cours…" : "Tester l'assistant IA"}
      </Button>
      {res && (
        <span
          role={res.ok ? "status" : "alert"}
          className={`text-sm ${res.ok ? "text-muted-foreground" : "text-destructive"}`}
        >
          {res.text}
        </span>
      )}
    </div>
  )
}
