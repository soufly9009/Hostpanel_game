import { count, desc, eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import {
  badRequest,
  notFound,
  pageParams,
  readAmount,
  walletErrorResponse,
} from "@/lib/api/respond"
import { db, schema } from "@/lib/db"
import { formatCredits } from "@/lib/wallet/format"
import { moveBalance, toApiTransaction } from "@/lib/wallet/service"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

/** Solde et historique (du plus récent au plus ancien). */
export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "wallet:read")
  if (auth instanceof Response) return auth
  const { id } = await params
  const { limit, offset } = pageParams(new URL(request.url))

  const [user] = await db
    .select({ balanceCents: schema.users.balanceCents })
    .from(schema.users)
    .where(eq(schema.users.id, id))
  if (!user) return notFound("Compte")

  const T = schema.walletTransactions
  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(T).where(eq(T.userId, id)),
    db
      .select()
      .from(T)
      .where(eq(T.userId, id))
      .orderBy(desc(T.createdAt), desc(T.id))
      .limit(limit)
      .offset(offset),
  ])
  return Response.json({
    ok: true,
    balanceCents: user.balanceCents,
    total,
    limit,
    offset,
    transactions: rows.map(toApiTransaction),
  })
}

/**
 * Crédite (montant positif) ou débite (négatif) le compte.
 *
 *   curl -X POST "$URL/api/v1/users/<id>/wallet" \
 *     -H "Authorization: Bearer sou_…" -H "Idempotency-Key: cmd-42" \
 *     -d '{"amountCents": 1000, "description": "Gain concours"}'
 *
 * Corps : amountCents (entier) ou amount (crédits), description (requis),
 * allowNegative (débit forcé), idempotencyKey (ou en-tête Idempotency-Key).
 */
export async function POST(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "wallet:write")
  if (auth instanceof Response) return auth
  const { id } = await params

  const body = await readJson(request)
  if (!body) return badRequest("Corps JSON attendu")
  const amount = readAmount(body)
  if (amount === null) return badRequest("amountCents (entier) requis")
  const description =
    typeof body.description === "string" ? body.description : ""
  if (description.trim().length < 3) return badRequest("description requise")

  const rawKey =
    request.headers.get("idempotency-key") ??
    (typeof body.idempotencyKey === "string" ? body.idempotencyKey : null)
  const idempotencyKey = rawKey ? `api:${rawKey.slice(0, 100)}` : null

  const res = await moveBalance({
    userId: id,
    amountCents: amount,
    kind: "api",
    description,
    actor: auth.actor,
    allowNegative: body.allowNegative === true,
    idempotencyKey,
  })
  if (!res.ok) return walletErrorResponse(res)

  if (!res.duplicate) {
    await logActivity(
      { id: "", email: auth.actor },
      `Solde ajusté via l'API (${formatCredits(amount, { sign: true })})`,
      { type: "wallet", id }
    )
  }
  return Response.json(
    {
      ok: true,
      duplicate: res.duplicate,
      balanceCents: res.balanceCents,
      transaction: toApiTransaction(res.transaction),
    },
    { status: res.duplicate ? 200 : 201 }
  )
}
