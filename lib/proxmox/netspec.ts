/**
 * Construction des chaînes de configuration réseau Proxmox (module pur).
 * LXC : `net0` (name=…,bridge=…,ip=…,gw=…) ; QEMU : `ipconfig0` (cloud-init).
 */

export type NetworkSpec =
  | {
      mode: "dhcp"
      vlan?: number | null
      dns?: string[]
    }
  | {
      mode: "static"
      family: "ipv4" | "ipv6"
      address: string
      prefix: number
      gateway?: string | null
      vlan?: number | null
      dns?: string[]
    }

/** Découpe « k=v,k=v » en liste ordonnée (les valeurs sans `=` sont conservées). */
export function parseKv(line: string): [string, string][] {
  return line
    .split(",")
    .filter(Boolean)
    .map((part) => {
      const i = part.indexOf("=")
      return i === -1
        ? ([part, ""] as [string, string])
        : ([part.slice(0, i), part.slice(i + 1)] as [string, string])
    })
}

export const formatKv = (pairs: [string, string][]) =>
  pairs.map(([k, v]) => (v === "" ? k : `${k}=${v}`)).join(",")

/** Paramètres d'adressage (ip/gw ou ip6/gw6) d'une spécification. */
export function addressingPairs(spec: NetworkSpec): [string, string][] {
  if (spec.mode === "dhcp") return [["ip", "dhcp"]]
  if (spec.family === "ipv4") {
    const p: [string, string][] = [["ip", `${spec.address}/${spec.prefix}`]]
    if (spec.gateway) p.push(["gw", spec.gateway])
    return p
  }
  const p: [string, string][] = [["ip6", `${spec.address}/${spec.prefix}`]]
  if (spec.gateway) p.push(["gw6", spec.gateway])
  return p
}

const ADDRESSING_KEYS = new Set(["ip", "gw", "ip6", "gw6"])

/**
 * Applique une spécification à un `net0` LXC existant en conservant les autres
 * attributs (hwaddr, firewall, rate…). `bridge` ne remplace que s'il est fourni.
 */
export function mergeLxcNet0(
  current: string | undefined,
  spec: NetworkSpec,
  bridge?: string
): string {
  const kept = parseKv(current ?? "").filter(
    ([k]) => !ADDRESSING_KEYS.has(k) && k !== "tag"
  )
  const has = (key: string) => kept.some(([k]) => k === key)
  const out: [string, string][] = [...kept]
  if (!has("name")) out.unshift(["name", "eth0"])
  if (bridge) {
    const i = out.findIndex(([k]) => k === "bridge")
    if (i === -1) out.push(["bridge", bridge])
    else out[i] = ["bridge", bridge]
  }
  if (spec.vlan) out.push(["tag", String(spec.vlan)])
  out.push(...addressingPairs(spec))
  return formatKv(out)
}

/** `net0` complet d'un conteneur à la création. */
export const newLxcNet0 = (bridge: string, spec: NetworkSpec) =>
  mergeLxcNet0(`name=eth0,bridge=${bridge}`, spec)

/** `ipconfig0` cloud-init pour QEMU. */
export const qemuIpconfig0 = (spec: NetworkSpec) =>
  formatKv(addressingPairs(spec))

/** Ajoute / retire `tag=` d'un `net0` QEMU (virtio=MAC,bridge=…,firewall=1). */
export function withQemuVlan(net0: string, vlan: number | null | undefined) {
  const pairs = parseKv(net0).filter(([k]) => k !== "tag")
  if (vlan) pairs.push(["tag", String(vlan)])
  return formatKv(pairs)
}

/** Vrai si la configuration lue correspond à la spécification demandée. */
export function configMatches(
  lxcNet0OrIpconfig: string | undefined,
  spec: NetworkSpec
) {
  if (!lxcNet0OrIpconfig) return false
  const have = new Map(parseKv(lxcNet0OrIpconfig))
  return addressingPairs(spec).every(([k, v]) => have.get(k) === v)
}

export const nameserverParam = (dns?: string[]) =>
  dns && dns.length > 0 ? dns.join(" ") : undefined
