import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { PageHeader, Section, StatusBadge } from "@/components/kit"
import {
  Enable2fa,
  Manage2fa,
  RevokeOthersButton,
  RevokeSessionButton,
} from "@/components/security-controls"
import { currentSessionId, requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import { describeAgent } from "@/lib/security/request"

export const metadata = { title: "Sécurité" }
export const dynamic = "force-dynamic"

const RESULT: Record<
  string,
  { label: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  success: { label: "Connexion", tone: "success" },
  success_recovery: { label: "Connexion (code de secours)", tone: "warning" },
  mfa_required: {
    label: "Mot de passe correct, 2FA demandée",
    tone: "neutral",
  },
  bad_password: { label: "Mot de passe incorrect", tone: "danger" },
  mfa_failed: { label: "Code 2FA incorrect", tone: "danger" },
}

const fmt = (d: Date | null) =>
  d
    ? d.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })
    : "—"

export default async function SecurityPage() {
  const user = await requireUser()
  const [[u], sessions, events, current] = await Promise.all([
    db
      .select({
        enabled: schema.users.totpEnabledAt,
        recovery: schema.users.recoveryCodes,
      })
      .from(schema.users)
      .where(eq(schema.users.id, user.id)),
    db
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, user.id))
      .orderBy(desc(schema.sessions.lastSeenAt)),
    db
      .select()
      .from(schema.loginEvents)
      .where(eq(schema.loginEvents.userId, user.id))
      .orderBy(desc(schema.loginEvents.createdAt))
      .limit(20),
    currentSessionId(),
  ])

  return (
    <>
      <PageHeader
        title="Sécurité"
        description={
          <>
            <Link className="underline" href="/account">
              Mon compte
            </Link>{" "}
            · double authentification, appareils connectés et historique.
          </>
        }
      />

      <Section
        title="Double authentification (2FA)"
        description="En plus du mot de passe, un code temporaire de ton téléphone est demandé à chaque connexion."
      >
        {u?.enabled ? (
          <div className="flex flex-col gap-4">
            <p className="flex flex-wrap items-center gap-2 text-sm">
              <StatusBadge tone="success">Active</StatusBadge>
              depuis le {u.enabled.toLocaleDateString("fr-FR")} ·{" "}
              {u.recovery?.length ?? 0} code(s) de secours restant(s)
            </p>
            <Manage2fa />
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {!env.APP_SECRET && (
              <p className="text-xs text-muted-foreground">
                Note : APP_SECRET n&apos;est pas défini, le secret 2FA sera
                stocké sans chiffrement.
              </p>
            )}
            <Enable2fa />
          </div>
        )}
      </Section>

      <Section
        title={`Sessions actives (${sessions.length})`}
        description="Adresse IP tronquée volontairement (réseau seulement)."
      >
        <ul className="divide-y text-sm">
          {sessions.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2 py-2">
              <span className="font-medium">{describeAgent(s.userAgent)}</span>
              {s.id === current && (
                <StatusBadge tone="info">Cette session</StatusBadge>
              )}
              <span className="text-xs text-muted-foreground">
                {s.ipHint ?? "IP inconnue"} · ouverte le {fmt(s.createdAt)} ·
                vue le {fmt(s.lastSeenAt)}
              </span>
              {s.id !== current && (
                <span className="ml-auto">
                  <RevokeSessionButton id={s.id} />
                </span>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <div className="mt-3">
            <RevokeOthersButton />
          </div>
        )}
      </Section>

      <Section title="Historique des connexions (90 jours)">
        {events.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun événement.</p>
        ) : (
          <ul className="divide-y text-sm">
            {events.map((e) => {
              const r = RESULT[e.result] ?? {
                label: e.result,
                tone: "neutral" as const,
              }
              return (
                <li
                  key={e.id}
                  className="flex flex-wrap items-center gap-2 py-1.5"
                >
                  <span className="w-32 text-xs text-muted-foreground">
                    {fmt(e.createdAt)}
                  </span>
                  <StatusBadge tone={r.tone}>{r.label}</StatusBadge>
                  <span className="text-xs text-muted-foreground">
                    {describeAgent(e.userAgent)} · {e.ipHint ?? "IP inconnue"}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Une connexion que tu ne reconnais pas ? Change ton mot de passe et
          ferme les autres sessions.
        </p>
      </Section>
    </>
  )
}
