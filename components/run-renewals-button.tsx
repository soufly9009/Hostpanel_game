"use client"

import { useState, useTransition } from "react"

import { Button } from "@/components/ui/button"
import { runRenewalsNow } from "@/lib/admin/actions"

export function RunRenewalsButton() {
  const [msg, setMsg] = useState<string | null>(null)
  const [pending, start] = useTransition()

  return (
    <div className="flex items-center gap-3">
      <Button
        size="sm"
        variant="outline"
        disabled={pending}
        onClick={() => {
          setMsg(null)
          start(async () => {
            const res = await runRenewalsNow()
            setMsg(res?.error ?? res?.notice ?? null)
          })
        }}
      >
        {pending ? "Vérification…" : "Lancer la vérification maintenant"}
      </Button>
      {msg && <span className="text-xs text-muted-foreground">{msg}</span>}
    </div>
  )
}
