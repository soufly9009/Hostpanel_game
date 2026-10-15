"use server"

import fs from "node:fs/promises"
import path from "node:path"
import { revalidatePath } from "next/cache"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@libsql/client"
import { z } from "zod"

import { logActivity } from "@/lib/activity"
import { hashPassword } from "@/lib/auth/password"
import { ensureRbacSeed } from "@/lib/auth/permissions"
import { createSession } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import {
  ensureLegalSeed,
  recordAcceptances,
  requiredDocuments,
} from "@/lib/legal/service"
import { applyPendingMigrations } from "@/lib/migrations/deploy"

import {
  checkSetupCode,
  clearSetupCode,
  codeAttemptsBlocked,
  INSTALL_COOKIE,
  installAccess,
  userCount,
} from "./access"
import { writeEnvFile, type EnvUpdate } from "./envfile"
import { ENV_FIELDS } from "./fields"

export type InstallState =
  { error?: string; ok?: boolean; notice?: string } | undefined

const DENIED = { error: "Accès refusé : recharge la page." }

async function allowed() {
  const access = await installAccess()
  return access.mode === "setup" || access.mode === "admin" ? access : null
}

const actorOf = (a: NonNullable<Awaited<ReturnType<typeof allowed>>>) =>
  a.mode === "admin" ? a.user.email : "installation"

/* ───────────── Déverrouillage ───────────── */

export async function unlockAction(
  _prev: InstallState,
  formData: FormData
): Promise<InstallState> {
  if (codeAttemptsBlocked()) {
    return { error: "Trop d'essais : réessaie dans 15 minutes." }
  }
  const code = String(formData.get("code") ?? "")
  if (!(await checkSetupCode(code))) return { error: "Code incorrect." }
  ;(await cookies()).set(INSTALL_COOKIE, code.trim(), {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.NODE_ENV === "production",
    path: "/install",
    maxAge: 2 * 60 * 60,
  })
  redirect("/install/setup")
}

/* ───────────── Base de données ───────────── */

/**
 * Teste une URL de base (celle saisie, sans l'enregistrer). Pour un fichier
 * local, le dossier est créé au besoin.
 */
export async function testDatabaseAction(
  _prev: InstallState,
  formData: FormData
): Promise<InstallState> {
  if (!(await allowed())) return DENIED
  const url = String(formData.get("url") ?? "").trim() || "file:./data/app.db"
  const authToken = String(formData.get("token") ?? "").trim() || undefined
  if (!/^(file:|libsql:\/\/|https:\/\/|wss:\/\/)/.test(url)) {
    return { error: "URL attendue : file:…, libsql://…, https://… ou wss://…" }
  }

  if (url.startsWith("file:")) {
    const file = url.slice(5)
    await fs
      .mkdir(path.dirname(path.resolve(process.cwd(), file)), {
        recursive: true,
      })
      .catch(() => undefined)
  }

  const client = createClient({ url, authToken })
  try {
    const started = Date.now()
    await client.execute("select 1")
    const tables = await client.execute(
      "select count(*) as n from sqlite_master where type='table'"
    )
    let users: number | null = null
    try {
      const r = await client.execute("select count(*) as n from users")
      users = Number(r.rows[0]?.n ?? 0)
    } catch {
      // base vierge
    }
    return {
      ok: true,
      notice: `Connexion réussie (${Date.now() - started} ms) : ${Number(tables.rows[0]?.n ?? 0)} table(s)${users === null ? ", base vierge" : `, ${users} compte(s)`}.`,
    }
  } catch (e) {
    return {
      error: `Connexion impossible : ${e instanceof Error ? e.message : "erreur inconnue"}`,
    }
  } finally {
    client.close()
  }
}

export async function migrateAction(): Promise<InstallState> {
  const access = await allowed()
  if (!access) return DENIED
  const res = await applyPendingMigrations({
    actor: `install:${actorOf(access)}`,
  })
  if (!res.ok) {
    if (res.code === "none") return { ok: true, notice: res.error }
    return {
      error:
        res.code === "destructive"
          ? `${res.error} Utilise Admin → Migrations (annonce + confirmation).`
          : res.error,
    }
  }
  revalidatePath("/install/setup")
  return {
    ok: true,
    notice: `${res.applied.length} migration(s) appliquée(s)${res.backup ? ` · sauvegarde : ${res.backup}` : ""}.`,
  }
}

/* ───────────── Fichier .env.local ───────────── */

export async function saveEnvAction(
  _prev: InstallState,
  formData: FormData
): Promise<InstallState> {
  const access = await allowed()
  if (!access) return DENIED

  const updates: EnvUpdate = {}
  for (const f of ENV_FIELDS) {
    if (f.secret && formData.get(`clear:${f.key}`) !== null) {
      updates[f.key] = null
      continue
    }
    const raw = formData.get(f.key)
    if (raw === null) continue
    const v = String(raw).trim()
    // Secret : champ vide = inchangé. Autre champ : vide = supprimé.
    if (f.secret && v === "") continue
    updates[f.key] = v === "" ? null : v
  }

  const res = await writeEnvFile(updates)
  if (!res.ok) return { error: res.error }

  if (access.mode === "admin") {
    await logActivity(access.user, "Configuration .env.local modifiée", {
      type: "account",
      label: Object.keys(updates).join(", ").slice(0, 120),
    })
  }
  return {
    ok: true,
    notice:
      "Enregistré dans .env.local (copie dans .env.local.bak). Redémarre le serveur pour appliquer les changements (base de données, clés).",
  }
}

/* ───────────── Premier administrateur ───────────── */

const adminSchema = z
  .object({
    name: z.string().trim().min(1, "Nom requis").max(80),
    email: z.string().trim().toLowerCase().pipe(z.email("Email invalide")),
    password: z.string().min(10, "10 caractères minimum").max(200),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Les mots de passe ne correspondent pas",
  })

export async function createAdminAction(
  _prev: InstallState,
  formData: FormData
): Promise<InstallState> {
  const access = await allowed()
  if (access?.mode !== "setup") return DENIED
  const parsed = adminSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  const n = await userCount()
  if (n === null) {
    return { error: "Base non prête : applique d'abord les migrations." }
  }
  if (n > 0) return { error: "Un compte existe déjà : connecte-toi." }

  const [user] = await db
    .insert(schema.users)
    .values({
      name: parsed.data.name,
      email: parsed.data.email,
      passwordHash: await hashPassword(parsed.data.password),
      role: "admin",
      serverLimit: 10,
    })
    .returning({ id: schema.users.id, email: schema.users.email })

  // Catalogue de rôles et documents légaux par défaut ; l'administrateur
  // accepte les conditions qu'il publie lui-même.
  await ensureRbacSeed()
  await ensureLegalSeed()
  await recordAcceptances(user.id, await requiredDocuments())
  await logActivity(user, "Installation terminée : administrateur créé", {
    type: "account",
  })

  await clearSetupCode()
  const jar = await cookies()
  jar.delete({ name: INSTALL_COOKIE, path: "/install" })
  await createSession(user.id)
  redirect("/admin")
}
