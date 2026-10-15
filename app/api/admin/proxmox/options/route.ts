import { getCurrentUser } from "@/lib/auth/session"
import { listBridges, listStorages, listTemplates } from "@/lib/proxmox/client"

export const dynamic = "force-dynamic"

/**
 * GET ?kind=templates|storages|bridges&node=pve&virt=lxc|qemu
 * Options de sélecteur chargées depuis Proxmox (admin uniquement).
 */
export async function GET(request: Request) {
  const user = await getCurrentUser()
  if (!user || user.role !== "admin") {
    return Response.json({ error: "Non autorisé" }, { status: 403 })
  }

  const params = new URL(request.url).searchParams
  const kind = params.get("kind")
  const node = params.get("node") ?? ""
  const virt = params.get("virt")

  if (!/^[a-zA-Z0-9-]+$/.test(node)) {
    return Response.json({ error: "Nœud invalide" }, { status: 400 })
  }
  if (virt !== "lxc" && virt !== "qemu") {
    return Response.json({ error: "Type invalide" }, { status: 400 })
  }

  try {
    let options
    if (kind === "templates") {
      const { options: found, notes } = await listTemplates(node, virt)
      return Response.json({ options: found, info: notes.join(" · ") })
    } else if (kind === "storages") {
      options = await listStorages(node, virt)
    } else if (kind === "bridges") {
      options = await listBridges(node)
    } else {
      return Response.json({ error: "Type de liste inconnu" }, { status: 400 })
    }
    return Response.json({ options })
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "Erreur" },
      { status: 502 }
    )
  }
}
