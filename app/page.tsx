import Link from "next/link"
import { asc, eq } from "drizzle-orm"
import {
  ActivityIcon,
  ArrowRightIcon,
  BotIcon,
  CameraIcon,
  CheckIcon,
  GlobeIcon,
  LifeBuoyIcon,
  NetworkIcon,
  ServerIcon,
  ShieldCheckIcon,
  TerminalIcon,
} from "lucide-react"

import { ThemeToggle } from "@/components/theme-toggle"
import { Button } from "@/components/ui/button"
import { getCurrentUser } from "@/lib/auth/session"
import { homeFor } from "@/lib/auth/roles"
import { siteConfig } from "@/lib/config/site"
import { db, schema } from "@/lib/db"
import { formatPrice } from "@/lib/format"
import { planSpecs } from "@/lib/plans"

export const metadata = {
  title: `${siteConfig.name} · Hébergement de VPS et de sites web`,
  description: siteConfig.description,
}
export const dynamic = "force-dynamic"

const FEATURES = [
  {
    icon: ServerIcon,
    title: "VPS prêts en quelques instants",
    text: "Conteneurs LXC ou machines virtuelles QEMU déployés sur Proxmox, avec le système de ton choix et une réinstallation à la demande.",
  },
  {
    icon: ShieldCheckIcon,
    title: "Pare-feu et profils prêts à l'emploi",
    text: "Règles par port et protocole, profils pour le web, SSH, Minecraft ou les bots, et avertissement avant d'ouvrir un port sensible.",
  },
  {
    icon: CameraIcon,
    title: "Snapshots et restauration",
    text: "Crée un snapshot avant une modification importante, programme-les chaque jour et reviens en arrière avec une confirmation renforcée.",
  },
  {
    icon: TerminalIcon,
    title: "Terminal SSH dans le navigateur",
    text: "Connecte-toi à ton serveur depuis le panel, sans client à installer. Les identifiants ne sont jamais enregistrés.",
  },
  {
    icon: GlobeIcon,
    title: "Sites web avec SSL",
    text: "Crée un domaine, envoie tes fichiers et active un certificat Let's Encrypt gratuit depuis la même interface.",
  },
  {
    icon: NetworkIcon,
    title: "IPv4, IPv6 et IP statique",
    text: "DHCP automatique ou adresse IP statique selon l'offre, avec le réseau, la passerelle et les DNS affichés clairement.",
  },
  {
    icon: ActivityIcon,
    title: "Suivi et transparence",
    text: "Performances en direct, alertes d'échéance, annonces de maintenance et une page d'état publique.",
  },
  {
    icon: LifeBuoyIcon,
    title: "Support par tickets",
    text: "Une équipe dédiée et un assistant IA qui répond tout de suite aux questions courantes, toujours signalé comme tel.",
  },
]

const STEPS = [
  {
    title: "Crée ton compte",
    text: "L'inscription prend une minute, sans carte requise pour découvrir le panel.",
  },
  {
    title: "Choisis une offre",
    text: "Sélectionne les ressources, le système et le réseau qui te conviennent.",
  },
  {
    title: "Déploie et gère",
    text: "Démarre, redémarre, sauvegarde et surveille ton service depuis un seul tableau de bord.",
  },
]

const FAQ = [
  {
    q: "Quelle est la différence entre un conteneur LXC et une VM ?",
    a: "Un conteneur LXC partage le noyau de l'hôte : il est léger et démarre vite. Une machine virtuelle QEMU embarque son propre noyau et offre une isolation plus complète. Les offres indiquent le type proposé.",
  },
  {
    q: "Comment fonctionne le renouvellement ?",
    a: "Chaque service a une échéance. Tu peux le renouveler depuis sa page ; les échéances à venir t'apparaissent dans tes notifications. Un service expiré est suspendu avant toute suppression éventuelle.",
  },
  {
    q: "Mes données sont-elles sauvegardées ?",
    a: "Tu peux créer des snapshots, manuellement ou chaque jour selon ton offre. Un snapshot est stocké sur le même stockage que ton serveur : pense aussi à conserver des copies de tes données importantes ailleurs.",
  },
  {
    q: "Puis-je choisir une adresse IP statique ?",
    a: "Oui lorsque ton offre propose ce mode : tu sélectionnes une adresse disponible dans un réseau autorisé, et le panel vérifie la configuration appliquée.",
  },
  {
    q: "Comment contacter le support ?",
    a: "Depuis ton espace, ouvre un ticket. L'assistant IA peut te répondre immédiatement ; un membre de l'équipe prend le relais si besoin. Tu peux aussi consulter la page d'état du service.",
  },
]

export default async function HomePage() {
  const [user, plans] = await Promise.all([
    getCurrentUser(),
    db
      .select()
      .from(schema.plans)
      .where(eq(schema.plans.isActive, true))
      .orderBy(asc(schema.plans.priceCents)),
  ])

  return (
    <div className="min-h-svh bg-background text-foreground">
      <a
        href="#contenu"
        className="sr-only z-50 rounded-md bg-primary px-4 py-2 text-primary-foreground focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Aller au contenu principal
      </a>

      <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-6">
          <Link
            href="/"
            className="flex items-center gap-2 rounded-md font-semibold outline-none focus-visible:ring-3 focus-visible:ring-ring/60"
          >
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <ServerIcon className="size-4" aria-hidden />
            </span>
            {siteConfig.name}
          </Link>

          <nav aria-label="Navigation principale" className="hidden md:block">
            <ul className="flex items-center gap-6 text-sm text-muted-foreground">
              <li>
                <a
                  className="rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
                  href="#fonctionnalites"
                >
                  Fonctionnalités
                </a>
              </li>
              <li>
                <a
                  className="rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
                  href="#offres"
                >
                  Offres
                </a>
              </li>
              <li>
                <a
                  className="rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
                  href="#faq"
                >
                  FAQ
                </a>
              </li>
              <li>
                <Link
                  className="rounded hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/60 focus-visible:outline-none"
                  href="/status"
                >
                  État du service
                </Link>
              </li>
            </ul>
          </nav>

          <div className="flex items-center gap-2">
            <ThemeToggle />
            {user ? (
              <Button
                nativeButton={false}
                render={<Link href={homeFor(user.role)} />}
              >
                Mon espace
              </Button>
            ) : (
              <>
                <Button
                  variant="ghost"
                  className="hidden sm:inline-flex"
                  nativeButton={false}
                  render={<Link href="/login" />}
                >
                  Connexion
                </Button>
                <Button nativeButton={false} render={<Link href="/register" />}>
                  Commencer
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      <main id="contenu">
        {/* Hero */}
        <section
          aria-labelledby="hero-title"
          className="mx-auto max-w-6xl px-6 pt-20 pb-16 text-center sm:pt-28"
        >
          <p className="mx-auto mb-5 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs text-muted-foreground">
            <span className="size-1.5 rounded-full bg-primary" aria-hidden />
            Propulsé par Proxmox VE et Plesk
          </p>
          <h1
            id="hero-title"
            className="mx-auto max-w-3xl text-4xl font-semibold tracking-tight text-balance sm:text-6xl"
          >
            Ton VPS et tes sites, gérés au même endroit.
          </h1>
          <p className="mx-auto mt-6 max-w-2xl text-lg text-pretty text-muted-foreground">
            Déploie un serveur en quelques instants, protège-le avec un pare-feu
            simple, sauvegarde-le et suis sa santé, depuis un panel clair conçu
            pour les débutants comme pour les experts.
          </p>
          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href={user ? "/servers/new" : "/register"} />}
            >
              {user ? "Créer un VPS" : "Créer mon compte"}
              <ArrowRightIcon aria-hidden />
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              render={<a href="#offres" />}
            >
              Voir les offres
            </Button>
          </div>
        </section>

        {/* Fonctionnalités */}
        <section
          id="fonctionnalites"
          aria-labelledby="features-title"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16"
        >
          <h2
            id="features-title"
            className="text-center text-3xl font-semibold tracking-tight"
          >
            Tout ce qu&apos;il faut pour héberger sereinement
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-center text-muted-foreground">
            Des outils concrets, sans configuration compliquée.
          </p>
          <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <li
                key={f.title}
                className="rounded-xl border bg-card p-5 transition-colors hover:border-primary/40 motion-reduce:transition-none"
              >
                <span className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <f.icon className="size-5" aria-hidden />
                </span>
                <h3 className="mt-4 font-medium">{f.title}</h3>
                <p className="mt-2 text-sm text-muted-foreground">{f.text}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Comment ça marche */}
        <section aria-labelledby="steps-title" className="border-y bg-muted/30">
          <div className="mx-auto max-w-6xl px-6 py-16">
            <h2
              id="steps-title"
              className="text-center text-3xl font-semibold tracking-tight"
            >
              Comment ça marche
            </h2>
            <ol className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span
                    className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
                    aria-hidden
                  >
                    {i + 1}
                  </span>
                  <div>
                    <h3 className="font-medium">{s.title}</h3>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {s.text}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Offres */}
        <section
          id="offres"
          aria-labelledby="plans-title"
          className="mx-auto max-w-6xl scroll-mt-20 px-6 py-16"
        >
          <h2
            id="plans-title"
            className="text-center text-3xl font-semibold tracking-tight"
          >
            Nos offres
          </h2>
          {plans.length === 0 ? (
            <p className="mx-auto mt-8 max-w-md rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
              Les offres seront bientôt disponibles. Crée ton compte pour être
              prêt le moment venu.
            </p>
          ) : (
            <ul className="mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {plans.map((p) => (
                <li
                  key={p.id}
                  className="flex flex-col rounded-xl border bg-card p-6"
                >
                  <h3 className="font-medium">{p.name}</h3>
                  <p className="mt-2 text-3xl font-semibold tracking-tight">
                    {formatPrice(p.priceCents)}
                  </p>
                  {p.description && (
                    <p className="mt-3 text-sm text-muted-foreground">
                      {p.description}
                    </p>
                  )}
                  <ul className="mt-5 flex-1 space-y-2 text-sm">
                    {planSpecs(p).map((s) => (
                      <li key={s} className="flex items-start gap-2">
                        <CheckIcon
                          className="mt-0.5 size-4 shrink-0 text-primary"
                          aria-hidden
                        />
                        {s}
                      </li>
                    ))}
                  </ul>
                  <Button
                    className="mt-6"
                    variant="outline"
                    nativeButton={false}
                    render={<Link href={user ? "/servers/new" : "/register"} />}
                  >
                    Choisir cette offre
                    <span className="sr-only"> : {p.name}</span>
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Assistant */}
        <section
          aria-labelledby="support-title"
          className="mx-auto max-w-6xl px-6 pb-16"
        >
          <div className="flex flex-col items-start gap-4 rounded-2xl border bg-card p-8 md:flex-row md:items-center">
            <span className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <BotIcon className="size-6" aria-hidden />
            </span>
            <div className="flex-1">
              <h2 id="support-title" className="text-xl font-semibold">
                Un support qui répond vite
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Ouvre un ticket : un assistant IA te répond immédiatement sur
                les questions courantes (toujours signalé comme tel), et notre
                équipe prend le relais quand c&apos;est nécessaire.
              </p>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section
          id="faq"
          aria-labelledby="faq-title"
          className="mx-auto max-w-3xl scroll-mt-20 px-6 pb-20"
        >
          <h2
            id="faq-title"
            className="text-center text-3xl font-semibold tracking-tight"
          >
            Questions fréquentes
          </h2>
          <div className="mt-10 divide-y rounded-xl border bg-card">
            {FAQ.map((item) => (
              <details key={item.q} className="group p-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 rounded font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/60 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="text-muted-foreground transition-transform group-open:rotate-45 motion-reduce:transition-none"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 text-sm text-muted-foreground">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* Appel à l'action */}
        {!user && (
          <section
            aria-labelledby="cta-title"
            className="mx-auto max-w-6xl px-6 pb-20"
          >
            <div className="rounded-2xl bg-primary px-8 py-12 text-center text-primary-foreground">
              <h2
                id="cta-title"
                className="text-3xl font-semibold tracking-tight"
              >
                Prêt à déployer ton premier serveur ?
              </h2>
              <p className="mx-auto mt-3 max-w-xl opacity-90">
                Crée ton compte et lance ton VPS depuis le tableau de bord.
              </p>
              <Button
                size="lg"
                variant="secondary"
                className="mt-8"
                nativeButton={false}
                render={<Link href="/register" />}
              >
                Créer mon compte
              </Button>
            </div>
          </section>
        )}
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-8 text-sm text-muted-foreground">
          <p>
            © {new Date().getFullYear()} {siteConfig.name}
          </p>
          <nav aria-label="Pied de page">
            <ul className="flex flex-wrap gap-5">
              <li>
                <Link className="hover:text-foreground" href="/status">
                  État du service
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/legal/cgu">
                  CGU
                </Link>
              </li>
              <li>
                <Link
                  className="hover:text-foreground"
                  href="/legal/confidentialite"
                >
                  Confidentialité
                </Link>
              </li>
              <li>
                <Link
                  className="hover:text-foreground"
                  href="/legal/mentions-legales"
                >
                  Mentions légales
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/login">
                  Connexion
                </Link>
              </li>
              <li>
                <Link className="hover:text-foreground" href="/register">
                  Inscription
                </Link>
              </li>
              {user && (
                <li>
                  <Link className="hover:text-foreground" href="/tickets">
                    Support
                  </Link>
                </li>
              )}
            </ul>
          </nav>
        </div>
      </footer>
    </div>
  )
}
