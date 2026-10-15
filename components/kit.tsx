import Link from "next/link"
import { AlertTriangleIcon, InboxIcon } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

/** Briques d'interface partagées (composants serveur, sans état). */

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string
  description?: React.ReactNode
  actions?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {description && (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  )
}

export function StatCard({
  label,
  value,
  hint,
  icon: Icon,
  href,
  tone = "default",
}: {
  label: string
  value: React.ReactNode
  hint?: React.ReactNode
  icon?: React.ComponentType<{ className?: string }>
  href?: string
  tone?: "default" | "warning" | "danger"
}) {
  const body = (
    <div
      className={cn(
        "flex h-full flex-col gap-1 rounded-xl border bg-card p-4 transition-colors",
        href && "hover:bg-muted/50",
        tone === "warning" && "border-amber-500/40",
        tone === "danger" && "border-destructive/40"
      )}
    >
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span>{label}</span>
        {Icon && <Icon className="size-4" />}
      </div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
  return href ? (
    <Link
      href={href}
      className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {body}
    </Link>
  ) : (
    body
  )
}

const BADGE: Record<string, string> = {
  success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  danger: "bg-destructive/15 text-destructive",
  neutral: "bg-muted text-muted-foreground",
  info: "bg-primary/15 text-primary",
}

export function StatusBadge({
  tone = "neutral",
  children,
}: {
  tone?: "success" | "warning" | "danger" | "neutral" | "info"
  children: React.ReactNode
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium",
        BADGE[tone]
      )}
    >
      {children}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: React.ReactNode
  action?: { href: string; label: string }
}) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed p-10 text-center">
      <InboxIcon className="size-6 text-muted-foreground" />
      <p className="font-medium">{title}</p>
      {description && (
        <p className="max-w-md text-sm text-muted-foreground">{description}</p>
      )}
      {action && (
        <Button
          size="sm"
          className="mt-2"
          nativeButton={false}
          render={<Link href={action.href} />}
        >
          {action.label}
        </Button>
      )}
    </div>
  )
}

export function ErrorState({
  title = "Une erreur est survenue",
  message,
}: {
  title?: string
  message?: React.ReactNode
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/5 p-4"
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0 text-destructive" />
      <div className="text-sm">
        <p className="font-medium text-destructive">{title}</p>
        {message && <p className="mt-0.5 text-muted-foreground">{message}</p>}
      </div>
    </div>
  )
}

export function Section({
  title,
  description,
  children,
  tone,
}: {
  title: string
  description?: React.ReactNode
  children: React.ReactNode
  tone?: "danger"
}) {
  return (
    <section
      className={cn(
        "rounded-xl border bg-card p-4",
        tone === "danger" && "border-destructive/40"
      )}
    >
      <h2 className="font-medium">{title}</h2>
      {description && (
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      )}
      <div className="mt-3">{children}</div>
    </section>
  )
}
