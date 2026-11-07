import type { DataEntryMap } from "astro:content";
import { getCollection } from "astro:content";
import { getRelativeLocaleUrl } from "astro:i18n";

import { defaultLocale, locales } from "@/docs/config/siteSettings.json";
import {
  dataTranslations,
  localizedCollections,
  routeTranslations,
  textTranslations,
} from "@/docs/config/translationData.json";

/**
 * * text translation helper function
 * @param locale: Language to use for translation, one of the locales
 * @returns function you can use to translate strings according to the src/config/translationData.json.ts file
 *
 * ## Example
 *
 * ```ts
 * import { useTranslations, getLocaleFromUrl } from "@/js/i18nUtils";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const t = useTranslations(currLocale);
 * t("blog.time"); // translated string for key "blog.time" in the current locale
 * ```
 */
export function useTranslations(locale: keyof typeof textTranslations) {
  return function t(key: keyof (typeof textTranslations)[typeof locale]) {
    return textTranslations[locale][key] || textTranslations[defaultLocale][key];
  };
}

type Locale = keyof typeof dataTranslations;
type DataKey<T extends Locale> = keyof (typeof dataTranslations)[T];
/**
 * * data file translation helper function
 * @param data: key in the data file to translate, like "siteData" or "navData"
 * @param locale: Language to use for translation, one of the locales
 * @returns appropriate data file as specified in src/config/translationData.json.ts
 *
 * ## Example
 *
 * ```ts
 * import { getLocaleFromUrl } from "@/js/i18nUtils";
 * import { getTranslatedData } from "@/js/translations";
 * const currLocale = getLocaleFromUrl(Astro.url);
 * const siteData = getTranslatedData("siteData", currLocale);
 * ```
 */
export function getTranslatedData<T extends Locale, K extends DataKey<T>>(
  data: K,
  locale: T,
): (typeof dataTranslations)[T][K] {
  return dataTranslations[locale][data] || dataTranslations[defaultLocale as T][data];
}

/**
 * * Returns the translated route for a given locale and base route. Drop-in replacement for getRelativeLocaleUrl()
 * Tries to match the longest prefix first, then shorter, for most specific translation.
 * Uses the static routeTranslations object (not async).
 * @param locale - The target locale (e.g., "de")
 * @param baseRoute - The route in the assumed base locale (default is defaultLocale)
 * @param options - Optional object: { baseLocale?: string }
 * @returns The localized route string
 */
export function getLocalizedRoute(
  locale: (typeof locales)[number],
  baseRoute: string = "/",
  options?: { baseLocale?: (typeof locales)[number] },
): string {
  const isExternalLink = /^(https?:\/\/|mailto:|tel:|sms:)/i.test(baseRoute);
  const isId = baseRoute.startsWith("#");
  if (isExternalLink || isId) {
    // base route is either external link or ID
    return baseRoute;
  }

  // Extract ID fragment if present
  let fragment = "";
  let routeWithoutFragment = baseRoute;
  const fragmentIndex = baseRoute.indexOf("#");

  if (fragmentIndex !== -1) {
    fragment = baseRoute.slice(fragmentIndex);
    routeWithoutFragment = baseRoute.slice(0, fragmentIndex);
  }

  const assumedBaseLocale = options?.baseLocale ?? defaultLocale;
  const normalized = routeWithoutFragment.replace(/^\/?|\/?$/g, "");

  // Special case: root route
  if (normalized === "") {
    // If there's a fragment, make sure to include it
    if (fragment) {
      return locale === defaultLocale ? "/" + fragment : `/${locale}/` + fragment;
    }
    return locale === defaultLocale ? "/" : `/${locale}/`;
  }

  const defaultTranslations = routeTranslations[assumedBaseLocale];
  const localeTranslations = routeTranslations[locale];

  const segments = normalized.split("/");

  let routePath: string | undefined;

  // Try longest to shortest prefix
  for (let i = segments.length; i > 0; i--) {
    const prefix = segments.slice(0, i).join("/");
    const key = Object.keys(defaultTranslations).find((k) => defaultTranslations[k] === prefix);
    if (key && localeTranslations[key]) {
      const translatedPrefix = localeTranslations[key];
      const rest = segments.slice(i).join("/");
      routePath = [translatedPrefix, rest].filter(Boolean).join("/");
      break;
    }
  }

  if (!routePath) {
    routePath = normalized;
  }

  // Insert locale prefix if not default
  if (locale !== defaultLocale) {
    routePath = `${locale}/${routePath}`;
  }

  // Combine the route path with the fragment
  // If there's a fragment, ensure there's exactly one slash before it
  if (fragment) {
    return `/${routePath.replace(/\\/g, "/")}/` + fragment;
  } else {
    return `/${routePath.replace(/\\/g, "/")}/`;
  }
}

// Module-level cache for dynamic route translations
let dynamicRouteTranslationsCache: Record<string, Record<string, string>> | null = null;

/**
 * Returns cached dynamic route translations, generating them on first call.
 * Ensures generateRouteTranslations only runs once per process.
 */
async function getDynamicRouteTranslations(): Promise<Record<string, Record<string, string>>> {
  if (dynamicRouteTranslationsCache) return dynamicRouteTranslationsCache;
  dynamicRouteTranslationsCache = await generateRouteTranslations();

  return dynamicRouteTranslationsCache;
}

/**
 * * take in a language (ex "de"), and the current URL, and return correct URL for the passed language
 * This is used in the language switcher components and hreflang generator
 *
 * @param locale: new language
 * @param url: current URL (Astro.url)
 * @returns new URL pathname as a string
 */
export async function getLocalizedPathname(
  locale: (typeof locales)[number],
  url: URL,
): Promise<string> {
  // Use cached dynamic route translations
  const dynamicRouteTranslations = await getDynamicRouteTranslations();

  // figure out if the current URL has a language in it's path
  const [, lang, ...rest] = url.pathname.split("/");

  const getKeyByValue = (obj: Record<string, string>, value: string): string | undefined => {
    return Object.keys(obj).find((key) => obj[key] === value.replace(/\/$/, "").replace(/^\//, ""));
  };

  let oldPath: string, currLocale: (typeof locales)[number];
  // @ts-expect-error the whole point of this is to check if lang is a valid locale
  if (locales.includes(lang)) {
    // remove locale from URL if it's already there
    oldPath = rest.join("/");
    currLocale = lang as (typeof locales)[number];
  } else {
    // otherwise, just create the URL from the existing path
    // this is the case if default locale and Astro config has `prefixDefaultLocale: false`
    oldPath = url.pathname;
    currLocale = defaultLocale;
  }

  // trim any starting and ending slashes for comparison
  const routeStringTrimmed = oldPath.replace(/\/$/, "").replace(/^\//, "");

  // first find out if the passed value maps to a key for route translations
  const routeTranslationsKey = getKeyByValue(
    dynamicRouteTranslations[currLocale],
    routeStringTrimmed,
  );

  let translatedRoute: string;

  if (routeTranslationsKey) {
    translatedRoute = dynamicRouteTranslations[locale][routeTranslationsKey];
  } else {
    // No direct match, check for wildcard matches
    const entries = Object.entries(dynamicRouteTranslations[currLocale] || {});
    let foundWildcardKey: string | undefined;
    let foundWildcardBase: string | undefined;
    for (const [key, value] of entries) {
      if (typeof value === "string" && value.endsWith("/*")) {
        const base = value.slice(0, -2); // Remove '/*'
        if (routeStringTrimmed.startsWith(base)) {
          foundWildcardKey = key;
          foundWildcardBase = base;
          break;
        }
      }
    }
    if (foundWildcardKey) {
      // Use the mapped value for the wildcard key in the target locale
      const mappedBase = dynamicRouteTranslations[locale][foundWildcardKey];
      const subPath = routeStringTrimmed.slice(foundWildcardBase!.length);
      // If the mappedBase in the target locale ends with /*, append the sub-path
      if (typeof mappedBase === "string" && mappedBase.endsWith("/*")) {
        translatedRoute =
          mappedBase.slice(0, -2).replace(/\/$/, "") +
          (subPath ? "/" + subPath.replace(/^\//, "") : "");
      } else {
        // Otherwise, just use the mappedBase directly (ignore subPath)
        translatedRoute = mappedBase;
      }
    } else {
      // No wildcard match, fallback
      translatedRoute = routeStringTrimmed;
    }
  }

  return getRelativeLocaleUrl(locale, translatedRoute);
}

/**
 * Generates a dynamic mapping of route translations for all supported locales.
 *
 * This function merges static route translations with content-driven dynamic routes for each locale.
 * It scans all configured content collections, grouping routes by a mapping key defined in entry metadata (or the collection name if missing),
 * and generates unique keys for each localized route, allowing for flexible and extensible i18n routing.
 *
 * @example
 * const translations = await generateRouteTranslations();
 * // translations['en']['content1Key'] => 'blog/example-1'
 */
export async function generateRouteTranslations() {
  // List of content collections to include
  const collections = Object.keys(localizedCollections) as Array<keyof DataEntryMap>;

  // Initialize base translations with existing static translations
  const dynamicRouteTranslations: Record<string, Record<string, string>> = Object.fromEntries(
    Object.keys(routeTranslations).map((locale) => [locale, { ...routeTranslations[locale] }]),
  );

  const allEntries = await Promise.all(
    collections.map(async (collection) => {
      const entries = await getCollection(collection);
      return entries.map((entry) => ({ ...entry, collection }));
    }),
  );

  const allContent = allEntries.flat();

  const entriesByMapping: Record<string, Record<string, string>> = {};

  let generatedMappingKeyCounter = 1;

  allContent.forEach((entry) => {
    // Extract locale and slug from the entry ID (assumed format: "locale/slug")
    const [locale, slug] = entry.id.split("/");

    // Retrieve mappingKey from entry metadata, if available
    const mappingKey = "mappingKey" in entry.data ? entry.data.mappingKey : undefined;

    const base = localizedCollections[entry.collection]?.[locale] ?? entry.collection;

    if (mappingKey) {
      if (!entriesByMapping[mappingKey]) {
        entriesByMapping[mappingKey] = {};
      }
      entriesByMapping[mappingKey][locale] = `${base}/${slug}`;
    } else {
      // Generate a unique mapping key
      const generatedKey = `generatedMappingKey_${generatedMappingKeyCounter++}`;
      if (!entriesByMapping[generatedKey]) {
        entriesByMapping[generatedKey] = {};
      }
      entriesByMapping[generatedKey][locale] = `${base}/${slug}`;

      // Find the other locale
      const otherLocales = locales.filter((l: string) => l !== locale);
      // For each other locale, map to the appropriate base with the same entry slug
      otherLocales.forEach((otherLocale: string) => {
        const otherBase = localizedCollections[entry.collection]?.[otherLocale] ?? entry.collection;
        entriesByMapping[generatedKey][otherLocale] = `${otherBase}/${slug}`;
      });
    }
  });

  // Remove duplicate generatedMappingKey_# entries
  const seenMappings = new Map<string, string>();
  Object.keys(entriesByMapping).forEach((key) => {
    if (key.startsWith("generatedMappingKey_")) {
      const value = entriesByMapping[key];
      // Use JSON.stringify to compare the mapping object
      const serialized = JSON.stringify(value, Object.keys(value).sort());
      if (seenMappings.has(serialized)) {
        // Duplicate found, delete this key
        delete entriesByMapping[key];
      } else {
        seenMappings.set(serialized, key);
      }
    }
  });

  // console.log("Entries by mapping:", entriesByMapping);

  // Assign and generate unique key names dynamically for each mapped item
  let itemIndex = 1;

  Object.entries(entriesByMapping).forEach(([, localePaths]) => {
    const keyName = `content${itemIndex}Key`;
    itemIndex++;

    Object.entries(localePaths).forEach(([locale, path]) => {
      if (dynamicRouteTranslations[locale]) {
        dynamicRouteTranslations[locale][keyName] = path;
      }
    });
  });

  // console.log("Generated dynamic route translations:", dynamicRouteTranslations);
  return dynamicRouteTranslations;
}
