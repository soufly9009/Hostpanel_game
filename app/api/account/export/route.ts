import { logActivity } from "@/lib/activity"
import { exportUserData } from "@/lib/account/privacy"
import { getCurrentUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

/** RGPD : export JSON des données du compte connecté (accès / portabilité). */
export async function GET() {
  const user = await getCurrentUser()
  if (!user) return new Response("Not found", { status: 404 })

  const data = await exportUserData(user.id)
  if (!data) return new Response("Not found", { status: 404 })

  await logActivity(user, "Export des données personnelles", {
    type: "account",
  })
  const day = new Date().toISOString().slice(0, 10)
  return new Response(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="mes-donnees-${day}.json"`,
      "Cache-Control": "no-store",
    },
  })
}
