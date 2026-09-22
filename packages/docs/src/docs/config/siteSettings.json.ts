/**
 * Global site settings
 */

import { type DocsSiteSettingsProps } from "./types/configDataTypes";

// The below locales need to match what you've put in your `astro.config.mjs` file
export const locales = ["en", "fr"] as const;
export const defaultLocale = "en" as const;

// localeMap is used to map languages to their respective locales - used for formatDate function
export const localeMap = {
  en: "en-US",
  fr: "fr-FR",
} as const;

// text to show in the language switcher for each locale
export const languageSwitcherMap = {
  en: "EN",
  fr: "FR",
  // en: "English",
  // fr: "Français",
} as const;

// site settings that don't change between languages
export const siteSettings: DocsSiteSettingsProps = {
  // if dev mode with tailwind v4 I see a lot of stuttering with view transitions. It seems fine when deployed
  useViewTransitions: false,
  // set to "false" to disable the copy link button for headings on docs pages
  copyLinkButtons: true,
  // set to "false" to disable pagination on docs pages
  pagination: true,
  // the base route for docs pages (default language). Defaults to "docs"
  // to change the base route for other languages use the `localizedCollections` and `routeTranslations` objects in `translationData.json`
  docsRoute: "docs",
};

export default siteSettings;
