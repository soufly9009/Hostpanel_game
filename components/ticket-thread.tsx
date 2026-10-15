import { BotIcon, LockIcon } from "lucide-react"

import { StatusBadge } from "@/components/kit"

export type ThreadMessage = {
  id: string
  kind: "customer" | "staff" | "ai" | "system"
  body: string
  internal: boolean
  createdAt: Date
  authorName?: string | null
  aiModel?: string | null
}

/**
 * Fil de discussion. Le texte est rendu tel quel (échappé par React) :
 * aucun HTML ni Markdown n'est interprété.
 */
export function TicketThread({
  messages,
  viewer,
}: {
  messages: ThreadMessage[]
  viewer: "customer" | "staff"
}) {
  return (
    <ol className="flex flex-col gap-3" aria-label="Messages du ticket">
      {messages.map((m) => {
        const mine =
          viewer === "customer" ? m.kind === "customer" : m.kind === "staff"
        const label =
          m.kind === "customer"
            ? viewer === "customer"
              ? "Toi"
              : (m.authorName ?? "Client")
            : m.kind === "ai"
              ? "Assistant IA"
              : m.kind === "system"
                ? "Système"
                : (m.authorName ?? "Support")
        return (
          <li
            key={m.id}
            className={`rounded-xl border p-4 text-sm ${
              m.internal
                ? "border-amber-500/40 bg-amber-500/5"
                : mine
                  ? "border-primary/30 bg-primary/5"
                  : "bg-card"
            }`}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">{label}</span>
              {m.kind === "ai" && (
                <span className="inline-flex items-center gap-1">
                  <BotIcon className="size-3" aria-hidden />
                  généré automatiquement
                  {viewer === "staff" && m.aiModel ? ` · ${m.aiModel}` : ""}
                </span>
              )}
              {m.internal && (
                <StatusBadge tone="warning">
                  <span className="inline-flex items-center gap-1">
                    <LockIcon className="size-3" aria-hidden />
                    Note interne
                  </span>
                </StatusBadge>
              )}
              <time dateTime={m.createdAt.toISOString()} className="ml-auto">
                {m.createdAt.toLocaleString("fr-FR", {
                  dateStyle: "medium",
                  timeStyle: "short",
                })}
              </time>
            </div>
            <p className="break-words whitespace-pre-wrap">{m.body}</p>
          </li>
        )
      })}
    </ol>
  )
}
