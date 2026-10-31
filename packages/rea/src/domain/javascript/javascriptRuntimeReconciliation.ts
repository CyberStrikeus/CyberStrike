import { classifyStaticLoadStates } from "./javascriptRuntimeLoadState.js";
import { buildReconciledApplicationGraph } from "./javascriptRuntimeReconciliationGraph.js";
import { reconcileRuntimeEntities } from "./javascriptRuntimeReconciliationMatching.js";
import {
  parseStaticLayer,
  type ParsedStaticLayer,
} from "./javascriptRuntimeReconciliationParsing.js";
import {
  parseRuntimeCapture,
  type ParsedRuntimeCapture,
} from "./javascriptRuntimeReconciliationCaptureParsing.js";
import { createJavaScriptRuntimeReconciliationResult } from "./javascriptRuntimeReconciliationResult.js";
import type {
  JavaScriptRuntimeReconciliationResult,
  ReconcileJavaScriptRuntimeFrame,
  ReconcileJavaScriptRuntimeInput,
} from "./javascriptRuntimeReconciliationSchemas.js";
import { projectRuntimeCaptures } from "./javascriptRuntimeReconciliationRuntime.js";
import { collectStaticRuntimeCandidates } from "./javascriptRuntimeStaticCandidates.js";
import { AnalysisInputError } from "../analysisErrorCore.js";
import { compareUnicodeCodePoints } from "../unicodeCodePointOrder.js";
import { err, ok, type Result } from "../result.js";

/** Verified caller input and the static and runtime facts parsed from it. */
export interface ParsedRuntimeReconciliationInput {
  readonly input: ReconcileJavaScriptRuntimeInput;
  readonly layers: readonly ParsedStaticLayer[];
  readonly captures: readonly ParsedRuntimeCapture[];
}

/** Parse caller Evidence once into the owner consumed by reconciliation. */
export const readRuntimeReconciliationInput = (
  input: ReconcileJavaScriptRuntimeFrame,
): Result<ParsedRuntimeReconciliationInput, AnalysisInputError> => {
  try {
    const layers: ParsedStaticLayer[] = [];
    const captures: ParsedRuntimeCapture[] = [];
    // Preserve caller source order in Evidence parameters while the algorithm
    // consumes deterministically sorted facts. Only authenticated records enter
    // the canonical input returned to the Evidence constructor.
    const staticLayers = input.static_layers.map((layer, index) => {
      const parsed = parseStaticLayer(layer, [
        "static_layers",
        index,
        "analysis",
      ]);
      layers.push(parsed);
      return { ...layer, analysis: parsed.evidence };
    });
    const runtimeObservations = input.runtime_observations.map(
      (observation, index) => {
        const parsed = parseRuntimeCapture(observation, [
          "runtime_observations",
          index,
        ]);
        captures.push(parsed);
        return parsed.evidence;
      },
    );
    return ok({
      input: {
        ...input,
        static_layers: staticLayers,
        runtime_observations: runtimeObservations,
      },
      layers: layers.sort((left, right) =>
        compareUnicodeCodePoints(left.layerId, right.layerId),
      ),
      captures: captures.sort((left, right) =>
        compareUnicodeCodePoints(
          left.evidence.evidence_id,
          right.evidence.evidence_id,
        ),
      ),
    });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisInputError) return err(cause);
    throw cause;
  }
};

/** Reconcile static JAG layers with authorized passive CDP Evidence. */
export const reconcileJavaScriptRuntime = (
  parsed: ParsedRuntimeReconciliationInput,
): JavaScriptRuntimeReconciliationResult => {
  const { layers, captures } = parsed;
  const runtime = projectRuntimeCaptures(captures);
  const candidates = collectStaticRuntimeCandidates(layers);
  const matching = reconcileRuntimeEntities({
    entities: runtime.entities,
    candidates,
    layers,
  });
  const loadStates = classifyStaticLoadStates(
    layers,
    captures,
    runtime.entities,
    matching.items,
    {
      reconciliationComplete:
        runtime.omittedEntities === 0 && matching.omittedItems === 0,
    },
  );
  const graph = buildReconciledApplicationGraph({
    layers,
    captures,
    runtime,
    reconciliationEdges: matching.edges,
    omittedReconciliationItems: matching.omittedItems,
  });
  return createJavaScriptRuntimeReconciliationResult({
    layers,
    captures,
    runtime,
    matching,
    loadStates,
    graph: graph.graph,
    omittedGraphItems: graph.omittedGraphItems,
  });
};
