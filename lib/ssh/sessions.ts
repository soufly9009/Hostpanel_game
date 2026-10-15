import "server-only"

import { randomBytes } from "node:crypto"

import { Client, type ClientChannel } from "ssh2"

/**
 * Sessions SSH ouvertes par le serveur du site pour le terminal web.
 * Elles vivent en mémoire (instance Node unique) et expirent seules.
 * Les identifiants ne sont jamais stockés ni journalisés.
 */

const IDLE_MS = 15 * 60 * 1000
const MAX_AGE_MS = 4 * 60 * 60 * 1000
const BACKLOG_BYTES = 64 * 1024
export const MAX_SESSIONS_PER_USER = 3

type Listener = (chunk: Buffer | null) => void

type Session = {
  id: string
  userId: string
  serverId: string
  client: Client
  stream: ClientChannel
  listeners: Set<Listener>
  /** Sortie reçue avant l'abonnement du navigateur. */
  backlog: Buffer[]
  backlogSize: number
  closed: boolean
  lastActive: number
  createdAt: number
}

type Store = {
  sessions: Map<string, Session>
  failures: Map<string, number[]>
  reaper?: NodeJS.Timeout
}

const g = globalThis as unknown as { __ssh?: Store }
const store: Store = (g.__ssh ??= { sessions: new Map(), failures: new Map() })

function startReaper() {
  if (store.reaper) return
  store.reaper = setInterval(() => {
    const now = Date.now()
    for (const s of store.sessions.values()) {
      if (now - s.lastActive > IDLE_MS || now - s.createdAt > MAX_AGE_MS) {
        closeSession(s.id)
      }
    }
  }, 60_000)
  store.reaper.unref?.()
}

export class SshError extends Error {
  constructor(
    message: string,
    public code:
      | "auth"
      | "hostkey_changed"
      | "unreachable"
      | "rate_limited"
      | "too_many"
      | "failed"
  ) {
    super(message)
  }
}

/* ───── Anti brute-force : 5 échecs / 10 min par utilisateur et VPS ───── */

const WINDOW = 10 * 60 * 1000
const MAX_FAILURES = 5

function recentFailures(key: string) {
  const now = Date.now()
  const list = (store.failures.get(key) ?? []).filter((t) => now - t < WINDOW)
  store.failures.set(key, list)
  return list
}

export function assertNotRateLimited(userId: string, serverId: string) {
  if (recentFailures(`${userId}:${serverId}`).length >= MAX_FAILURES) {
    throw new SshError(
      "Trop de tentatives échouées. Réessaie dans quelques minutes.",
      "rate_limited"
    )
  }
}

function recordFailure(userId: string, serverId: string) {
  recentFailures(`${userId}:${serverId}`).push(Date.now())
}

/* ───── Ouverture / pilotage ───── */

export function countSessions(userId: string) {
  let n = 0
  for (const s of store.sessions.values()) if (s.userId === userId) n++
  return n
}

export function getSession(id: string, userId: string) {
  const s = store.sessions.get(id)
  return s && s.userId === userId && !s.closed ? s : null
}

export async function openSession(opts: {
  userId: string
  serverId: string
  host: string
  port?: number
  username: string
  password: string
  cols: number
  rows: number
  /** Empreinte SHA-256 (hex) déjà connue : refus si elle change. */
  expectedFingerprint: string | null
}): Promise<{ id: string; fingerprint: string }> {
  startReaper()
  assertNotRateLimited(opts.userId, opts.serverId)
  if (countSessions(opts.userId) >= MAX_SESSIONS_PER_USER) {
    throw new SshError(
      `${MAX_SESSIONS_PER_USER} sessions SSH maximum en même temps.`,
      "too_many"
    )
  }

  const client = new Client()
  let fingerprint = ""
  let hostKeyRejected = false

  return new Promise((resolve, reject) => {
    const fail = (err: SshError) => {
      client.removeAllListeners()
      client.on("error", () => {})
      client.destroy()
      reject(err)
    }

    client
      .on("ready", () => {
        client.shell(
          { term: "xterm-256color", cols: opts.cols, rows: opts.rows },
          (err, stream) => {
            if (err) return fail(new SshError("Shell indisponible", "failed"))

            const id = randomBytes(24).toString("base64url")
            const session: Session = {
              id,
              userId: opts.userId,
              serverId: opts.serverId,
              client,
              stream,
              listeners: new Set(),
              backlog: [],
              backlogSize: 0,
              closed: false,
              lastActive: Date.now(),
              createdAt: Date.now(),
            }
            store.sessions.set(id, session)

            stream.on("data", (chunk: Buffer) => {
              session.lastActive = Date.now()
              if (session.listeners.size === 0) {
                session.backlog.push(chunk)
                session.backlogSize += chunk.length
                while (session.backlogSize > BACKLOG_BYTES) {
                  session.backlogSize -= session.backlog.shift()!.length
                }
              } else {
                for (const l of session.listeners) l(chunk)
              }
            })
            stream.on("close", () => closeSession(id))
            client.on("close", () => closeSession(id))
            client.on("error", () => closeSession(id))

            resolve({ id, fingerprint })
          }
        )
      })
      .on("keyboard-interactive", (_n, _i, _l, prompts, finish) => {
        finish(prompts.map(() => opts.password))
      })
      .on("error", (err: Error & { level?: string }) => {
        if (hostKeyRejected) {
          recordFailure(opts.userId, opts.serverId)
          return fail(
            new SshError(
              "L'empreinte du serveur a changé (réinstallation ou usurpation possible).",
              "hostkey_changed"
            )
          )
        }
        if (err.level === "client-authentication") {
          recordFailure(opts.userId, opts.serverId)
          return fail(new SshError("Identifiants refusés.", "auth"))
        }
        if (err.level === "client-timeout" || err.level === "client-socket") {
          return fail(
            new SshError(
              "Impossible de joindre le VPS (démarré ? pare-feu sur le port 22 ?).",
              "unreachable"
            )
          )
        }
        fail(new SshError(`Connexion SSH échouée : ${err.message}`, "failed"))
      })
      .connect({
        host: opts.host,
        port: opts.port ?? 22,
        username: opts.username,
        password: opts.password,
        tryKeyboard: true,
        readyTimeout: 12_000,
        keepaliveInterval: 15_000,
        hostHash: "sha256",
        hostVerifier: (hash: string) => {
          fingerprint = hash
          if (opts.expectedFingerprint && opts.expectedFingerprint !== hash) {
            hostKeyRejected = true
            return false
          }
          return true
        },
      })
  })
}

export function subscribe(session: Session, listener: Listener) {
  // Rejoue ce qui est arrivé avant l'abonnement.
  for (const chunk of session.backlog) listener(chunk)
  session.backlog = []
  session.backlogSize = 0
  session.listeners.add(listener)
  return () => {
    session.listeners.delete(listener)
  }
}

export function writeInput(session: Session, data: string) {
  session.lastActive = Date.now()
  session.stream.write(data)
}

export function resize(session: Session, cols: number, rows: number) {
  session.lastActive = Date.now()
  session.stream.setWindow(rows, cols, 0, 0)
}

export function closeSession(id: string) {
  const s = store.sessions.get(id)
  if (!s || s.closed) return
  s.closed = true
  store.sessions.delete(id)
  for (const l of s.listeners) l(null)
  s.listeners.clear()
  try {
    s.stream.end()
    s.client.end()
  } catch {
    // déjà fermé
  }
}
