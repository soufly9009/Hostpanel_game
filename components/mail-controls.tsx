"use client"

import { useActionState, useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  resetTemplateAction,
  retryFailedAction,
  saveTemplateAction,
  testEmailAction,
  type MailState,
} from "@/lib/mail/actions"

function Feedback({ state }: { state: MailState }) {
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

export function MailTools() {
  const [pending, start] = useTransition()
  const [state, setState] = useState<MailState>(undefined)
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={pending}
          onClick={() => start(async () => setState(await testEmailAction()))}
        >
          M&apos;envoyer un e-mail de test
        </Button>
        <Button
          variant="ghost"
          disabled={pending}
          onClick={() => start(async () => setState(await retryFailedAction()))}
        >
          Traiter la file maintenant
        </Button>
      </div>
      <Feedback state={state} />
    </div>
  )
}

export function TemplateEditor({
  tpl,
}: {
  tpl: {
    key: string
    subject: string
    body: string
    isEnabled: boolean
    customized: boolean
    variables: string[]
  }
}) {
  const [state, action, pending] = useActionState(saveTemplateAction, undefined)
  const [resetting, start] = useTransition()
  return (
    <form action={action} className="flex flex-col gap-2">
      <input type="hidden" name="key" value={tpl.key} />
      <Input
        name="subject"
        defaultValue={tpl.subject}
        required
        maxLength={200}
        aria-label="Sujet"
      />
      <textarea
        name="body"
        defaultValue={tpl.body}
        required
        maxLength={10000}
        aria-label="Contenu"
        className="min-h-40 w-full rounded-lg border border-input bg-transparent px-2.5 py-2 font-mono text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
      />
      <p className="text-xs text-muted-foreground">
        Variables : {tpl.variables.map((v) => `{{${v}}}`).join(" ")}
      </p>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          name="isEnabled"
          defaultChecked={tpl.isEnabled}
        />
        Envoi activé
      </label>
      <Feedback state={state} />
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={pending}>
          Enregistrer
        </Button>
        {tpl.customized && (
          <Button
            type="button"
            size="sm"
            variant="ghost"
            disabled={resetting}
            onClick={() =>
              start(async () => void (await resetTemplateAction(tpl.key)))
            }
          >
            Texte par défaut
          </Button>
        )}
      </div>
    </form>
  )
}
