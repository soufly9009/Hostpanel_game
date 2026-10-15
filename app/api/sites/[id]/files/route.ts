import { basename } from "node:path"

import { errorText, logError } from "@/lib/discord/logging"
import {
  isPleskConnectivityError,
  PleskError,
  safeRelativeDir,
  uploadFiles,
} from "@/lib/plesk/client"
import { getAccessibleSiteOrNull } from "@/lib/sites/access"

export const dynamic = "force-dynamic"

const MAX_FILES = 100
const MAX_FILE_BYTES = 50 * 1024 * 1024
const MAX_TOTAL_BYTES = 200 * 1024 * 1024

/** Envoie des fichiers dans le dossier web (httpdocs) du site. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const site = await getAccessibleSiteOrNull(id)
  if (!site)
    return Response.json({ error: "Site introuvable" }, { status: 404 })

  const form = await request.formData().catch(() => null)
  if (!form)
    return Response.json({ error: "Requête invalide" }, { status: 400 })

  const dir = safeRelativeDir(String(form.get("dir") ?? ""))
  if (dir === null) {
    return Response.json({ error: "Dossier invalide" }, { status: 400 })
  }

  const entries = form
    .getAll("files")
    .filter((f): f is File => f instanceof File)
  if (entries.length === 0) {
    return Response.json({ error: "Aucun fichier" }, { status: 400 })
  }
  if (entries.length > MAX_FILES) {
    return Response.json(
      { error: `${MAX_FILES} fichiers maximum par envoi` },
      { status: 400 }
    )
  }

  let total = 0
  const files: { name: string; data: Buffer }[] = []
  for (const f of entries) {
    if (f.size > MAX_FILE_BYTES) {
      return Response.json(
        { error: `${f.name} dépasse 50 Mo` },
        { status: 413 }
      )
    }
    total += f.size
    const name = basename(f.name.replace(/\\/g, "/"))
    if (!name || name === "." || name === "..") {
      return Response.json(
        { error: "Nom de fichier invalide" },
        { status: 400 }
      )
    }
    files.push({ name, data: Buffer.from(await f.arrayBuffer()) })
  }
  if (total > MAX_TOTAL_BYTES) {
    return Response.json({ error: "Envoi trop volumineux" }, { status: 413 })
  }

  try {
    await uploadFiles({
      domain: site.domain,
      ftpLogin: site.ftpLogin,
      dir,
      files,
    })
  } catch (e) {
    // Les pannes de connexion Plesk sont signalées par le client API ; ici
    // seuls les échecs propres au transfert (FTP, mot de passe temporaire).
    if (!isPleskConnectivityError(e)) {
      void logError({
        category: "files",
        title: "Échec de transfert de fichiers",
        service: "Site web",
        action: "envoi FTP",
        result: "failure",
        message: errorText(e),
        meta: { site: site.id, fichiers: files.length },
        dedupeKey: `upload:${site.id}`,
      })
    }
    const message = e instanceof PleskError ? e.message : "Envoi impossible"
    return Response.json({ error: message }, { status: 502 })
  }

  return Response.json({ uploaded: files.length })
}
