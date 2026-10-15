import { desc } from "drizzle-orm"

import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { MailTools, TemplateEditor } from "@/components/mail-controls"
import { db, schema } from "@/lib/db"
import { env, mailConfigured } from "@/lib/env"
import { EMAIL_TEMPLATES } from "@/lib/mail/templates"

export const metadata = { title: "E-mails" }
export const dynamic = "force-dynamic"

const STATUS = {
  pending: { label: "En attente", tone: "info" },
  sent: { label: "Envoyé", tone: "success" },
  failed: { label: "Échec", tone: "danger" },
  skipped: { label: "Ignoré", tone: "neutral" },
} as const

export default async function AdminEmailsPage() {
  const [overrides, log] = await Promise.all([
    db.select().from(schema.emailTemplates),
    db
      .select({
        id: schema.emailQueue.id,
        to: schema.emailQueue.toAddress,
        template: schema.emailQueue.template,
        subject: schema.emailQueue.subject,
        status: schema.emailQueue.status,
        attempts: schema.emailQueue.attempts,
        lastError: schema.emailQueue.lastError,
        createdAt: schema.emailQueue.createdAt,
      })
      .from(schema.emailQueue)
      .orderBy(desc(schema.emailQueue.id))
      .limit(100),
  ])
  const byKey = new Map(overrides.map((o) => [o.key, o]))

  return (
    <>
      <PageHeader
        title="E-mails"
        description="Factures, rappels, suspensions, réponses aux tickets, bienvenue et mot de passe oublié."
      />
      <Section title="Envoi">
        <div className="flex flex-col gap-3 text-sm">
          <p>
            {mailConfigured ? (
              <StatusBadge tone="success">
                SMTP {env.SMTP_HOST}:{env.SMTP_PORT}
              </StatusBadge>
            ) : (
              <StatusBadge tone="warning">
                SMTP non configuré : les e-mails sont journalisés sans être
                envoyés
              </StatusBadge>
            )}
            {!env.PANEL_PUBLIC_URL && (
              <span className="ml-2 text-muted-foreground">
                PANEL_PUBLIC_URL absent : les e-mails ne contiendront pas de
                lien.
              </span>
            )}
          </p>
          <MailTools />
        </div>
      </Section>

      <Section title="Modèles">
        <div className="flex flex-col gap-3">
          {EMAIL_TEMPLATES.map((t) => {
            const o = byKey.get(t.key)
            return (
              <details key={t.key} className="rounded-lg border p-3">
                <summary className="flex cursor-pointer flex-wrap items-center gap-2 text-sm">
                  <span className="font-medium">{t.label}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {t.key}
                  </span>
                  {o && <StatusBadge tone="info">Personnalisé</StatusBadge>}
                  {o && !o.isEnabled && (
                    <StatusBadge tone="neutral">Désactivé</StatusBadge>
                  )}
                </summary>
                <div className="mt-3">
                  <TemplateEditor
                    tpl={{
                      key: t.key,
                      subject: o?.subject ?? t.subject,
                      body: o?.body ?? t.body,
                      isEnabled: o?.isEnabled ?? true,
                      customized: Boolean(o),
                      variables: t.variables,
                    }}
                  />
                </div>
              </details>
            )
          })}
        </div>
      </Section>

      <Section
        title="Journal (100 derniers, conservés 90 jours)"
        description="Le contenu des e-mails n'est pas conservé après l'envoi."
      >
        {log.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun e-mail.</p>
        ) : (
          <ul className="divide-y text-sm">
            {log.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-2 py-2">
                <StatusBadge tone={STATUS[m.status].tone}>
                  {STATUS[m.status].label}
                </StatusBadge>
                <span className="font-mono text-xs">{m.template}</span>
                <span>{m.subject}</span>
                <span className="text-muted-foreground">→ {m.to}</span>
                {m.lastError && (
                  <span className="text-xs text-destructive">
                    {m.lastError} {m.attempts > 0 && `(${m.attempts} essai(s))`}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {m.createdAt.toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
