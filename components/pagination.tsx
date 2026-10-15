import Link from "next/link"

import { Button } from "@/components/ui/button"

/** Pagination par paramètre d'URL `page`, en conservant les autres paramètres. */
export function Pagination({
  basePath,
  page,
  pageCount,
  params = {},
}: {
  basePath: string
  page: number
  pageCount: number
  params?: Record<string, string | undefined>
}) {
  if (pageCount <= 1) return null
  const href = (p: number) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v) qs.set(k, v)
    if (p > 1) qs.set("page", String(p))
    const s = qs.toString()
    return s ? `${basePath}?${s}` : basePath
  }
  return (
    <nav
      aria-label="Pagination"
      className="flex items-center justify-between text-sm"
    >
      <span className="text-muted-foreground">
        Page {page} / {pageCount}
      </span>
      <div className="flex gap-2">
        {page > 1 ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={href(page - 1)} />}
          >
            Précédent
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            Précédent
          </Button>
        )}
        {page < pageCount ? (
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<Link href={href(page + 1)} />}
          >
            Suivant
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled>
            Suivant
          </Button>
        )}
      </div>
    </nav>
  )
}
