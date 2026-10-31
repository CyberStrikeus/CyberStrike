import { z } from "zod";

/** Complete static checkpoint / per-script result transport ceiling. */
export const JAVASCRIPT_STATIC_FACT_BYTES = 8 * 1024 * 1024;
/** Maximum encoded worker transfer record, including the JSON envelope and newline. */
export const JAVASCRIPT_ANALYSIS_TRANSFER_RECORD_BYTES = 8 * 1024 * 1024;
import type { JsonValue } from "../jsonValue.js";
import type { ApplicationCoverage } from "./javascriptApplicationEvidenceSchemas.js";

/** Shared operational defaults for the isolated source-analysis boundary. */
export const JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS = {
  heapMb: 1024,
  timeoutMs: 300_000,
  semanticNodes: 100_000,
  semanticNodesPerFile: 20_000,
  semanticUnknowns: 100_000,
  semanticUnknownsPerFile: 20_000,
} as const;

/** Inclusive `max_heap_mb` range. The worker reads it only when that process starts. */
export const JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM = 128;
export const JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM = 16_384;

/** Maximum caller-selected retained record capacity; heap and transfer admission still apply. */
export const JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM = 1_000_000;

const HEAP_DOES_NOT_RAISE =
  "Raising max_heap_mb does not raise the parent result budget, transfer record or transfer file byte ceilings, the CLI/MCP process heap, or fixed parser limits.";

/**
 * Recovery for the isolated analyzer heap. A changed value applies on the next
 * analysis because the V8 flag is fixed at worker launch and a different heap
 * is not reused.
 */
export const javaScriptWorkerHeapRemediation = (heapMb: number): string => {
  const bounds = `an integer from ${String(JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM)} to ${String(JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM)} (default ${String(JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.heapMb)} MiB)`;
  const adjustment =
    heapMb >= JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM
      ? `max_heap_mb is already ${String(heapMb)} MiB, the maximum ${String(JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM)}. Do not increase it further.`
      : `Increase max_heap_mb (CLI: rea analyze-javascript-application <input_path> --max-heap-mb <mebibytes>), ${bounds}.`;
  return `${adjustment} The effective worker heap for this analysis is ${String(heapMb)} MiB. A changed max_heap_mb applies on the next analysis, which starts a new worker. It does not change a worker that is already running, and it does not require restarting the REA server. ${HEAP_DOES_NOT_RAISE} On Bun, V8 heap flags are ignored: Windows limits the analyzer's committed memory to max_heap_mb plus a 512 MiB reserve, and other Bun hosts enforce no analyzer heap limit.`;
};

/**
 * Node control for the CLI/MCP process heap. The old-space flag requires a
 * mebibyte value; a bare name is an illegal V8 option and prevents Node from
 * starting.
 */
export const JAVASCRIPT_PARENT_HEAP_NODE_OPTIONS =
  "On Node, set NODE_OPTIONS (for example --max-old-space-size=<MiB>) in the environment that starts the CLI or MCP server, then restart that process,";

/** Parent admission follows the CLI/MCP heap, not the isolated worker heap argument. */
export const JAVASCRIPT_PARENT_RESULT_BUDGET_REMEDIATION = `This limit belongs to the parent result budget. That budget follows the parent V8 heap limit. Increasing max_heap_mb does not raise it. ${JAVASCRIPT_PARENT_HEAP_NODE_OPTIONS} to raise the parent heap and this budget. Use the retained static facts or analyze fewer source files.`;

/** Checkpoint decode uses the parent heap, not the isolated worker heap argument. */
export const JAVASCRIPT_PARENT_CHECKPOINT_HEAP_REMEDIATION = `This limit belongs to the parent process heap. Increasing max_heap_mb does not raise it. max_heap_mb changes only the isolated analyzer, on the next analysis, by starting a new worker. ${JAVASCRIPT_PARENT_HEAP_NODE_OPTIONS} to raise the parent heap and admit this checkpoint.`;

/**
 * Heap-exhaustion exit text. Node exhausted the configured V8 old-space.
 * Bun ignores that flag, so the same diagnostic must not name it as the cause.
 */
export const javaScriptWorkerHeapExhaustionRecovery = (input: {
  readonly heapFlagsEnforced: boolean;
  readonly heapMb: number;
  readonly path: string;
  readonly phase: string;
}): { readonly reason: string; readonly remediationAction: string } => {
  if (input.heapFlagsEnforced)
    return {
      reason: `Owned JavaScript worker exhausted its ${String(input.heapMb)} MiB V8 old-space heap (max_heap_mb) while analyzing ${input.path} during ${input.phase}`,
      remediationAction: javaScriptWorkerHeapRemediation(input.heapMb),
    };
  return {
    reason: `Owned JavaScript worker ran out of memory while analyzing ${input.path} during ${input.phase}. Bun ignores the V8 old-space flag, so this exit is not the configured max_heap_mb limit of ${String(input.heapMb)} MiB.`,
    remediationAction:
      "Bun ignores V8 heap flags, so raising max_heap_mb does not change this exit. Windows limits the analyzer's committed memory to max_heap_mb plus a 512 MiB reserve and reports that separately as a process memory limit. Other Bun hosts enforce no analyzer heap limit. Reduce the analysis instead of increasing max_heap_mb.",
  };
};

const semanticControl = {
  nodes: {
    total: "max_semantic_nodes",
    perFile: "max_semantic_nodes_per_file",
    ceiling: "semantic_graph_node_ceiling",
    fileCeiling: "semantic_graph_file_node_ceiling",
    totalDefault: JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticNodes,
    perFileDefault: JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticNodesPerFile,
    cliTotal: "--max-semantic-nodes",
    cliPerFile: "--max-semantic-nodes-per-file",
    doesNotRaise:
      "max_semantic_unknowns, max_heap_mb, transfer ceilings, or the parent result budget",
  },
  unknowns: {
    total: "max_semantic_unknowns",
    perFile: "max_semantic_unknowns_per_file",
    ceiling: "semantic_graph_unknown_ceiling",
    fileCeiling: "semantic_graph_file_unknown_ceiling",
    totalDefault: JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticUnknowns,
    perFileDefault:
      JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.semanticUnknownsPerFile,
    cliTotal: "--max-semantic-unknowns",
    cliPerFile: "--max-semantic-unknowns-per-file",
    doesNotRaise:
      "max_semantic_nodes, max_heap_mb, transfer ceilings, or the parent result budget",
  },
} as const;

const semanticAdjustment = (
  name: string,
  value: number,
  fallback: number,
): string =>
  value >= JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM
    ? `${name} is already ${String(value)}, the maximum ${String(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)}. Do not increase it further.`
    : `${name} is ${String(value)} (default ${String(fallback)}; an integer from 1 to ${String(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)})`;

/**
 * Name the caller arguments for one semantic retention ceiling.
 * Coverage limits list both effective values. The limitation claims only
 * the ceilings that stopped retention.
 */
export const javaScriptSemanticCeilingCoverage = (
  kind: "nodes" | "unknowns",
  total: number,
  perFile: number,
  reached: { readonly total: boolean; readonly perFile: boolean },
): {
  readonly limits: ApplicationCoverage["limits"];
  readonly limitation: string;
} => {
  const control = semanticControl[kind];
  const limits: ApplicationCoverage["limits"] = [
    { name: control.ceiling, value: total, unit: "items" },
    { name: control.fileCeiling, value: perFile, unit: "items" },
    { name: control.total, value: total, unit: "items" },
    { name: control.perFile, value: perFile, unit: "items" },
  ];
  const reachedControls = [
    ...(reached.total
      ? [
          {
            name: control.total,
            value: total,
            fallback: control.totalDefault,
            cli: control.cliTotal,
          },
        ]
      : []),
    ...(reached.perFile
      ? [
          {
            name: control.perFile,
            value: perFile,
            fallback: control.perFileDefault,
            cli: control.cliPerFile,
          },
        ]
      : []),
  ];
  if (reachedControls.length === 0)
    throw new RangeError(
      "Semantic ceiling coverage requires a ceiling that stopped retention",
    );
  const reachedText = reachedControls
    .map((item) => semanticAdjustment(item.name, item.value, item.fallback))
    .join(" and ");
  const names = reachedControls.map((item) => item.name).join(" and ");
  const cli = reachedControls.map((item) => item.cli).join(" and ");
  const raising = reachedControls.length === 1 ? "Raising it" : "Raising them";
  const limitation = `Semantic ${kind === "nodes" ? "node" : "unknown"} retention reached ${reachedText}. Set ${names} on the next analyze_javascript_application call (CLI: ${cli}). The change applies to that next analysis and does not restart the worker or the REA server. ${raising} does not raise ${control.doesNotRaise}. Coverage reports the same effective values as ${control.ceiling} and ${control.fileCeiling}.`;
  return { limits, limitation };
};

/** Project observed execution limits without inventing unmeasured values. */
export const javaScriptAnalysisCoverageLimits = (
  limits: Readonly<Record<string, JsonValue>> | null,
): ApplicationCoverage["limits"] => {
  const result: ApplicationCoverage["limits"] = [];
  for (const key of [
    "worker_heap_limit_bytes",
    "worker_process_memory_limit_bytes",
    "worker_timeout_ms",
    "parent_result_budget_bytes",
    "parent_available_result_budget_bytes",
    "semantic_result_budget_bytes",
    "transfer_record_bytes",
    "transfer_file_bytes",
  ]) {
    const value = limits?.[key];
    if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0)
      continue;
    result.push({
      name: `javascript_analysis_${key}`,
      value,
      unit: key.endsWith("_ms") ? "milliseconds" : "bytes",
    });
  }
  return result;
};

/** Optional operational choices; omission keeps them out of Evidence parameters. */
export const javaScriptAnalysisResourceControlsSchema = z.strictObject({
  max_semantic_nodes: z
    .number()
    .int()
    .min(1)
    .max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)
    .optional()
    .describe(
      "Maximum retained semantic nodes across the application; defaults to 100000. Worker heap and parent result admission remain enforced.",
    ),
  max_semantic_nodes_per_file: z
    .number()
    .int()
    .min(1)
    .max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)
    .optional()
    .describe(
      "Maximum retained semantic nodes per source file; defaults to 20000, additionally bounded by max_semantic_nodes and memory/transfer limits.",
    ),
  max_semantic_unknowns: z
    .number()
    .int()
    .min(1)
    .max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)
    .optional()
    .describe(
      "Maximum retained semantic unknown records across the application; defaults to 100000. Omitted emission occurrences are counted by family and reason.",
    ),
  max_semantic_unknowns_per_file: z
    .number()
    .int()
    .min(1)
    .max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM)
    .optional()
    .describe(
      "Maximum retained semantic unknown records per source file; defaults to 20000, additionally bounded by max_semantic_unknowns and memory/transfer limits.",
    ),
  max_heap_mb: z
    .number()
    .int()
    .min(JAVASCRIPT_WORKER_HEAP_MIB_MINIMUM)
    .max(JAVASCRIPT_WORKER_HEAP_MIB_MAXIMUM)
    .optional()
    .describe(
      "Maximum V8 old-space heap in MiB for the isolated JavaScript source analyzer; defaults to 1024. This does not change the CLI/MCP process heap. When REA runs on Bun, which ignores V8 heap flags, Windows instead limits the analyzer's committed memory to this budget plus a 512 MiB runtime reserve; other Bun hosts enforce no limit.",
    ),
  analysis_timeout_ms: z
    .number()
    .int()
    .min(1)
    .max(2_147_483_647)
    .optional()
    .describe(
      "Maximum startup, analysis and transfer time per JavaScript source, in milliseconds; defaults to 300000. On timeout, return collected partial Evidence and stop the analysis.",
    ),
});
