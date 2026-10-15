import { errorText } from "@/lib/discord/logging"
import { getAccessibleGame } from "@/lib/games/access"
import {
  getGameInstallStatus,
  getGameResources,
} from "@/lib/pterodactyl/client"

export const dynamic = "force-dynamic"

/** État et consommation en direct (sondé par la page toutes les 5 s). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const access = await getAccessibleGame(id)
  if (!access) return new Response("Not found", { status: 404 })
  if (access.game.suspended) {
    return Response.json({ ok: true, state: "suspended" })
  }
  try {
    const install = await getGameInstallStatus(access.game.pteroIdentifier)
    if (install === "installing" || install === "install_failed") {
      return Response.json({ ok: true, state: install })
    }
    const r = await getGameResources(access.game.pteroIdentifier)
    return Response.json({ ok: true, ...r })
  } catch (e) {
    return Response.json({ ok: false, error: errorText(e) }, { status: 502 })
  }
}
