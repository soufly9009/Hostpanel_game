import type { Plan } from "@/lib/db/schema"
import { formatMb } from "@/lib/format"

/** Libellés de ressources d'une offre, utilisés sur l'accueil et la création. */
export function planSpecs(p: Plan): string[] {
  return [
    `${p.proxmox.cores} vCPU`,
    `${formatMb(p.memoryMb)} RAM`,
    `${formatMb(p.diskMb)} SSD`,
    p.proxmox.virt === "qemu" ? "VM KVM" : "Conteneur LXC",
  ]
}

export type TemplateChoice = { value: string; label: string }

/** Libellé lisible d'un template à partir de sa valeur. */
export function templateLabel(virt: "lxc" | "qemu", value: string) {
  return virt === "lxc" ? (value.split("/").pop() ?? value) : `VMID ${value}`
}

/** Templates qu'un client peut choisir pour cette offre (défaut inclus). */
export function allowedTemplates(p: Plan): TemplateChoice[] {
  const { virt, template, templates } = p.proxmox
  const list = [...(templates ?? [])]
  if (!list.some((t) => t.value === template)) {
    list.unshift({ value: template, label: templateLabel(virt, template) })
  }
  return list
}
