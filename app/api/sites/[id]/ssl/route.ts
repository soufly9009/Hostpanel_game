import { inspectCertificateCached } from "@/lib/sites/ssl"
import { getAccessibleSiteOrNull } from "@/lib/sites/access"

export const dynamic = "force-dynamic"

/** État du certificat réellement servi (lecture seule, sans effet de bord). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params
  const site = await getAccessibleSiteOrNull(id)
  if (!site) return Response.json({ error: "Introuvable" }, { status: 404 })

  const cert = await inspectCertificateCached(site.domain)
  return Response.json({
    cert,
    lastError: site.sslLastError,
    issuedAt: site.sslIssuedAt?.toISOString() ?? null,
  })
}
