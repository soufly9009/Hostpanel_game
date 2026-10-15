"use client"

import { PrinterIcon } from "lucide-react"

import { Button } from "@/components/ui/button"

/** « Enregistrer au format PDF » depuis la boîte d'impression du navigateur. */
export function PrintButton() {
  return (
    <Button onClick={() => window.print()}>
      <PrinterIcon /> Imprimer ou enregistrer en PDF
    </Button>
  )
}
