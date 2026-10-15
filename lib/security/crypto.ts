import "server-only"

import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto"

import { env } from "@/lib/env"

/**
 * Chiffrement AES-256-GCM des secrets stockés en base, avec une clé dérivée
 * de APP_SECRET. Sans APP_SECRET, la valeur est stockée en clair (préfixe
 * « plain: ») et reste lisible si la clé est ajoutée plus tard.
 */

const key = () =>
  env.APP_SECRET
    ? createHash("sha256").update(`panel-secrets:${env.APP_SECRET}`).digest()
    : null

export function sealSecret(value: string) {
  const k = key()
  if (!k) return `plain:${value}`
  const iv = randomBytes(12)
  const cipher = createCipheriv("aes-256-gcm", k, iv)
  const data = Buffer.concat([cipher.update(value, "utf8"), cipher.final()])
  return [
    "v1",
    iv.toString("base64url"),
    cipher.getAuthTag().toString("base64url"),
    data.toString("base64url"),
  ].join(":")
}

/** null si illisible (clé absente ou changée). */
export function openSecret(stored: string | null | undefined) {
  if (!stored) return null
  if (stored.startsWith("plain:")) return stored.slice(6)
  const [v, iv, tag, data] = stored.split(":")
  const k = key()
  if (v !== "v1" || !k || !iv || !tag || !data) return null
  try {
    const d = createDecipheriv("aes-256-gcm", k, Buffer.from(iv, "base64url"))
    d.setAuthTag(Buffer.from(tag, "base64url"))
    return Buffer.concat([
      d.update(Buffer.from(data, "base64url")),
      d.final(),
    ]).toString("utf8")
  } catch {
    return null
  }
}

export const sha256 = (v: string) =>
  createHash("sha256").update(v).digest("hex")
