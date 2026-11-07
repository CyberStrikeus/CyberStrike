import { getCollection } from "astro:content";

import { defaultLocale, locales, siteSettings } from "@/docs/config/siteSettings.json";
import type { DocsSection, DocsSidebarNavData, DocsTab } from "@/docs/config/types/configDataTypes";

import { filterCollectionByLanguage } from "./localeUtils";
import { getTranslatedData } from "./translationUtils";

type LocaleType = (typeof locales)[number];

export const docsRoute = (siteSettings.docsRoute || "docs").replace(/^\/|\/$/g, "");

// Cache for translated tab data to avoid repeated data fetching
const tabCache = new Map<LocaleType, DocsTab[]>();

/**
 * Get translated tabs data with caching
 */
const getTranslatedTabs = (locale: LocaleType): DocsTab[] => {
  if (!tabCache.has(locale)) {
    tabCache.set(locale, getTranslatedData("sidebarNavData", locale).tabs);
  }
  return tabCache.get(locale)!;
};

/**
 * Get tab by ID
 */
export const getTabById = (tabId: string, locale: LocaleType): DocsTab | undefined => {
  return getTranslatedTabs(locale).find((tab) => tab.id === tabId);
};

/**
 * Get sections for a specific tab
 */
export const getTabSections = (tabId: string, locale: LocaleType): DocsSection[] => {
  const tab = getTabById(tabId, locale);
  return tab?.sections || [];
};

/**
 * Get an array of section IDs in the order they should appear in navigation for a specific tab
 */
export const getOrderedSectionIds = (tabId: string, locale: LocaleType): string[] => {
  return getTabSections(tabId, locale).map((section) => section.id);
};

/**
 * Get the section details by ID within a specific tab
 */
export const getSectionById = (
  sectionId: string,
  tabId: string,
  locale: LocaleType,
): DocsSection | undefined => {
  return getTabSections(tabId, locale).find((section) => section.id === sectionId);
};

/**
 * Get the title for a documentation section
 */
export const getSectionTitle = (sectionId: string, tabId: string, locale: LocaleType): string => {
  const section = getSectionById(sectionId, tabId, locale);
  if (section?.title) return section.title;

  // Fallback to title case if section not found
  return sectionId
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

/**
 * Get the previous and next pages for a given doc id
 */
export const getAdjacentPages = async (currentId: string, locale: LocaleType, tabId: string) => {
  // Get all non-draft docs
  const allDocs = await getCollection("docs", ({ data }) => {
    return data.draft !== true;
  });

  // Filter docs by locale
  let filteredDocs = filterCollectionByLanguage(allDocs, locale);

  // Filter by tab if tabId is provided
  if (tabId) {
    filteredDocs = filteredDocs.filter((doc) => doc.data.section === tabId);
  }

  // Get tab details
  const tab = getTabById(tabId, locale);

  // Get ordered section IDs for this tab and create a Map for faster lookups
  const orderedSectionIds = tab ? getOrderedSectionIds(tabId, locale) : [];
  const sectionIndexMap = new Map(orderedSectionIds.map((id, index) => [id, index]));

  // Sort docs by section order and then by sidebar order
  const sortedDocs = filteredDocs.sort((a, b) => {
    const [aSection] = a.id.split("/");
    const [bSection] = b.id.split("/");

    // Get section indices
    const aSectionIndex = sectionIndexMap.get(aSection) ?? -1;
    const bSectionIndex = sectionIndexMap.get(bSection) ?? -1;

    // If sections are different, sort by section order
    if (aSectionIndex !== bSectionIndex) {
      return aSectionIndex - bSectionIndex;
    }

    // If in same section, sort by sidebar order if available
    const aOrder = a.data.sidebar?.order;
    const bOrder = b.data.sidebar?.order;

    if (aOrder !== undefined && bOrder !== undefined) {
      return aOrder - bOrder;
    }

    // If only one has order, it should come first
    if (aOrder !== undefined) return -1;
    if (bOrder !== undefined) return 1;

    // If neither has order, sort by title
    return a.data.title.localeCompare(b.data.title, locale);
  });

  // Find the current doc's index
  const currentIndex = sortedDocs.findIndex((doc) => doc.id === currentId);

  return {
    prev:
      currentIndex > 0
        ? {
            slug: sortedDocs[currentIndex - 1].id,
            title:
              sortedDocs[currentIndex - 1].data.sidebar?.label ||
              sortedDocs[currentIndex - 1].data.title,
          }
        : null,
    next:
      currentIndex < sortedDocs.length - 1
        ? {
            slug: sortedDocs[currentIndex + 1].id,
            title:
              sortedDocs[currentIndex + 1].data.sidebar?.label ||
              sortedDocs[currentIndex + 1].data.title,
          }
        : null,
  };
};
