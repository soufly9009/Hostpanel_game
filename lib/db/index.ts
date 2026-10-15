import "server-only"

import { createClient } from "@libsql/client"
import { drizzle } from "drizzle-orm/libsql"

import { env } from "@/lib/env"

import * as schema from "./schema"
import { serializeClient } from "./serialize"

const globalForDb = globalThis as unknown as {
  dbClient?: ReturnType<typeof createClient>
}

function connect() {
  const raw = createClient({
    url: env.DATABASE_URL,
    authToken: env.DATABASE_AUTH_TOKEN,
  })
  // SQLite local : opérations sérialisées (sinon SQLITE_BUSY dès qu'une
  // écriture croise une transaction ouverte). Voir serialize.ts.
  return env.DATABASE_URL.startsWith("file:") ? serializeClient(raw) : raw
}

const client = globalForDb.dbClient ?? connect()

if (process.env.NODE_ENV !== "production") globalForDb.dbClient = client

export const db = drizzle(client, { schema })
export { schema }
