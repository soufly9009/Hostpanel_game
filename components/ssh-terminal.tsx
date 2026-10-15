"use client"

import "@xterm/xterm/css/xterm.css"

import { useCallback, useEffect, useRef, useState } from "react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { forgetSshHostKey, repairRootSsh } from "@/lib/servers/actions"

import type { Terminal } from "@xterm/xterm"
import type { FitAddon } from "@xterm/addon-fit"

type Status = "idle" | "connecting" | "connected" | "closed"

function base64ToBytes(b64: string) {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

export function SshTerminal({
  serverId,
  host,
  disabled,
}: {
  serverId: string
  host: string | null
  disabled: boolean
}) {
  const [status, setStatus] = useState<Status>("idle")
  const [error, setError] = useState<string | null>(null)
  const [hostKeyChanged, setHostKeyChanged] = useState(false)
  const [info, setInfo] = useState<string | null>(null)
  const [authFailed, setAuthFailed] = useState(false)
  const [repairing, setRepairing] = useState(false)

  const container = useRef<HTMLDivElement>(null)
  const term = useRef<Terminal | null>(null)
  const fit = useRef<FitAddon | null>(null)
  const source = useRef<EventSource | null>(null)
  const sessionId = useRef<string | null>(null)
  const sendChain = useRef<Promise<unknown>>(Promise.resolve())
  const resizeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const teardown = useCallback((remote: boolean) => {
    source.current?.close()
    source.current = null
    if (remote && sessionId.current) {
      void fetch(`/api/ssh/${sessionId.current}`, { method: "DELETE" })
    }
    sessionId.current = null
    term.current?.dispose()
    term.current = null
    fit.current = null
  }, [])

  // Ferme proprement en quittant la page.
  useEffect(() => () => teardown(true), [teardown])

  const sendInput = useCallback((data: string) => {
    // Chaîne séquentielle : l'ordre des frappes doit être conservé.
    sendChain.current = sendChain.current.then(() => {
      const id = sessionId.current
      if (!id) return
      return fetch(`/api/ssh/${id}/input`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ data }),
      }).catch(() => {})
    })
  }, [])

  async function connect(form: FormData) {
    setError(null)
    setHostKeyChanged(false)
    setInfo(null)
    setStatus("connecting")

    const [{ Terminal }, { FitAddon }] = await Promise.all([
      import("@xterm/xterm"),
      import("@xterm/addon-fit"),
    ])

    const t = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
      theme: { background: "#0b0d10" },
      scrollback: 5000,
    })
    const f = new FitAddon()
    t.loadAddon(f)
    term.current = t
    fit.current = f

    // Le conteneur est monté pendant la connexion pour mesurer la taille réelle.
    await new Promise((r) => setTimeout(r, 0))
    if (container.current) {
      t.open(container.current)
      f.fit()
    }

    let res: Response
    try {
      res = await fetch(`/api/servers/${serverId}/ssh`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: String(form.get("username") ?? ""),
          password: String(form.get("password") ?? ""),
          cols: t.cols,
          rows: t.rows,
        }),
      })
    } catch {
      teardown(false)
      setStatus("idle")
      setError("Réseau indisponible.")
      return
    }

    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      teardown(false)
      setStatus("idle")
      setError(json.error ?? `Erreur ${res.status}`)
      setHostKeyChanged(json.code === "hostkey_changed")
      setAuthFailed(json.code === "auth")
      return
    }

    sessionId.current = json.sessionId
    if (json.firstConnection && json.fingerprint) {
      setInfo(
        `Première connexion : empreinte SHA-256 mémorisée (${String(json.fingerprint).slice(0, 16)}…).`
      )
    }

    const es = new EventSource(`/api/ssh/${json.sessionId}/stream`)
    source.current = es
    es.onmessage = (e) => t.write(base64ToBytes(e.data))
    es.addEventListener("close", () => {
      t.write("\r\n\x1b[33m[connexion fermée]\x1b[0m\r\n")
      es.close()
      source.current = null
      sessionId.current = null
      setStatus("closed")
    })
    es.onerror = () => {
      // Le navigateur retente seul ; si la session n'existe plus, on s'arrête.
      if (es.readyState === EventSource.CLOSED) setStatus("closed")
    }

    t.onData((d) => sendInput(d))
    t.onResize(({ cols, rows }) => {
      if (resizeTimer.current) clearTimeout(resizeTimer.current)
      resizeTimer.current = setTimeout(() => {
        const id = sessionId.current
        if (!id) return
        void fetch(`/api/ssh/${id}/resize`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ cols, rows }),
        })
      }, 150)
    })

    const ro = new ResizeObserver(() => fit.current?.fit())
    if (container.current) ro.observe(container.current)

    setStatus("connected")
    t.focus()
  }

  const connected = status === "connecting" || status === "connected"

  return (
    <section className="rounded-xl border">
      <header className="flex flex-wrap items-center gap-3 border-b p-4">
        <h2 className="font-medium">Terminal SSH</h2>
        <span className="font-mono text-xs text-muted-foreground">
          {host ?? "adresse inconnue"}
        </span>
        {status === "connected" && (
          <Button
            size="sm"
            variant="outline"
            className="ml-auto"
            onClick={() => {
              teardown(true)
              setStatus("closed")
            }}
          >
            Déconnecter
          </Button>
        )}
      </header>

      <div className="flex flex-col gap-3 p-4">
        {!connected && (
          <form
            className="flex flex-wrap items-end gap-3"
            onSubmit={(e) => {
              e.preventDefault()
              void connect(new FormData(e.currentTarget))
            }}
          >
            <label className="flex flex-col gap-1 text-xs">
              Utilisateur
              <Input
                name="username"
                defaultValue="root"
                autoComplete="username"
                className="w-40"
                required
              />
            </label>
            <label className="flex flex-col gap-1 text-xs">
              Mot de passe
              <Input
                name="password"
                type="password"
                autoComplete="current-password"
                className="w-56"
                required
              />
            </label>
            <Button type="submit" disabled={disabled || !host}>
              {status === "closed" ? "Se reconnecter" : "Se connecter"}
            </Button>
            <p className="basis-full text-xs text-muted-foreground">
              Les identifiants ne sont ni enregistrés ni journalisés. Le VPS
              doit être démarré et le port 22 autorisé dans le pare-feu.
            </p>
          </form>
        )}

        {error && (
          <div role="alert" className="text-sm text-destructive">
            <p>{error}</p>
            {authFailed && (
              <div className="mt-2 flex flex-col gap-2">
                <p className="text-xs text-muted-foreground">
                  Si le mot de passe est correct, la connexion root par mot de
                  passe est peut-être désactivée dans le conteneur.
                </p>
                <Button
                  size="sm"
                  variant="outline"
                  className="w-fit"
                  disabled={repairing}
                  onClick={async () => {
                    setRepairing(true)
                    const res = await repairRootSsh(serverId)
                    setRepairing(false)
                    if (res?.error) {
                      setError(res.error)
                      return
                    }
                    setError(null)
                    setAuthFailed(false)
                    setInfo(
                      "Connexion root autorisée : réessaie de te connecter."
                    )
                  }}
                >
                  {repairing ? "Réparation…" : "Autoriser la connexion root"}
                </Button>
              </div>
            )}
            {hostKeyChanged && (
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                onClick={async () => {
                  await forgetSshHostKey(serverId)
                  setError(null)
                  setHostKeyChanged(false)
                  setInfo(
                    "Empreinte oubliée : la prochaine connexion la mémorisera."
                  )
                }}
              >
                Oublier l&apos;empreinte et réessayer
              </Button>
            )}
          </div>
        )}
        {info && <p className="text-xs text-muted-foreground">{info}</p>}

        <div
          ref={container}
          className={
            connected || status === "closed"
              ? "h-[420px] overflow-hidden rounded-lg bg-[#0b0d10] p-2"
              : "hidden"
          }
        />
      </div>
    </section>
  )
}
