import "server-only"

import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

import { env } from "@/lib/env"

import * as schema from "./schema"

const globalForDb = globalThis as unknown as {
  libsql?: ReturnType<typeof createClient>
}

const client =
  globalForDb.libsql ??
  createClient({ url: env.DATABASE_URL, authToken: env.DATABASE_AUTH_TOKEN })

if (process.env.NODE_ENV !== "production") globalForDb.libsql = client

export const db = drizzle(client, { schema })
export { schema }
