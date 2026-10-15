import { desc } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import { badRequest, walletErrorResponse } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"
import { createCoupon, toApiCoupon } from "@/lib/wallet/service"

export const dynamic = "force-dynamic"

export async function GET(request: Request) {
  const auth = await authenticateApi(request, "coupons:read")
  if (auth instanceof Response) return auth
  const rows = await db
    .select()
    .from(schema.coupons)
    .orderBy(desc(schema.coupons.createdAt))
  return Response.json({ ok: true, coupons: rows.map(toApiCoupon) })
}

/**
 * Corps : code, amountCents, description?, maxRedemptions? (null = ∞),
 * perUserLimit? (1), startsAt?, expiresAt? (ISO 8601), isActive? (true).
 */
export async function POST(request: Request) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const body = await readJson(request)
  if (!body) return badRequest("Corps JSON attendu")

  const res = await createCoupon(body, auth.actor)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity({ id: "", email: auth.actor }, "Coupon créé via l'API", {
    type: "wallet",
    id: res.coupon.id,
    label: res.coupon.code,
  })
  return Response.json(
    { ok: true, coupon: toApiCoupon(res.coupon) },
    { status: 201 }
  )
}
