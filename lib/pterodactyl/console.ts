import "server-only"

import { env } from "@/lib/env"

import { getConsoleCredentials } from "./client"

/**
 * Console des serveurs de jeu : le SERVEUR du panel se connecte au websocket
 * Wings (jeton obtenu par l'API Client) et redistribue la sortie aux
 * navigateurs en SSE. Le navigateur ne voit jamais ni jeton ni adresse Wings.
 * Une connexion par serveur, partagée entre les onglets ; fermée 30 s après
 * le départ du dernier spectateur. Instance unique (état sur globalThis).
 */

export type ConsoleEvent =
  | { type: "line"; data: string }
  | { type: "status"; data: string }
  | { type: "reset" }
  | { type: "error"; data: string }

type Listener = (e: ConsoleEvent) => void

type Conn = {
  identifier: string
  ws: WebSocket | null
  lines: string[]
  status: string | null
  listeners: Set<Listener>
  idle: ReturnType<typeof setTimeout> | null
  retries: number
  closed: boolean
}

const MAX_LINES = 400
const g = globalThis as unknown as { __pteroConsoles?: Map<string, Conn> }
const conns = (g.__pteroConsoles ??= new Map())

function emit(c: Conn, e: ConsoleEvent) {
  for (const l of c.listeners) {
    try {
      l(e)
    } catch {
      // abonné fermé
    }
  }
}

function push(c: Conn, line: string) {
  c.lines.push(line)
  if (c.lines.length > MAX_LINES) c.lines.splice(0, c.lines.length - MAX_LINES)
  emit(c, { type: "line", data: line })
}

async function connect(c: Conn) {
  if (c.closed) return
  let creds: { token: string; socket: string }
  try {
    creds = await getConsoleCredentials(c.identifier)
  } catch (e) {
    emit(c, {
      type: "error",
      data: e instanceof Error ? e.message : "Console indisponible",
    })
    return scheduleReconnect(c)
  }
  if (c.closed) return

  // Wings vérifie l'origine : celle du panel Pterodactyl.
  const ws = new WebSocket(creds.socket, {
    headers: { Origin: env.PTERODACTYL_URL ?? "" },
  } as unknown as string[])
  c.ws = ws
  const send = (event: string, args: unknown[] = []) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ event, args }))
    }
  }

  ws.onopen = () => send("auth", [creds.token])
  ws.onmessage = async (msg) => {
    let m: { event?: string; args?: unknown[] }
    try {
      m = JSON.parse(String(msg.data))
    } catch {
      return
    }
    const arg = typeof m.args?.[0] === "string" ? (m.args[0] as string) : ""
    switch (m.event) {
      case "auth success":
        c.retries = 0
        // Wings renvoie l'historique récent : on repart d'une console vide.
        c.lines = []
        emit(c, { type: "reset" })
        send("send logs", [null])
        break
      case "console output":
      case "install output":
        push(c, arg)
        break
      case "status":
        c.status = arg
        emit(c, { type: "status", data: arg })
        break
      case "token expiring":
        try {
          const next = await getConsoleCredentials(c.identifier)
          send("auth", [next.token])
        } catch {
          // la reconnexion prendra le relais à l'expiration
        }
        break
      case "token expired":
      case "jwt error":
        ws.close()
        break
      case "daemon error":
        emit(c, { type: "error", data: arg || "Erreur du démon" })
        break
    }
  }
  ws.onerror = () => undefined
  ws.onclose = () => {
    if (c.ws === ws) c.ws = null
    scheduleReconnect(c)
  }
}

function scheduleReconnect(c: Conn) {
  if (c.closed || c.listeners.size === 0) return
  c.retries++
  if (c.retries > 6) {
    emit(c, { type: "error", data: "Console déconnectée." })
    return
  }
  setTimeout(() => void connect(c), Math.min(30_000, 2_000 * c.retries))
}

function close(key: string, c: Conn) {
  c.closed = true
  try {
    c.ws?.close()
  } catch {
    // déjà fermé
  }
  conns.delete(key)
}

/** S'abonne à la console du serveur ; renvoie la fonction de désabonnement. */
export function subscribeConsole(
  game: { id: string; pteroIdentifier: string },
  listener: Listener
) {
  let c = conns.get(game.id)
  if (!c) {
    c = {
      identifier: game.pteroIdentifier,
      ws: null,
      lines: [],
      status: null,
      listeners: new Set(),
      idle: null,
      retries: 0,
      closed: false,
    }
    conns.set(game.id, c)
    void connect(c)
  }
  const conn = c
  if (conn.idle) {
    clearTimeout(conn.idle)
    conn.idle = null
  }
  // Rattrapage : historique déjà reçu.
  for (const line of conn.lines) listener({ type: "line", data: line })
  if (conn.status) listener({ type: "status", data: conn.status })
  conn.listeners.add(listener)

  return () => {
    conn.listeners.delete(listener)
    if (conn.listeners.size === 0 && !conn.idle) {
      conn.idle = setTimeout(() => close(game.id, conn), 30_000)
    }
  }
}

/** Ferme la console d'un serveur (suppression, suspension). */
export function closeConsole(gameId: string) {
  const c = conns.get(gameId)
  if (c) close(gameId, c)
}
