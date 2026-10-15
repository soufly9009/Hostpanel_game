"use client"

import Link from "next/link"
import { useActionState } from "react"

import { Button } from "@/components/ui/button"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import {
  requestResetAction,
  resetPasswordAction,
} from "@/lib/auth/reset-actions"

export function ForgotPasswordForm() {
  const [state, action, pending] = useActionState(requestResetAction, undefined)
  return (
    <Card>
      <CardHeader>
        <CardTitle>Mot de passe oublié</CardTitle>
        <CardDescription>
          Indique ton e-mail : tu recevras un lien valable 30 minutes.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state?.ok ? (
          <p role="status" className="text-sm">
            {state.notice}
          </p>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <label className="flex flex-col gap-1.5 text-sm">
              E-mail
              <Input name="email" type="email" required autoComplete="email" />
            </label>
            {state?.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "…" : "Envoyer le lien"}
            </Button>
          </form>
        )}
        <p className="mt-4 text-center text-sm text-muted-foreground">
          <Link href="/login" className="underline">
            Retour à la connexion
          </Link>
        </p>
      </CardContent>
    </Card>
  )
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, action, pending] = useActionState(
    resetPasswordAction,
    undefined
  )
  return (
    <Card>
      <CardHeader>
        <CardTitle>Nouveau mot de passe</CardTitle>
        <CardDescription>
          Toutes tes sessions ouvertes seront fermées.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {state?.ok ? (
          <div className="flex flex-col gap-3 text-sm">
            <p role="status">{state.notice}</p>
            <Button nativeButton={false} render={<Link href="/login" />}>
              Se connecter
            </Button>
          </div>
        ) : (
          <form action={action} className="flex flex-col gap-3">
            <input type="hidden" name="token" value={token} />
            <label className="flex flex-col gap-1.5 text-sm">
              Nouveau mot de passe
              <Input
                name="password"
                type="password"
                required
                minLength={8}
                maxLength={200}
                autoComplete="new-password"
              />
            </label>
            <label className="flex flex-col gap-1.5 text-sm">
              Confirmation
              <Input
                name="confirm"
                type="password"
                required
                minLength={8}
                autoComplete="new-password"
              />
            </label>
            {state?.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "…" : "Changer le mot de passe"}
            </Button>
          </form>
        )}
      </CardContent>
    </Card>
  )
}
