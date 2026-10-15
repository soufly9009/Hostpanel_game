/**
 * Analyse statique d'un fichier de migration SQL (module pur).
 * Heuristique volontairement prudente : elle signale, elle ne prouve rien.
 */

export type SqlAnalysis = {
  statements: number
  creates: string[]
  additions: string[]
  /** Opérations pouvant détruire ou réécrire des données. */
  destructive: string[]
  other: number
}

const strip = (s: string) =>
  s
    .replace(/--[^\n]*/g, "")
    .replace(/\s+/g, " ")
    .trim()

export function analyzeSql(sql: string): SqlAnalysis {
  const out: SqlAnalysis = {
    statements: 0,
    creates: [],
    additions: [],
    destructive: [],
    other: 0,
  }

  const parts = sql.split("--> statement-breakpoint").map(strip).filter(Boolean)

  for (const raw of parts) {
    out.statements++
    const st = raw.replace(/;+\s*$/, "")

    let m: RegExpExecArray | null
    if (
      (m =
        /^CREATE (?:UNIQUE )?(TABLE|INDEX)(?: IF NOT EXISTS)? [`"]?([\w]+)/i.exec(
          st
        ))
    ) {
      out.creates.push(`${m[1].toLowerCase()} ${m[2]}`)
    } else if (
      (m = /^ALTER TABLE [`"]?(\w+)[`"]? ADD(?: COLUMN)? [`"]?(\w+)/i.exec(st))
    ) {
      out.additions.push(`${m[1]}.${m[2]}`)
    } else if (
      (m =
        /^DROP (TABLE|INDEX|COLUMN|VIEW|TRIGGER)(?: IF EXISTS)? [`"]?([\w]+)/i.exec(
          st
        ))
    ) {
      out.destructive.push(`DROP ${m[1].toUpperCase()} ${m[2]}`)
    } else if (
      (m = /^ALTER TABLE [`"]?(\w+)[`"]? (DROP|RENAME)[^;]*/i.exec(st))
    ) {
      out.destructive.push(`ALTER TABLE ${m[1]} ${m[2].toUpperCase()}`)
    } else if (/^DELETE FROM/i.test(st)) {
      out.destructive.push("DELETE FROM …")
    } else if (/^UPDATE /i.test(st)) {
      out.destructive.push("UPDATE (réécriture de données)")
    } else if (/^(TRUNCATE|PRAGMA foreign_keys\s*=\s*OFF)/i.test(st)) {
      out.destructive.push(st.slice(0, 40))
    } else if (/^INSERT INTO [`"]?\w+[`"]? SELECT/i.test(st)) {
      // Recopie de table (reconstruction SQLite) : à relire.
      out.destructive.push("Reconstruction de table (INSERT … SELECT)")
    } else {
      out.other++
    }
  }
  return out
}

export function summarize(a: SqlAnalysis) {
  const bits: string[] = []
  if (a.creates.length) bits.push(`${a.creates.length} création(s)`)
  if (a.additions.length)
    bits.push(`${a.additions.length} colonne(s) ajoutée(s)`)
  if (a.destructive.length)
    bits.push(`${a.destructive.length} opération(s) destructive(s)`)
  if (a.other) bits.push(`${a.other} autre(s)`)
  return bits.join(" · ") || "vide"
}
