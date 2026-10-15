import "server-only"

import { and, eq, inArray, isNull, lt, lte, or } from "drizzle-orm"
import nodemailer, { type Transporter } from "nodemailer"

import { siteConfig } from "@/lib/config/site"
import { db, schema } from "@/lib/db"
import { env, mailConfigured } from "@/lib/env"

import { EMAIL_TEMPLATES } from "./templates"

/**
 * E-mails : file persistante (`email_queue`) traitée chaque minute par le
 * planificateur et juste après l'ajout. Le corps est effacé après l'envoi ou
 * l'abandon (5 tentatives). Sans SMTP, les messages sont marqués « skipped ».
 */

const MAX_ATTEMPTS = 5

/** URL publique du panel (liens des e-mails) ; null si non configurée. */
export function panelUrl(path = "") {
  const base = env.PANEL_PUBLIC_URL
  return base ? `${base}${path}` : null
}

const linkOr = (path: string) =>
  panelUrl(path) ?? `(connecte-toi à ton espace ${siteConfig.name})`

export const links = {
  panel: () => linkOr("/dashboard"),
  invoice: (id: string) => linkOr(`/invoices/${id}`),
  ticket: (id: string) => linkOr(`/tickets/${id}`),
  quote: (id: string) => linkOr(`/quotes/${id}`),
}

export async function getTemplate(key: string) {
  const def = EMAIL_TEMPLATES.find((t) => t.key === key)
  if (!def) return null
  try {
    const [row] = await db
      .select()
      .from(schema.emailTemplates)
      .where(eq(schema.emailTemplates.key, key))
    if (row)
      return {
        ...def,
        subject: row.subject,
        body: row.body,
        isEnabled: row.isEnabled,
      }
  } catch {
    // table absente : modèle par défaut
  }
  return { ...def, isEnabled: true }
}

export function render(text: string, vars: Record<string, string>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => vars[k] ?? "")
}

/** Ajoute un e-mail à la file ; n'échoue jamais (l'action métier continue). */
export async function queueEmail(input: {
  to: string
  template: string
  vars: Record<string, string>
  userId?: string | null
}) {
  try {
    const tpl = await getTemplate(input.template)
    if (!tpl) return
    const vars = { site: siteConfig.name, ...input.vars }
    const skipped = !mailConfigured || !tpl.isEnabled
    await db.insert(schema.emailQueue).values({
      userId: input.userId ?? null,
      toAddress: input.to,
      template: input.template,
      subject: render(tpl.subject, vars).slice(0, 300),
      body: skipped ? null : render(tpl.body, vars),
      status: skipped ? "skipped" : "pending",
      lastError: !mailConfigured
        ? "SMTP non configuré"
        : !tpl.isEnabled
          ? "Modèle désactivé"
          : null,
    })
    if (!skipped) void flushEmails(5).catch(() => undefined)
  } catch (e) {
    console.error("[mail] mise en file impossible", e)
  }
}

/** E-mail à un utilisateur (adresse et prénom lus en base). */
export async function queueUserEmail(
  userId: string,
  template: string,
  vars: Record<string, string> = {}
) {
  const [u] = await db
    .select({ email: schema.users.email, name: schema.users.name })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!u) return
  await queueEmail({
    to: u.email,
    template,
    userId,
    vars: { name: u.name ?? u.email, ...vars },
  })
}

const g = globalThis as unknown as {
  __mailer?: Transporter
  __mailFlushing?: boolean
}

function transport() {
  g.__mailer ??= nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: env.SMTP_USER
      ? { user: env.SMTP_USER, pass: env.SMTP_PASSWORD ?? "" }
      : undefined,
    connectionTimeout: 15_000,
  })
  return g.__mailer
}

const escapeHtml = (s: string) =>
  s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)

/** Version HTML minimale (texte échappé, liens cliquables). */
function toHtml(text: string) {
  const html = escapeHtml(text)
    .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>')
    .replace(/\n/g, "<br>")
  return `<div style="font-family:system-ui,sans-serif;font-size:14px;line-height:1.5">${html}</div>`
}

/** Envoie les e-mails en attente (un seul traitement à la fois). */
export async function flushEmails(limit = 20) {
  if (!mailConfigured || g.__mailFlushing) return 0
  g.__mailFlushing = true
  let sent = 0
  try {
    const now = new Date()
    const Q = schema.emailQueue
    const rows = await db
      .select()
      .from(Q)
      .where(
        and(
          eq(Q.status, "pending"),
          or(isNull(Q.nextAttemptAt), lte(Q.nextAttemptAt, now))
        )
      )
      .limit(limit)
    for (const m of rows) {
      try {
        await transport().sendMail({
          from: env.MAIL_FROM,
          to: m.toAddress,
          subject: m.subject,
          text: m.body ?? "",
          html: toHtml(m.body ?? ""),
        })
        await db
          .update(Q)
          .set({
            status: "sent",
            sentAt: new Date(),
            body: null,
            lastError: null,
          })
          .where(eq(Q.id, m.id))
        sent++
      } catch (e) {
        const attempts = m.attempts + 1
        const giveUp = attempts >= MAX_ATTEMPTS
        await db
          .update(Q)
          .set({
            attempts,
            status: giveUp ? "failed" : "pending",
            body: giveUp ? null : m.body,
            lastError: (e instanceof Error ? e.message : "Erreur").slice(
              0,
              300
            ),
            nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
          })
          .where(eq(Q.id, m.id))
      }
    }
  } finally {
    g.__mailFlushing = false
  }
  return sent
}

/** Rétention du journal d'envoi : 90 jours. */
export async function purgeOldEmails() {
  await db
    .delete(schema.emailQueue)
    .where(
      and(
        inArray(schema.emailQueue.status, ["sent", "failed", "skipped"]),
        lt(schema.emailQueue.createdAt, new Date(Date.now() - 90 * 86_400_000))
      )
    )
}

/** Vérifie la connexion SMTP (administration). */
export async function verifySmtp() {
  if (!mailConfigured) return "SMTP non configuré (SMTP_HOST et MAIL_FROM)."
  try {
    await transport().verify()
    return "OK"
  } catch (e) {
    return e instanceof Error ? e.message : "Erreur"
  }
}
