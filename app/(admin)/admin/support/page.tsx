import { count, eq } from "drizzle-orm"

import {
  AiTestButton,
  TicketSettingsForm,
} from "@/components/support-admin-controls"
import { PageHeader, Section, StatCard } from "@/components/kit"
import { aiConfigured, listFreeModels } from "@/lib/ai/openrouter"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import { getTicketSettings } from "@/lib/tickets/settings"

export const metadata = { title: "Support" }
export const dynamic = "force-dynamic"

export default async function AdminSupportPage() {
  const [settings, [open], [pending], [aiMessages], models] = await Promise.all(
    [
      getTicketSettings(),
      db
        .select({ n: count() })
        .from(schema.tickets)
        .where(eq(schema.tickets.status, "open")),
      db
        .select({ n: count() })
        .from(schema.tickets)
        .where(eq(schema.tickets.status, "pending")),
      db
        .select({ n: count() })
        .from(schema.ticketMessages)
        .where(eq(schema.ticketMessages.authorKind, "ai")),
      aiConfigured() ? listFreeModels() : Promise.resolve([] as string[]),
    ]
  )

  return (
    <>
      <PageHeader title="Support" description="Tickets et assistant IA." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Tickets ouverts" value={open.n} />
        <StatCard label="En attente du client" value={pending.n} />
        <StatCard label="Réponses IA envoyées" value={aiMessages.n} />
        <StatCard
          label="OpenRouter"
          value={aiConfigured() ? "Configuré" : "Absent"}
          tone={aiConfigured() ? "default" : "warning"}
          hint="OPENROUTER_API_KEY"
        />
      </div>

      <Section
        title="Assistant IA"
        description="Fournisseur : OpenRouter, modèles gratuits uniquement (identifiants en « :free »). Les messages sont expurgés (secrets, e-mails, IP) avant envoi."
      >
        <div className="flex flex-col gap-5">
          <TicketSettingsForm aiAutoReply={settings.aiAutoReply} />
          <AiTestButton disabled={!aiConfigured()} />
          <dl className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-muted-foreground">Modèle préféré</dt>
              <dd className="font-mono text-xs">
                {env.OPENROUTER_MODEL ??
                  "automatique (premier modèle gratuit disponible)"}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">
                Modèles gratuits détectés
              </dt>
              <dd className="text-xs">
                {aiConfigured()
                  ? `${models.length} (les 4 premiers sont essayés dans l'ordre)`
                  : "—"}
              </dd>
            </div>
          </dl>
          {!aiConfigured() && (
            <p className="text-xs text-muted-foreground">
              Crée une clé sur openrouter.ai puis renseigne{" "}
              <span className="font-mono">OPENROUTER_API_KEY</span> (et
              éventuellement <span className="font-mono">OPENROUTER_MODEL</span>
              ) dans l&apos;environnement, puis redémarre.
            </p>
          )}
        </div>
      </Section>
    </>
  )
}
