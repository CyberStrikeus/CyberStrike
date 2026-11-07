import {
  artifactInventorySummaryViewResultSchema,
  sealAnalysisView,
} from "./analysisView.js";
import { ARTIFACT_INVENTORY_VIEW_CAVEATS } from "./artifactInventoryViewCaveats.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { evidenceSemanticContent, type Evidence } from "../evidence.js";

// The ordinary-root formats actually admitted before ce1f4b1bb/b395190e4.
// Godot/PyInstaller summaries already disclosed coverage in those revisions.
// Freeze this historical set: newly introduced formats have no older aliases.
const HISTORICAL_ORDINARY_ROOT_FORMATS: ReadonlySet<string> = new Set([
  "dmg",
  "zip",
  "pkg",
  "asar",
  "javascript-bundle",
  "source-map",
  "mach-o-universal",
  "mach-o",
  "elf",
  "pe",
  "dos-mz",
  "dos-com",
  "raw-binary",
  "hopper",
  "analysis-database",
  "ipa",
  "apk",
  "msix",
  "appx",
  "hap",
  "hsp",
  "app-pack",
  "plist",
  "entitlements",
  "directory",
  "file",
  "unknown",
]);

/** Exact shipped projections, rather than arbitrary omission or prose tolerance. */
export const artifactInventorySummaryProjectionIds = (
  current: Evidence,
): readonly string[] => {
  const result = artifactInventorySummaryViewResultSchema.parse(
    current.normalized_result,
  );
  const format = result.summary.manifest.root_format;
  if (!HISTORICAL_ORDINARY_ROOT_FORMATS.has(format))
    return [current.evidence_id];
  const { view_digest: _digest, ...projection } = result;
  // b395190e4 began disclosing unavailable hashes for ordinary root formats.
  const beforeHashDisclosure = {
    ...projection,
    unknowns: projection.unknowns.filter(
      (value) => value !== ARTIFACT_INVENTORY_VIEW_CAVEATS.unknownContentHashes,
    ),
  };
  // ce1f4b1bb began carrying traversal coverage and its caveat for these roots.
  const { source_coverage: _coverage, ...summary } = projection.summary;
  const beforeTraversalDisclosure = {
    ...beforeHashDisclosure,
    summary,
    unknowns: beforeHashDisclosure.unknowns.filter(
      (value) => value !== ARTIFACT_INVENTORY_VIEW_CAVEATS.unknownTraversal,
    ),
  };
  return [
    current.evidence_id,
    ...[beforeHashDisclosure, beforeTraversalDisclosure].map(
      (variant) =>
        `ev_${digestCanonicalValue(
          evidenceSemanticContent({
            ...current,
            normalized_result: artifactInventorySummaryViewResultSchema.parse(
              sealAnalysisView(variant),
            ),
          }),
          "Evidence",
        )}`,
    ),
  ];
};
