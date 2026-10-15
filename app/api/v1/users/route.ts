import { count, desc, eq, like, or } from "drizzle-orm"

import { authenticateApi } from "@/lib/api/auth"
import { pageParams, toApiUser } from "@/lib/api/respond"
import { db, schema } from "@/lib/db"

export const dynamic = "force-dynamic"

/** Liste des comptes : ?email= (exact) ou ?q= (e-mail/nom), paginée. */
export async function GET(request: Request) {
  const auth = await authenticateApi(request, "users:read")
  if (auth instanceof Response) return auth

  const url = new URL(request.url)
  const { limit, offset } = pageParams(url)
  const email = url.searchParams.get("email")?.trim().toLowerCase()
  const q = url.searchParams.get("q")?.trim().slice(0, 80)
  const U = schema.users
  const where = email
    ? eq(U.email, email)
    : q
      ? or(like(U.email, `%${q}%`), like(U.name, `%${q}%`))
      : undefined

  const [[{ total }], rows] = await Promise.all([
    db.select({ total: count() }).from(U).where(where),
    db
      .select()
      .from(U)
      .where(where)
      .orderBy(desc(U.createdAt))
      .limit(limit)
      .offset(offset),
  ])
  return Response.json({
    ok: true,
    total,
    limit,
    offset,
    users: rows.map(toApiUser),
  })
}
