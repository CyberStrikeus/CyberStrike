import { z } from "zod";

import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { logicalPathEscapesRoot } from "../artifactIdentity.js";
import { evidenceSchema } from "../evidence.js";
import type { EvidenceRequestFrameInput } from "../evidenceInputContract.js";
import { javascriptRuntimeUnresolvedLocationSchema } from "./javascriptRuntimeObservation.js";
import { javascriptApplicationGraphSchema } from "./javascriptApplicationGraph.js";
import { digestSchema, prefixedDigestSchema } from "../digests.js";
import { urlDeclaresQueryOrFragment } from "../urlComponents.js";

const evidenceIdSchema = prefixedDigestSchema("ev");
const nodeIdSchema = prefixedDigestSchema("jag_node");
const boundedTextSchema = z.string().min(1);
const safePrefixSchema = z
  .string()
  .refine(
    (value) =>
      value === "" ||
      (!logicalPathEscapesRoot(value) &&
        value.split("/").every((part) => !["", ".", ".."].includes(part))),
    "Artifact prefix must be empty or a safe relative POSIX path",
  );

const runtimeFileMappingSchema = z.strictObject({
  kind: z.literal("file-root"),
  root: z.string().min(1),
  artifact_prefix: safePrefixSchema.default(""),
});

const runtimeUrlMappingSchema = z.strictObject({
  kind: z.literal("url-prefix"),
  prefix: z
    .string()
    .min(1)
    .refine(
      (value) => normalizeRuntimeUrlPrefix(value) !== null,
      "Runtime URL prefix must be HTTP(S) without credentials, query, or fragment",
    )
    .overwrite((value) => normalizeRuntimeUrlPrefix(value) ?? value),
  artifact_prefix: safePrefixSchema.default(""),
});

const normalizeRuntimeUrlPrefix = (value: string): string | null => {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    // Invalid input is represented by the null return.
    void cause;
    return null;
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    url.username !== "" ||
    url.password !== "" ||
    urlDeclaresQueryOrFragment(url)
  )
    return null;
  if (!url.pathname.endsWith("/")) url.pathname += "/";
  return url.href;
};

/** Caller-declared translation from an authorized runtime location to a layer. */
const runtimeLocationMappingSchema = z.discriminatedUnion("kind", [
  runtimeFileMappingSchema,
  runtimeUrlMappingSchema,
]);
type RuntimeLocationMapping = z.infer<typeof runtimeLocationMappingSchema>;

const staticLayerSchema = z.strictObject({
  role: z.enum(["application", "cache", "assets"]).default("application"),
  analysis: evidenceSchema,
  runtime_mappings: z
    .array(runtimeLocationMappingSchema)
    .overwrite(normalizeRuntimeMappings)
    .default([]),
});

function normalizeRuntimeMappings(
  mappings: RuntimeLocationMapping[],
): RuntimeLocationMapping[] {
  return [
    ...new Map(
      mappings.map((mapping) => [runtimeMappingKey(mapping), mapping]),
    ).values(),
  ].sort((left, right) =>
    compareUnicodeCodePoints(runtimeMappingKey(left), runtimeMappingKey(right)),
  );
}

function runtimeMappingKey(mapping: RuntimeLocationMapping): string {
  return mapping.kind === "file-root"
    ? `file-root\0${mapping.root}\0${mapping.artifact_prefix}`
    : `url-prefix\0${mapping.prefix}\0${mapping.artifact_prefix}`;
}

const validateReconciliationIdentities = (
  input: {
    readonly static_layers: readonly {
      readonly role: "application" | "cache" | "assets";
      readonly analysis: { readonly evidence_id: string };
    }[];
    readonly runtime_observations: readonly { readonly evidence_id: string }[];
  },
  context: z.RefinementCtx,
): void => {
  if (
    input.static_layers.filter(({ role }) => role === "application").length !==
    1
  )
    context.addIssue({
      code: "custom",
      path: ["static_layers"],
      message: "Exactly one application static layer is required",
    });
  const staticIds = input.static_layers.map(
    ({ analysis }) => analysis.evidence_id,
  );
  if (new Set(staticIds).size !== staticIds.length)
    context.addIssue({
      code: "custom",
      path: ["static_layers"],
      message: "Static layer Evidence must be unique",
    });
  const runtimeIds = input.runtime_observations.map(
    ({ evidence_id: id }) => id,
  );
  if (new Set(runtimeIds).size !== runtimeIds.length)
    context.addIssue({
      code: "custom",
      path: ["runtime_observations"],
      message: "Runtime observation Evidence must be unique",
    });
};

/** Verify layer roles and source uniqueness without copying retained payloads. */
export const runtimeReconciliationIdentitiesSchema = z
  .object({
    static_layers: z.array(
      z.object({
        role: z.enum(["application", "cache", "assets"]),
        analysis: z.object({ evidence_id: evidenceIdSchema }),
      }),
    ),
    runtime_observations: z.array(z.object({ evidence_id: evidenceIdSchema })),
  })
  .superRefine(validateReconciliationIdentities);

/** Evidence-backed static layers and passive captures to reconcile. */
export const reconcileJavaScriptRuntimeInputSchema = z
  .strictObject({
    static_layers: z.array(staticLayerSchema).min(1),
    runtime_observations: z.array(evidenceSchema).min(1),
  })
  .superRefine(validateReconciliationIdentities);

const layerSummarySchema = z.strictObject({
  layer_id: prefixedDigestSchema("jrl"),
  role: z.enum(["application", "cache", "assets"]),
  evidence_id: evidenceIdSchema,
  graph_id: prefixedDigestSchema("jag"),
  root_artifact_sha256: digestSchema,
  input_path: z.string().min(1),
  format: z.enum(["asar", "directory"]),
  runtime_mappings: z.array(runtimeLocationMappingSchema),
});

const captureSummarySchema = z.strictObject({
  evidence_id: evidenceIdSchema,
  capture_sha256: digestSchema,
  kind: z.enum(["browser", "electron", "v8-inspector", "electron-active"]),
  target_node_id: nodeIdSchema,
  target_key: boundedTextSchema,
  target_location: z
    .string()
    .min(1)
    .or(javascriptRuntimeUnresolvedLocationSchema),
  frames: z.int().min(0),
  scripts: z.int().min(0),
  workers: z.int().min(0),
  scripts_complete_within_scope: z.boolean(),
});

const reconciliationReasonSchema = z.enum([
  "content-and-location-match",
  "unique-content-match",
  "unique-location-match",
  "ambiguous-static-candidates",
  "captured-content-disagrees-with-static-location",
  "no-static-content-match",
  "no-authorized-location-mapping",
  "runtime-location-unresolved",
  "runtime-frame-unattributed",
  "static-or-runtime-coverage-incomplete",
  "reconciliation-limit-reached",
]);

const reconciliationItemShape = {
  reconciliation_id: prefixedDigestSchema("jrr_item"),
  entity_kind: z.enum(["target", "frame", "script", "worker"]),
  runtime_evidence_id: evidenceIdSchema,
  runtime_node_id: nodeIdSchema,
  basis: z.enum([
    "content-and-location",
    "content-sha256",
    "module-source-sha256",
    "artifact-path",
    "operator-file-mapping",
    "operator-url-mapping",
    "none",
  ]),
  confidence: z.enum(["exact", "high", "medium", "low", "unknown"]),
  reason: reconciliationReasonSchema,
  candidate_static_count: z.int().min(0),
  candidate_static_nodes: z.array(
    z.strictObject({
      static_layer_id: prefixedDigestSchema("jrl"),
      static_node_id: nodeIdSchema,
    }),
  ),
};
const reconciliationItemSchema = z.union([
  z.strictObject({
    ...reconciliationItemShape,
    static_layer_id: prefixedDigestSchema("jrl"),
    static_node_id: nodeIdSchema,
    status: z.literal("matched"),
  }),
  z.strictObject({
    ...reconciliationItemShape,
    static_layer_id: z.null(),
    static_node_id: z.null(),
    status: z.enum(["ambiguous", "unmatched", "unknown"]),
  }),
]);

const staticLoadStateSchema = z.strictObject({
  static_layer_id: prefixedDigestSchema("jrl"),
  static_node_id: nodeIdSchema,
  kind: z.enum(["javascript-asset", "javascript-chunk", "javascript-module"]),
  status: z.enum([
    "loaded",
    "resident-in-loaded-asset",
    "not-observed-in-capture",
    "unknown",
  ]),
  runtime_node_ids: z.array(nodeIdSchema),
  reason: z.enum([
    "runtime-script-correspondence",
    "containing-asset-was-loaded",
    "not-observed-in-bounded-capture",
    "layer-outside-runtime-scope",
    "static-or-runtime-coverage-incomplete",
    "ambiguous-runtime-candidate",
  ]),
});

/** Deterministic static/passive-runtime reconciliation with a combined JAG. */
export const javascriptRuntimeReconciliationResultSchema = z.strictObject({
  reconciliation_id: prefixedDigestSchema("jrr"),
  static_layers: z.array(layerSummarySchema).min(1),
  runtime_captures: z.array(captureSummarySchema).min(1),
  graph: javascriptApplicationGraphSchema,
  summary: z.strictObject({
    runtime_targets: z.int().min(0),
    runtime_frames: z.int().min(0),
    runtime_scripts: z.int().min(0),
    runtime_workers: z.int().min(0),
    matched: z.int().min(0),
    ambiguous: z.int().min(0),
    unmatched: z.int().min(0),
    unknown: z.int().min(0),
    static_loaded: z.int().min(0),
    static_resident: z.int().min(0),
    static_not_observed: z.int().min(0),
    static_unknown: z.int().min(0),
  }),
  reconciliations: z.array(reconciliationItemSchema),
  static_load_states: z.array(staticLoadStateSchema),
  source_map_authority: z.strictObject({
    used_for_primary_matching: z.literal(false),
    static_layer_count: z.int().min(0),
    runtime_script_declarations: z.int().min(0),
    limitation: boundedTextSchema,
  }),
  coverage: z.strictObject({
    status: z.enum(["complete-within-inputs", "partial", "truncated"]),
    truncated: z.boolean(),
    omitted_runtime_entities: z.int().min(0),
    omitted_reconciliation_items: z.int().min(0),
    omitted_static_load_states: z.int().min(0),
    omitted_graph_items: z.int().min(0),
  }),
  evidence_links: z.array(evidenceIdSchema).min(2),
  limitations: z.array(boundedTextSchema),
});

export type ReconcileJavaScriptRuntimeInput = z.infer<
  typeof reconcileJavaScriptRuntimeInputSchema
>;
/** Admitted ordinary request facts; each source still needs owner authentication. */
export type ReconcileJavaScriptRuntimeFrame =
  EvidenceRequestFrameInput<ReconcileJavaScriptRuntimeInput>;
export type JavaScriptRuntimeReconciliationResult = z.infer<
  typeof javascriptRuntimeReconciliationResultSchema
>;
export type JavaScriptRuntimeReconciliationItem = z.infer<
  typeof reconciliationItemSchema
>;
export type JavaScriptStaticLoadState = z.infer<typeof staticLoadStateSchema>;
