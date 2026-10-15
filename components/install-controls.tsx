"use client"

import { useActionState, useRef, useTransition, useState } from "react"
import { WandSparklesIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  createAdminAction,
  migrateAction,
  saveEnvAction,
  testDatabaseAction,
  unlockAction,
  type InstallState,
} from "@/lib/install/actions"
import type { EnvField } from "@/lib/install/fields"

const selectClass =
  "h-9 rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:ring-3 focus-visible:ring-ring/50"

function Feedback({ state }: { state: InstallState }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state?.ok && state.notice) {
    return (
      <p
        role="status"
        className="text-sm text-emerald-700 dark:text-emerald-400"
      >
        {state.notice}
      </p>
    )
  }
  return null
}

export function UnlockForm() {
  const [state, action, pending] = useActionState(unlockAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Code d&apos;installation</span>
        <Input
          name="code"
          type="password"
          required
          autoComplete="off"
          className="max-w-sm font-mono"
        />
      </label>
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "…" : "Déverrouiller"}
        </Button>
      </div>
    </form>
  )
}

export function DatabaseTestForm({ defaultUrl }: { defaultUrl: string }) {
  const [state, action, pending] = useActionState(testDatabaseAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-1 flex-col gap-1.5 text-sm">
          <span className="font-medium">URL à tester</span>
          <Input
            name="url"
            defaultValue={defaultUrl}
            className="font-mono"
            placeholder="file:./data/app.db"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-medium">Jeton (libsql distant)</span>
          <Input
            name="token"
            type="password"
            autoComplete="off"
            className="w-56"
          />
        </label>
        <Button type="submit" variant="outline" disabled={pending}>
          {pending ? "Test…" : "Tester la connexion"}
        </Button>
      </div>
      <Feedback state={state} />
    </form>
  )
}

export function MigrateButton({ pending: count }: { pending: number }) {
  const [busy, start] = useTransition()
  const [state, setState] = useState<InstallState>(undefined)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <Button
          disabled={busy || count === 0}
          onClick={() => start(async () => setState(await migrateAction()))}
        >
          {busy
            ? "Application…"
            : count === 0
              ? "Base à jour"
              : `Appliquer ${count} migration(s)`}
        </Button>
      </div>
      <Feedback state={state} />
    </div>
  )
}

type FieldView = EnvField & { value: string; configured: boolean }

function randomValue(length: number) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789"
  const bytes = new Uint8Array(length)
  crypto.getRandomValues(bytes)
  // 252 = plus grand multiple de 36 sous 256 : pas de biais.
  let out = ""
  for (const b of bytes) {
    if (b < 252) out += alphabet[b % 36]
  }
  while (out.length < length) out += randomValue(length - out.length)
  return out.slice(0, length)
}

export function EnvForm({ fields }: { fields: FieldView[] }) {
  const [state, action, pending] = useActionState(saveEnvAction, undefined)
  const refs = useRef<Record<string, HTMLInputElement | null>>({})
  const groups = [...new Set(fields.map((f) => f.group))]

  return (
    <form action={action} className="flex flex-col gap-6">
      {groups.map((g) => (
        <fieldset key={g} className="flex flex-col gap-3">
          <legend className="mb-1 text-sm font-semibold">{g}</legend>
          <div className="grid gap-4 sm:grid-cols-2">
            {fields
              .filter((f) => f.group === g)
              .map((f) => (
                <div key={f.key} className="flex flex-col gap-1.5 text-sm">
                  <label
                    htmlFor={`env-${f.key}`}
                    className="flex flex-wrap items-center gap-2"
                  >
                    <span className="font-medium">{f.label}</span>
                    <span className="font-mono text-xs text-muted-foreground">
                      {f.key}
                    </span>
                    {f.secret && (
                      <span
                        className={`text-xs ${f.configured ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}
                      >
                        {f.configured ? "● configuré" : "○ vide"}
                      </span>
                    )}
                  </label>
                  {f.kind === "bool" ? (
                    <select
                      id={`env-${f.key}`}
                      name={f.key}
                      defaultValue={f.value}
                      className={selectClass}
                    >
                      <option value="">Par défaut (false)</option>
                      <option value="true">true</option>
                      <option value="false">false</option>
                    </select>
                  ) : (
                    <div className="flex gap-2">
                      <Input
                        id={`env-${f.key}`}
                        ref={(el) => {
                          refs.current[f.key] = el
                        }}
                        name={f.key}
                        type={
                          f.secret
                            ? "password"
                            : f.kind === "number"
                              ? "number"
                              : "text"
                        }
                        defaultValue={f.secret ? "" : f.value}
                        placeholder={
                          f.secret
                            ? f.configured
                              ? "•••••• (laisser vide = inchangé)"
                              : (f.placeholder ?? "")
                            : f.placeholder
                        }
                        autoComplete="off"
                        spellCheck={false}
                        className="font-mono"
                      />
                      {f.generate && (
                        <Button
                          type="button"
                          variant="outline"
                          size="icon"
                          aria-label={`Générer ${f.key}`}
                          title="Générer une valeur aléatoire"
                          onClick={() => {
                            const el = refs.current[f.key]
                            if (!el) return
                            el.value =
                              (f.generate!.prefix ?? "") +
                              randomValue(f.generate!.length)
                            el.type = "text"
                          }}
                        >
                          <WandSparklesIcon />
                        </Button>
                      )}
                    </div>
                  )}
                  {f.secret && f.configured && (
                    <label className="flex items-center gap-2 text-xs text-muted-foreground">
                      <input type="checkbox" name={`clear:${f.key}`} />
                      Effacer cette valeur
                    </label>
                  )}
                  {f.help && (
                    <p className="text-xs text-muted-foreground">{f.help}</p>
                  )}
                </div>
              ))}
          </div>
        </fieldset>
      ))}
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={pending}>
          {pending ? "Enregistrement…" : "Enregistrer dans .env.local"}
        </Button>
      </div>
    </form>
  )
}

export function CreateAdminForm() {
  const [state, action, pending] = useActionState(createAdminAction, undefined)
  return (
    <form action={action} className="grid max-w-xl gap-3 sm:grid-cols-2">
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Nom</span>
        <Input name="name" required autoComplete="name" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">E-mail</span>
        <Input name="email" type="email" required autoComplete="email" />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Mot de passe (10+ caractères)</span>
        <Input
          name="password"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-medium">Confirmation</span>
        <Input
          name="confirm"
          type="password"
          required
          minLength={10}
          autoComplete="new-password"
        />
      </label>
      <div className="sm:col-span-2">
        <Feedback state={state} />
      </div>
      <div className="sm:col-span-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Création…" : "Créer l'administrateur et terminer"}
        </Button>
      </div>
    </form>
  )
}
