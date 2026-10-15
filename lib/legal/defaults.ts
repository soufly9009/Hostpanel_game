import type { LegalSectionContent } from "@/lib/db/schema"

/**
 * Modèles livrés avec le panel, publiés en version 1 au premier démarrage.
 * Les passages entre crochets [ … ] sont À COMPLÉTER par l'exploitant
 * depuis l'éditeur (Support → Documents légaux). Ces modèles ne remplacent
 * pas l'avis d'un professionnel du droit.
 */

export type LegalTemplate = {
  slug: string
  title: string
  summary: string
  requiresAcceptance: boolean
  position: number
  sections: LegalSectionContent[]
}

export function legalTemplates(site: string): LegalTemplate[] {
  return [
    {
      slug: "cgu",
      title: "Conditions générales d'utilisation",
      summary: `Règles d'utilisation du panel ${site} et de ses services.`,
      requiresAcceptance: true,
      position: 1,
      sections: [
        {
          heading: "1. Objet",
          body: `Les présentes conditions générales d'utilisation (« CGU ») encadrent l'accès et l'utilisation du panel ${site} (le « Service ») édité par [raison sociale / nom de l'éditeur], ainsi que des services qu'il permet de gérer : serveurs privés virtuels (VPS), sites web et support.\n\nToute création de compte vaut acceptation sans réserve des présentes CGU, des Conditions des crédits et la prise de connaissance de la Politique de confidentialité.`,
        },
        {
          heading: "2. Compte utilisateur",
          body: `L'utilisateur fournit une adresse e-mail valide et choisit un mot de passe d'au moins 8 caractères. Il est seul responsable de la confidentialité de ses identifiants et de toute activité réalisée depuis son compte.\n\n- Un compte est personnel et ne peut être cédé.\n- L'utilisateur doit être majeur ou disposer de l'autorisation de son représentant légal.\n- L'utilisateur peut à tout moment exporter ses données ou supprimer son compte depuis « Mon compte ».`,
        },
        {
          heading: "3. Services fournis",
          body: `Le Service permet de commander, configurer, démarrer, arrêter, sauvegarder (snapshots) et supprimer des VPS, de gérer des sites web et d'ouvrir des tickets de support. Les caractéristiques de chaque offre (ressources, durée de période, nombre de snapshots) sont indiquées lors de la commande.\n\nChaque service a une échéance. Un service non renouvelé à son échéance peut être suspendu puis supprimé, avec ses données, selon les délais affichés dans le panel.`,
        },
        {
          heading: "4. Usages interdits",
          body: `Il est interdit d'utiliser le Service pour :\n- toute activité illégale, notamment la diffusion de contenus illicites ou contrefaisants ;\n- l'envoi de courriers non sollicités (spam), l'hameçonnage ou la diffusion de logiciels malveillants ;\n- les attaques informatiques (déni de service, balayage de ports, intrusion) visant des tiers ou l'infrastructure ;\n- le minage de cryptomonnaies ou tout usage portant atteinte à la stabilité de l'infrastructure partagée.\n\nEn cas de manquement, l'éditeur peut suspendre ou supprimer le service concerné, voire le compte, après notification sauf urgence.`,
        },
        {
          heading: "5. Responsabilités",
          body: `L'utilisateur est responsable des contenus et logiciels qu'il installe sur ses services, de leurs mises à jour de sécurité et de ses sauvegardes. Les snapshots sont stockés sur la même infrastructure que le serveur : ils ne remplacent pas une sauvegarde externe.\n\nL'éditeur met en œuvre des moyens raisonnables pour assurer la disponibilité du Service (obligation de moyens). Les maintenances programmées sont annoncées sur la page « État du service ». La responsabilité de l'éditeur ne saurait être engagée pour les dommages indirects ou la perte de données.`,
        },
        {
          heading: "6. Assistant IA du support",
          body: `Certaines réponses du support peuvent être rédigées par un assistant d'intelligence artificielle. Elles sont toujours signalées comme telles. Avant tout envoi à l'assistant, les adresses e-mail, adresses IP et secrets détectés sont masqués. Un membre de l'équipe peut prendre le relais à tout moment.`,
        },
        {
          heading: "7. Modification des CGU",
          body: `L'éditeur peut modifier les présentes CGU. En cas de modification substantielle, une nouvelle acceptation est demandée lors de la connexion suivante ; à défaut, l'utilisateur peut supprimer son compte. Chaque version publiée est conservée et datée.`,
        },
        {
          heading: "8. Droit applicable et litiges",
          body: `Les présentes CGU sont soumises au droit français. En cas de litige, une solution amiable sera recherchée en priorité (contact : [adresse e-mail de contact]). Le consommateur peut recourir gratuitement à un médiateur de la consommation : [nom et coordonnées du médiateur]. À défaut d'accord, les tribunaux compétents sont ceux désignés par la loi.`,
        },
      ],
    },
    {
      slug: "conditions-credits",
      title: "Conditions des crédits, coupons et cartes cadeaux",
      summary:
        "Fonctionnement du solde de crédits virtuels, des coupons et des cartes cadeaux.",
      requiresAcceptance: true,
      position: 2,
      sections: [
        {
          heading: "1. Nature des crédits",
          body: `Les « crédits » sont une unité de compte virtuelle propre au Service ${site}. Ils n'ont AUCUNE valeur monétaire :\n- ils ne sont ni de la monnaie, ni de la monnaie électronique au sens de l'article L. 315-1 du Code monétaire et financier ;\n- ils ne peuvent pas être achetés avec de l'argent réel par l'intermédiaire du Service, ni convertis, remboursés ou échangés contre de l'argent ;\n- ils ne peuvent être utilisés qu'au sein du Service, pour les usages qu'il propose.`,
        },
        {
          heading: "2. Obtention et utilisation",
          body: `Des crédits peuvent être attribués par l'éditeur (bonus d'inscription, geste commercial), par la saisie d'un coupon ou d'une carte cadeau. Lorsque la facturation en crédits est activée, le prix d'une offre est débité du solde à la commande et à chaque renouvellement ; un échec technique de la commande donne lieu à un remboursement automatique en crédits.\n\nL'historique complet des mouvements est consultable à tout moment dans « Mon solde ».`,
        },
        {
          heading: "3. Coupons",
          body: `Un coupon est un code promotionnel qui crédite un montant fixe. Il peut être limité dans le temps, en nombre total d'utilisations et en nombre d'utilisations par compte. Un coupon désactivé, expiré ou épuisé ne peut plus être utilisé.`,
        },
        {
          heading: "4. Cartes cadeaux",
          body: `Une carte cadeau est un code unique (format XXXX-XXXX-XXXX-XXXX) utilisable une seule fois, éventuellement jusqu'à une date d'expiration. Le porteur du code est réputé en être le bénéficiaire : gardez-le confidentiel. Une carte perdue ou divulguée ne peut être remplacée que si elle n'a pas encore été utilisée.`,
        },
        {
          heading: "5. Incessibilité, fraude et correction",
          body: `Les crédits sont personnels et ne peuvent être transférés entre comptes. L'éditeur peut corriger un solde en cas d'erreur manifeste ou d'utilisation frauduleuse (saisie automatisée de codes, exploitation d'un dysfonctionnement). Chaque correction figure à l'historique avec son motif.`,
        },
        {
          heading: "6. Fin du compte",
          body: `La suppression du compte entraîne la perte définitive du solde de crédits, sans contrepartie, ces derniers n'ayant pas de valeur monétaire. L'éditeur peut mettre fin au programme de crédits en prévenant les utilisateurs au moins 30 jours à l'avance.`,
        },
      ],
    },
    {
      slug: "confidentialite",
      title: "Politique de confidentialité",
      summary:
        "Données personnelles traitées, finalités, durées de conservation et droits (RGPD).",
      requiresAcceptance: false,
      position: 3,
      sections: [
        {
          heading: "1. Responsable du traitement",
          body: `Le responsable du traitement est [raison sociale / nom], [adresse postale], joignable à [adresse e-mail de contact]. [Le cas échéant : délégué à la protection des données (DPO) : coordonnées.]`,
        },
        {
          heading: "2. Données traitées",
          body: `- Compte : adresse e-mail, nom, mot de passe (stocké uniquement sous forme d'empreinte scrypt, jamais en clair), rôle, date de création.\n- Services : VPS et sites web (nom, offre, adresses IP attribuées, échéances), snapshots, configuration réseau et pare-feu.\n- Support : tickets et messages échangés.\n- Crédits : solde et historique des mouvements, utilisations de coupons et de cartes cadeaux.\n- Sécurité et traçabilité : journal d'activité (action réalisée, date, auteur), acceptations des documents légaux (document, version, date).\n\nLes mots de passe root saisis à la création d'un VPS, les mots de passe SSH du terminal web et les mots de passe FTP ne sont jamais conservés.`,
        },
        {
          heading: "3. Finalités et bases légales",
          body: `- Fournir le Service, gérer le compte, les services et le support : exécution du contrat (art. 6.1.b RGPD).\n- Gérer les crédits, coupons et cartes cadeaux : exécution du contrat (art. 6.1.b).\n- Sécuriser le Service (prévention des abus, journal d'activité, détection d'incidents) : intérêt légitime (art. 6.1.f).\n- Conserver la preuve de l'acceptation des conditions : intérêt légitime et respect des obligations légales (art. 6.1.c et 6.1.f).\n\nAucune donnée n'est utilisée à des fins publicitaires ni vendue.`,
        },
        {
          heading: "4. Durées de conservation",
          body: `Les données du compte, des services, du support et des crédits sont conservées tant que le compte est actif. À la suppression du compte, elles sont effacées ; les entrées du journal d'activité sont anonymisées. [Le cas échéant : durée de conservation légale des données de facturation réelle.] Les sauvegardes techniques de la base de données sont conservées [durée] avant écrasement.`,
        },
        {
          heading: "5. Destinataires et sous-traitants",
          body: `Les données ne sont accessibles qu'au personnel habilité, selon ses permissions. Sous-traitants susceptibles d'intervenir :\n- [hébergeur de l'infrastructure, pays] ;\n- OpenRouter (États-Unis), pour l'assistant IA du support, si activé : seuls les messages des tickets, après masquage des e-mails, adresses IP et secrets, lui sont transmis ;\n- Discord (États-Unis), pour la supervision technique interne : seuls des événements expurgés (sans données personnelles directes) sont transmis.\n\nLes transferts hors de l'Union européenne sont encadrés par les garanties appropriées (clauses contractuelles types de la Commission européenne ou décision d'adéquation).`,
        },
        {
          heading: "6. Vos droits",
          body: `Conformément au RGPD et à la loi Informatique et Libertés, vous disposez d'un droit d'accès, de rectification, d'effacement, de limitation, d'opposition et de portabilité de vos données, ainsi que du droit de définir des directives relatives à leur sort après votre décès.\n\n- Export (accès / portabilité) : « Mon compte » → « Exporter mes données » (fichier JSON).\n- Effacement : « Mon compte » → « Supprimer mon compte ».\n- Autres demandes : [adresse e-mail de contact] ; réponse sous un mois.\n\nVous pouvez introduire une réclamation auprès de la CNIL (www.cnil.fr).`,
        },
        {
          heading: "7. Cookies et stockage local",
          body: `Le Service utilise uniquement :\n- un cookie de session « session » (strictement nécessaire à l'authentification, durée 30 jours) ;\n- le stockage local du navigateur pour mémoriser le thème clair/sombre.\n\nCes traceurs sont strictement nécessaires au fonctionnement ou à une préférence demandée par l'utilisateur : ils sont exemptés de consentement (article 82 de la loi Informatique et Libertés). Aucun cookie publicitaire ni de mesure d'audience tiers n'est utilisé.`,
        },
        {
          heading: "8. Sécurité",
          body: `Mots de passe hachés (scrypt), sessions dont seule l'empreinte est stockée, connexions chiffrées, permissions par rôle, journal d'activité et protection contre les tentatives répétées. En cas de violation de données présentant un risque, la CNIL et, si nécessaire, les personnes concernées sont informées dans les délais légaux.`,
        },
      ],
    },
    {
      slug: "mentions-legales",
      title: "Mentions légales",
      summary: "Identification de l'éditeur et de l'hébergeur (LCEN, art. 6).",
      requiresAcceptance: false,
      position: 4,
      sections: [
        {
          heading: "Éditeur",
          body: `[Raison sociale ou nom et prénom]\n[Forme juridique et capital social, le cas échéant]\n[Adresse du siège]\n[Numéro RCS / SIREN]\n[Numéro de TVA intracommunautaire]\nContact : [adresse e-mail] – [téléphone]`,
        },
        {
          heading: "Directeur de la publication",
          body: `[Nom et prénom du directeur de la publication]`,
        },
        {
          heading: "Hébergeur",
          body: `[Nom de l'hébergeur]\n[Adresse]\n[Téléphone]`,
        },
        {
          heading: "Propriété intellectuelle",
          body: `Les éléments du site ${site} (textes, logos, interface) sont protégés. Toute reproduction sans autorisation est interdite, sauf exceptions prévues par la loi.`,
        },
      ],
    },
  ]
}
