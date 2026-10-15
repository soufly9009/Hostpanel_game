import { eq } from "drizzle-orm"

import { logActivity } from "@/lib/activity"
import { authenticateApi, readJson } from "@/lib/api/auth"
import { badRequest, notFound, walletErrorResponse } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"
import { deleteCoupon, toApiCoupon, updateCoupon } from "@/lib/wallet/service"

export const dynamic = "force-dynamic"

type Ctx = { params: Promise<{ id: string }> }

export async function GET(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:read")
  if (auth instanceof Response) return auth
  const { id } = await params
  const [coupon] = await db
    .select()
    .from(schema.coupons)
    .where(eq(schema.coupons.id, id))
  if (!coupon) return notFound("Coupon")
  return Response.json({ ok: true, coupon: toApiCoupon(coupon) })
}

/** Modification partielle (mêmes champs que la création). */
export async function PATCH(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const { id } = await params
  const body = await readJson(request)
  if (!body) return badRequest("Corps JSON attendu")

  const res = await updateCoupon(id, body)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity({ id: "", email: auth.actor }, "Coupon modifié via l'API", {
    type: "wallet",
    id,
    label: res.coupon.code,
  })
  return Response.json({ ok: true, coupon: toApiCoupon(res.coupon) })
}

export async function DELETE(request: Request, { params }: Ctx) {
  const auth = await authenticateApi(request, "coupons:write")
  if (auth instanceof Response) return auth
  const { id } = await params
  const res = await deleteCoupon(id)
  if (!res.ok) return walletErrorResponse(res)
  await logActivity(
    { id: "", email: auth.actor },
    "Coupon supprimé via l'API",
    {
      type: "wallet",
      id,
      label: res.coupon.code,
    }
  )
  return Response.json({ ok: true })
}
