import { eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import { badRequest, notFound, walletErrorResponse } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"
import {
  deleteGiftCard,
  toApiGiftCard,
  updateGiftCard,
} from "@/lib/wallet/service"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:read")
  if (auth instanceof Response) return auth
  const { id } = await params
  const [card] = await db
    .select()
    .from(schema.giftCards)
    .where(eq(schema.giftCards.id, id))
  if (!card) return notFound("Carte cadeau")
  return Response.json({ ok: true, giftCard: toApiGiftCard(card) })
}

/** Corps : status (active|disabled)?, note?, expiresAt? — carte non utilisée. */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const { id } = await params
  const body = await readJson(request)
  if (!body) return badRequest("Corps JSON attendu")

  const res = await updateGiftCard(id, body)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity(
    { id: "", email: auth.actor },
    "Carte cadeau modifiée via l'API",
    { type: "wallet", id }
  )
  return Response.json({ ok: true, giftCard: toApiGiftCard(res.card) })
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const { id } = await params
  const res = await deleteGiftCard(id)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity(
    { id: "", email: auth.actor },
    "Carte cadeau supprimée via l'API",
    { type: "wallet", id }
  )
  return Response.json({ ok: true })
}
