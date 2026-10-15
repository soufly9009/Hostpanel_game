"use client"

import { useTransition } from "react"

import { Button } from "@/components/ui/button"
import { markNotificationRead } from "@/lib/notifications-actions"

/** `id` null : marque toutes les notifications comme lues. */
export function MarkReadButton({
  id,
  label,
}: {
  id: string | null
  label: string
}) {
  const [pending, start] = useTransition()
  return (
    <Button
      size="sm"
      variant="ghost"
      disabled={pending}
      onClick={() => start(() => markNotificationRead(id))}
    >
      {pending ? "…" : label}
    </Button>
  )
}
