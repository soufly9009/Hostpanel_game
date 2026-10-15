import "server-only"

import { randomBytes, timingSafeEqual } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import { cookies } from "next/headers"

import { getCurrentUser } from "@/lib/auth/session"
import { db } from "@/lib/db"
import { env } from "@/lib/env"

/**
 * Accès à l'assistant /install/setup :
 * - panel non installé (aucun compte) : code d'installation requis. C'est
 *   ADMIN_TOKEN s'il est défini, sinon un code aléatoire écrit dans
 *   data/install-code.txt et affiché dans la console du serveur ;
 * - panel installé : administrateur connecté uniquement.
 */

export const INSTALL_COOKIE = "install_token"
const CODE_FILE = () => path.join(process.cwd(), "data", "install-code.txt")

const g = globalThis as unknown as {
  __installCode?: string
  __installFails?: { n: number; until: number }
}

/** Nombre de comptes ; null si la base ou la table est inaccessible. */
export async function userCount(): Promise<number | null> {
  try {
    const res = await db.$client.execute("select count(*) as n from users")
    return Number(res.rows[0]?.n ?? 0)
  } catch {
    return null
  }
}

export async function isInstalled() {
  return ((await userCount()) ?? 0) > 0
}

/** Code d'installation (stable entre redémarrages tant que l'installation n'est pas terminée). */
export async function setupCode(): Promise<string> {
  if (env.ADMIN_TOKEN) return env.ADMIN_TOKEN
  if (g.__installCode) return g.__installCode
  try {
    const saved = (await fs.readFile(CODE_FILE(), "utf8")).trim()
    if (saved.length >= 16) return (g.__installCode = saved)
  } catch {
    // pas encore de fichier
  }
  const code = randomBytes(12).toString("base64url")
  g.__installCode = code
  try {
    await fs.mkdir(path.dirname(CODE_FILE()), { recursive: true })
    await fs.writeFile(CODE_FILE(), code, { mode: 0o600 })
  } catch {
    // dossier non inscriptible : le code reste en mémoire (console)
  }
  return code
}

/** Supprime le code une fois l'installation terminée. */
export async function clearSetupCode() {
  g.__installCode = undefined
  await fs.rm(CODE_FILE(), { force: true }).catch(() => undefined)
}

/** Appelé au démarrage : indique comment terminer l'installation. */
export async function announceSetup() {
  if (await isInstalled()) return
  const code = await setupCode()
  console.log(
    `\n[install] Panel non installé : ouvre /install/setup\n[install] Code d'installation : ${
      env.ADMIN_TOKEN ? "la valeur de ADMIN_TOKEN" : code
    }${env.ADMIN_TOKEN ? "" : " (aussi dans data/install-code.txt)"}\n`
  )
}

function same(a: string, b: string) {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  return x.length === y.length && timingSafeEqual(x, y)
}

/** Anti-force brute global : 10 essais par quart d'heure. */
export function codeAttemptsBlocked() {
  const f = g.__installFails
  return !!f && f.until > Date.now() && f.n >= 10
}

export async function checkSetupCode(given: string) {
  if (codeAttemptsBlocked()) return false
  const ok = same(given.trim(), await setupCode())
  if (!ok) {
    const f = g.__installFails
    g.__installFails =
      !f || f.until < Date.now()
        ? { n: 1, until: Date.now() + 15 * 60_000 }
        : { n: f.n + 1, until: f.until }
  }
  return ok
}

export type InstallAccess =
  | { mode: "setup" } // aucun compte, code validé
  | { mode: "admin"; user: { id: string; email: string } }
  | { mode: "locked"; installed: boolean } // code requis ou admin requis

export async function installAccess(): Promise<InstallAccess> {
  const installed = await isInstalled()
  if (installed) {
    const user = await getCurrentUser()
    return user?.role === "admin"
      ? { mode: "admin", user }
      : { mode: "locked", installed: true }
  }
  const token = (await cookies()).get(INSTALL_COOKIE)?.value
  if (token && same(token, await setupCode())) return { mode: "setup" }
  return { mode: "locked", installed: false }
}
