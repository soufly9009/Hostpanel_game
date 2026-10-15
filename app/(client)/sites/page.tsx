import Link from "next/link"
import { desc, eq } from "drizzle-orm"

import { CreateSiteForm } from "@/components/create-site-form"
import { requireUser } from "@/lib/auth/session"
import { db, schema } from "@/lib/db"
import { env, pleskConfigured } from "@/lib/env"

export const metadata = { title: "Mes sites" }
export const dynamic = "force-dynamic"

export default async function SitesPage() {
  const user = await requireUser()

  const sites = await db
    .select()
    .from(schema.sites)
    .where(eq(schema.sites.userId, user.id))
    .orderBy(desc(schema.sites.createdAt))

  const limit = user.role === "admin" ? null : env.PLESK_SITE_LIMIT
  const full = limit !== null && sites.length >= limit

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">Mes sites</h1>
        <p className="text-sm text-muted-foreground">
          {sites.length}
          {limit !== null ? ` / ${limit}` : ""} site(s)
        </p>
      </div>

      {!pleskConfigured && (
        <p className="rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm">
          Plesk n&apos;est pas configuré (PLESK_URL et PLESK_API_KEY).
        </p>
      )}

      <section className="rounded-xl border p-4">
        <h2 className="mb-3 font-medium">Nouveau site</h2>
        <CreateSiteForm disabled={!pleskConfigured || full} />
        {full && (
          <p className="mt-2 text-xs text-muted-foreground">
            Limite de sites atteinte.
          </p>
        )}
      </section>

      {sites.length > 0 && (
        <ul className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {sites.map((s) => (
            <li key={s.id}>
              <Link
                href={`/sites/${s.id}`}
                className="block rounded-xl border p-4 transition-colors hover:bg-muted/50"
              >
                <p className="truncate font-medium">{s.domain}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {s.sslIssuedAt ? "SSL actif" : "Sans SSL"}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </>
  )
}
