import "server-only"

import { timingSafeEqual } from "node:crypto"

import { env } from "@/lib/env"
import {
  applyPendingMigrations,
  getMigrationState,
} from "@/lib/migrations/deploy"

export const dynamic = "force-dynamic"

function isAuthorized(request: Request) {
  if (!env.ADMIN_TOKEN) return false
  const header = request.headers.get("authorization") ?? ""
  const given = Buffer.from(header.replace(/^Bearer\s+/i, ""))
  const expected = Buffer.from(env.ADMIN_TOKEN)
  return given.length === expected.length && timingSafeEqual(given, expected)
}

function guard(request: Request) {
  if (!env.ADMIN_TOKEN) {
    return Response.json(
      { ok: false, error: "ADMIN_TOKEN non configuré" },
      { status: 503 }
    )
  }
  if (!isAuthorized(request)) {
    return Response.json({ ok: false, error: "Non autorisé" }, { status: 401 })
  }
  return null
}

/**
 * Migrations en attente (lecture seule) :
 *
 *   curl "$URL/api/admin/db/deploy" -H "Authorization: Bearer $ADMIN_TOKEN"
 */
export async function GET(request: Request) {
  const denied = guard(request)
  if (denied) return denied

  const state = await getMigrationState()
  return Response.json({
    ok: !state.error,
    error: state.error,
    pending: state.pending.map((p) => ({
      tag: p.tag,
      statements: p.analysis.statements,
      destructive: p.analysis.destructive,
    })),
  })
}

/**
 * Applique les migrations en attente.
 *
 *   curl -X POST "$URL/api/admin/db/deploy" \
 *     -H "Authorization: Bearer $ADMIN_TOKEN"
 *
 * Les migrations destructives sont REFUSÉES sauf si le corps JSON contient
 * `{"allowDestructive": true}` ET qu'une annonce de migration de base de
 * données est programmée. `{"tags": [...]}` (facultatif) impose la liste relue.
 */
export async function POST(request: Request) {
  const denied = guard(request)
  if (denied) return denied

  const body = (await request.json().catch(() => ({}))) as {
    tags?: unknown
    allowDestructive?: unknown
    announcementId?: unknown
  }

  const result = await applyPendingMigrations({
    actor: "api:ADMIN_TOKEN",
    expectedTags: Array.isArray(body.tags)
      ? body.tags.filter((t): t is string => typeof t === "string")
      : undefined,
    allowDestructive: body.allowDestructive === true,
    announcementId:
      typeof body.announcementId === "string" ? body.announcementId : null,
  })

  if (!result.ok) {
    // « Rien à faire » reste un succès côté déploiement automatisé.
    if (result.code === "none") {
      return Response.json({ ok: true, migrated: false, message: result.error })
    }
    const status =
      result.code === "destructive" ||
      result.code === "no_announcement" ||
      result.code === "changed"
        ? 409
        : result.code === "busy"
          ? 423
          : 500
    console.error("[db/deploy]", result.error)
    return Response.json(
      { ok: false, code: result.code, error: result.error },
      { status }
    )
  }

  return Response.json({
    ok: true,
    migrated: true,
    applied: result.applied,
    backup: result.backup,
    backupNote: result.backupNote,
  })
}
