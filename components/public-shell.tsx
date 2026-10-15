import Link from "next/link"
import { ServerIcon } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { siteConfig } from "@/lib/config/site"

/** Mise en page des pages publiques (documents légaux, annonces, aide). */
export function PublicShell({
  children,
  wide = false,
}: {
  children: React.ReactNode
  wide?: boolean
}) {
  const width = wide ? "max-w-5xl" : "max-w-3xl"
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div
          className={`mx-auto flex h-14 ${width} items-center justify-between gap-4 px-6`}
        >
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ServerIcon className="size-4" aria-hidden />
            </span>
            {siteConfig.name}
          </Link>
          <nav
            aria-label="Pages publiques"
            className="flex items-center gap-4 text-sm text-muted-foreground"
          >
            <Link href="/news" className="hover:text-foreground">
              Annonces
            </Link>
            <Link href="/help" className="hover:text-foreground">
              Aide
            </Link>
            <Link
              href="/legal"
              className="hidden hover:text-foreground sm:inline"
            >
              Documents légaux
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main id="contenu" className={`mx-auto ${width} px-6 py-10`}>
        {children}
      </main>
    </div>
  )
}
