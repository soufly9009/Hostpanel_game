import type { Client, Transaction } from "@libsql/client"

/**
 * SQLite local : le pilote libsql est synchrone et chaque transaction prend
 * sa propre connexion. Une écriture concurrente pendant une transaction
 * ouverte échoue donc immédiatement (SQLITE_BUSY), et un délai d'attente ne
 * peut pas aider (il bloquerait la boucle d'événements, donc aussi la
 * transaction qui détient le verrou).
 *
 * On sérialise ici toutes les opérations du client dans le processus : une
 * requête attend son tour ; une transaction garde la main jusqu'à son commit,
 * rollback ou close. À ne PAS utiliser `db` (hors `tx`) dans une transaction.
 */
export function serializeClient(client: Client): Client {
  let tail: Promise<void> = Promise.resolve()

  const acquire = () => {
    let release!: () => void
    const held = new Promise<void>((r) => (release = r))
    const ready = tail
    tail = tail.then(() => held)
    return ready.then(() => release)
  }

  const run = async <T>(fn: () => Promise<T>) => {
    const release = await acquire()
    try {
      return await fn()
    } finally {
      release()
    }
  }

  const holdUntilSettled = (
    tx: Transaction,
    release: () => void
  ): Transaction => {
    let done = false
    const finish = () => {
      if (!done) {
        done = true
        release()
      }
    }
    return new Proxy(tx, {
      get(target, prop) {
        const value = Reflect.get(target, prop, target)
        if (prop === "commit" || prop === "rollback") {
          return async () => {
            try {
              return await (value as () => Promise<void>).call(target)
            } finally {
              finish()
            }
          }
        }
        if (prop === "close") {
          return () => {
            try {
              return (value as () => void).call(target)
            } finally {
              finish()
            }
          }
        }
        return typeof value === "function" ? value.bind(target) : value
      },
    })
  }

  return new Proxy(client, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target)
      if (typeof value !== "function") return value
      if (prop === "transaction") {
        return async (...args: unknown[]) => {
          const release = await acquire()
          try {
            const tx = await (
              value as (...a: unknown[]) => Promise<Transaction>
            ).apply(target, args)
            return holdUntilSettled(tx, release)
          } catch (e) {
            release()
            throw e
          }
        }
      }
      if (
        prop === "execute" ||
        prop === "batch" ||
        prop === "executeMultiple" ||
        prop === "migrate"
      ) {
        return (...args: unknown[]) =>
          run(() =>
            (value as (...a: unknown[]) => Promise<unknown>).apply(target, args)
          )
      }
      return value.bind(target)
    },
  })
}
