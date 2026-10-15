import "server-only"

import { and, asc, count, eq, inArray, ne } from "drizzle-orm"

import { db, schema } from "@/lib/db"

/**
 * RGPD : export (droits d'accès et de portabilité) et effacement.
 * L'export ne contient jamais d'empreinte de mot de passe ni de note interne
 * du support.
 */
export async function exportUserData(userId: string) {
  const [user] = await db
    .select({
      id: schema.users.id,
      email: schema.users.email,
      name: schema.users.name,
      role: schema.users.role,
      serverLimit: schema.users.serverLimit,
      balanceCents: schema.users.balanceCents,
      createdAt: schema.users.createdAt,
    })
    .from(schema.users)
    .where(eq(schema.users.id, userId))
  if (!user) return null

  const tickets = await db
    .select()
    .from(schema.tickets)
    .where(eq(schema.tickets.userId, userId))
    .orderBy(asc(schema.tickets.createdAt))
  const messages = tickets.length
    ? await db
        .select({
          ticketId: schema.ticketMessages.ticketId,
          authorKind: schema.ticketMessages.authorKind,
          body: schema.ticketMessages.body,
          createdAt: schema.ticketMessages.createdAt,
        })
        .from(schema.ticketMessages)
        .where(
          and(
            inArray(
              schema.ticketMessages.ticketId,
              tickets.map((t) => t.id)
            ),
            eq(schema.ticketMessages.isInternal, false)
          )
        )
        .orderBy(asc(schema.ticketMessages.createdAt))
    : []

  const [
    servers,
    sites,
    notifications,
    activity,
    wallet,
    redemptions,
    giftCards,
    acceptances,
    sessions,
  ] = await Promise.all([
    db
      .select({
        id: schema.servers.id,
        name: schema.servers.name,
        os: schema.servers.os,
        address: schema.servers.address,
        ipv6: schema.servers.ipv6,
        networkMode: schema.servers.networkMode,
        suspended: schema.servers.suspended,
        expiresAt: schema.servers.expiresAt,
        createdAt: schema.servers.createdAt,
      })
      .from(schema.servers)
      .where(eq(schema.servers.userId, userId)),
    db
      .select({
        id: schema.sites.id,
        domain: schema.sites.domain,
        ftpLogin: schema.sites.ftpLogin,
        sslIssuedAt: schema.sites.sslIssuedAt,
        createdAt: schema.sites.createdAt,
      })
      .from(schema.sites)
      .where(eq(schema.sites.userId, userId)),
    db
      .select({
        title: schema.notifications.title,
        body: schema.notifications.body,
        readAt: schema.notifications.readAt,
        createdAt: schema.notifications.createdAt,
      })
      .from(schema.notifications)
      .where(eq(schema.notifications.userId, userId)),
    db
      .select({
        action: schema.activityLogs.action,
        targetType: schema.activityLogs.targetType,
        targetLabel: schema.activityLogs.targetLabel,
        createdAt: schema.activityLogs.createdAt,
      })
      .from(schema.activityLogs)
      .where(eq(schema.activityLogs.userId, userId)),
    db
      .select({
        amountCents: schema.walletTransactions.amountCents,
        balanceAfterCents: schema.walletTransactions.balanceAfterCents,
        kind: schema.walletTransactions.kind,
        description: schema.walletTransactions.description,
        createdAt: schema.walletTransactions.createdAt,
      })
      .from(schema.walletTransactions)
      .where(eq(schema.walletTransactions.userId, userId))
      .orderBy(asc(schema.walletTransactions.createdAt)),
    db
      .select({
        code: schema.coupons.code,
        createdAt: schema.couponRedemptions.createdAt,
      })
      .from(schema.couponRedemptions)
      .innerJoin(
        schema.coupons,
        eq(schema.coupons.id, schema.couponRedemptions.couponId)
      )
      .where(eq(schema.couponRedemptions.userId, userId)),
    db
      .select({
        amountCents: schema.giftCards.amountCents,
        redeemedAt: schema.giftCards.redeemedAt,
      })
      .from(schema.giftCards)
      .where(eq(schema.giftCards.redeemedBy, userId)),
    db
      .select({
        document: schema.legalDocuments.slug,
        version: schema.legalAcceptances.version,
        acceptedAt: schema.legalAcceptances.acceptedAt,
      })
      .from(schema.legalAcceptances)
      .innerJoin(
        schema.legalDocuments,
        eq(schema.legalDocuments.id, schema.legalAcceptances.documentId)
      )
      .where(eq(schema.legalAcceptances.userId, userId)),
    db
      .select({
        createdAt: schema.sessions.createdAt,
        expiresAt: schema.sessions.expiresAt,
      })
      .from(schema.sessions)
      .where(eq(schema.sessions.userId, userId)),
  ])

  return {
    exportedAt: new Date().toISOString(),
    format: "hosting-panel/user-export@1",
    account: user,
    servers,
    sites,
    gameServers: await db
      .select({
        id: schema.gameServers.id,
        name: schema.gameServers.name,
        address: schema.gameServers.address,
        suspended: schema.gameServers.suspended,
        expiresAt: schema.gameServers.expiresAt,
        createdAt: schema.gameServers.createdAt,
      })
      .from(schema.gameServers)
      .where(eq(schema.gameServers.userId, userId)),
    tickets: tickets.map((t) => ({
      number: t.number,
      subject: t.subject,
      category: t.category,
      priority: t.priority,
      status: t.status,
      createdAt: t.createdAt,
      closedAt: t.closedAt,
      messages: messages.filter((m) => m.ticketId === t.id),
    })),
    notifications,
    activity,
    wallet: { transactions: wallet, couponRedemptions: redemptions, giftCards },
    legalAcceptances: acceptances,
    billingProfile:
      (
        await db
          .select()
          .from(schema.billingProfiles)
          .where(eq(schema.billingProfiles.userId, userId))
      )[0] ?? null,
    invoices: await db
      .select({
        number: schema.invoices.number,
        type: schema.invoices.type,
        status: schema.invoices.status,
        currency: schema.invoices.currency,
        totalCents: schema.invoices.totalCents,
        issuedAt: schema.invoices.issuedAt,
        paidAt: schema.invoices.paidAt,
      })
      .from(schema.invoices)
      .where(eq(schema.invoices.userId, userId)),
    sessions,
  }
}

/** Raison pour laquelle le compte ne peut pas encore être supprimé. */
export async function deletionBlocker(user: { id: string; role: string }) {
  const [[{ servers }], [{ sites }], [{ games }]] = await Promise.all([
    db
      .select({ servers: count() })
      .from(schema.servers)
      .where(eq(schema.servers.userId, user.id)),
    db
      .select({ sites: count() })
      .from(schema.sites)
      .where(eq(schema.sites.userId, user.id)),
    db
      .select({ games: count() })
      .from(schema.gameServers)
      .where(eq(schema.gameServers.userId, user.id)),
  ])
  if (servers > 0 || sites > 0 || games > 0) {
    return `Supprime d'abord tes services (${servers} VPS, ${sites} site(s), ${games} serveur(s) de jeu) : ils occupent des ressources réelles.`
  }
  if (user.role === "admin") {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.users)
      .where(and(eq(schema.users.role, "admin"), ne(schema.users.id, user.id)))
    if (n === 0) return "Tu es le dernier administrateur."
  }
  return null
}

/**
 * Efface le compte et ses données. Le journal d'activité est anonymisé
 * (l'action reste, l'auteur disparaît) ; les suppressions sont explicites
 * pour ne pas dépendre de l'activation des clés étrangères SQLite.
 */
export async function eraseUser(userId: string) {
  await db.transaction(async (tx) => {
    await tx
      .update(schema.activityLogs)
      .set({ userId: null, actor: "compte supprimé" })
      .where(eq(schema.activityLogs.userId, userId))

    const tickets = await tx
      .select({ id: schema.tickets.id })
      .from(schema.tickets)
      .where(eq(schema.tickets.userId, userId))
    if (tickets.length) {
      const ids = tickets.map((t) => t.id)
      await tx
        .delete(schema.ticketMessages)
        .where(inArray(schema.ticketMessages.ticketId, ids))
      await tx.delete(schema.tickets).where(inArray(schema.tickets.id, ids))
    }
    await tx
      .update(schema.ticketMessages)
      .set({ authorId: null })
      .where(eq(schema.ticketMessages.authorId, userId))
    await tx
      .update(schema.tickets)
      .set({ assignedTo: null })
      .where(eq(schema.tickets.assignedTo, userId))
    await tx
      .update(schema.giftCards)
      .set({ redeemedBy: null })
      .where(eq(schema.giftCards.redeemedBy, userId))

    // Factures, paiements et commandes : conservation légale (10 ans) ; le
    // lien au compte disparaît, l'acheteur reste figé sur la facture.
    await tx
      .update(schema.invoices)
      .set({ userId: null })
      .where(eq(schema.invoices.userId, userId))
    await tx
      .update(schema.payments)
      .set({ userId: null })
      .where(eq(schema.payments.userId, userId))
    await tx
      .update(schema.orders)
      .set({ userId: null })
      .where(eq(schema.orders.userId, userId))
    await tx
      .update(schema.emailQueue)
      .set({ userId: null })
      .where(eq(schema.emailQueue.userId, userId))

    for (const table of [
      schema.notifications,
      schema.walletTransactions,
      schema.couponRedemptions,
      schema.legalAcceptances,
      schema.billingProfiles,
      schema.clientNotes,
      schema.passwordResets,
      schema.sessions,
    ]) {
      await tx.delete(table).where(eq(table.userId, userId))
    }
    await tx.delete(schema.users).where(eq(schema.users.id, userId))
  })
}
