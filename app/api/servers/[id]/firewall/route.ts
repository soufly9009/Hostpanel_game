import { getAccessibleServerOrNull } from "@/lib/servers/access"
import { getFirewall } from "@/lib/proxmox/firewall"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const server = await getAccessibleServerOrNull(id)
  if (!server) return Response.json({ error: "Introuvable" }, { status: 404 })

  try {
    return Response.json(
      await getFirewall(server.node, server.virt, server.vmid)
    )
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 502 }
    )
  }
}
