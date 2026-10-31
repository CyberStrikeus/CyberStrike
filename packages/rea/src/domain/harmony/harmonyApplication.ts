import {
  bridgeCandidateCoverageSchema,
  projectCartesianCandidates,
} from "../bridgeCandidateProjection.js";
import { z } from "zod";
import { AnalysisInputError } from "../analysisErrorCore.js";

import {
  hasCompleteInventoryCoverage,
  type ParsedInventorySet,
} from "../artifactInventoryEvidence.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { digestCanonicalValue } from "../canonicalDigest.js";
import { nativeRuntimeConvention } from "../nativeConvention.js";
import {
  projectedBridgeCandidateSchema,
  projectedComponentSchema,
  projectedInventoryEntries,
  projectedFileComponents,
  projectionCoverage,
  projectionEvidenceIdSchema,
  unavailableComponentSchema,
  type ProjectedInventoryEntry,
} from "../mobileApplicationGraphProjection.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { err, ok, type Result } from "../result.js";

const HARMONY_ROOT_FORMATS = ["hap", "hsp", "app-pack"] as const;
type RootFormat = (typeof HARMONY_ROOT_FORMATS)[number];

/** Deterministic, execution-free HarmonyOS application inventory projection. */
export const harmonyApplicationProjectionResultSchema = z.strictObject({
  projection_id: prefixedDigestSchema("hmp"),
  root_sha256: digestSchema,
  root_format: z.enum(HARMONY_ROOT_FORMATS),
  source_evidence_ids: z.array(projectionEvidenceIdSchema).min(1),
  packaging_model: z.enum(["stage", "fa", "unknown"]),
  components: z.strictObject({
    manifests: z.array(projectedComponentSchema),
    bytecode: z.array(projectedComponentSchema),
    resources: z.array(projectedComponentSchema),
    native_libraries: z.array(projectedComponentSchema),
    javascript: z.array(projectedComponentSchema),
    signing: z.array(projectedComponentSchema),
  }),
  unavailable_components: z.array(unavailableComponentSchema),
  app_pack_children: z.array(
    z.union([projectedComponentSchema, unavailableComponentSchema]),
  ),
  runtime_families: z.array(
    z.enum(["ark", "native", "javascript", "react-native", "flutter", "unity"]),
  ),
  bridge_candidates: z.array(
    projectedBridgeCandidateSchema([
      "managed-and-native-content",
      "napi-library-convention",
    ] as const),
  ),
  bridge_candidate_coverage: bridgeCandidateCoverageSchema,
  coverage: z.strictObject({
    status: z.enum(["complete-within-inventory", "partial"]),
    // Count completeness is separate from the declared coverage status.
    inventory_complete: z.boolean(),
  }),
  limitations: z.array(z.string()),
});

export type HarmonyApplicationProjectionResult = z.infer<
  typeof harmonyApplicationProjectionResultSchema
>;
type Component = z.infer<typeof projectedComponentSchema>;

/** Project exact HarmonyOS package paths and hashes without decoding or executing target code. */
export const projectHarmonyInventory = (
  source: ParsedInventorySet,
): Result<HarmonyApplicationProjectionResult, AnalysisInputError> => {
  const { evidence, inventory } = source;
  const rootFormatResult = harmonyRootFormat(inventory.manifest.root_format);
  if (!rootFormatResult.ok) return rootFormatResult;
  const rootFormat = rootFormatResult.value;
  const { entries, limitations: unresolved } =
    projectedInventoryEntries(inventory);
  const all = projectedFileComponents(entries);
  const fileEntries = entries.filter(
    ({ kind }) => kind === "file" || kind === "slice",
  );
  const unavailable = fileEntries.flatMap(({ unavailable }) =>
    unavailable === undefined ? [] : [unavailable],
  );
  const children: HarmonyApplicationProjectionResult["app_pack_children"] = [];
  if (rootFormat === "app-pack") {
    for (const entry of fileEntries) {
      if (!/\.(?:hap|hsp)$/iu.test(entry.path)) continue;
      const child = entry.component ?? entry.unavailable;
      if (child !== undefined) children.push(child);
    }
  }
  const manifests = classifyManifests(fileEntries);
  const classified = classify(all, manifests.components);
  const bridgeProjection = bridgeCandidates(
    classified.bytecode,
    classified.native_libraries,
  );
  const limitations = [
    ...unresolved,
    ...inventory.limitations,
    ...(!hasCompleteInventoryCoverage(inventory, "container-entries")
      ? ["Source inventory coverage is partial; absence is unknown."]
      : []),
    ...(unavailable.length > 0
      ? [
          "Some inventoried files or slices have no authenticated content identity. Their paths and limitations are retained in unavailable_components; component and runtime absence is unknown.",
        ]
      : []),
    "Manifest, module, resource, and signing semantics require a dedicated HarmonyOS provider; this projection reports exact inventory paths and hashes only.",
    "The packaging model is a path-presence heuristic: a Stage model is claimed only from module.json and a FA model only from config.json; both can coexist with unusual layouts.",
    "Runtime families are inferred from inventory formats and paths; filename suffixes do not establish valid Ark bytecode.",
    "The signing component lists META-INF certificate-entry suffixes only; signatures applied by the packaging tool live in the ZIP signing block rather than archive entries, so an empty signing list does not mean the package is unsigned.",
    "Bridge candidates are path-based hypotheses, not decoded N-API declarations or observed runtime calls.",
    ...(rootFormat === "app-pack"
      ? [
          "App Pack child packages are listed by inventory path only; their contents are not recursively inventoried by this projection.",
          "The app-pack root classification is a verified-ZIP-magic plus .app suffix rule; the projection does not require pack.info or child packages before reporting the root format.",
        ]
      : []),
    "HarmonyOS .har shared libraries are not identified by this projection; the .har suffix also names HTTP Archive JSON, so that classification requires verified ZIP bytes.",
    ...(bridgeProjection.coverage.status === "partial"
      ? [
          `Bridge candidate pairs exceeded the projection safety budget; ${bridgeProjection.coverage.omitted_candidates} hypotheses are omitted. Component arrays still include every component from the supplied inventory pages.`,
        ]
      : []),
  ];
  const withoutId = {
    root_sha256: inventory.manifest.root_sha256,
    root_format: rootFormat,
    source_evidence_ids: evidence
      .map(({ evidence_id: id }) => id)
      .sort(compareUnicodeCodePoints),
    packaging_model: manifests.packagingModel,
    components: classified,
    unavailable_components: unavailable,
    app_pack_children: children,
    runtime_families: runtimeFamilies(all, classified),
    bridge_candidates: bridgeProjection.candidates,
    bridge_candidate_coverage: bridgeProjection.coverage,
    coverage: projectionCoverage(
      inventory,
      bridgeProjection.coverage.status === "complete" &&
        unavailable.length === 0,
    ),
    limitations,
  };
  return ok(
    harmonyApplicationProjectionResultSchema.parse({
      ...withoutId,
      projection_id: `hmp_${digestCanonicalValue(withoutId, "HarmonyOS application projection")}`,
    }),
  );
};

const harmonyRootFormat = (
  format: string,
): Result<RootFormat, AnalysisInputError> => {
  const root = HARMONY_ROOT_FORMATS.find((candidate) => candidate === format);
  if (root === undefined)
    return err(
      new AnalysisInputError("project_harmony_application_graph", {}, [
        {
          path: [
            "inventory_evidence",
            0,
            "normalized_result",
            "manifest",
            "root_format",
          ],
          reason: "invalid_value",
          message: `HarmonyOS application projection requires HAP, HSP, or App Pack inventory Evidence (got ${format})`,
        },
      ]),
    );
  return ok(root);
};

/**
 * ZIP manifest names are case-sensitive. Classify each file path once for
 * both consumers; its model hint survives an unavailable content identity.
 */
const classifyManifests = (entries: readonly ProjectedInventoryEntry[]) => {
  const components: Component[] = [];
  let packagingModel: HarmonyApplicationProjectionResult["packaging_model"] =
    "unknown";
  for (const { path, component } of entries) {
    const name = /(?:^|\/)(module\.json|config\.json|pack\.info)$/u.exec(
      path,
    )?.[1];
    if (name === undefined || isResourcePath(path)) continue;
    if (component !== undefined) components.push(component);
    if (name === "module.json") packagingModel = "stage";
    else if (name === "config.json" && packagingModel === "unknown")
      packagingModel = "fa";
  }
  return { components, packagingModel };
};

const classify = (all: readonly Component[], manifests: Component[]) => ({
  manifests,
  bytecode: all.filter(({ path }) => /\.(?:abc|pa)$/iu.test(path)),
  resources: all.filter(({ path }) => isResourcePath(path)),
  native_libraries: all.filter(
    ({ path, format }) =>
      format === "elf" || /(?:^|\/)libs\/[^/]+\/[^/]+\.so$/iu.test(path),
  ),
  javascript: all.filter(
    ({ path, format }) =>
      format === "javascript-bundle" || /\.(?:m?js|cjs)$/iu.test(path),
  ),
  signing: all.filter(({ path }) =>
    /^META-INF\/[^/]+\.(?:p7b|sig|cer|crt|pem|provision|rsa|dsa|ec)$/iu.test(
      path,
    ),
  ),
});

const isResourcePath = (path: string): boolean =>
  /(?:^|\/)resources\.index$/iu.test(path) ||
  /^(?:resources\/|assets\/[^/]+\/resources\/)/iu.test(path);

const runtimeFamilies = (
  all: readonly Component[],
  components: HarmonyApplicationProjectionResult["components"],
) => {
  const families = new Set<
    HarmonyApplicationProjectionResult["runtime_families"][number]
  >();
  if (components.bytecode.length > 0) families.add("ark");
  if (all.some(({ format }) => format === "elf")) families.add("native");
  if (components.javascript.length > 0) families.add("javascript");
  for (const { path } of all) {
    const convention = nativeRuntimeConvention(path);
    if (convention !== null) families.add(convention);
  }
  return [...families].sort(compareUnicodeCodePoints);
};

const bridgeCandidates = (
  managed: readonly Component[],
  native: readonly Component[],
) => {
  return projectCartesianCandidates({
    groups: [{ left: managed, right: native }],
    createCandidate: (managed_path, target) => ({
      managed_path,
      native_path: target.path,
      basis: napiBasis(target.path),
    }),
  });
};

const napiBasis = (
  path: string,
): HarmonyApplicationProjectionResult["bridge_candidates"][number]["basis"] =>
  /(?:^|\/)libs\/[^/]+\/lib[^/]+\.so$/iu.test(path)
    ? "napi-library-convention"
    : "managed-and-native-content";
