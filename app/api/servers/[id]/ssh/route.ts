import { eq } from "drizzle-orm"
import { z } from "zod"

import { db, schema } from "@/lib/db"
import { errorText, logWarning } from "@/lib/discord/logging"
import { getAccessibleServerOrNull } from "@/lib/servers/access"
import { openSession, SshError } from "@/lib/ssh/sessions"
import { getCurrentUser } from "@/lib/auth/session"

export const dynamic = "force-dynamic"

const bodySchema = z.object({
  username: z
    .string()
    .trim()
    .regex(/^[a-zA-Z_][a-zA-Z0-9_.-]{0,31}$/, "Nom d'utilisateur invalide"),
  password: z.string().min(1, "Mot de passe requis").max(256),
  cols: z.coerce.number().int().min(20).max(400).default(80),
  rows: z.coerce.number().int().min(5).max(200).default(24),
})

const STATUS: Record<SshError["code"], number> = {
  auth: 401,
  hostkey_changed: 409,
  unreachable: 504,
  rate_limited: 429,
  too_many: 429,
  failed: 502,
}

/**
 * Ouvre une session SSH vers le VPS. La destination vient TOUJOURS de la base
 * (jamais du client) : le terminal ne peut pas servir à scanner le réseau.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const user = await getCurrentUser()
  const { id } = await params
  const server = await getAccessibleServerOrNull(id)
  if (!user || !server) {
    return Response.json({ error: "Introuvable" }, { status: 404 })
  }
  if (server.suspended) {
    return Response.json({ error: "VPS suspendu" }, { status: 403 })
  }

  const host = server.address ?? server.ipv6
  if (!host) {
    return Response.json(
      { error: "Adresse IP inconnue : démarre le VPS et réessaie." },
      { status: 409 }
    )
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})))
  if (!parsed.success) {
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Requête invalide" },
      { status: 400 }
    )
  }

  try {
    const { id: sessionId, fingerprint } = await openSession({
      userId: user.id,
      serverId: server.id,
      host,
      username: parsed.data.username,
      password: parsed.data.password,
      cols: parsed.data.cols,
      rows: parsed.data.rows,
      expectedFingerprint: server.sshHostKey,
    })

    // Première connexion : on mémorise l'empreinte (TOFU).
    if (!server.sshHostKey && fingerprint) {
      await db
        .update(schema.servers)
        .set({ sshHostKey: fingerprint })
        .where(eq(schema.servers.id, server.id))
    }

    return Response.json({
      sessionId,
      host,
      fingerprint,
      firstConnection: !server.sshHostKey,
    })
  } catch (e) {
    if (e instanceof SshError) {
      // Une faute de saisie n'est pas un incident ; l'injoignabilité l'est.
      if (e.code === "unreachable" || e.code === "failed") {
        void logWarning({
          category: "ssh",
          title: "Échec de connexion SSH web",
          service: "Terminal SSH",
          action: "ouverture de session",
          result: "failure",
          message: errorText(e),
          meta: { vps: server.id },
          dedupeKey: `ssh:${server.id}:${e.code}`,
        })
      } else if (e.code === "rate_limited") {
        void logWarning({
          category: "security",
          title: "Échecs d'authentification SSH répétés",
          service: "Terminal SSH",
          action: "limitation",
          result: "failure",
          meta: { vps: server.id },
          dedupeKey: `ssh-bf:${server.id}`,
        })
      }
      return Response.json(
        { error: e.message, code: e.code },
        { status: STATUS[e.code] }
      )
    }
    return Response.json({ error: "Connexion SSH échouée" }, { status: 502 })
  }
}
