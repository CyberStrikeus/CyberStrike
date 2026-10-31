import { z } from "zod";
import { AnalysisInputError } from "../analysisErrorCore.js";

import {
  anatomyNameIs,
  anatomyTailMatches,
  appleBundleSchema,
  projectAppleBundleAnatomy,
  isMachOFormat,
  isSidecar,
  isWithin,
  platformsOf,
} from "./appleBundleAnatomy.js";
import {
  isSwiftRuntimeLibrary,
  nativeRuntimeConvention,
} from "../nativeConvention.js";
import {
  hasCompleteInventoryCoverage,
  type ParsedInventorySet,
} from "../artifactInventoryEvidence.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import {
  bridgeCandidateCoverageSchema,
  projectCartesianCandidates,
} from "../bridgeCandidateProjection.js";
import {
  projectedComponentSchema,
  projectionEvidenceIdSchema,
  projectionPathSchema,
  projectedInventoryEntries,
  projectedFileComponents,
  unavailableComponentSchema,
  type ProjectedInventoryEntry,
} from "../mobileApplicationGraphProjection.js";
import { uniqueSortedBy } from "../canonicalOrdering.js";
import { compareUnicodeCodePoints as compare } from "../unicodeCodePointOrder.js";
import { err, ok, type Result } from "../result.js";

const APPLE_ROOT_FORMATS = ["ipa", "directory", "zip", "dmg"] as const;

/** Deterministic, execution-free Apple application inventory projection. */
export const appleApplicationProjectionResultSchema = z.strictObject({
  projection_id: prefixedDigestSchema("aap"),
  root_sha256: digestSchema,
  root_format: z.enum(APPLE_ROOT_FORMATS),
  platforms: z.array(z.enum(["ios", "macos"])),
  source_evidence_ids: z.array(projectionEvidenceIdSchema).min(1),
  application_roots: z.array(projectionPathSchema),
  bundles: z.array(appleBundleSchema),
  components: z.strictObject({
    bundle_metadata: z.array(projectedComponentSchema),
    executables: z.array(projectedComponentSchema),
    frameworks: z.array(projectedComponentSchema),
    native_libraries: z.array(projectedComponentSchema),
    javascript: z.array(projectedComponentSchema),
    signing: z.array(projectedComponentSchema),
    privileged_helpers: z.array(projectedComponentSchema),
    launchd_plists: z.array(
      projectedComponentSchema.extend({ domain: z.enum(["agent", "daemon"]) }),
    ),
    helpers: z.array(projectedComponentSchema),
  }),
  unavailable_components: z.array(unavailableComponentSchema),
  symlinks: z.array(projectionPathSchema),
  runtime_families: z.array(
    z.enum([
      "native",
      "swift-objective-c",
      "javascript",
      "react-native",
      "flutter",
      "unity",
    ]),
  ),
  bridge_candidates: z.array(
    z.strictObject({
      source_path: projectionPathSchema,
      native_path: projectionPathSchema,
      basis: z.enum([
        "javascript-and-native-content",
        "react-native-convention",
        "flutter-convention",
        "unity-convention",
      ]),
    }),
  ),
  bridge_candidate_coverage: bridgeCandidateCoverageSchema,
  coverage: z.strictObject({
    status: z.enum(["complete-within-inventory", "partial"]),
    // Count completeness is separate from the declared coverage status.
    inventory_complete: z.boolean(),
  }),
  limitations: z.array(z.string()),
});

export type AppleApplicationProjectionResult = z.infer<
  typeof appleApplicationProjectionResultSchema
>;

type Component = z.infer<typeof projectedComponentSchema>;
type RootFormat = (typeof APPLE_ROOT_FORMATS)[number];

/** Project an already authenticated inventory without reparsing its source. */
export const projectAppleInventory = (
  source: ParsedInventorySet,
): Result<AppleApplicationProjectionResult, AnalysisInputError> => {
  const { evidence, inventory } = source;
  const rootFormatResult = appleRootFormat(inventory.manifest.root_format);
  if (!rootFormatResult.ok) return rootFormatResult;
  const rootFormat = rootFormatResult.value;
  const { entries, limitations: unresolved } =
    projectedInventoryEntries(inventory);
  const inventoried = projectedFileComponents(entries);
  const { roots, bundles } = projectAppleBundleAnatomy(entries, {
    name: evidence[0]?.subject?.name ?? "",
    format: rootFormat,
  });
  const { all, unattributed } = attributeComponents(
    inventoried,
    roots,
    rootFormat,
  );
  // Directories have no file bytes; symlinks already have their own path-only output.
  const unavailable = attributeComponents(
    entries.flatMap(({ kind, unavailable }) =>
      (kind === "file" || kind === "slice") && unavailable !== undefined
        ? [unavailable]
        : [],
    ),
    roots,
    rootFormat,
  );
  const classified = classifyComponents(entries, all, roots, bundles);
  const runtimeFamilies = identifyRuntimeFamilies(all);
  const bridgeProjection = identifyBridgeCandidates(
    classified.javascript,
    uniqueSortedBy(
      [...classified.executables, ...classified.native_libraries],
      (component) => component.path,
    ),
    roots,
  );
  const uninventoriedImage =
    rootFormat === "dmg" && inventory.occurrences.length === 1;
  const inventoryComplete = hasCompleteInventoryCoverage(
    inventory,
    "container-entries",
  );
  const complete = inventoryComplete && !uninventoriedImage;
  const limitations = [
    ...unresolved,
    ...inventory.limitations,
    ...projectionLimitations({
      complete: inventoryComplete,
      uninventoriedImage,
      roots,
      bundles,
      sidecars: entries.some(({ path }) => isSidecar(path)),
      symlinks: entries.some(({ kind }) => kind === "symlink"),
      unattributed: unattributed + unavailable.unattributed,
      unavailable: unavailable.all.length > 0,
      bridgeCandidateCoverage: bridgeProjection.coverage,
    }),
  ];
  const withoutId = {
    root_sha256: inventory.manifest.root_sha256,
    root_format: rootFormat,
    platforms: platformsOf(bundles),
    source_evidence_ids: evidence
      .map(({ evidence_id: id }) => id)
      .sort(compare),
    application_roots: roots,
    bundles,
    components: classified,
    unavailable_components: unavailable.all,
    symlinks: entries
      .filter(({ kind }) => kind === "symlink")
      .map(({ path }) => path)
      .sort(compare),
    runtime_families: runtimeFamilies,
    bridge_candidates: bridgeProjection.candidates,
    bridge_candidate_coverage: bridgeProjection.coverage,
    coverage: {
      status:
        complete &&
        unavailable.all.length === 0 &&
        bridgeProjection.coverage.status === "complete"
          ? ("complete-within-inventory" as const)
          : ("partial" as const),
      inventory_complete: inventory.complete,
    },
    limitations,
  };
  return ok(
    appleApplicationProjectionResultSchema.parse({
      ...withoutId,
      projection_id: appleProjectionId(withoutId),
    }),
  );
};

/** Identify the complete projection, including source Evidence provenance. */
export const appleProjectionId = (projection: unknown): string =>
  `aap_${digestCanonicalValue(projection, "Apple application projection")}`;

/**
 * AppleDouble sidecars describe neighbouring files and are never components.
 * IPA projection keeps every other archive component, as before. Directory,
 * ZIP, and DMG inventories can hold installers and other siblings, so only
 * components inside an application root are attributed to it.
 */
const attributeComponents = <Entry extends { readonly path: string }>(
  inventoried: readonly Entry[],
  roots: readonly string[],
  rootFormat: RootFormat,
): { readonly all: Entry[]; readonly unattributed: number } => {
  const visible = inventoried.filter(({ path }) => !isSidecar(path));
  if (rootFormat === "ipa") return { all: visible, unattributed: 0 };
  const all = visible.filter(({ path }) =>
    roots.some((root) => isWithin(path, root)),
  );
  return { all, unattributed: visible.length - all.length };
};

const appleRootFormat = (
  format: string,
): Result<RootFormat, AnalysisInputError> => {
  const root = APPLE_ROOT_FORMATS.find((candidate) => candidate === format);
  if (root === undefined)
    return err(
      new AnalysisInputError("project_apple_application_graph", {}, [
        {
          path: [
            "inventory_evidence",
            0,
            "normalized_result",
            "manifest",
            "root_format",
          ],
          reason: "invalid_value",
          message: `Apple application projection requires IPA, directory, ZIP, or DMG inventory Evidence (got ${format})`,
        },
      ]),
    );
  return ok(root);
};

const isNativeLibrary = (path: string): boolean =>
  /\.(?:dylib|so)$/iu.test(path);

const launchdDomain = (path: string): "agent" | "daemon" | undefined => {
  if (anatomyTailMatches(path, ["Contents", "Library", "LaunchAgents", "*"]))
    return "agent";
  if (anatomyTailMatches(path, ["Contents", "Library", "LaunchDaemons", "*"]))
    return "daemon";
  return undefined;
};

const classifyComponents = (
  entries: readonly ProjectedInventoryEntry[],
  all: readonly Component[],
  roots: readonly string[],
  bundles: readonly z.infer<typeof appleBundleSchema>[],
) => {
  const frameworkRoots = bundles
    .filter(({ role }) => role === "framework")
    .map(({ path }) => path);
  const withinApp = (path: string): boolean =>
    roots.some((root) => isWithin(path, root));
  const matching = (predicate: (path: string) => boolean): Component[] =>
    entries.flatMap(({ path, kind, component }) =>
      kind === "file" &&
      component !== undefined &&
      !isSidecar(path) &&
      withinApp(path) &&
      predicate(path)
        ? [component]
        : [],
    );
  const lastSegment = (path: string): string => path.split("/").at(-1) ?? "";
  return {
    bundle_metadata: all.filter(({ path }) =>
      anatomyNameIs(lastSegment(path), "Info.plist"),
    ),
    // An unrooted IPA library is listed only under native_libraries.
    executables: all.filter(
      ({ path, format }) =>
        isMachOFormat(format) && (withinApp(path) || !isNativeLibrary(path)),
    ),
    frameworks: all.filter(({ path }) =>
      frameworkRoots.some((root) => isWithin(path, root)),
    ),
    native_libraries: all.filter(({ path }) => isNativeLibrary(path)),
    javascript: all.filter(({ format }) => format === "javascript-bundle"),
    signing: all.filter(
      ({ path }) =>
        anatomyTailMatches(path, ["_CodeSignature", "CodeResources"]) ||
        anatomyNameIs(lastSegment(path), "embedded.mobileprovision") ||
        anatomyNameIs(lastSegment(path), "embedded.provisionprofile"),
    ),
    privileged_helpers: matching((path) =>
      anatomyTailMatches(path, ["Contents", "Library", "LaunchServices", "*"]),
    ),
    launchd_plists: matching((path) => path.endsWith(".plist")).flatMap(
      (component) => {
        const domain = launchdDomain(component.path);
        return domain === undefined ? [] : [{ ...component, domain }];
      },
    ),
    helpers: matching((path) =>
      anatomyTailMatches(path, ["Contents", "Helpers", "*"]),
    ),
  };
};

const identifyRuntimeFamilies = (all: readonly Component[]) => {
  const families = new Set<
    z.infer<
      typeof appleApplicationProjectionResultSchema
    >["runtime_families"][number]
  >();
  if (all.some(({ format }) => ["mach-o", "mach-o-universal"].includes(format)))
    families.add("native");
  if (all.some(({ path }) => isSwiftRuntimeLibrary(path)))
    families.add("swift-objective-c");
  if (all.some(({ format }) => format === "javascript-bundle"))
    families.add("javascript");
  for (const { path } of all) {
    const convention = nativeRuntimeConvention(path);
    if (convention !== null) families.add(convention);
  }
  return [...families].sort(compare);
};

/** Pair scripts and native code within matching application-root groups. */
const identifyBridgeCandidates = (
  scripts: readonly Component[],
  native: readonly Component[],
  roots: readonly string[],
) => {
  const owner = (path: string): string | null =>
    roots.find((root) => isWithin(path, root)) ?? null;
  const scriptGroups: { root: string | null; left: Component[] }[] = [];
  for (const script of scripts) {
    const root = owner(script.path);
    const last = scriptGroups.at(-1);
    if (last?.root === root) last.left.push(script);
    else scriptGroups.push({ root, left: [script] });
  }
  const nativeByRoot = new Map<string | null, Component[]>();
  for (const item of native) {
    const root = owner(item.path);
    const scoped = nativeByRoot.get(root) ?? [];
    scoped.push(item);
    nativeByRoot.set(root, scoped);
  }
  const groups = scriptGroups.map(({ root, left }) => ({
    left,
    right: nativeByRoot.get(root) ?? [],
  }));
  return projectCartesianCandidates({
    groups,
    createCandidate: (source_path, item) => ({
      source_path,
      native_path: item.path,
      basis: bridgeBasis(item.path),
    }),
  });
};

const bridgeBasis = (
  path: string,
):
  | "javascript-and-native-content"
  | "react-native-convention"
  | "flutter-convention"
  | "unity-convention" => {
  const convention = nativeRuntimeConvention(path);
  if (convention === "react-native") return "react-native-convention";
  if (convention === "flutter") return "flutter-convention";
  if (convention === "unity") return "unity-convention";
  return "javascript-and-native-content";
};

const projectionLimitations = (facts: {
  readonly complete: boolean;
  readonly uninventoriedImage: boolean;
  readonly roots: readonly string[];
  readonly bundles: readonly z.infer<typeof appleBundleSchema>[];
  readonly sidecars: boolean;
  readonly symlinks: boolean;
  readonly unattributed: number;
  readonly unavailable: boolean;
  readonly bridgeCandidateCoverage: AppleApplicationProjectionResult["bridge_candidate_coverage"];
}): string[] => [
  ...(!facts.complete
    ? ["Source inventory coverage is partial; absence is unknown."]
    : []),
  ...(facts.uninventoriedImage
    ? [
        "The DMG's contents were not inventoried on this host; bundle absence is unknown.",
      ]
    : []),
  ...(facts.roots.length === 0
    ? [
        "No application bundle (Payload/*.app or *.app/Contents) was present in the supplied inventory pages.",
      ]
    : []),
  ...(facts.bundles.some(
    ({ layout, info_plist_path: plist }) =>
      layout === "versioned-framework" && plist === null,
  )
    ? [
        "A versioned framework has several version directories or no Versions/*/Resources/Info.plist; the Info.plist that Versions/Current selects is unknown because symlink targets are not inventoried.",
      ]
    : []),
  ...(facts.symlinks
    ? [
        "Symlinks are reported by path only; their targets are not inventoried, so bundles are reported at their real paths.",
      ]
    : []),
  ...(facts.unattributed > 0
    ? [
        `${facts.unattributed} inventoried entries outside every application root are not attributed to the application.`,
      ]
    : []),
  ...(facts.sidecars
    ? [
        "AppleDouble sidecar entries (._* files and __MACOSX/) describe neighbouring files and are excluded from bundle roles.",
      ]
    : []),
  ...(facts.bridgeCandidateCoverage.status === "partial"
    ? [
        `Bridge candidate pairs exceeded the projection safety budget; ${facts.bridgeCandidateCoverage.omitted_candidates} hypotheses are omitted. Component arrays still include every component from the supplied inventory pages.`,
      ]
    : []),
  ...(facts.unavailable
    ? [
        "Some inventoried files have no authenticated content identity. Their paths and limitations are retained in unavailable_components; component absence is unknown.",
      ]
    : []),
  "Bundle roles follow path conventions. Read each info_plist_path with inspect_plist for CFBundleExecutable, identifiers, and declared services.",
  "Bundle identifiers and signing claims require dedicated plist and CMS parsing; this projection reports only exact paths and hashes.",
  "Runtime families are inferred from inventory formats and bounded framework path conventions, not observed runtime loading.",
  "Generic framework and dylib paths do not establish Swift or Objective-C; this inventory projection does not decode language metadata.",
  "Bridge candidates are path-based hypotheses, not observed runtime calls.",
  "A bridge basis is inferred from the native path and is repeated for every managed component.",
];
