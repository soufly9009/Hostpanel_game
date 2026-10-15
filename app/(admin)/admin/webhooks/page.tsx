import { desc, eq } from "drizzle-orm"

import { PageHeader, Section, StatusBadge } from "@/components/kit"
import {
  CreateWebhookForm,
  WebhookActions,
} from "@/components/webhook-controls"
import { db, schema } from "@/lib/db"

export const metadata = { title: "Webhooks" }
export const dynamic = "force-dynamic"

const VERIFY = `// Node.js : vérifier une livraison
import { createHmac, timingSafeEqual } from "node:crypto"
const ts = req.headers["x-webhook-timestamp"]
const sig = req.headers["x-webhook-signature"]          // "sha256=…"
const expected = "sha256=" + createHmac("sha256", SECRET).update(\`\${ts}.\${rawBody}\`).digest("hex")
const ok = Math.abs(Date.now() / 1000 - Number(ts)) < 300 &&
  sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected))`

export default async function WebhooksPage() {
  const D = schema.webhookDeliveries
  const [hooks, deliveries] = await Promise.all([
    db.select().from(schema.webhooks).orderBy(desc(schema.webhooks.createdAt)),
    db
      .select({ d: D, name: schema.webhooks.name })
      .from(D)
      .innerJoin(schema.webhooks, eq(schema.webhooks.id, D.webhookId))
      .orderBy(desc(D.id))
      .limit(50),
  ])
  return (
    <>
      <PageHeader
        title="Webhooks sortants"
        description="Notifie un autre service (comptabilité, CRM, Discord, Zapier…) à chaque événement. Corps JSON signé HMAC-SHA256, 6 tentatives avec délai croissant."
      />
      <Section title={`Webhooks (${hooks.length})`}>
        {hooks.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucun webhook.</p>
        ) : (
          <ul className="divide-y">
            {hooks.map((h) => (
              <li key={h.id} className="flex flex-col gap-2 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{h.name}</span>
                  <StatusBadge tone={h.isActive ? "success" : "neutral"}>
                    {h.isActive ? "Actif" : "Inactif"}
                  </StatusBadge>
                  <span className="font-mono text-xs break-all text-muted-foreground">
                    {h.url}
                  </span>
                </div>
                <div className="flex flex-wrap gap-1">
                  {h.events.map((e) => (
                    <StatusBadge key={e} tone="neutral">
                      <span className="font-mono">{e}</span>
                    </StatusBadge>
                  ))}
                </div>
                <WebhookActions id={h.id} active={h.isActive} />
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Nouveau webhook">
        <CreateWebhookForm />
      </Section>
      <Section title="Journal des livraisons (50 dernières, 30 jours)">
        {deliveries.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune livraison.</p>
        ) : (
          <ul className="divide-y text-sm">
            {deliveries.map(({ d, name }) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center gap-2 py-1.5"
              >
                <StatusBadge
                  tone={
                    d.status === "sent"
                      ? "success"
                      : d.status === "failed"
                        ? "danger"
                        : "info"
                  }
                >
                  {d.status === "sent"
                    ? "Livré"
                    : d.status === "failed"
                      ? "Abandonné"
                      : "En attente"}
                </StatusBadge>
                <span className="font-mono text-xs">{d.event}</span>
                <span>{name}</span>
                {d.responseCode && (
                  <span className="text-xs text-muted-foreground">
                    HTTP {d.responseCode}
                  </span>
                )}
                {d.lastError && (
                  <span className="text-xs text-destructive">
                    {d.lastError}
                  </span>
                )}
                <span className="ml-auto text-xs text-muted-foreground">
                  {d.attempts} essai(s) ·{" "}
                  {d.createdAt.toLocaleString("fr-FR", {
                    dateStyle: "short",
                    timeStyle: "short",
                  })}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>
      <Section title="Vérifier la signature">
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          {VERIFY}
        </pre>
      </Section>
    </>
  )
}
