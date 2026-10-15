"use client"

import { useRef, useState, useTransition } from "react"
import { useRouter } from "next/navigation"

import { SslStatus } from "@/components/ssl-status"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { deleteSite, issueSsl } from "@/lib/sites/actions"

export function SitePanel({
  siteId,
  domain,
  sslIssuedAt,
}: {
  siteId: string
  domain: string
  /** ISO ; null = pas encore de certificat émis depuis le site. */
  sslIssuedAt: string | null
}) {
  const router = useRouter()
  const [sslRefresh, setSslRefresh] = useState(0)
  const [sslError, setSslError] = useState<string | null>(null)
  const [sslPending, startSsl] = useTransition()
  const [delPending, startDel] = useTransition()
  const [delError, setDelError] = useState<string | null>(null)

  const fileInput = useRef<HTMLInputElement>(null)
  const [uploading, setUploading] = useState(false)
  const [upload, setUpload] = useState<{ ok: boolean; text: string } | null>(
    null
  )

  async function onUpload(form: FormData) {
    setUpload(null)
    const files = fileInput.current?.files
    if (!files || files.length === 0) {
      setUpload({ ok: false, text: "Choisis au moins un fichier." })
      return
    }
    setUploading(true)
    try {
      const res = await fetch(`/api/sites/${siteId}/files`, {
        method: "POST",
        body: form,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        setUpload({ ok: false, text: json.error ?? `Erreur ${res.status}` })
      } else {
        setUpload({
          ok: true,
          text: `${json.uploaded} fichier(s) envoyé(s) dans httpdocs.`,
        })
        if (fileInput.current) fileInput.current.value = ""
      }
    } catch {
      setUpload({ ok: false, text: "Réseau indisponible." })
    } finally {
      setUploading(false)
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <section className="rounded-xl border p-4">
        <h2 className="font-medium">Certificat SSL</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Certificat Let&apos;s Encrypt gratuit pour {domain} et www.{domain}.
          Le DNS du domaine doit déjà pointer vers le serveur
          d&apos;hébergement.
        </p>
        <div className="mt-3">
          <SslStatus siteId={siteId} refreshKey={sslRefresh} />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Button
            size="sm"
            disabled={sslPending}
            onClick={() => {
              setSslError(null)
              startSsl(async () => {
                const res = await issueSsl(siteId)
                if (res?.error) setSslError(res.error)
                else {
                  setSslRefresh((k) => k + 1)
                  router.refresh()
                }
              })
            }}
          >
            {sslPending
              ? "Émission…"
              : sslIssuedAt
                ? "Renouveler le certificat"
                : "Activer le SSL"}
          </Button>
          {sslIssuedAt && !sslError && (
            <span className="text-xs text-muted-foreground">
              Émis le{" "}
              {new Date(sslIssuedAt).toLocaleDateString("fr-FR", {
                dateStyle: "long",
              })}
            </span>
          )}
          {sslError && (
            <span role="alert" className="text-sm text-destructive">
              {sslError}
            </span>
          )}
        </div>
      </section>

      <section className="rounded-xl border p-4">
        <h2 className="font-medium">Envoyer des fichiers</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Les fichiers sont déposés dans le dossier web (httpdocs) du site. 50
          Mo par fichier, 100 fichiers par envoi.
        </p>
        <form
          className="mt-3 flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault()
            void onUpload(new FormData(e.currentTarget))
          }}
        >
          <div className="flex flex-wrap gap-3">
            <Input
              ref={fileInput}
              name="files"
              type="file"
              multiple
              className="w-full max-w-sm"
            />
            <Input
              name="dir"
              placeholder="Sous-dossier (optionnel) : assets/img"
              className="w-full max-w-xs"
              autoComplete="off"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button type="submit" size="sm" disabled={uploading}>
              {uploading ? "Envoi…" : "Envoyer"}
            </Button>
            {upload && (
              <span
                role={upload.ok ? "status" : "alert"}
                className={`text-sm ${upload.ok ? "text-muted-foreground" : "text-destructive"}`}
              >
                {upload.text}
              </span>
            )}
          </div>
        </form>
      </section>

      <section className="rounded-xl border border-destructive/40 p-4">
        <h2 className="font-medium">Supprimer le site</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Le domaine et tous ses fichiers sont supprimés de Plesk.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button
            size="sm"
            variant="destructive"
            disabled={delPending}
            onClick={() => {
              if (!confirm(`Supprimer définitivement ${domain} ?`)) return
              setDelError(null)
              startDel(async () => {
                const res = await deleteSite(siteId)
                if (res?.error) setDelError(res.error)
              })
            }}
          >
            {delPending ? "Suppression…" : "Supprimer"}
          </Button>
          {delError && (
            <span role="alert" className="text-sm text-destructive">
              {delError}
            </span>
          )}
        </div>
      </section>
    </div>
  )
}
