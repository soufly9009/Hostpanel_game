import Link from "next/link"
import { ServerIcon } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { siteConfig } from "@/lib/config/site"

export default function LegalLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between gap-4 px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ServerIcon className="size-4" aria-hidden />
            </span>
            {siteConfig.name}
          </Link>
          <nav aria-label="Documents" className="flex items-center gap-4">
            <Link
              href="/legal"
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Documents légaux
            </Link>
            <ThemeToggle />
          </nav>
        </div>
      </header>
      <main id="contenu" className="mx-auto max-w-3xl px-6 py-10">
        {children}
      </main>
    </div>
  )
}
