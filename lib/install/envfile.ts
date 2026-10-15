import "server-only"

import fs from "node:fs/promises"
import path from "node:path"

import { envSchema } from "@/lib/env"

import { ENV_FIELDS } from "./fields"

/**
 * Lecture/écriture de .env.local pour l'assistant d'installation.
 * Seules les clés de ENV_FIELDS sont modifiables ; les autres lignes et les
 * commentaires sont conservés ; une copie .env.local.bak est faite avant.
 */

const FILE = () => path.join(process.cwd(), ".env.local")
const KEYS = new Set(ENV_FIELDS.map((f) => f.key))
const LINE_RE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$/

function unquote(raw: string) {
  const v = raw.trim()
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v.at(-1) === v[0]) {
    return v.slice(1, -1).replace(/\\\$/g, "$").replace(/\\"/g, '"')
  }
  // commentaire en fin de ligne (non entre guillemets)
  return v.replace(/\s+#.*$/, "").replace(/\\\$/g, "$")
}

/** Valeur écrite : `$` échappé (dotenv-expand), guillemets si nécessaire. */
function quote(value: string) {
  const v = value.replace(/\$/g, "\\$")
  return /[\s#"'`]/.test(value) ? `"${v.replace(/"/g, '\\"')}"` : v
}

export async function readEnvFile() {
  let text = ""
  try {
    text = await fs.readFile(FILE(), "utf8")
  } catch {
    // fichier absent
  }
  const values: Record<string, string> = {}
  for (const line of text.split(/\r?\n/)) {
    const m = LINE_RE.exec(line)
    if (m && !line.trimStart().startsWith("#")) values[m[1]] = unquote(m[2])
  }
  return { exists: text.length > 0, text, values }
}

export type EnvUpdate = Record<string, string | null> // null = effacer

/** Valide puis écrit ; renvoie une erreur lisible sinon. */
export async function writeEnvFile(updates: EnvUpdate) {
  for (const [k, v] of Object.entries(updates)) {
    if (!KEYS.has(k))
      return { ok: false as const, error: `Clé non modifiable : ${k}` }
    if (v !== null && /[\r\n\0]/.test(v)) {
      return { ok: false as const, error: `${k} : retour à la ligne interdit` }
    }
  }

  const current = await readEnvFile()
  const merged: Record<string, string | undefined> = { ...current.values }
  for (const [k, v] of Object.entries(updates)) merged[k] = v ?? undefined

  // Même validation qu'au démarrage du panel.
  const parsed = envSchema.safeParse(merged)
  if (!parsed.success) {
    const i = parsed.error.issues[0]
    return {
      ok: false as const,
      error: `${String(i?.path[0] ?? "")} : ${i?.message ?? "valeur invalide"}`,
    }
  }

  const done = new Set<string>()
  const lines = current.text ? current.text.split(/\r?\n/) : []
  const out: string[] = []
  for (const line of lines) {
    const m = LINE_RE.exec(line)
    if (!m || line.trimStart().startsWith("#")) {
      out.push(line)
      continue
    }
    const key = m[1]
    if (key in updates) {
      if (done.has(key)) continue // doublon : une seule ligne
      done.add(key)
      const v = updates[key]
      if (v !== null && v !== "") out.push(`${key}=${quote(v)}`)
      continue
    }
    // Corrige « CLE =valeur » (espace avant =), mal interprété.
    out.push(line.replace(/^(\s*[A-Za-z_][A-Za-z0-9_]*)\s+=/, "$1="))
  }
  const added = Object.entries(updates).filter(
    ([k, v]) => !done.has(k) && v !== null && v !== ""
  )
  if (added.length) {
    if (out.length && out.at(-1) !== "") out.push("")
    out.push("# Ajouté par /install/setup")
    for (const [k, v] of added) out.push(`${k}=${quote(v!)}`)
  }

  if (current.exists) await fs.copyFile(FILE(), `${FILE()}.bak`)
  await fs.writeFile(FILE(), out.join("\n").replace(/\n*$/, "\n"), {
    mode: 0o600,
  })
  return { ok: true as const }
}
