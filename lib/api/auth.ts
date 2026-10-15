import "server-only"

import { createHash, randomInt, timingSafeEqual } from "node:crypto"
import { and, eq, isNull } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"

import { API_KEY_PREFIX, API_SCOPE_KEYS, type ApiScope } from "./scopes"

/**
 * Clés d'API « sou_… » : seule l'empreinte SHA-256 est stockée. La clé
 * maîtresse SOU_API_KEY (environnement) a toutes les portées.
 */

const KEY_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789"
const KEY_LENGTH = 40 // ~206 bits d'aléa

export const hashKey = (key: string) =>
  createHash("sha256").update(key).digest("hex")

export function generateApiKey() {
  let body = ""
  for (let i = 0; i < KEY_LENGTH; i++) {
    body += KEY_ALPHABET[randomInt(KEY_ALPHABET.length)]
  }
  const key = `${API_KEY_PREFIX}${body}`
  return { key, prefix: key.slice(0, 12), hash: hashKey(key) }
}

export type ApiPrincipal = {
  keyId: string | null
  name: string
  scopes: Set<string>
  /** Auteur lisible pour les journaux et le grand livre. */
  actor: string
}

const json = (status: number, error: string, headers?: HeadersInit) =>
  Response.json({ ok: false, error }, { status, headers })

/* Limite : 120 requêtes par minute et par clé (instance unique). */
const g = globalThis as unknown as {
  __apiRate?: Map<string, { n: number; reset: number }>
}
const rate = (g.__apiRate ??= new Map())
const RATE_MAX = 120

function rateLimited(id: string) {
  const now = Date.now()
  const r = rate.get(id)
  if (!r || r.reset < now) {
    rate.set(id, { n: 1, reset: now + 60_000 })
    return null
  }
  r.n++
  return r.n > RATE_MAX ? Math.ceil((r.reset - now) / 1000) : null
}

function masterMatches(given: string) {
  if (!env.SOU_API_KEY) return false
  const a = Buffer.from(hashKey(given))
  const b = Buffer.from(hashKey(env.SOU_API_KEY))
  return timingSafeEqual(a, b)
}

/**
 * Authentifie la requête et vérifie la portée. Renvoie le principal, ou une
 * réponse d'erreur à retourner telle quelle.
 */
export async function authenticateApi(
  request: Request,
  scope?: ApiScope
): Promise<ApiPrincipal | Response> {
  const header = request.headers.get("authorization") ?? ""
  const given =
    header.replace(/^Bearer\s+/i, "").trim() ||
    request.headers.get("x-api-key")?.trim() ||
    ""
  if (!given.startsWith(API_KEY_PREFIX) || given.length > 200) {
    return json(
      401,
      "Clé d'API manquante ou invalide (Authorization: Bearer sou_…)"
    )
  }

  let principal: ApiPrincipal | null = null
  if (masterMatches(given)) {
    principal = {
      keyId: null,
      name: "maîtresse",
      scopes: new Set(API_SCOPE_KEYS),
      actor: "api:maîtresse",
    }
  } else {
    const K = schema.apiKeys
    const [key] = await db
      .select()
      .from(K)
      .where(and(eq(K.keyHash, hashKey(given)), isNull(K.revokedAt)))
    if (key && (!key.expiresAt || key.expiresAt > new Date())) {
      principal = {
        keyId: key.id,
        name: key.name,
        scopes: new Set(key.scopes),
        actor: `api:${key.name}`,
      }
      // Dernière utilisation, au plus une écriture par minute.
      if (!key.lastUsedAt || Date.now() - key.lastUsedAt.getTime() > 60_000) {
        void db
          .update(K)
          .set({ lastUsedAt: new Date() })
          .where(eq(K.id, key.id))
          .catch(() => undefined)
      }
    }
  }
  if (!principal) return json(401, "Clé d'API invalide, expirée ou révoquée")

  const retry = rateLimited(principal.keyId ?? "master")
  if (retry !== null) {
    return json(429, "Trop de requêtes", { "Retry-After": String(retry) })
  }
  if (scope && !principal.scopes.has(scope)) {
    return json(403, `Portée requise : ${scope}`)
  }
  return principal
}

export const apiError = json

/** Lit un corps JSON (objet) ; null si absent ou invalide. */
export async function readJson(request: Request) {
  const body = await request.json().catch(() => null)
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null
}
