import { z } from "zod";
import { browserExclusionSchema } from "./browserCompleteness.js";
import { webPageInspectionSchema } from "./browserObservationSchemas.js";
import { javaScriptRouteInventorySchema } from "./javascript/javascriptRouteInventory.js";

import {
  MAX_BROWSER_DEADLINE_MS,
  browserDeadlineIncrease,
  browserDeadlineRetry,
  noRuntimeOverrideSentence,
  optionalBrowserDeadlineMs,
} from "./browserDeadline.js";
import { emptyArraySchema } from "./emptyArraySchema.js";
import {
  inspectWebPageWithSourceInputSchema,
  recordedBrowserOriginSchema,
} from "./browserObservation.js";
import {
  webTextArtifactMetadataSchema,
  webTextArtifactSchema,
} from "./webContentArtifact.js";

/** Isolated analyzer heap used when max_heap_mb is omitted. */
export const DEFAULT_WEB_BUNDLE_HEAP_MB = 1024;
export const MIN_WEB_BUNDLE_HEAP_MB = 128;
export const MAX_WEB_BUNDLE_HEAP_MB = 16_384;
/** Per-script deadline used when analysis_timeout_ms is omitted. */
export const DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS = 30_000;
/** Total analysis deadline used when total_analysis_timeout_ms is omitted. */
export const DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS = 300_000;
/** Source-map fetch deadline used when source_map_fetch_timeout_ms is omitted. */
export const DEFAULT_SOURCE_MAP_FETCH_TIMEOUT_MS = 30_000;

const webBundleHeapDescription = `Heap phase: maximum V8 old-space for the isolated inert-script analyzer, in MiB (default ${String(DEFAULT_WEB_BUNDLE_HEAP_MB)}, range ${String(MIN_WEB_BUNDLE_HEAP_MB)}..${String(MAX_WEB_BUNDLE_HEAP_MB)}). Omitted means ${String(DEFAULT_WEB_BUNDLE_HEAP_MB)} and applies on the next call. This is not a total process RSS limit, not analysis_timeout_ms, and not total_analysis_timeout_ms. Bun ignores V8 flags; Windows Bun uses an owned process commit limit plus a 512 MiB runtime reserve, while other Bun hosts have no enforced memory limit. Raising max_heap_mb does not raise the fixed worker protocol or result byte budgets.`;

const webBundleScriptTimeoutDescription = `Per-script deadline phase: maximum startup, analysis and result transfer time for one captured script, in milliseconds (default ${String(DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS)}, range 1..${String(MAX_BROWSER_DEADLINE_MS)}). Omitted means ${String(DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS)}. deadlineExpired for one script is not total_analysis_timeout_ms. A per-script value above the effective total is rejected. Timed-out scripts are explicit unknowns and other scripts may still be analyzed. Applies on the next call.`;

const webBundleTotalTimeoutDescription = `Total analysis deadline phase: maximum time for all captured-script analysis, in milliseconds (default ${String(DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS)}, range 1..${String(MAX_BROWSER_DEADLINE_MS)}). Omitted means ${String(DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS)}. This is not the per-script analysis_timeout_ms, not capture, and not source-map fetch. A per-script timeout above this total is rejected. Unstarted scripts remain explicit unknowns. Applies on the next call.`;

/** Capture-and-analyze input with optional source-map fetching. */
export const analyzeWebBundleInputSchema = inspectWebPageWithSourceInputSchema
  .safeExtend({
    fetch_source_maps: z.boolean().default(false),
    max_heap_mb: z
      .number()
      .int()
      .min(MIN_WEB_BUNDLE_HEAP_MB)
      .max(MAX_WEB_BUNDLE_HEAP_MB)
      .optional()
      .describe(webBundleHeapDescription),
    analysis_timeout_ms: optionalBrowserDeadlineMs(
      webBundleScriptTimeoutDescription,
    ),
    total_analysis_timeout_ms: optionalBrowserDeadlineMs(
      webBundleTotalTimeoutDescription,
    ),
    source_map_fetch_timeout_ms: optionalBrowserDeadlineMs(
      `Source-map fetch deadline in milliseconds (default ${String(DEFAULT_SOURCE_MAP_FETCH_TIMEOUT_MS)}). Omitted means ${String(DEFAULT_SOURCE_MAP_FETCH_TIMEOUT_MS)} and applies on the next fetch. A fetch overrun is an item limitation (fetch_failed), not a thrown analysis timeout. Does not raise the fixed 64 MiB response budget or the source-map decode deadline. The response budget has no runtime override.`,
    ),
  })
  .superRefine((input, context) => {
    const perScript =
      input.analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS;
    const total =
      input.total_analysis_timeout_ms ?? DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS;
    if (perScript <= total) return;
    context.addIssue({
      code: "custom",
      path:
        input.analysis_timeout_ms === undefined
          ? ["total_analysis_timeout_ms"]
          : ["analysis_timeout_ms"],
      message: `analysis_timeout_ms ${String(perScript)} ms is the per-script deadline and must be less than or equal to total_analysis_timeout_ms ${String(total)} ms. A per-script timeout above the total is rejected. Omitted analysis_timeout_ms means ${String(DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS)}; omitted total_analysis_timeout_ms means ${String(DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS)}.`,
    });
  });
export type AnalyzeWebBundleInput = z.infer<typeof analyzeWebBundleInputSchema>;

/** Per-script deadlineExpired text. It is not the total analysis deadline. */
export const webBundleScriptTimeoutRecovery = (
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `analyze_web_bundle reached its ${String(timeoutMs)} ms per-script deadline (deadlineExpired) for analysis_timeout_ms. This is not total_analysis_timeout_ms and not the MCP client deadline.`,
  remediationAction: `${browserDeadlineIncrease("analysis_timeout_ms", timeoutMs, DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS, "--analysis-timeout-ms")} Keep it less than or equal to total_analysis_timeout_ms (omitted means ${String(DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS)}); a per-script timeout above the total is rejected. ${browserDeadlineRetry} analysis_timeout_ms does not raise max_heap_mb, total_analysis_timeout_ms, or the fixed worker protocol and result byte budgets.`,
});

/** Total captured-script deadlineExpired text. */
export const webBundleTotalTimeoutRecovery = (
  timeoutMs: number,
): { readonly userMessage: string; readonly remediationAction: string } => ({
  userMessage: `analyze_web_bundle reached its ${String(timeoutMs)} ms total captured-script analysis deadline (deadlineExpired) for total_analysis_timeout_ms. This is not the per-script analysis_timeout_ms, not capture, and not source-map fetch.`,
  remediationAction: `${browserDeadlineIncrease("total_analysis_timeout_ms", timeoutMs, DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS, "--total-analysis-timeout-ms")} A per-script analysis_timeout_ms above the total is rejected. ${browserDeadlineRetry} total_analysis_timeout_ms does not raise analysis_timeout_ms, max_heap_mb, source_map_fetch_timeout_ms, or the fixed worker byte budgets.`,
});

/**
 * Which resource the analyzer actually exhausted.
 * Node enforces the V8 old-space flag. Windows Bun enforces a process commit
 * limit of that heap plus a 512 MiB reserve. Other Bun hosts enforce neither.
 */
export type WebBundleMemoryExhaustion =
  | { readonly kind: "v8-heap"; readonly heapMb: number }
  | {
      readonly kind: "process-commit";
      readonly heapMb: number;
      readonly limitBytes: number;
    }
  | {
      readonly kind: "bun-allocation";
      readonly heapMb: number;
      readonly processMemoryLimitBytes: number | null;
    };

/** Map host facts onto the exhausted resource. The worker supplies those facts. */
export const webBundleMemoryExhaustion = (input: {
  readonly runtime: "node" | "bun";
  readonly heapMb: number;
  readonly memoryLimitReached: boolean;
  readonly processMemoryLimitBytes: number | null;
}): WebBundleMemoryExhaustion => {
  if (input.runtime === "node")
    return { kind: "v8-heap", heapMb: input.heapMb };
  if (input.memoryLimitReached && input.processMemoryLimitBytes !== null)
    return {
      kind: "process-commit",
      heapMb: input.heapMb,
      limitBytes: input.processMemoryLimitBytes,
    };
  return {
    kind: "bun-allocation",
    heapMb: input.heapMb,
    processMemoryLimitBytes: input.processMemoryLimitBytes,
  };
};

const webBundleHeapRange = (): string =>
  `range ${String(MIN_WEB_BUNDLE_HEAP_MB)}..${String(MAX_WEB_BUNDLE_HEAP_MB)}; omitted means ${String(DEFAULT_WEB_BUNDLE_HEAP_MB)}`;

const webBundleHeapIncrease = (heapMb: number): string =>
  heapMb < MAX_WEB_BUNDLE_HEAP_MB
    ? `Increase max_heap_mb above ${String(heapMb)} (integer MiB from ${String(MIN_WEB_BUNDLE_HEAP_MB)} to ${String(MAX_WEB_BUNDLE_HEAP_MB)}; omitted means ${String(DEFAULT_WEB_BUNDLE_HEAP_MB)}), or use --max-heap-mb on the CLI.`
    : `max_heap_mb is already at the maximum ${String(MAX_WEB_BUNDLE_HEAP_MB)} MiB; do not increase it further.`;

const webBundleHeapDoesNotRaise =
  "Applies on the next call. Raising max_heap_mb does not raise analysis_timeout_ms, total_analysis_timeout_ms, or the fixed worker protocol and result byte budgets. Those byte budgets have no runtime override.";

/** Heap exhaustion names the resource this runtime actually exhausted. */
export const webBundleHeapExhaustedReason = (
  exhaustion: WebBundleMemoryExhaustion,
): string => {
  const range = webBundleHeapRange();
  switch (exhaustion.kind) {
    case "v8-heap":
      return `Owned web analyzer exhausted its max_heap_mb V8 old-space heap of ${String(exhaustion.heapMb)} MiB (${range}). This is the isolated analyzer heap, not a process RSS limit.`;
    case "process-commit":
      return `Owned web analyzer reached its ${String(exhaustion.limitBytes)}-byte process commit limit. That limit is max_heap_mb ${String(exhaustion.heapMb)} MiB plus a 512 MiB Bun runtime reserve (${range}). Bun ignores the V8 old-space flag, so this is not V8 old-space exhaustion.`;
    case "bun-allocation":
      return exhaustion.processMemoryLimitBytes === null
        ? `Owned web analyzer ran out of memory. Bun ignores the V8 old-space flag, so this exit is not the configured max_heap_mb of ${String(exhaustion.heapMb)} MiB (${range}). This host enforces no analyzer process commit limit.`
        : `Owned web analyzer ran out of memory before its ${String(exhaustion.processMemoryLimitBytes)}-byte process commit limit was reported as reached. That configured limit is max_heap_mb ${String(exhaustion.heapMb)} MiB plus a 512 MiB Bun runtime reserve (${range}). Bun ignores the V8 old-space flag, so this exit is not V8 old-space exhaustion.`;
  }
};

export const webBundleHeapExhaustedRemediation = (
  exhaustion: WebBundleMemoryExhaustion,
): string => {
  switch (exhaustion.kind) {
    case "v8-heap":
      return `${webBundleHeapIncrease(exhaustion.heapMb)} ${webBundleHeapDoesNotRaise}`;
    case "process-commit":
      return `${webBundleHeapIncrease(exhaustion.heapMb)} That raises the Windows process commit limit (max_heap_mb plus the fixed 512 MiB Bun runtime reserve), not a V8 old-space heap. ${webBundleHeapDoesNotRaise}`;
    case "bun-allocation":
      return exhaustion.processMemoryLimitBytes === null
        ? `Bun ignores V8 heap flags, so raising max_heap_mb does not change this exit. A reached Windows process commit limit is reported separately. Other Bun hosts enforce no analyzer heap limit. Reduce the analysis instead of increasing max_heap_mb. ${webBundleHeapDoesNotRaise}`
        : `The configured ${String(exhaustion.processMemoryLimitBytes)}-byte process commit limit was not reported as reached, so raising max_heap_mb does not change this exit. A reached Windows process commit limit is reported separately. Reduce the analysis instead of increasing max_heap_mb. ${webBundleHeapDoesNotRaise}`;
  }
};

export const webBundleFixedByteBudget = (
  budgetBytes: number,
  label: string,
): string =>
  noRuntimeOverrideSentence(
    `The ${String(budgetBytes)}-byte web-bundle ${label} has no further room.`,
    "max_heap_mb",
  );

/**
 * Result admission failed because `min(fixedRemaining, hostCapacity)` is not
 * positive. The fixed allowance wins when it has no room left. Host pressure
 * is named only while that allowance still has room.
 */
export const webBundleResultAdmissionFailure = (input: {
  readonly fixedBudgetBytes: number;
  readonly fixedRemainingBytes: number;
  readonly hostCapacityBytes: number;
}):
  | {
      readonly kind: "fixed-budget";
      readonly reason: string;
      readonly reportedLimits: { readonly result_bytes: number };
    }
  | {
      readonly kind: "host-capacity";
      readonly reason: string;
      readonly remediationAction: string;
      readonly reportedLimits: {
        readonly result_bytes: number;
        readonly result_budget_remaining_bytes: number;
        readonly host_result_capacity_bytes: number;
      };
    } => {
  if (input.fixedRemainingBytes <= 0)
    return {
      kind: "fixed-budget",
      reason: webBundleFixedByteBudget(input.fixedBudgetBytes, "result budget"),
      reportedLimits: { result_bytes: input.fixedBudgetBytes },
    };
  return {
    kind: "host-capacity",
    reason: `The CLI/MCP host heap has no remaining reserved capacity for another web-bundle result (host result capacity ${String(input.hostCapacityBytes)} bytes). The fixed ${String(input.fixedBudgetBytes)}-byte result budget still has ${String(input.fixedRemainingBytes)} bytes available. This is host memory pressure, not exhaustion of that fixed allowance.`,
    remediationAction:
      "Retry when the CLI/MCP process has more heap headroom. On Node, set NODE_OPTIONS (for example --max-old-space-size=<MiB>) in the environment that starts the CLI or MCP server, then restart that process, to raise this host heap. Raising max_heap_mb changes the isolated analyzer, not this host admission. The fixed result budget is separate and was not exhausted.",
    reportedLimits: {
      result_bytes: input.fixedBudgetBytes,
      result_budget_remaining_bytes: input.fixedRemainingBytes,
      host_result_capacity_bytes: input.hostCapacityBytes,
    },
  };
};

const sourceLocationSchema = z.object({
  script_key: z.string(),
  line: z.int().min(1).nullable(),
  column: z.int().min(0).nullable(),
});

const basisSchema = z.object({
  script_key: z.string(),
  artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  line: z.int().min(1).nullable(),
  column: z.int().min(0).nullable(),
  detector: z.string(),
});

const findingSchema = z.object({
  value: z.string(),
  mechanism: z.string(),
  location: sourceLocationSchema,
});

const originalSourceSchema = z.object({
  source_index: z.int().min(0).optional(),
  declaration_index: z.int().min(0).optional(),
  source: z.string().nullable(),
  artifact: webTextArtifactSchema.nullable(),
});
const originalModuleEdgeSchema = z.object({
  // Historical observations omit this link to original_sources declarations.
  declaration_index: z.int().min(0).optional(),
  from_source: z.string(),
  kind: z.enum(["static_import", "dynamic_import", "require"]),
  specifier: z.string(),
  resolved_source: z.string().nullable(),
});
const sourceMapMappingSchema = z.object({
  source_index: z.int().min(0).optional(),
  declaration_index: z.int().min(0).optional(),
  generated_line: z.int().min(1),
  generated_column: z.int().min(0),
  source: z.string().nullable(),
  original_line: z.int().min(1),
  original_column: z.int().min(0),
  name: z.string().nullable(),
});
const sourceMapContextShape = {
  script_key: z.string(),
  declared_url: z.string(),
  // Older saved observations omit this field; current fetches emit string/null.
  effective_url: z.string().nullable().optional(),
};
const parsedSourceMapShape = {
  artifact: webTextArtifactSchema,
  original_sources: z.array(originalSourceSchema),
  original_module_edges: z.array(originalModuleEdgeSchema),
  mappings: z.array(sourceMapMappingSchema),
};
const responseIdentitySchema = z.object({
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  bytes: z.int().min(0),
  representation: z.literal("fetch-response-body-bytes"),
});

const sourceMapSchema = z.union([
  z.object({
    ...sourceMapContextShape,
    ...parsedSourceMapShape,
    status: z.literal("included"),
    limitation: z.null(),
  }),
  z.object({
    ...sourceMapContextShape,
    ...parsedSourceMapShape,
    status: z.literal("partial"),
    limitation: z.string(),
  }),
  z.object({
    ...sourceMapContextShape,
    ...parsedSourceMapShape,
    status: z.enum(["fetch_failed", "invalid"]),
    artifact: z.null(),
    /** Older observations omit this; completed bytes need it only when text is absent. */
    response_identity: responseIdentitySchema.exactOptional(),
    original_sources: emptyArraySchema,
    original_module_edges: emptyArraySchema,
    mappings: emptyArraySchema,
    limitation: z.string(),
  }),
  z.object({
    ...sourceMapContextShape,
    status: z.literal("policy_filtered"),
    artifact: z.null(),
    original_sources: emptyArraySchema,
    original_module_edges: emptyArraySchema,
    mappings: emptyArraySchema,
    limitation: z.string(),
  }),
]);

const webTextArtifactSummarySchema = webTextArtifactMetadataSchema.extend({
  text_available: z.literal(true),
});

export const webSourceMapsSchema = z
  .object({
    status: z.enum(["not_requested", "included", "partial", "unavailable"]),
    requested: z.int().min(0),
    processed: z.int().min(0),
    items: z.array(sourceMapSchema),
    /** Capture exclusions retain counts/reasons without disallowed URL details. */
    excluded: z
      .array(
        browserExclusionSchema.extend({ section: z.literal("source_maps") }),
      )
      .optional(),
    limitation: z.string().min(1).optional(),
  })
  .superRefine((sourceMaps, context) => {
    if (
      sourceMaps.processed > sourceMaps.requested ||
      sourceMaps.processed !== sourceMaps.items.length
    )
      context.addIssue({
        code: "custom",
        message: "Source-map coverage counts are inconsistent",
      });
    if (
      sourceMaps.processed < sourceMaps.requested &&
      sourceMaps.limitation === undefined
    )
      context.addIssue({
        code: "custom",
        message:
          "Unprocessed source maps require an explicit coverage limitation",
        path: ["limitation"],
      });
    const statuses = sourceMaps.items.map(({ status }) => status);
    const retained = statuses.filter(
      (status) => status === "included" || status === "partial",
    ).length;
    const allowedStatuses =
      sourceMaps.processed < sourceMaps.requested ||
      sourceMaps.excluded?.some(({ count }) => count === null || count > 0) ===
        true
        ? retained === 0
          ? ["unavailable"]
          : ["partial"]
        : sourceMaps.items.length === 0
          ? ["not_requested", "unavailable"]
          : retained === 0
            ? ["unavailable"]
            : retained === sourceMaps.items.length &&
                !statuses.includes("partial")
              ? ["included"]
              : ["partial"];
    if (!allowedStatuses.includes(sourceMaps.status))
      context.addIssue({
        code: "custom",
        message: "Source-map status contradicts retained coverage",
        path: ["status"],
      });
  });

export type WebSourceMapItem = z.infer<typeof sourceMapSchema>;
export type WebSourceMaps = z.infer<typeof webSourceMapsSchema>;

/** Completed fetch facts retained when source-map acquisition stops early. */
export const webSourceMapFetchPartialObservationSchema = z.object({
  kind: z.literal("web-source-map-fetch"),
  source_maps: webSourceMapsSchema,
});
export type WebSourceMapFetchPartialObservation = z.infer<
  typeof webSourceMapFetchPartialObservationSchema
>;

/** Captured page and completed maps before bundle analysis has begun. */
export const webBundleAcquisitionPartialObservationSchema = z.object({
  kind: z.literal("web-bundle-acquisition"),
  inspection: webPageInspectionSchema,
  source_maps: webSourceMapsSchema,
  analysis_status: z.literal("not_performed"),
});
export type WebBundleAcquisitionPartialObservation = z.infer<
  typeof webBundleAcquisitionPartialObservationSchema
>;

/** Provider-neutral result of JavaScript bundle reverse engineering. */
export const webBundleAnalysisSchema = z.object({
  route_inventory: javaScriptRouteInventorySchema.exactOptional(),
  capture: z.object({
    target_url: z.string(),
    // Older saved observations omit this field; current analyses retain the
    // validated HTTP(S) target origin or null when no browser origin exists.
    target_origin: recordedBrowserOriginSchema.nullable().optional(),
    scripts_observed: z.int().min(0),
    scripts_analyzed: z.int().min(0),
    source_artifacts: z.array(webTextArtifactSummarySchema),
  }),
  observations: z.object({
    chunks: z.object({
      nodes: z.array(
        z.object({
          script_key: z.string(),
          url: z.string(),
          artifact_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          bytes: z.int().min(0),
        }),
      ),
      edges: z.array(
        z.object({
          from_script_key: z.string(),
          kind: z.enum([
            "static_import",
            "dynamic_import",
            "require",
            "worker_import",
          ]),
          specifier: z.string(),
          resolved_url: z.string().nullable(),
          location: sourceLocationSchema,
        }),
      ),
    }),
    routes: z.array(findingSchema),
    endpoints: z.array(findingSchema),
    webmcp_declarations: z.array(
      z.object({
        name: z.string().nullable(),
        description: z.string().nullable(),
        schema_property_names: z
          .array(z.string())
          .describe(
            "Statically known own property names from the declared schema projection; a partial list may omit unresolved members.",
          ),
        schema_property_names_coverage: z
          .enum(["complete", "partial", "unknown", "not_present"])
          .optional()
          .describe(
            "Coverage of the schema property-name projection. Missing means unknown for historical observations. Not a schema-validity result.",
          ),
        trust: z.literal("page-declared-untrusted"),
        location: sourceLocationSchema,
      }),
    ),
    source_maps: webSourceMapsSchema,
  }),
  inferences: z.array(
    z.object({
      kind: z.enum([
        "vendor_fingerprint",
        "route_framework",
        "bundle_runtime",
        "endpoint_candidate",
      ]),
      value: z.string(),
      confidence: z.enum(["low", "medium", "high"]),
      basis: z.array(basisSchema).min(1),
    }),
  ),
  unknowns: z.array(
    z.object({
      dimension: z.string(),
      reason: z.string(),
      affected_script_keys: z.array(z.string()),
    }),
  ),
  completeness: z.object({
    status: z.enum(["complete", "partial"]),
    parsed_scripts: z.int().min(0),
    parse_failures: z.int().min(0),
    visited_ast_nodes: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});
export type WebBundleAnalysis = z.infer<typeof webBundleAnalysisSchema>;
