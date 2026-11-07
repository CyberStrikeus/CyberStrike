import { glob } from "astro/loaders";
import { defineCollection, z } from "astro:content";

import { locales } from "@/docs/config/siteSettings.json";
import type { DocsTab } from "@/docs/config/types/configDataTypes";
import { getTranslatedData } from "@/docs/js/translationUtils";

// Extract all unique section IDs from all tabs in all locales
const allSectionIds = new Set<string>();

// For each configured locale
for (const locale of locales) {
  // Get translated sidebar data for this locale
  const sidebarData = getTranslatedData("sidebarNavData", locale);

  // For each tab in this locale's data
  if (sidebarData.tabs) {
    sidebarData.tabs.forEach((tab: DocsTab) => {
      // Add the tab ID itself as a valid section
      allSectionIds.add(tab.id);
    });
  }
}

// Convert Set to Array for z.enum
const sectionIds = [...allSectionIds].length > 0 ? [...allSectionIds] : ["main"];

const docsCollection = defineCollection({
  loader: glob({ pattern: "**/[^_]*{md,mdx}", base: "./src/docs/data/docs" }),
  schema: () =>
    z.object({
      title: z.string(),
      description: z.string().optional(),
      // Add section field to associate docs with specific sections
      section: z.enum(sectionIds as [string, ...string[]]).default("main"),
      sidebar: z
        .object({
          label: z.string().optional(),
          order: z.number().optional(),
          badge: z
            .object({
              text: z.string(),
              variant: z.enum(["note", "tip", "caution", "danger", "info"]).default("note"),
            })
            .optional(),
        })
        .optional(),
      tableOfContents: z
        .object({
          minHeadingLevel: z.number().min(1).max(6).optional(),
          maxHeadingLevel: z.number().min(1).max(6).optional(),
        })
        .optional(),
      pagefind: z.boolean().optional(),
      mappingKey: z.string().optional(),
      draft: z.boolean().optional(),
    }),
});

export const collections = {
  docs: docsCollection,
};
