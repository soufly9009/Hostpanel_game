import "server-only"

import https from "node:https"
import { randomBytes } from "node:crypto"
import { posix } from "node:path"
import { Readable } from "node:stream"

import { Client as FtpClient } from "basic-ftp"

import { errorText, logError } from "@/lib/discord/logging"
import { env } from "@/lib/env"

export class PleskError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message)
    this.name = "PleskError"
  }
}

type Json = Record<string, unknown>

/** Erreur de joignabilité ou d'authentification Plesk. */
export function isPleskConnectivityError(e: unknown) {
  return (
    e instanceof PleskError && [0, 401, 403, 502, 503, 504].includes(e.status)
  )
}

function request<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Json
): Promise<T> {
  return requestRaw<T>(method, path, body).catch((e) => {
    if (isPleskConnectivityError(e)) {
      void logError({
        category: "plesk",
        title: "Erreur de connexion à Plesk",
        service: "Plesk",
        action: "appel API",
        result: "failure",
        message: errorText(e),
        dedupeKey: `plesk-conn:${(e as PleskError).status}`,
        dedupeWindowMs: 15 * 60_000,
      })
    }
    throw e
  })
}

function requestRaw<T = unknown>(
  method: "GET" | "POST" | "PUT" | "DELETE",
  path: string,
  body?: Json
): Promise<T> {
  if (!env.PLESK_URL || !env.PLESK_API_KEY) {
    throw new PleskError(
      "Plesk n'est pas configuré (PLESK_URL et PLESK_API_KEY).",
      503
    )
  }
  const url = new URL(`${env.PLESK_URL}/api/v2${path}`)
  const payload = body ? JSON.stringify(body) : undefined

  return new Promise<T>((resolve, reject) => {
    const req = https.request(
      url,
      {
        method,
        rejectUnauthorized: !env.PLESK_INSECURE_TLS,
        timeout: 60_000,
        headers: {
          "X-API-Key": env.PLESK_API_KEY!,
          Accept: "application/json",
          ...(payload && {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          }),
        },
      },
      (res) => {
        let raw = ""
        res.setEncoding("utf8")
        res.on("data", (c) => (raw += c))
        res.on("end", () => {
          const status = res.statusCode ?? 0
          let json: unknown = null
          try {
            json = raw ? JSON.parse(raw) : null
          } catch {
            // corps non JSON
          }
          if (status >= 200 && status < 300) return resolve(json as T)

          const j = json as { message?: string; code?: number } | null
          const detail = j?.message || res.statusMessage || `HTTP ${status}`
          reject(
            new PleskError(
              status === 401 || status === 403
                ? `Clé API Plesk refusée : ${detail}`
                : detail,
              status
            )
          )
        })
      }
    )
    req.on("timeout", () => req.destroy(new Error("Délai dépassé")))
    req.on("error", (e) =>
      reject(
        e instanceof PleskError
          ? e
          : new PleskError(`Plesk injoignable : ${e.message}`, 502)
      )
    )
    if (payload) req.write(payload)
    req.end()
  })
}

/** Lance un utilitaire CLI Plesk (`plesk bin <command> …`). */
async function cli(command: string, params: string[]) {
  const res = await request<{ code: number; stdout: string; stderr: string }>(
    "POST",
    `/cli/${encodeURIComponent(command)}/call`,
    { params }
  )
  if (res.code !== 0) {
    const msg = (res.stderr || res.stdout || "").trim()
    throw new PleskError(msg || `Commande ${command} échouée`, 500)
  }
  return res.stdout
}

/* ───────────── Domaines ───────────── */

export const DOMAIN_RE =
  /^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/** Mot de passe aléatoire conforme aux politiques usuelles de Plesk. */
export const randomPassword = () =>
  `${randomBytes(18).toString("base64url")}aZ9!`

export const randomFtpLogin = () => `u${randomBytes(6).toString("hex")}`

export async function createDomain(input: {
  domain: string
  ftpLogin: string
  ftpPassword: string
}) {
  const res = await request<{ id: number; name: string }>("POST", "/domains", {
    name: input.domain,
    description: "",
    hosting_type: "virtual",
    hosting_settings: {
      ftp_login: input.ftpLogin,
      ftp_password: input.ftpPassword,
    },
    plan: { name: env.PLESK_SERVICE_PLAN },
  })
  if (!res?.id) throw new PleskError("Réponse Plesk inattendue", 502)
  return { pleskId: res.id }
}

export async function deleteDomain(pleskId: number) {
  await request("DELETE", `/domains/${pleskId}`)
}

/** Certificat Let's Encrypt (extension Plesk) pour le domaine et `www`. */
export async function issueLetsEncrypt(domain: string, email: string) {
  await cli("extension", [
    "--exec",
    "letsencrypt",
    "cli.php",
    "-d",
    domain,
    "-d",
    `www.${domain}`,
    "-m",
    email,
  ])
}

/* ───────────── Fichiers (FTP) ───────────── */

/** Nettoie un chemin relatif fourni par le client : pas de `..`, pas de `/` initial. */
export function safeRelativeDir(input: string) {
  const parts = input
    .replace(/\\/g, "/")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p && p !== ".")
  if (parts.some((p) => p === ".." || /[\0:*?"<>|]/.test(p))) return null
  return parts.join("/")
}

export type UploadFile = { name: string; data: Buffer }

/**
 * Envoie des fichiers dans `httpdocs/<dir>` du domaine. Le mot de passe FTP est
 * régénéré à chaque envoi (il n'est jamais stocké).
 */
export async function uploadFiles(opts: {
  domain: string
  ftpLogin: string
  dir: string
  files: UploadFile[]
}) {
  const password = randomPassword()
  await cli("subscription", [
    "--update",
    opts.domain,
    "-login",
    opts.ftpLogin,
    "-passwd",
    password,
  ])

  const host =
    env.PLESK_FTP_HOST ?? (env.PLESK_URL ? new URL(env.PLESK_URL).hostname : "")
  const ftp = new FtpClient(60_000)
  try {
    await ftp.access({
      host,
      port: env.PLESK_FTP_PORT,
      user: opts.ftpLogin,
      password,
      secure: true,
      secureOptions: { rejectUnauthorized: !env.PLESK_INSECURE_TLS },
    })
    const base = posix.join("/httpdocs", opts.dir)
    for (const f of opts.files) {
      const target = posix.join(base, f.name)
      await ftp.ensureDir(posix.dirname(target))
      await ftp.uploadFrom(Readable.from(f.data), posix.basename(target))
    }
  } catch (e) {
    if (e instanceof PleskError) throw e
    throw new PleskError(
      `Envoi FTP impossible : ${e instanceof Error ? e.message : "erreur"}`,
      502
    )
  } finally {
    ftp.close()
  }
}
