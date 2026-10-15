"use client"

import { useActionState, useState, useTransition } from "react"

import { ConfirmDialog, CopyButton } from "@/components/kit-client"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { verifyMfaAction } from "@/lib/auth/actions"
import {
  adminDisable2faAction,
  confirm2faAction,
  disable2faAction,
  regenerateRecoveryAction,
  revokeOtherSessionsAction,
  revokeSessionAction,
  start2faAction,
  type SecurityState,
} from "@/lib/security/actions"

function Feedback({ state }: { state: SecurityState | { error?: string } }) {
  if (state?.error) {
    return (
      <p role="alert" className="text-sm text-destructive">
        {state.error}
      </p>
    )
  }
  if (state && "notice" in state && state.notice) {
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

function CodeInput({ label = "Code à 6 chiffres" }: { label?: string }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <Input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        required
        maxLength={12}
        className="w-40 font-mono tracking-widest"
      />
    </label>
  )
}

function RecoveryCodes({ codes }: { codes: string[] }) {
  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        Codes de secours (usage unique)
        <CopyButton value={codes.join("\n")} label="Copier les codes" />
      </div>
      <ul className="grid grid-cols-2 gap-1 font-mono text-sm sm:grid-cols-5">
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
    </div>
  )
}

/** Activation : QR code puis confirmation par un premier code. */
export function Enable2fa() {
  const [setup, setSetup] = useState<SecurityState>(undefined)
  const [pending, start] = useTransition()
  const [state, action, confirming] = useActionState(
    confirm2faAction,
    undefined
  )

  if (state?.codes) {
    return (
      <div className="flex flex-col gap-3">
        <Feedback state={state} />
        <RecoveryCodes codes={state.codes} />
      </div>
    )
  }
  if (!setup?.qr) {
    return (
      <div className="flex flex-col gap-2">
        <div>
          <Button
            disabled={pending}
            onClick={() => start(async () => setSetup(await start2faAction()))}
          >
            Activer la double authentification
          </Button>
        </div>
        <Feedback state={setup} />
      </div>
    )
  }
  return (
    <form action={action} className="flex flex-col gap-4">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>
          Ouvre une application d&apos;authentification (Google Authenticator,
          Aegis, Bitwarden…).
        </li>
        <li>Scanne le QR code, ou saisis la clé manuellement.</li>
        <li>Entre le code à 6 chiffres affiché.</li>
      </ol>
      <div className="flex flex-wrap items-center gap-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={setup.qr}
          alt="QR code de configuration"
          width={180}
          height={180}
          className="rounded-lg bg-white p-2"
        />
        <div className="text-sm">
          <p className="text-muted-foreground">Clé manuelle</p>
          <p className="flex items-center gap-1 font-mono break-all">
            {setup.secret}
            <CopyButton value={setup.secret ?? ""} label="Copier la clé" />
          </p>
        </div>
      </div>
      <CodeInput />
      <Feedback state={state} />
      <div>
        <Button type="submit" disabled={confirming}>
          {confirming ? "…" : "Confirmer et activer"}
        </Button>
      </div>
    </form>
  )
}

export function Manage2fa() {
  const [regen, regenAction, regenPending] = useActionState(
    regenerateRecoveryAction,
    undefined
  )
  const [dis, disAction, disPending] = useActionState(
    disable2faAction,
    undefined
  )
  return (
    <div className="flex flex-col gap-6">
      <form action={regenAction} className="flex flex-col gap-3">
        <p className="text-sm font-medium">Nouveaux codes de secours</p>
        <div className="flex flex-wrap items-end gap-3">
          <CodeInput label="Code de l'application" />
          <Button type="submit" variant="outline" disabled={regenPending}>
            Régénérer
          </Button>
        </div>
        <Feedback state={regen} />
        {regen?.codes && <RecoveryCodes codes={regen.codes} />}
      </form>
      <form action={disAction} className="flex flex-col gap-3 border-t pt-4">
        <p className="text-sm font-medium">
          Désactiver la double authentification
        </p>
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-medium">Mot de passe</span>
            <Input
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className="w-56"
            />
          </label>
          <CodeInput label="Code ou code de secours" />
          <Button type="submit" variant="destructive" disabled={disPending}>
            Désactiver
          </Button>
        </div>
        <Feedback state={dis} />
      </form>
    </div>
  )
}

export function RevokeSessionButton({ id }: { id: string }) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="xs"
      variant="ghost"
      className="text-destructive"
      disabled={pending}
      onClick={() => start(() => revokeSessionAction(id))}
    >
      Révoquer
    </Button>
  )
}

export function RevokeOthersButton() {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="outline"
      disabled={pending}
      onClick={() => start(() => revokeOtherSessionsAction())}
    >
      Fermer toutes les autres sessions
    </Button>
  )
}

/** Second facteur à la connexion. */
export function MfaLoginForm() {
  const [state, action, pending] = useActionState(verifyMfaAction, undefined)
  return (
    <form action={action} className="flex flex-col gap-3">
      <label className="flex flex-col gap-1.5 text-sm">
        Code de l&apos;application (ou code de secours)
        <Input
          name="code"
          autoFocus
          inputMode="numeric"
          autoComplete="one-time-code"
          required
          maxLength={12}
          className="font-mono tracking-widest"
        />
      </label>
      <Feedback state={state} />
      <Button type="submit" disabled={pending}>
        {pending ? "…" : "Valider"}
      </Button>
    </form>
  )
}

export function AdminDisable2faButton({ userId }: { userId: string }) {
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [state, setState] = useState<SecurityState>(undefined)
  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        Désactiver la 2FA
      </Button>
      <Feedback state={state} />
      <ConfirmDialog
        open={open}
        title="Désactiver la double authentification du client ?"
        description="À faire seulement après avoir vérifié l'identité du client (téléphone et codes perdus). Ses sessions seront fermées."
        confirmLabel="Désactiver"
        destructive
        pending={pending}
        onCancel={() => setOpen(false)}
        onConfirm={() =>
          start(async () => {
            setState(await adminDisable2faAction(userId))
            setOpen(false)
          })
        }
      />
    </>
  )
}
