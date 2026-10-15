import "server-only"

import fs from "node:fs/promises"
import path from "node:path"

import { and, desc, eq, gte, inArray } from "drizzle-orm"
import { migrate } from "drizzle-orm/libsql/migrator"

import { logCritical, logSuccess, logWarning } from "@/lib/discord/logging"
import { db, schema } from "@/lib/db"
import { env } from "@/lib/env"

import { finishAnnouncement } from "./announcements"
import { analyzeSql, type SqlAnalysis } from "./analysis"

const FOLDER = () => path.join(process.cwd(), "drizzle")

export type PendingMigration = {
  tag: string
  when: number
  analysis: SqlAnalysis
}

export type MigrationState = {
  total: number
  appliedCount: number
  pending: PendingMigration[]
  lastAppliedAt: number | null
  error: string | null
}

type JournalEntry = { idx: number; when: number; tag: string }

/**
 * Migrations en attente = entrées du journal Drizzle plus récentes que la
 * dernière migration enregistrée en base (même règle que le migrateur).
 */
export async function getMigrationState(): Promise<MigrationState> {
  try {
    const journal = JSON.parse(
      await fs.readFile(path.join(FOLDER(), "meta", "_journal.json"), "utf8")
    ) as { entries: JournalEntry[] }

    let last: number | null = null
    try {
      const res = await db.$client.execute(
        "select created_at from __drizzle_migrations order by created_at desc limit 1"
      )
      const v = res.rows[0]?.created_at
      last = v === undefined || v === null ? null : Number(v)
    } catch {
      // table absente : base vierge, tout est en attente
    }

    const pendingEntries = journal.entries
      .filter((e) => last === null || e.when > last)
      .sort((a, b) => a.idx - b.idx)

    const pending: PendingMigration[] = []
    for (const e of pendingEntries) {
      const sql = await fs.readFile(path.join(FOLDER(), `${e.tag}.sql`), "utf8")
      pending.push({ tag: e.tag, when: e.when, analysis: analyzeSql(sql) })
    }

    return {
      total: journal.entries.length,
      appliedCount: journal.entries.length - pending.length,
      pending,
      lastAppliedAt: last,
      error: null,
    }
  } catch (e) {
    return {
      total: 0,
      appliedCount: 0,
      pending: [],
      lastAppliedAt: null,
      error: e instanceof Error ? e.message : "Journal illisible",
    }
  }
}

/** Sauvegarde cohérente d'une base SQLite fichier (VACUUM INTO). */
async function backupDatabase(): Promise<
  { ok: true; path: string } | { ok: false; reason: string }
> {
  if (!env.DATABASE_URL.startsWith("file:")) {
    return {
      ok: false,
      reason: "Base distante : sauvegarde à faire côté fournisseur.",
    }
  }
  try {
    const dir = path.join(process.cwd(), "data", "backups")
    await fs.mkdir(dir, { recursive: true })
    const stamp = new Date().toISOString().replace(/[:.]/g, "-")
    const file = path.join(dir, `app-${stamp}.db`)
    await db.$client.execute(`VACUUM INTO '${file.replace(/'/g, "''")}'`)
    return { ok: true, path: file }
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : "Erreur" }
  }
}

export type ApplyResult =
  | {
      ok: true
      applied: string[]
      backup: string | null
      backupNote: string | null
      runId: number
    }
  | {
      ok: false
      error: string
      code:
        | "none"
        | "changed"
        | "destructive"
        | "no_announcement"
        | "busy"
        | "failed"
    }

export type ApplyOptions = {
  actor: string
  /** Tags que l'administrateur a relus ; doivent correspondre exactement. */
  expectedTags?: string[]
  allowDestructive?: boolean
  /** Annonce de maintenance liée (mise à jour automatiquement). */
  announcementId?: string | null
}

const g = globalThis as unknown as { __deployBusy?: boolean }

/** Les tables de suivi peuvent être créées par la migration elle-même. */
async function tableExists(name: string) {
  try {
    const res = await db.$client.execute({
      sql: "select 1 from sqlite_master where type='table' and name=?",
      args: [name],
    })
    return res.rows.length > 0
  } catch {
    return false
  }
}

/**
 * Applique les migrations en attente avec garde-fous : liste relue, annonce
 * requise pour les changements destructifs, sauvegarde, journal, vérification
 * du résultat. Ne restaure jamais automatiquement.
 */
export async function applyPendingMigrations(
  opts: ApplyOptions
): Promise<ApplyResult> {
  if (g.__deployBusy) {
    return {
      ok: false,
      code: "busy",
      error: "Un déploiement est déjà en cours.",
    }
  }
  g.__deployBusy = true

  try {
    // Un autre processus (autre instance) ? Vérifiable seulement si la table
    // de suivi existe déjà (sinon c'est cette migration qui la créera).
    const runsReady = await tableExists("db_deploy_runs")
    const recent = runsReady
      ? await db
          .select({ id: schema.dbDeployRuns.id })
          .from(schema.dbDeployRuns)
          .where(
            and(
              eq(schema.dbDeployRuns.status, "running"),
              gte(
                schema.dbDeployRuns.startedAt,
                new Date(Date.now() - 10 * 60_000)
              )
            )
          )
      : []
    if (recent.length > 0) {
      return {
        ok: false,
        code: "busy",
        error: "Un déploiement est déjà marqué en cours (moins de 10 min).",
      }
    }

    const state = await getMigrationState()
    if (state.error) {
      return { ok: false, code: "failed", error: state.error }
    }
    if (state.pending.length === 0) {
      return { ok: false, code: "none", error: "Aucune migration en attente." }
    }

    const tags = state.pending.map((p) => p.tag)
    if (
      opts.expectedTags &&
      [...opts.expectedTags].sort().join("|") !== [...tags].sort().join("|")
    ) {
      return {
        ok: false,
        code: "changed",
        error:
          "La liste des migrations en attente a changé depuis ta relecture. Recharge la page.",
      }
    }

    const destructive = state.pending.filter(
      (p) => p.analysis.destructive.length > 0
    )
    let announcementId = opts.announcementId ?? null

    if (destructive.length > 0) {
      if (!opts.allowDestructive) {
        void logWarning({
          category: "database",
          title: "Migration destructive refusée (confirmation manquante)",
          service: "Base de données",
          action: "déploiement",
          result: "failure",
          meta: { migrations: destructive.map((d) => d.tag).join(", ") },
          dedupeKey: `deploy-refused:${destructive.map((d) => d.tag).join("|")}`,
        })
        return {
          ok: false,
          code: "destructive",
          error: `Migration(s) destructive(s) : ${destructive.map((d) => d.tag).join(", ")}. Confirme explicitement après revue manuelle.`,
        }
      }
      // Annonce de maintenance obligatoire (planifiée ou notifiée).
      const annReady = await tableExists("migration_announcements")
      const [ann] = !annReady
        ? []
        : announcementId
          ? await db
              .select()
              .from(schema.migrationAnnouncements)
              .where(eq(schema.migrationAnnouncements.id, announcementId))
          : await db
              .select()
              .from(schema.migrationAnnouncements)
              .where(
                and(
                  eq(schema.migrationAnnouncements.kind, "database"),
                  inArray(schema.migrationAnnouncements.status, [
                    "scheduled",
                    "notified",
                    "in_progress",
                  ])
                )
              )
              .orderBy(desc(schema.migrationAnnouncements.scheduledAt))
              .limit(1)
      if (
        !ann ||
        ann.kind !== "database" ||
        !["scheduled", "notified", "in_progress"].includes(ann.status)
      ) {
        return {
          ok: false,
          code: "no_announcement",
          error:
            "Migration destructive : programme d'abord une annonce de migration de base de données.",
        }
      }
      announcementId = ann.id
    }

    const backup = await backupDatabase()

    // Journal : si la table n'existe pas encore, l'entrée est écrite après coup.
    let runId = 0
    const startedAt = new Date()
    if (runsReady) {
      const [run] = await db
        .insert(schema.dbDeployRuns)
        .values({ actor: opts.actor, pending: tags })
        .returning({ id: schema.dbDeployRuns.id })
      runId = run.id
    }

    if (announcementId) {
      await db
        .update(schema.migrationAnnouncements)
        .set({ status: "in_progress" })
        .where(eq(schema.migrationAnnouncements.id, announcementId))
    }

    try {
      await migrate(db, { migrationsFolder: FOLDER() })

      // On ne conclut qu'après relecture de l'état réel.
      const after = await getMigrationState()
      if (after.pending.length > 0) {
        throw new Error(
          `Migrations toujours en attente après exécution : ${after.pending.map((p) => p.tag).join(", ")}`
        )
      }

      if (runId > 0) {
        await db
          .update(schema.dbDeployRuns)
          .set({ status: "success", finishedAt: new Date() })
          .where(eq(schema.dbDeployRuns.id, runId))
      } else if (await tableExists("db_deploy_runs")) {
        const [row] = await db
          .insert(schema.dbDeployRuns)
          .values({
            actor: opts.actor,
            pending: tags,
            startedAt,
            finishedAt: new Date(),
            status: "success",
          })
          .returning({ id: schema.dbDeployRuns.id })
        runId = row.id
      }
      if (announcementId) {
        await finishAnnouncement(
          announcementId,
          true,
          `Migrations appliquées : ${tags.join(", ")}`,
          { id: "", email: opts.actor }
        ).catch(() => {})
      }
      void logSuccess({
        category: "database",
        title: "Migrations de base de données appliquées",
        service: "Base de données",
        action: "déploiement",
        result: "success",
        meta: {
          migrations: tags.join(", "),
          sauvegarde: backup.ok ? "oui" : "non",
        },
        dedupeKey: `deploy-ok:${tags.join("|")}`,
      })
      return {
        ok: true,
        applied: tags,
        backup: backup.ok ? backup.path : null,
        backupNote: backup.ok ? null : backup.reason,
        runId,
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : "Erreur"
      if (runId > 0) {
        await db
          .update(schema.dbDeployRuns)
          .set({ status: "failed", finishedAt: new Date(), error: message })
          .where(eq(schema.dbDeployRuns.id, runId))
      }
      if (announcementId) {
        await finishAnnouncement(announcementId, false, message, {
          id: "",
          email: opts.actor,
        }).catch(() => {})
      }
      void logCritical({
        category: "database",
        title: "Échec d'une migration de base de données",
        service: "Base de données",
        action: "déploiement",
        result: "failure",
        message,
        meta: {
          migrations: tags.join(", "),
          sauvegarde: backup.ok ? "disponible" : "aucune",
        },
        dedupeKey: `deploy-ko:${tags.join("|")}`,
      })
      return {
        ok: false,
        code: "failed",
        error: `${message}${backup.ok ? ` — sauvegarde disponible : ${backup.path}` : ""}`,
      }
    }
  } finally {
    g.__deployBusy = false
  }
}

export async function recentDeployRuns(limit = 10) {
  return db
    .select()
    .from(schema.dbDeployRuns)
    .orderBy(desc(schema.dbDeployRuns.id))
    .limit(limit)
}
