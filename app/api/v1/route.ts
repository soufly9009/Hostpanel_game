import { authenticateApi } from "@/lib/api/auth"

export const dynamic = "force-dynamic"

/**
 * Vérifie la clé et liste les points d'accès.
 *
 *   curl "$URL/api/v1" -H "Authorization: Bearer sou_…"
 */
export async function GET(request: Request) {
  const auth = await authenticateApi(request)
  if (auth instanceof Response) return auth

  return Response.json({
    ok: true,
    key: { name: auth.name, scopes: [...auth.scopes] },
    endpoints: [
      "GET    /api/v1/users?q=&email=&limit=&offset=      users:read",
      "GET    /api/v1/users/{id}                          users:read",
      "PATCH  /api/v1/users/{id}                          users:write",
      "GET    /api/v1/users/{id}/wallet?limit=&offset=    wallet:read",
      "POST   /api/v1/users/{id}/wallet                   wallet:write",
      "GET    /api/v1/coupons                             coupons:read",
      "POST   /api/v1/coupons                             coupons:write",
      "GET    /api/v1/coupons/{id}                        coupons:read",
      "PATCH  /api/v1/coupons/{id}                        coupons:write",
      "DELETE /api/v1/coupons/{id}                        coupons:write",
      "GET    /api/v1/gift-cards?status=                  coupons:read",
      "POST   /api/v1/gift-cards                          coupons:write",
      "GET    /api/v1/gift-cards/{id}                     coupons:read",
      "PATCH  /api/v1/gift-cards/{id}                     coupons:write",
      "DELETE /api/v1/gift-cards/{id}                     coupons:write",
    ],
  })
}
