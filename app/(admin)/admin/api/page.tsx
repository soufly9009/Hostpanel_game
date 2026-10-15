import { desc } from "drizzle-orm"

import { ApiKeyActions, CreateApiKeyForm } from "@/components/api-key-controls"
import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"
import { isPast } from "@/lib/expiry"

export const metadata = { title: "API" }
export const dynamic = "force-dynamic"

const EXAMPLES = `# Vérifier la clé
curl "$URL/api/v1" -H "Authorization: Bearer sou_…"

# Trouver un compte par e-mail
curl "$URL/api/v1/users?email=client@exemple.com" -H "Authorization: Bearer sou_…"

# Créditer 10 crédits (montants en centimes ; négatif = débit)
curl -X POST "$URL/api/v1/users/<id>/wallet" \\
  -H "Authorization: Bearer sou_…" -H "Content-Type: application/json" \\
  -H "Idempotency-Key: commande-42" \\
  -d '{"amountCents": 1000, "description": "Gain concours"}'

# Créer un coupon de 5 crédits, 100 utilisations
curl -X POST "$URL/api/v1/coupons" \\
  -H "Authorization: Bearer sou_…" -H "Content-Type: application/json" \\
  -d '{"code": "BIENVENUE", "amountCents": 500, "maxRedemptions": 100}'

# Générer 10 cartes cadeaux de 20 crédits
curl -X POST "$URL/api/v1/gift-cards" \\
  -H "Authorization: Bearer sou_…" -H "Content-Type: application/json" \\
  -d '{"amountCents": 2000, "quantity": 10}'`

const ENDPOINTS = [
  ["GET", "/api/v1/users?q=&email=&limit=&offset=", "users:read"],
  ["GET", "/api/v1/users/{id}", "users:read"],
  ["PATCH", "/api/v1/users/{id}  {name, serverLimit}", "users:write"],
  ["GET", "/api/v1/users/{id}/wallet?limit=&offset=", "wallet:read"],
  [
    "POST",
    "/api/v1/users/{id}/wallet  {amountCents, description}",
    "wallet:write",
  ],
  ["GET / POST", "/api/v1/coupons", "coupons:read / write"],
  ["GET / PATCH / DELETE", "/api/v1/coupons/{id}", "coupons:read / write"],
  ["GET / POST", "/api/v1/gift-cards?status=", "coupons:read / write"],
  ["GET / PATCH / DELETE", "/api/v1/gift-cards/{id}", "coupons:read / write"],
]

export default async function ApiKeysPage() {
  const keys = await db
    .select()
    .from(schema.apiKeys)
    .orderBy(desc(schema.apiKeys.createdAt))

  return (
    <>
      <PageHeader
        title="API REST"
        description="Gère les comptes, soldes, coupons et cartes cadeaux depuis un autre service. Authentification : Authorization: Bearer sou_…"
      />

      <Section
        title="Clé maîtresse (environnement)"
        description="SOU_API_KEY dans .env : toutes les portées, non révocable depuis le panel. Préfère des clés dédiées à portées limitées."
      >
        {env.SOU_API_KEY ? (
          <p className="flex items-center gap-2 text-sm">
            <StatusBadge tone="warning">Active</StatusBadge>
            <span className="font-mono text-xs">
              {env.SOU_API_KEY.slice(0, 8)}…
            </span>
          </p>
        ) : (
          <StatusBadge tone="neutral">Non configurée</StatusBadge>
        )}
      </Section>

      <Section title={`Clés (${keys.length})`}>
        {keys.length === 0 ? (
          <p className="text-sm text-muted-foreground">Aucune clé.</p>
        ) : (
          <ul className="divide-y text-sm">
            {keys.map((k) => {
              const expired = k.expiresAt && isPast(k.expiresAt)
              return (
                <li
                  key={k.id}
                  className="flex flex-wrap items-center gap-2 py-3"
                >
                  <span className="font-medium">{k.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">
                    {k.prefix}…
                  </span>
                  {k.revokedAt ? (
                    <StatusBadge tone="danger">Révoquée</StatusBadge>
                  ) : expired ? (
                    <StatusBadge tone="warning">Expirée</StatusBadge>
                  ) : (
                    <StatusBadge tone="success">Active</StatusBadge>
                  )}
                  {k.scopes.map((s) => (
                    <StatusBadge key={s} tone="neutral">
                      <span className="font-mono">{s}</span>
                    </StatusBadge>
                  ))}
                  <span className="text-xs text-muted-foreground">
                    {k.lastUsedAt
                      ? `utilisée le ${k.lastUsedAt.toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" })}`
                      : "jamais utilisée"}
                    {k.expiresAt &&
                      ` · expire le ${k.expiresAt.toLocaleDateString("fr-FR")}`}
                    {k.createdBy && ` · par ${k.createdBy}`}
                  </span>
                  <span className="ml-auto">
                    <ApiKeyActions
                      id={k.id}
                      name={k.name}
                      revoked={!!k.revokedAt}
                    />
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Section>

      <Section title="Nouvelle clé">
        <CreateApiKeyForm />
      </Section>

      <Section
        title="Référence"
        description="Réponses JSON { ok, … } ; erreurs { ok: false, error } avec 400, 401, 403, 404, 409 ou 429 (120 requêtes/min par clé). Montants en centimes de crédit."
      >
        <ul className="mb-4 divide-y text-sm">
          {ENDPOINTS.map(([m, path, scope]) => (
            <li key={m + path} className="flex flex-wrap gap-3 py-1.5">
              <span className="w-40 font-mono text-xs font-medium">{m}</span>
              <span className="flex-1 font-mono text-xs">{path}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {scope}
              </span>
            </li>
          ))}
        </ul>
        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs">
          {EXAMPLES}
        </pre>
      </Section>
    </>
  )
}
