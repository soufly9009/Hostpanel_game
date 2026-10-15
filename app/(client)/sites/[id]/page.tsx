import { notFound } from "next/navigation"

import { SitePanel } from "@/components/site-panel"
import { getAccessibleSite } from "@/lib/sites/access"

export const dynamic = "force-dynamic"

export default async function SitePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id } = await params
  const site = await getAccessibleSite(id)
  if (!site) notFound()

  return (
    <>
      <div>
        <h1 className="text-xl font-semibold">{site.domain}</h1>
        <p className="text-sm text-muted-foreground">Site web (Plesk)</p>
      </div>
      <SitePanel
        siteId={site.id}
        domain={site.domain}
        sslIssuedAt={site.sslIssuedAt ? site.sslIssuedAt.toISOString() : null}
      />
    </>
  )
}
