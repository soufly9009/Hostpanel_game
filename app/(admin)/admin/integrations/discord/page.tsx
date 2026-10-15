import { desc, eq } from "drizzle-orm"

import {
  DiscordSettingsForm,
  DiscordTestButton,
  FlushQueueButton,
} from "@/components/discord-controls"
import { PageHeader, Section, StatCard, StatusBadge } from "@/components/kit"
import { db, schema } from "@/lib/db"
import { CATEGORY_LABEL } from "@/lib/discord/embed"
import { deliveryStats } from "@/lib/discord/logging"
import { getDiscordSettings } from "@/lib/discord/settings"
import { webhookConfigured } from "@/lib/discord/webhook"
import { env } from "@/lib/env"

export const metadata = { title: "Discord" }
export const dynamic = "force-dynamic"

export default async function DiscordPage() {
  const configured = webhookConfigured()
  const [settings, stats, failures] = await Promise.all([
    getDiscordSettings(),
    deliveryStats().catch(() => null),
    db
      .select({
        id: schema.systemEvents.id,
        createdAt: schema.systemEvents.createdAt,
        title: schema.systemEvents.title,
        error: schema.systemEvents.discordLastError,
        attempts: schema.systemEvents.discordAttempts,
      })
      .from(schema.systemEvents)
      .where(eq(schema.systemEvents.discordState, "failed"))
      .orderBy(desc(schema.systemEvents.id))
      .limit(10)
      .catch(() => []),
  ])

  const rawConfigured = Boolean(env.DISCORD_LOG_WEBHOOK_URL)

  return (
    <>
      <PageHeader
        title="Discord"
        description="Notifications de supervision envoyées par webhook. L'URL du webhook reste dans l'environnement du serveur."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Webhook"
          value={
            configured ? "Configuré" : rawConfigured ? "Invalide" : "Absent"
          }
          tone={configured ? "default" : "warning"}
          hint="DISCORD_LOG_WEBHOOK_URL"
        />
        <StatCard
          label="Notifications"
          value={settings.enabled && configured ? "Actives" : "Inactives"}
        />
        <StatCard
          label="En attente"
          value={stats?.pending ?? "—"}
          tone={(stats?.pending ?? 0) > 0 ? "warning" : "default"}
        />
        <StatCard
          label="Échecs de livraison"
          value={stats?.failed ?? "—"}
          tone={(stats?.failed ?? 0) > 0 ? "danger" : "default"}
        />
      </div>

      <Section title="État" description="Dernières informations de livraison.">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Dernier événement</dt>
            <dd>
              {stats?.lastEventAt
                ? stats.lastEventAt.toLocaleString("fr-FR")
                : "aucun"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Dernier envoi accepté</dt>
            <dd>
              {stats?.lastSentAt
                ? stats.lastSentAt.toLocaleString("fr-FR")
                : "aucun"}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Liens vers le panel</dt>
            <dd>
              {env.PANEL_PUBLIC_URL ? (
                <StatusBadge tone="success">
                  PANEL_PUBLIC_URL définie
                </StatusBadge>
              ) : (
                <span className="text-muted-foreground">
                  désactivés (PANEL_PUBLIC_URL absente)
                </span>
              )}
            </dd>
          </div>
        </dl>
        <div className="mt-4 flex flex-col gap-3">
          <DiscordTestButton disabled={!configured} />
          <FlushQueueButton pendingCount={stats?.pending ?? 0} />
        </div>
        {!configured && (
          <p className="mt-3 text-xs text-muted-foreground">
            Pour activer : crée un webhook dans Discord (Paramètres du salon →
            Intégrations → Webhooks), puis renseigne{" "}
            <span className="font-mono">DISCORD_LOG_WEBHOOK_URL</span> dans
            l&apos;environnement du serveur et redémarre. L&apos;URL n&apos;est
            jamais stockée en base ni affichée ici.
          </p>
        )}
      </Section>

      <Section
        title="Préférences"
        description="Seules ces préférences non secrètes sont enregistrées en base."
      >
        <DiscordSettingsForm
          initial={settings}
          categories={[...schema.EVENT_CATEGORIES]}
          labels={CATEGORY_LABEL}
        />
      </Section>

      <Section title="Dernières livraisons échouées">
        {failures.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun échec.</p>
        ) : (
          <ul className="divide-y text-sm">
            {failures.map((f) => (
              <li key={f.id} className="flex flex-wrap gap-x-3 py-2">
                <span>{f.title}</span>
                <span className="text-xs text-destructive">
                  {f.error ?? "erreur"} ({f.attempts} tentative(s))
                </span>
                <span className="ml-auto text-xs text-muted-foreground">
                  {f.createdAt.toLocaleString("fr-FR")}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
    </>
  )
}
