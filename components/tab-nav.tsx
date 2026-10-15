import Link from "next/link"

import { cn } from "@/lib/utils"

/** Onglets pilotés par un paramètre d'URL : seul l'onglet actif est rendu côté serveur. */
export function TabNav({
  basePath,
  active,
  tabs,
  param = "tab",
  extra = {},
}: {
  basePath: string
  active: string
  tabs: { id: string; label: string }[]
  param?: string
  extra?: Record<string, string | undefined>
}) {
  const href = (id: string) => {
    const qs = new URLSearchParams()
    for (const [k, v] of Object.entries(extra)) if (v) qs.set(k, v)
    if (id !== tabs[0]?.id) qs.set(param, id)
    const s = qs.toString()
    return s ? `${basePath}?${s}` : basePath
  }
  return (
    <nav
      aria-label="Sections"
      className="-mx-1 flex gap-1 overflow-x-auto border-b px-1"
    >
      {tabs.map((t) => (
        <Link
          key={t.id}
          href={href(t.id)}
          aria-current={t.id === active ? "page" : undefined}
          className={cn(
            "-mb-px shrink-0 border-b-2 px-3 py-2 text-sm transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
            t.id === active
              ? "border-primary font-medium text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          )}
        >
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
