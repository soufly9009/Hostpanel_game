import "server-only"

import { createHash, randomBytes } from "node:crypto"
import { headers } from "next/headers"
import { and, count, eq, gt, isNull } from "drizzle-orm"

import { db, schema } from "@/lib/db"
import { queueUserEmail, panelUrl } from "@/lib/mail/service"

/**
 * Réinitialisation du mot de passe : jeton aléatoire envoyé par e-mail, seule
 * son empreinte SHA-256 est stockée ; valable 30 min, usage unique ; 3
 * demandes par heure et par compte au maximum.
 */

const TTL_MIN = 30
const hash = (t: string) => createHash("sha256").update(t).digest("hex")

/** Base des liens : PANEL_PUBLIC_URL, ou l'hôte de la requête en développement. */
async function baseUrl() {
  const configured = panelUrl()
  if (configured) return configured
  if (process.env.NODE_ENV === "production") return null
  const h = await headers()
  const host = h.get("host")
  return host ? `http://${host}` : null
}

/** Crée un jeton et envoie l'e-mail ; renvoie le lien (ou null si limité). */
export async function issueResetLink(userId: string) {
  const R = schema.passwordResets
  const [{ n }] = await db
    .select({ n: count() })
    .from(R)
    .where(
      and(
        eq(R.userId, userId),
        gt(R.createdAt, new Date(Date.now() - 3_600_000))
      )
    )
  if (n >= 3) return null

  const token = randomBytes(32).toString("base64url")
  await db.insert(R).values({
    userId,
    tokenHash: hash(token),
    expiresAt: new Date(Date.now() + TTL_MIN * 60_000),
  })
  const base = await baseUrl()
  const link = `${base ?? ""}/reset-password?token=${token}`
  await queueUserEmail(userId, "password_reset", {
    resetUrl: link,
    minutes: String(TTL_MIN),
  })
  return link
}

/** Vérifie un jeton (sans le consommer). */
export async function findValidReset(token: string) {
  if (!token || token.length > 100) return null
  const R = schema.passwordResets
  const [row] = await db
    .select()
    .from(R)
    .where(
      and(
        eq(R.tokenHash, hash(token)),
        isNull(R.usedAt),
        gt(R.expiresAt, new Date())
      )
    )
  return row ?? null
}

/** Consomme le jeton (atomique) ; renvoie l'utilisateur concerné. */
export async function consumeReset(token: string) {
  const R = schema.passwordResets
  const [row] = await db
    .update(R)
    .set({ usedAt: new Date() })
    .where(
      and(
        eq(R.tokenHash, hash(token)),
        isNull(R.usedAt),
        gt(R.expiresAt, new Date())
      )
    )
    .returning({ userId: R.userId })
  return row?.userId ?? null
}
