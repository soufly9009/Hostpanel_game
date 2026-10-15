import Link from "next/link"
import { notFound } from "next/navigation"
import { and, desc, eq } from "drizzle-orm"

import { AppsPanel } from "@/components/apps-panel"
import { CancellationBox } from "@/components/cancellation-controls"
import { FirewallPanel } from "@/components/firewall-panel"
import { PageHeader, Section, StatusBadge } from "@/components/kit"
import { NetworkPanel } from "@/components/network-panel"
import { RenewBox } from "@/components/renew-box"
import { ResetServerForm } from "@/components/reset-server-form"
import { ServerControls } from "@/components/server-controls"
import { SnapshotsPanel } from "@/components/snapshots-panel"
import { SshTerminal } from "@/components/ssh-terminal"
import { TabNav } from "@/components/tab-nav"
import { VpsPerformance } from "@/components/vps-performance"
import { requireUser } from "@/lib/auth/session"
import { hostExecConfigured } from "@/lib/proxmox/exec"
import { db, schema } from "@/lib/db"
import { formatMb } from "@/lib/format"
import { allowedTemplates } from "@/lib/plans"
import { TIMEFRAMES, type Timeframe } from "@/lib/proxmox/status"
import { checkEveryMs, nextRenewalAt, periodMs } from "@/lib/renewals"
import { serverStatus } from "@/lib/service-status"

export const dynamic = "force-dynamic"

const TABS = [
  { id: "overview", label: "Vue d'ensemble" },
  { id: "performance", label: "Performances" },
  { id: "network", label: "Réseau et pare-feu" },
  { id: "ip", label: "Adresse IP" },
  { id: "backups", label: "Sauvegardes" },
  { id: "ssh", label: "Accès SSH" },
  { id: "apps", label: "Applications" },
  { id: "settings", label: "Paramètres" },
]

const TF_TABS: { id: Timeframe; label: string }[] = [
  { id: "hour", label: "1 h" },
  { id: "day", label: "24 h" },
  { id: "week", label: "7 j" },
  { id: "month", label: "30 j" },
]

export default async function ServerPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ tab?: string; tf?: string }>
}) {
  const user = await requireUser()
  const { id } = await params
  const sp = await searchParams

  const [row] = await db
    .select({ server: schema.servers, plan: schema.plans })
    .from(schema.servers)
    .leftJoin(schema.plans, eq(schema.plans.id, schema.servers.planId))
    .where(eq(schema.servers.id, id))

  if (!row || (row.server.userId !== user.id && user.role !== "admin")) {
    notFound()
  }
  const { server, plan } = row
  const [pendingCancel] = await db
    .select({ id: schema.cancellationRequests.id })
    .from(schema.cancellationRequests)
    .where(
      and(
        eq(schema.cancellationRequests.serviceId, server.id),
        eq(schema.cancellationRequests.status, "pending")
      )
    )

  const tab = TABS.some((t) => t.id === sp.tab) ? sp.tab! : "overview"
  const tf: Timeframe = TIMEFRAMES.includes(sp.tf as Timeframe)
    ? (sp.tf as Timeframe)
    : "hour"
  const status = serverStatus(server)

  // Contexte réseau (IPAM) pour l'onglet « Adresse IP ».
  let netNetwork: {
    name: string
    cidr: string
    gateway: string | null
    dns: string[]
    vlan: number | null
  } | null = null
  let previousAddress: string | null = null
  if (tab === "ip") {
    if (server.networkId) {
      const [n] = await db
        .select()
        .from(schema.ipNetworks)
        .where(eq(schema.ipNetworks.id, server.networkId))
      if (n) {
        netNetwork = {
          name: n.name,
          cidr: n.cidr,
          gateway: n.gateway,
          dns: n.dnsServers,
          vlan: n.vlan,
        }
      }
    }
    if (server.previousIpAddressId) {
      const [a] = await db
        .select({ address: schema.ipAddresses.address })
        .from(schema.ipAddresses)
        .where(eq(schema.ipAddresses.id, server.previousIpAddressId))
      previousAddress = a?.address ?? null
    }
  }
  const periodDays = plan?.periodDays ?? null
  const period = Math.round(periodMs(periodDays) / 86_400_000)

  return (
    <>
      <PageHeader
        title={server.name}
        description={
          <>
            {server.virt === "qemu" ? "Machine virtuelle" : "Conteneur LXC"}
            {server.os ? ` · ${server.os}` : ""} ·{" "}
            {plan?.name ?? "Offre supprimée"}
          </>
        }
        actions={<StatusBadge tone={status.tone}>{status.label}</StatusBadge>}
      />

      <TabNav
        basePath={`/servers/${server.id}`}
        active={tab}
        tabs={TABS}
        extra={{ tf: tab === "performance" && tf !== "hour" ? tf : undefined }}
      />

      {tab === "overview" && (
        <>
          <RenewBox
            serverId={server.id}
            expiresAt={server.expiresAt ? server.expiresAt.toISOString() : null}
            suspendedForExpiry={
              server.suspended && server.suspendReason === "expired"
            }
            nextRenewalAt={
              nextRenewalAt(server.lastRenewedAt, periodDays)?.toISOString() ??
              null
            }
            periodDays={period}
            checkEveryDays={Math.round(checkEveryMs() / 86_400_000)}
          />

          {plan && (
            <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ["vCPU", String(plan.proxmox.cores)],
                ["Mémoire allouée", formatMb(plan.memoryMb)],
                ["Disque alloué", formatMb(plan.diskMb)],
                ["Système", server.os ?? "—"],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border bg-card p-4">
                  <dt className="text-sm text-muted-foreground">{label}</dt>
                  <dd className="mt-1 text-lg font-semibold break-words">
                    {value}
                  </dd>
                </div>
              ))}
            </dl>
          )}

          <ServerControls
            serverId={server.id}
            suspended={server.suspended}
            initialIpv4={server.address}
            initialIpv6={server.ipv6}
          />
        </>
      )}

      {tab === "performance" && (
        <>
          <nav aria-label="Période" className="flex gap-2">
            {TF_TABS.map((t) => (
              <Link
                key={t.id}
                href={`/servers/${server.id}?tab=performance${t.id === "hour" ? "" : `&tf=${t.id}`}`}
                aria-current={t.id === tf ? "true" : undefined}
                className={`rounded-md border px-3 py-1 text-sm ${
                  t.id === tf
                    ? "border-primary bg-primary/10 text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </Link>
            ))}
          </nav>
          <VpsPerformance
            node={server.node}
            virt={server.virt}
            vmid={server.vmid}
            timeframe={tf}
          />
        </>
      )}

      {tab === "network" && (
        <FirewallPanel serverId={server.id} disabled={server.suspended} />
      )}

      {tab === "ip" && (
        <NetworkPanel
          serverId={server.id}
          disabled={server.suspended}
          virt={server.virt}
          current={{
            mode: server.networkMode,
            ipv4: server.address,
            ipv6: server.ipv6,
            network: netNetwork,
            syncState: server.netSyncState,
            error: server.netError,
            updatedAt: server.netUpdatedAt
              ? server.netUpdatedAt.toISOString()
              : null,
            previousAddress,
          }}
        />
      )}

      {tab === "backups" && (
        <Section title="Snapshots">
          <SnapshotsPanel
            serverId={server.id}
            limit={plan?.snapshotLimit ?? 0}
            autoEnabled={server.autoSnapshot}
            disabled={server.suspended}
          />
        </Section>
      )}

      {tab === "ssh" && (
        <SshTerminal
          serverId={server.id}
          host={server.address ?? server.ipv6}
          disabled={server.suspended}
        />
      )}

      {tab === "apps" && (
        <Section
          title="Applications"
          description="Installe en un clic des logiciels courants dans ton conteneur (Debian ou Ubuntu). L'installation se fait en arrière-plan."
        >
          <AppsPanel
            serverId={server.id}
            installs={(
              await db
                .select()
                .from(schema.appInstalls)
                .where(eq(schema.appInstalls.serverId, server.id))
                .orderBy(desc(schema.appInstalls.createdAt))
                .limit(30)
            ).map((i) => ({
              id: i.id,
              appId: i.appId,
              status: i.status,
              log: i.log,
              createdAt: i.createdAt.toISOString(),
              finishedAt: i.finishedAt?.toISOString() ?? null,
            }))}
            disabledReason={
              server.virt !== "lxc"
                ? "Les applications en un clic sont réservées aux VPS conteneurs (LXC)."
                : server.suspended
                  ? "VPS suspendu."
                  : !hostExecConfigured
                    ? "Installation indisponible pour le moment (configuration de l'hôte)."
                    : null
            }
          />
        </Section>
      )}

      {tab === "settings" && (
        <Section
          title="Réinstallation"
          description="Recrée le VPS avec un autre système : toutes les données sont effacées."
          tone="danger"
        >
          <ResetServerForm
            serverId={server.id}
            templates={plan ? allowedTemplates(plan) : []}
            current={server.os}
            disabled={server.suspended || !plan}
          />
        </Section>
      )}
      {tab === "settings" && (
        <Section title="Annuler le service" tone="danger">
          <CancellationBox
            serviceType="vps"
            serviceId={server.id}
            pendingId={pendingCancel?.id ?? null}
            scheduled={server.cancelAtPeriodEnd}
            expiresAt={server.expiresAt?.toISOString() ?? null}
          />
        </Section>
      )}
    </>
  )
}
