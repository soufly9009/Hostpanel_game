import { desc, eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import { badRequest, pageParams, walletErrorResponse } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"
import { createGiftCards, toApiGiftCard } from "@/lib/wallet/service"

export const dynamic = "force-dynamic"

/** ?status=active|redeemed|disabled, paginé. */
export async function GET(request: Request) {
  const auth = await authenticateApi(request, "coupons:read")
  if (auth instanceof Response) return auth
  const url = new URL(request.url)
  const { limit, offset } = pageParams(url)
  const status = (["active", "redeemed", "disabled"] as const).find(
    (s) => s === url.searchParams.get("status")
  )
  const G = schema.giftCards
  const rows = await db
    .select()
    .from(G)
    .where(status ? eq(G.status, status) : undefined)
    .orderBy(desc(G.createdAt))
    .limit(limit)
    .offset(offset)
  return Response.json({
    ok: true,
    limit,
    offset,
    giftCards: rows.map(toApiGiftCard),
  })
}

/** Corps : amountCents, quantity? (1-100), note?, expiresAt? (ISO 8601). */
export async function POST(request: Request) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  if (!body) return badRequest("Corps JSON attendu")

  const res = await createGiftCards(body, auth.actor)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity(
    { id: "", email: auth.actor },
    `${res.cards.length} carte(s) cadeau créée(s) via l'API`,
    { type: "wallet" }
  )
  return Response.json(
    { ok: true, giftCards: res.cards.map(toApiGiftCard) },
    { status: 201 }
  )
}
