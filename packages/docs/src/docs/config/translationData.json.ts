/**
 * * Configuration of the i18n system data files and text translations
 * Example translations below are for English and French, with textTranslations used in src/layouts/BlogLayoutCenter.astro and src/components/hero/[hero].astro
 */

/**
 * * Data file configuration for the i18n system
 * Every {Data} key must exist in the below object
 */
import navDataEn from "./en/navData.json";
import sidebarNavDataEn from "./en/sidebarNavData.json";
import siteDataEn from "./en/siteData.json";
import testimonialDataEn from "./en/testimonialData.json";
import navDataFr from "./fr/navData.json";
import sidebarNavDataFr from "./fr/sidebarNavData.json";
import siteDataFr from "./fr/siteData.json";
import testimonialDataFr from "./fr/testimonialData.json";

export const dataTranslations = {
  en: {
    siteData: siteDataEn,
    navData: navDataEn,
    sidebarNavData: sidebarNavDataEn,
    testimonialData: testimonialDataEn,
  },
  fr: {
    siteData: siteDataFr,
    navData: navDataFr,
    sidebarNavData: sidebarNavDataFr,
    testimonialData: testimonialDataFr,
  },
} as const;

/**
 * * Text translations are used with the `useTranslation` function from src/js/i18nUtils.ts to translate various strings on your site.
 *
 * ## Examples
 *
 * ```ts
 * import { getLocaleFromUrl } from "@/docs/js/localeUtils";
 * import { useTranslations } from "@/docs/js/translationUtils";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const t = useTranslations(currLocale);
 * t("back_to_all_posts"); // this would be "Retour à tous les articles" if the current locale is "fr"
 * ```
 * or
 * ```ts
 * import { useTranslations } from "@/docs/js/translationUtils";
 * const t = useTranslations("fr");
 * t("back_to_all_posts"); // this would be "Retour à tous les articles"
 * ```
 */
export const textTranslations = {
  en: {
    hero_description: `The open-source AI agent for penetration testing. Automate reconnaissance, vulnerability scanning, and exploitation with intelligent security agents powered by leading LLMs.`,
    back_to_all_posts: "Back to all posts",
  },
  fr: {
    hero_description:
      "L'agent IA open-source pour les tests de pénétration. Automatisez la reconnaissance, l'analyse des vulnérabilités et l'exploitation avec des agents de sécurité intelligents.",
    back_to_all_posts: "Retour à tous les articles",
  },
} as const;

/**
 * * Route translations are used to translate route names for the language switcher component
 * This can be useful for SEO reasons. The key does not matter, it just needs to match between languages
 *
 * These routes must be everything after the base domain. So if this is "atlas.com/blog", the route would be "blog"
 * Or if this is "atlas.com/legal/privacy", the route would be "legal/privacy"
 *
 * This also supports wildcards. For example, "categories/*" would match "categories/1" or "categories/2" etc for that language.
 *
 * Note: This works in conjunction with the localizedCollections object below
 */
export const routeTranslations = {
  en: {
    overviewKey: "overview",
    docsKey1: "docs",
    docsKey2: "docs/*",
    docsKey3: "docs",
  },
  fr: {
    overviewKey: "apercu",
    docsKey1: "docs",
    docsKey2: "docs",
    docsKey3: "docs/*",
  },
} as const;

/**
 * * Content collection translations used by the language switcher and hreflang generator
 *
 * Per-collection, per-locale route base mapping (collections to localize are the keys)
 *
 * If you have a key of "blog" then the blog content collection will be localized. This will look
 * for a "mappingKey" in the entry metadata, and use that to map the entry to the correct locale
 *
 * You can use the locale value to map the collection to a different route if desired
 */
export const localizedCollections = {
  docs: {
    en: "docs",
    fr: "docs",
  },
  // Add more collections/locales as needed
} as const;
