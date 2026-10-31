import type { BrowserExclusion } from "./browserCompleteness.js";
import {
  webSourceMapsSchema,
  type WebSourceMaps,
} from "./webBundleAnalysis.js";

/** Preserve capture admission facts when map fetching was selected. */
export const sourceMapsWithCaptureExclusions = (
  sourceMaps: WebSourceMaps,
  exclusions: readonly BrowserExclusion[],
): WebSourceMaps => {
  const excluded = exclusions.flatMap((exclusion) =>
    exclusion.section === "source_maps" && exclusion.count !== 0
      ? [{ ...exclusion, section: "source_maps" as const }]
      : [],
  );
  if (excluded.length === 0) return sourceMaps;
  const summary = excluded
    .map(
      ({ reason, count }) =>
        `${count === null ? "An unknown number of" : String(count)} source-map declaration(s) excluded during capture: ${reason}.`,
    )
    .join(" ");
  return webSourceMapsSchema.parse({
    ...sourceMaps,
    status: sourceMaps.items.some(
      ({ status }) => status === "included" || status === "partial",
    )
      ? "partial"
      : "unavailable",
    excluded,
    limitation: [sourceMaps.limitation, summary]
      .filter((value) => value !== undefined)
      .join(" "),
  });
};
