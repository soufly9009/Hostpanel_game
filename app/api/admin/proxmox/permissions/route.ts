import { getCurrentUser } from "@/lib/auth/session"
import { checkProxmoxPermissions } from "@/lib/proxmox/permissions"

export const dynamic = "force-dynamic"

/**
 * GET ?node=pve (facultatif) — indique si le jeton Proxmox dispose des droits
 * nécessaires. Admin uniquement.
 *
 *   { ready, connected, tokenId, node, checks[], probes[], missing[], error }
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Non autorisé" }, { status: 403 })
  }

  const node = new URL(request.url).searchParams.get("node")
  if (node !== null && !/^[a-zA-Z0-9-]+$/.test(node)) {
    return Response.json({ error: "Nœud invalide" }, { status: 400 })
  }

  const report = await checkProxmoxPermissions(node)
  // 200 même si des droits manquent : le détail est dans le corps.
  return Response.json(report)
}
