import "server-only"

import type { WalletError } from "@/lib/wallet/service"

const STATUS: Record<WalletError["code"], number> = {
  invalid: 400,
  not_found: 404,
  insufficient: 409,
  limit: 409,
  conflict: 409,
}

/** Erreur métier → réponse JSON avec le code HTTP adapté. */
export const walletErrorResponse = (e: WalletError) =>
  Response.json(
    { ok: false, code: e.code, error: e.error },
    { status: STATUS[e.code] }
  )

export const notFound = (what = "Ressource") =>
  Response.json({ ok: false, error: `${what} introuvable` }, { status: 404 })

export const badRequest = (error: string) =>
  Response.json({ ok: false, error }, { status: 400 })

/** Pagination : ?limit (1-100, défaut 50) & ?offset. */
export function pageParams(url: URL) {
  const limit = Math.min(
    100,
    Math.max(
      1,
      Number.parseInt(url.searchParams.get("limit") ?? "50", 10) || 50
    )
  )
  const offset = Math.max(
    0,
    Number.parseInt(url.searchParams.get("offset") ?? "0", 10) || 0
  )
  return { limit, offset }
}

export const toApiUser = (u: {
  id: string
  email: string
  name: string | null
  role: string
  serverLimit: number
  balanceCents: number
  createdAt: Date
}) => ({
  id: u.id,
  email: u.email,
  name: u.name,
  role: u.role,
  serverLimit: u.serverLimit,
  balanceCents: u.balanceCents,
  createdAt: u.createdAt.toISOString(),
})

/** amountCents (entier) ou amount (crédits, 2 décimales max). */
export function readAmount(body: Record<string, unknown>) {
  if (typeof body.amountCents === "number") return body.amountCents
  if (typeof body.amount === "number" && Number.isFinite(body.amount)) {
    return Math.round(body.amount * 100)
  }
  return null
}
