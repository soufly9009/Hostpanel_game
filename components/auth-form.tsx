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
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field"
import { Input } from "@/components/ui/input"
import type { AuthState } from "@/lib/auth/actions"

type DocLink = { slug: string; title: string }

type Props = {
  mode: "login" | "register"
  /** Inscription : documents à accepter et politique de confidentialité. */
  legal?: { required: DocLink[]; privacy: DocLink | null }
  action: (prev: AuthState, formData: FormData) => Promise<AuthState>
}

const copy = {
  login: {
    title: "Connexion",
    description: "Entre ton email et ton mot de passe.",
    submit: "Se connecter",
    alt: "Pas encore de compte ?",
    altLink: "/register",
    altLabel: "Créer un compte",
  },
  register: {
    title: "Créer un compte",
    description: "Quelques infos pour commencer.",
    submit: "Créer mon compte",
    alt: "Déjà un compte ?",
    altLink: "/login",
    altLabel: "Se connecter",
  },
} as const

export function AuthForm({ mode, action, legal }: Props) {
  const [state, formAction, pending] = useActionState(action, undefined)
  const c = copy[mode]

  return (
    <Card>
      <CardHeader>
        <CardTitle>{c.title}</CardTitle>
        <CardDescription>{c.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <form action={formAction}>
          <FieldGroup>
            {mode === "register" && (
              <Field>
                <FieldLabel htmlFor="name">Nom</FieldLabel>
                <Input id="name" name="name" autoComplete="name" required />
              </Field>
            )}
            <Field>
              <FieldLabel htmlFor="email">Email</FieldLabel>
              <Input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                defaultValue={state?.email}
                required
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="password">Mot de passe</FieldLabel>
              <Input
                id="password"
                name="password"
                type="password"
                autoComplete={
                  mode === "login" ? "current-password" : "new-password"
                }
                minLength={mode === "register" ? 8 : undefined}
                required
              />
            </Field>
            {mode === "register" && (
              <Field>
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="terms"
                    required
                    className="mt-1"
                  />
                  <span className="text-muted-foreground">
                    J&apos;accepte{" "}
                    {legal?.required.map((d, i) => (
                      <span key={d.slug}>
                        {i > 0 &&
                          (i === legal.required.length - 1 ? " et " : ", ")}
                        <Link
                          className="underline"
                          href={`/legal/${d.slug}`}
                          target="_blank"
                        >
                          {d.title}
                        </Link>
                      </span>
                    ))}
                    {!legal?.required.length && "les conditions d'utilisation"}
                    {legal?.privacy && (
                      <>
                        , et j&apos;ai lu la{" "}
                        <Link
                          className="underline"
                          href={`/legal/${legal.privacy.slug}`}
                          target="_blank"
                        >
                          {legal.privacy.title.toLowerCase()}
                        </Link>
                      </>
                    )}
                    .
                  </span>
                </label>
              </Field>
            )}
            {state?.error && (
              <p role="alert" className="text-sm text-destructive">
                {state.error}
              </p>
            )}
            <Field>
              <Button type="submit" disabled={pending}>
                {pending ? "…" : c.submit}
              </Button>
              <FieldDescription className="text-center">
                {c.alt} <Link href={c.altLink}>{c.altLabel}</Link>
              </FieldDescription>
            </Field>
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  )
}
