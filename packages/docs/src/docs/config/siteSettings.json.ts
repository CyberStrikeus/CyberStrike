/**
 * Global site settings
 */

import { type DocsSiteSettingsProps } from "./types/configDataTypes";

// The below locales need to match what you've put in your `astro.config.mjs` file
export const locales = ["en", "fr", "zh", "ja", "ru", "hi", "ko", "de", "pt"] as const;
export const defaultLocale = "en" as const;

// localeMap is used to map languages to their respective locales - used for formatDate function
export const localeMap = {
  en: "en-US",
  fr: "fr-FR",
  zh: "zh-CN",
  ja: "ja-JP",
  ru: "ru-RU",
  hi: "hi-IN",
  ko: "ko-KR",
  de: "de-DE",
  pt: "pt-BR",
} as const;

// text to show in the language switcher for each locale
export const languageSwitcherMap = {
  en: "English",
  fr: "Français",
  zh: "中文",
  ja: "日本語",
  ru: "Русский",
  hi: "हिन्दी",
  ko: "한국어",
  de: "Deutsch",
  pt: "Português",
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
