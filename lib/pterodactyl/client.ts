import "server-only"

import { errorText, logError } from "@/lib/discord/logging"
import { env, pterodactylConfigured } from "@/lib/env"

/**
 * Seule porte d'entrée vers Pterodactyl. Les clients du panel n'ont aucun
 * compte Pterodactyl : tous les serveurs appartiennent à PTERODACTYL_OWNER_ID
 * et sont pilotés ici.
 *
 * - API Application (ptla_) : offres, création, suspension, suppression.
 * - API Client (ptlc_ d'un compte administrateur) : alimentation, commandes,
 *   ressources, console (un administrateur peut agir sur tous les serveurs).
 */

export class PteroError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = "PteroError"
  }
}

/** Erreur de joignabilité ou d'authentification (pas une erreur métier). */
export function isPteroConnectivityError(e: unknown) {
  return e instanceof PteroError && [0, 401, 502, 503, 504].includes(e.status)
}

type Api = "application" | "client"

async function call<T>(
  api: Api,
  method: "GET" | "POST" | "PATCH" | "DELETE",
  path: string,
  body?: unknown
): Promise<T> {
  if (!pterodactylConfigured) {
    throw new PteroError(
      "Pterodactyl n'est pas configuré (URL, clés API et compte propriétaire).",
      503
    )
  }
  const key =
    api === "application" ? env.PTERODACTYL_APP_KEY : env.PTERODACTYL_CLIENT_KEY

  let res: Response
  try {
    res = await fetch(`${env.PTERODACTYL_URL}/api/${api}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "Application/vnd.pterodactyl.v1+json",
        ...(body !== undefined && { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
      cache: "no-store",
    })
  } catch (e) {
    const err = new PteroError(
      `Pterodactyl injoignable : ${e instanceof Error ? e.message : "erreur réseau"}`,
      502
    )
    report(err)
    throw err
  }

  if (res.status === 204) return undefined as T
  const text = await res.text()
  let json: unknown = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    // corps non JSON
  }
  if (!res.ok) {
    const errors = (json as { errors?: { detail?: string; code?: string }[] })
      ?.errors
    const detail =
      errors
        ?.map((x) => x.detail || x.code)
        .filter(Boolean)
        .join(" · ") || `HTTP ${res.status}`
    const err = new PteroError(
      res.status === 403
        ? `Permission refusée par Pterodactyl : ${detail}`
        : detail,
      res.status
    )
    // Réponse métier de Pterodactyl (ex. 502 « serveur éteint ») : pas une
    // panne. Alerte seulement pour une clé refusée ou un proxy en erreur.
    if (res.status === 401 || (res.status >= 500 && !errors?.length)) {
      report(err)
    }
    throw err
  }
  return json as T
}

/** Une alerte par panne (dédupliquée 15 min), jamais pour une erreur métier. */
function report(e: PteroError) {
  if (!isPteroConnectivityError(e)) return
  void logError({
    category: "pterodactyl",
    title:
      e.status === 401
        ? "Clé API Pterodactyl refusée"
        : "Erreur de connexion à Pterodactyl",
    service: "Pterodactyl",
    action: "appel API",
    result: "failure",
    message: errorText(e),
    dedupeKey: `ptero-conn:${e.status}`,
    dedupeWindowMs: 15 * 60_000,
  })
}

type Obj<A> = { object: string; attributes: A }
type List<A> = {
  data: Obj<A>[]
  meta?: { pagination?: { total_pages: number } }
}

/** Parcourt toutes les pages d'une liste de l'API Application. */
async function listAll<A>(path: string) {
  const out: A[] = []
  for (let page = 1; page <= 20; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const r = await call<List<A>>(
      "application",
      "GET",
      `${path}${sep}per_page=100&page=${page}`
    )
    out.push(...r.data.map((d) => d.attributes))
    if ((r.meta?.pagination?.total_pages ?? 1) <= page) break
  }
  return out
}

/* ───────────── Catalogue (API Application) ───────────── */

export type PteroLocation = { id: number; short: string; long: string | null }
export type PteroEgg = {
  id: number
  nest: number
  name: string
  docker_image: string
  docker_images?: Record<string, string>
  startup: string
}
export type PteroVariable = {
  name: string
  env_variable: string
  default_value: string
  rules: string
  user_editable: boolean
}

export const listLocations = () => listAll<PteroLocation>("/locations")

export async function listEggs() {
  const nests = await listAll<{ id: number; name: string }>("/nests")
  const eggs: (PteroEgg & { nestName: string })[] = []
  for (const n of nests) {
    const list = await listAll<PteroEgg>(`/nests/${n.id}/eggs`)
    for (const e of list) eggs.push({ ...e, nest: n.id, nestName: n.name })
  }
  return eggs
}

async function getEgg(nestId: number, eggId: number) {
  const r = await call<
    Obj<PteroEgg & { relationships?: { variables?: List<PteroVariable> } }>
  >("application", "GET", `/nests/${nestId}/eggs/${eggId}?include=variables`)
  return {
    egg: r.attributes,
    variables: (r.attributes.relationships?.variables?.data ?? []).map(
      (v) => v.attributes
    ),
  }
}

/** Vérifie la connexion des deux clés (pour l'administration). */
export async function checkConnection() {
  const result = { application: "", client: "" }
  try {
    const l = await listLocations()
    result.application = `OK · ${l.length} emplacement(s)`
  } catch (e) {
    result.application = errorText(e)
  }
  try {
    await call("client", "GET", "/account")
    result.client = "OK"
  } catch (e) {
    result.client = errorText(e)
  }
  return result
}

/* ───────────── Cycle de vie (API Application) ───────────── */

type AppServer = {
  id: number
  uuid: string
  identifier: string
  allocation: number
  suspended: boolean
  container?: { installed?: number | boolean }
  relationships?: {
    allocations?: List<{
      id: number
      ip: string
      ip_alias: string | null
      port: number
    }>
  }
}

export type CreateGameServerInput = {
  name: string
  externalId: string
  plan: {
    nestId: number
    eggId: number
    locationId: number
    memoryMb: number
    diskMb: number
    cpuPercent: number
    databases: number
    backups: number
    environment: Record<string, string>
  }
}

/**
 * Crée le serveur (propriétaire : PTERODACTYL_OWNER_ID). Les variables de
 * l'egg prennent leur valeur par défaut, sauf celles imposées par l'offre ;
 * le nœud et le port sont choisis par Pterodactyl dans l'emplacement.
 */
export async function createGameServer(input: CreateGameServerInput) {
  const { egg, variables } = await getEgg(input.plan.nestId, input.plan.eggId)
  const environment: Record<string, string> = {}
  for (const v of variables) {
    environment[v.env_variable] =
      input.plan.environment[v.env_variable] ?? v.default_value ?? ""
  }
  const image =
    egg.docker_image || Object.values(egg.docker_images ?? {})[0] || ""

  const r = await call<Obj<AppServer>>("application", "POST", "/servers", {
    name: input.name,
    external_id: input.externalId,
    user: env.PTERODACTYL_OWNER_ID,
    egg: egg.id,
    docker_image: image,
    startup: egg.startup,
    environment,
    limits: {
      memory: input.plan.memoryMb,
      swap: 0,
      disk: input.plan.diskMb,
      io: 500,
      cpu: input.plan.cpuPercent,
    },
    feature_limits: {
      databases: input.plan.databases,
      backups: input.plan.backups,
      allocations: 1,
    },
    deploy: {
      locations: [input.plan.locationId],
      dedicated_ip: false,
      port_range: [],
    },
    start_on_completion: true,
  })
  return r.attributes
}

/** Adresse de connexion (allocation par défaut), ex. « 51.38.1.2:25565 ». */
export async function getGameAddress(pteroId: number) {
  const r = await call<Obj<AppServer>>(
    "application",
    "GET",
    `/servers/${pteroId}?include=allocations`
  )
  const allocs = r.attributes.relationships?.allocations?.data ?? []
  const a =
    allocs.find((x) => x.attributes.id === r.attributes.allocation) ?? allocs[0]
  if (!a) return null
  return `${a.attributes.ip_alias || a.attributes.ip}:${a.attributes.port}`
}

/** Le serveur existe-t-il encore côté Pterodactyl ? (null si inconnu) */
export async function gameServerExists(pteroId: number) {
  try {
    await call("application", "GET", `/servers/${pteroId}`)
    return true
  } catch (e) {
    if (e instanceof PteroError && e.status === 404) return false
    return null
  }
}

export const suspendGameServer = (pteroId: number) =>
  call<void>("application", "POST", `/servers/${pteroId}/suspend`)

export const unsuspendGameServer = (pteroId: number) =>
  call<void>("application", "POST", `/servers/${pteroId}/unsuspend`)

export const reinstallGameServer = (pteroId: number) =>
  call<void>("application", "POST", `/servers/${pteroId}/reinstall`)

/** Suppression ; déjà absent = succès. */
export async function deleteGameServer(pteroId: number) {
  try {
    await call<void>("application", "DELETE", `/servers/${pteroId}`)
  } catch (e) {
    if (e instanceof PteroError && e.status === 404) return
    throw e
  }
}

/* ───────────── Pilotage (API Client) ───────────── */

export type GameState = "running" | "starting" | "stopping" | "offline"

export type GameResources = {
  state: GameState | string
  cpuPercent: number
  memoryBytes: number
  diskBytes: number
  rxBytes: number
  txBytes: number
  uptimeMs: number
}

export async function getGameResources(
  identifier: string
): Promise<GameResources> {
  const r = await call<
    Obj<{
      current_state: string
      resources: {
        cpu_absolute: number
        memory_bytes: number
        disk_bytes: number
        network_rx_bytes: number
        network_tx_bytes: number
        uptime: number
      }
    }>
  >("client", "GET", `/servers/${identifier}/resources`)
  const x = r.attributes
  return {
    state: x.current_state,
    cpuPercent: x.resources.cpu_absolute,
    memoryBytes: x.resources.memory_bytes,
    diskBytes: x.resources.disk_bytes,
    rxBytes: x.resources.network_rx_bytes,
    txBytes: x.resources.network_tx_bytes,
    uptimeMs: x.resources.uptime,
  }
}

/** État d'installation côté Pterodactyl (« installing », « install_failed »…). */
export async function getGameInstallStatus(identifier: string) {
  const r = await call<Obj<{ status: string | null; is_installing?: boolean }>>(
    "client",
    "GET",
    `/servers/${identifier}`
  )
  return r.attributes.is_installing
    ? "installing"
    : (r.attributes.status ?? null)
}

export type PowerSignal = "start" | "stop" | "restart" | "kill"

export const sendPower = (identifier: string, signal: PowerSignal) =>
  call<void>("client", "POST", `/servers/${identifier}/power`, { signal })

export const sendCommand = (identifier: string, command: string) =>
  call<void>("client", "POST", `/servers/${identifier}/command`, { command })

/** Jeton et URL du websocket Wings (console), valables quelques minutes. */
export async function getConsoleCredentials(identifier: string) {
  const r = await call<{ data: { token: string; socket: string } }>(
    "client",
    "GET",
    `/servers/${identifier}/websocket`
  )
  return r.data
}
