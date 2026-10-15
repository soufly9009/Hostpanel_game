import { ServerIcon } from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { siteConfig } from "@/lib/config/site"

export default function InstallLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div className="min-h-svh bg-background text-foreground">
      <header className="border-b">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between gap-4 px-6">
          <span className="flex items-center gap-2 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ServerIcon className="size-4" aria-hidden />
            </span>
            {siteConfig.name} · Installation
          </span>
          <ThemeToggle />
        </div>
      </header>
      <main
        id="contenu"
        className="mx-auto flex max-w-4xl flex-col gap-4 px-6 py-8"
      >
        {children}
      </main>
    </div>
  )
}
