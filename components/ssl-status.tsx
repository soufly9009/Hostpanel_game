"use client"

import { useCallback, useEffect, useState } from "react"

import { ErrorState, StatusBadge } from "@/components/kit"
import { Button } from "@/components/ui/button"

type Cert = {
  state:
    | "valid"
    | "expiring"
    | "expired"
    | "untrusted"
    | "mismatch"
    | "none"
    | "unreachable"
  issuer: string | null
  validFrom: string | null
  validTo: string | null
  daysLeft: number | null
  names: string[]
  error: string | null
}
type Payload = { cert: Cert; lastError: string | null }

const LABEL: Record<
  Cert["state"],
  { text: string; tone: "success" | "warning" | "danger" | "neutral" }
> = {
  valid: { text: "Valide", tone: "success" },
  expiring: { text: "Expire bientôt", tone: "warning" },
  expired: { text: "Expiré", tone: "danger" },
  untrusted: { text: "Non approuvé", tone: "danger" },
  mismatch: { text: "Domaine non couvert", tone: "danger" },
  none: { text: "Aucun certificat", tone: "neutral" },
  unreachable: { text: "Injoignable", tone: "neutral" },
}

export function SslStatus({
  siteId,
  refreshKey,
}: {
  siteId: string
  /** Change après une émission pour relancer la vérification. */
  refreshKey: number
}) {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch(`/api/sites/${siteId}/ssl`, { cache: "no-store" })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? `Erreur ${res.status}`)
      setData(json)
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur")
    } finally {
      setLoading(false)
    }
  }, [siteId])

  useEffect(() => {
    // Synchronisation avec une source externe (sonde TLS du serveur).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load()
  }, [load, refreshKey])

  if (error)
    return <ErrorState title="Vérification impossible" message={error} />
  if (!data) {
    return (
      <p className="text-sm text-muted-foreground">
        {loading ? "Vérification du certificat…" : "Aucune donnée."}
      </p>
    )
  }

  const { cert, lastError } = data
  const label = LABEL[cert.state]

  return (
    <div className="flex flex-col gap-3 text-sm">
      <div className="flex flex-wrap items-center gap-3">
        <StatusBadge tone={label.tone}>{label.text}</StatusBadge>
        {cert.daysLeft !== null && cert.state !== "expired" && (
          <span className="text-muted-foreground">
            expire dans {cert.daysLeft} jour{cert.daysLeft > 1 ? "s" : ""}
          </span>
        )}
        <Button
          size="xs"
          variant="ghost"
          disabled={loading}
          onClick={() => void load()}
        >
          {loading ? "…" : "Revérifier"}
        </Button>
      </div>

      <dl className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
        {cert.issuer && (
          <div>
            <dt className="text-muted-foreground">Émetteur</dt>
            <dd>{cert.issuer}</dd>
          </div>
        )}
        {cert.validFrom && cert.validTo && (
          <div>
            <dt className="text-muted-foreground">Validité</dt>
            <dd>
              {new Date(cert.validFrom).toLocaleDateString("fr-FR")} →{" "}
              {new Date(cert.validTo).toLocaleDateString("fr-FR")}
            </dd>
          </div>
        )}
        {cert.names.length > 0 && (
          <div className="sm:col-span-2">
            <dt className="text-muted-foreground">Domaines couverts</dt>
            <dd className="font-mono break-all">{cert.names.join(", ")}</dd>
          </div>
        )}
      </dl>

      {cert.error && cert.state !== "valid" && (
        <p className="text-xs text-muted-foreground">Détail : {cert.error}</p>
      )}
      {lastError && (
        <p role="alert" className="text-xs text-destructive">
          Dernière tentative d&apos;émission : {lastError}
        </p>
      )}
    </div>
  )
}
