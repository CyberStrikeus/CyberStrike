import type { JsonValue } from "../../domain/jsonValue.js";
import { createEvidence } from "../../domain/evidence.js";
import {
  readRuntimeReconciliationInput,
  reconcileJavaScriptRuntime,
} from "../../domain/javascript/javascriptRuntimeReconciliation.js";
import {
  JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE,
  JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
} from "./javascriptRuntimeReconciliationExample.js";
import { createHistoricalSourceGraph } from "../../domain/referenceSourceGraph.js";
import { reconcileJavaScriptRuntimeInputSchema } from "../../domain/javascript/javascriptRuntimeReconciliationSchemas.js";

const reconciliationInput = readRuntimeReconciliationInput(
  reconcileJavaScriptRuntimeInputSchema.parse(
    JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE,
  ),
);
if (!reconciliationInput.ok)
  throw new Error(
    "The JavaScript runtime reconciliation contract example is invalid",
    { cause: reconciliationInput.error },
  );
const reconciliation = reconcileJavaScriptRuntime(reconciliationInput.value);
const reconciliationEvidence = createEvidence(
  undefined,
  {
    id: "rea-javascript-runtime-reconciliation",
    name: "REA JavaScript runtime reconciliation",
    version: "1",
  },
  {
    predicateType: "rea.javascript-runtime-reconciliation",
    operation: "reconcile_javascript_runtime",
    parameters: {
      static_layers:
        JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.static_layers.map(
          ({ analysis }) => ({
            role: "application",
            evidence_id: analysis.evidence_id,
            runtime_mappings: [],
          }),
        ),
      runtime_evidence_ids:
        JAVASCRIPT_RUNTIME_RECONCILIATION_EXAMPLE.runtime_observations.map(
          ({ evidence_id: id }) => id,
        ),
    },
    result: reconciliation,
    confidence: "inferred",
    authority: "analyst-inference",
    limitations: reconciliation.limitations,
    evidenceLinks: reconciliation.evidence_links,
  },
);
const TRACE_SEED = {
  kind: "module" as const,
  value: "renderer.js",
  match: "exact" as const,
  case_sensitive: false,
};
/** Natural trace request with the producer's complete Evidence inline. */
export const JAVASCRIPT_FEATURE_TRACE_EXAMPLE = {
  application: JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE,
  seed: TRACE_SEED,
  direction: "both" as const,
};

/** Natural version comparison with both Evidence records inline. */
export const JAVASCRIPT_APPLICATION_VERSION_COMPARISON_EXAMPLE = {
  left: JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE,
  right: reconciliationEvidence,
};

/** Historical source inventory compared with inline application Evidence. */
export const SOURCE_TO_BUNDLE_COMPARISON_EXAMPLE = {
  reference: createHistoricalSourceGraph({
    schema: "HistoricalSourceGraph",
    authority: "historical-reference",
    root_alias: "$REFERENCE_ROOT",
    inventory_state: "complete",
    entries: [
      {
        path: "src",
        kind: "directory",
        classifications: ["source"],
        tree_state: "enumerated",
        limitations: [],
      },
      {
        path: "src/main.ts",
        kind: "file",
        sha256: "2".repeat(64),
        size: 128,
        language: "TypeScript",
        classifications: ["source"],
        content_state: "hashed",
        limitations: [],
      },
    ],
    relationships: [],
    parse_failures: [],
    exclusions: [],
    languages: ["TypeScript"],
    manifests: [],
    vcs: { kind: "none", head: null, dirty: null },
    provenance: {
      importer: "rea",
      importer_version: "1",
      caller: "contract-example",
    },
    limitations: [],
  }),
  application: JAVASCRIPT_APPLICATION_EVIDENCE_EXAMPLE,
} satisfies Readonly<Record<string, JsonValue>>;
