import { ProxmoxError } from "@/lib/proxmox/client"
import { listSnapshots, supportsSnapshots } from "@/lib/proxmox/snapshots"
import { getAccessibleServerOrNull } from "@/lib/servers/access"

export const dynamic = "force-dynamic"

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const server = await getAccessibleServerOrNull(id)
  if (!server) return Response.json({ error: "Introuvable" }, { status: 404 })

  try {
    const supported = await supportsSnapshots(
      server.node,
      server.virt,
      server.vmid
    )
    if (!supported) {
      return Response.json({ supported: false, snapshots: [] })
    }
    const snapshots = await listSnapshots(server.node, server.virt, server.vmid)
    return Response.json({ supported: true, snapshots })
  } catch (e) {
    const status = e instanceof ProxmoxError && e.status === 403 ? 403 : 502
    return Response.json(
      { error: e instanceof Error ? e.message : "Erreur Proxmox" },
      { status }
    )
  }
}
