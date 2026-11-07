import { artifactNameForClassification } from "../../domain/artifactNameSelection.js";
import type { AnalysisSettingValues } from "../../domain/analysisSettings.js";
import { absoluteCallerPath } from "../../filesystem/callerPath.js";
import {
  DEFAULT_ASAR_HEADER_ADMISSION,
  type AsarHeaderAdmission,
} from "../../config/asarHeaderAdmission.js";
import { constants, type Stats } from "node:fs";
import {
  buildJavaScriptRouteInventorySteps,
  type JavaScriptRouteInventory,
} from "../../domain/javascript/javascriptRouteInventory.js";
import { access, realpath, stat } from "node:fs/promises";
import { setImmediate } from "node:timers/promises";

import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
  AnalysisUnsupportedTargetError,
} from "../../domain/analysisErrorCore.js";
import { createJavaScriptArtifactReader as createReader } from "../../artifacts/javascript/JavaScriptArtifactReader.js";
import type { JavaScriptApplicationGraph } from "../../domain/javascript/javascriptApplicationGraph.js";
import type { JavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticGraph.js";
import type { JavaScriptSourceSelection } from "../../domain/javascript/javascriptSourceSelection.js";
import {
  parseOwnedJavaScriptApplicationAnalysisSteps,
  type AnalyzeJavaScriptApplicationInput,
  type ElectronBoundarySummary,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import { ArtifactOperationError } from "../../domain/artifactOperationError.js";
import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import type { ArtifactInventoryPartialObservation } from "../../domain/artifactPartialObservation.js";
import type { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { analyzeAndAdoptJavaScriptArtifactFiles } from "./JavaScriptArtifactAnalysis.js";
import {
  isSkippedJavaScriptAnalysis,
  javascriptArtifactAnalysisScopes,
} from "./JavaScriptArtifactAnalysisTypes.js";
import { createJavaScriptSourceAnalysis } from "../../artifacts/javascript/JavaScriptSourceAnalysis.js";
import { JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS } from "../../domain/javascript/javascriptAnalysisResourceControls.js";
import { createOwnedJavaScriptApplicationEvidenceCooperatively } from "./JavaScriptApplicationEvidence.js";
import { readJavaScriptArtifactFiles } from "../../artifacts/javascript/JavaScriptArtifactFiles.js";
import { buildImmutableJavaScriptArtifactGraphSteps } from "./JavaScriptArtifactGraphBuilder.js";
import { scanCanonicalArtifactInventoryInScope } from "../../artifacts/inventory/scanCanonical.js";
import { createJavaScriptNextAppContext } from "./JavaScriptNextAppContext.js";
import { createJavaScriptSemanticGraphProjection } from "./JavaScriptSemanticGraphBuilder.js";
import type { ProgressReporter } from "../ProgressReporter.js";
import {
  checkpointJavaScriptAnalysis,
  completeJavaScriptAnalysisSteps,
} from "./JavaScriptAnalysisControl.js";

/** Application-layer result retaining local diagnostics outside the canonical graph. */
export interface JavaScriptArtifactReconstructionResult {
  readonly route_inventory?: JavaScriptRouteInventory;
  readonly input_path: string;
  readonly format: "asar" | "directory";
  readonly root_artifact_sha256: string;
  readonly inventory_manifest_id: string;
  readonly inventory_graph_sha256: string;
  readonly integrity_contradictions: ArtifactInventorySnapshot["integrity_contradictions"];
  readonly source_selection?: JavaScriptSourceSelection;
  readonly graph: JavaScriptApplicationGraph;
  readonly semantic_graph: JavaScriptSemanticGraph;
  readonly electron_summary: ElectronBoundarySummary;
  readonly statistics: {
    readonly relevant_files: number;
    readonly nested_asar_containers: number;
    readonly text_bytes_read: number;
    readonly invalid_utf8_files: number;
    readonly parsed_javascript_files: number;
    readonly skipped_javascript_files: number;
    readonly visited_ast_nodes: number;
    readonly findings: number;
    readonly modules: number;
    readonly parse_failures: number;
  };
  readonly limitations: readonly string[];
}

/** Reconstruct a parsed local ASAR/directory request without executing code. */
export const reconstructJavaScriptArtifact = async (
  input: AnalyzeJavaScriptApplicationInput,
  scope: ArtifactResourceScope,
  signal?: AbortSignal,
  progress?: ProgressReporter,
  asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
  overrides?: Readonly<Partial<AnalysisSettingValues>>,
): Promise<JavaScriptArtifactReconstructionResult> =>
  scope.run(async () => {
    const reportPhase = async (
      phase: string,
      message: string,
    ): Promise<void> => {
      await progress?.report({
        phase,
        completed: 0,
        total: 1,
        message,
      });
      await checkpointJavaScriptAnalysis(signal);
    };
    abortIfNeeded(signal);
    const selectedPath = absoluteCallerPath(input.input_path);
    const { path, metadata } = await resolveSelectedInput(selectedPath);
    const format = resolveFormat(path, metadata, input, selectedPath);
    const snapshot = await scanCanonicalArtifactInventoryInScope(
      path,
      {
        resourceScope: scope,
        signal,
        integrity: input.integrity_policy,
        asarHeaderAdmission,
      },
      undefined,
      selectedPath,
    );
    if (snapshot.manifest.root_format !== format)
      throw new ArtifactReaderFailure(
        "format",
        `Artifact inventory classified ${path} as ${snapshot.manifest.root_format}, not ${format}`,
      );
    const reader = createReader(
      path,
      format,
      asarHeaderAdmission,
      selectedPath,
    );
    const readerOwner = {
      kind: "reader" as const,
      reader,
      resource: `JavaScript artifact reader for ${path}`,
    };
    let readerOpen = true;
    let reconstructionOutcome:
      | {
          readonly kind: "completed";
          readonly result: JavaScriptArtifactReconstructionResult;
        }
      | { readonly kind: "failed"; readonly cause: unknown };
    try {
      await reportPhase(
        "read_javascript_artifacts",
        "Reading inventoried JavaScript application sources",
      );
      const files = await readJavaScriptArtifactFiles(
        reader,
        snapshot,
        scope,
        signal,
        input.source_paths,
        asarHeaderAdmission,
      );
      // Release acquisition before analysis consumes these owned file facts.
      const earlyCleanup = await scope.release(readerOwner);
      readerOpen = false;
      if (earlyCleanup.kind === "failed")
        throw scope.cleanupFailure({ kind: "completed" }, [earlyCleanup], {
          kind: "artifact-inventory",
          inventory: snapshot,
        });
      await reportPhase(
        "parse_javascript_sources",
        `Processing ${String(files.files.length - (files.source_selection?.unselected_files ?? 0))} selected application files`,
      );
      const semanticProjection = createJavaScriptSemanticGraphProjection({
        ...(input.max_semantic_unknowns === undefined
          ? {}
          : { totalUnknowns: input.max_semantic_unknowns }),
        ...(input.max_semantic_unknowns_per_file === undefined
          ? {}
          : { fileUnknowns: input.max_semantic_unknowns_per_file }),
        ...(input.max_semantic_nodes === undefined
          ? {}
          : { totalNodes: input.max_semantic_nodes }),
        ...(input.max_semantic_nodes_per_file === undefined
          ? {}
          : { fileNodes: input.max_semantic_nodes_per_file }),
      });
      const worker = await createJavaScriptSourceAnalysis(
        {
          heapMb:
            input.max_heap_mb ??
            overrides?.["javascript.max_heap_mb"] ??
            JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.heapMb,
          timeoutMs:
            input.analysis_timeout_ms ??
            overrides?.["javascript.analysis_timeout_ms"] ??
            JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS.timeoutMs,
        },
        files.files.filter(
          (file) => file.kind === "javascript" && file.text.included,
        ).length,
        { scope },
      );
      let outcome;
      let cleanupFailure: AnalysisError | undefined;
      try {
        outcome = await analyzeAndAdoptJavaScriptArtifactFiles(
          files,
          worker,
          semanticProjection,
          async (file, completed, total) => {
            abortIfNeeded(signal);
            const ast =
              javascriptArtifactAnalysisScopes[file.kind]?.authority ===
              "ast-static-analysis";
            await progress?.report({
              phase: ast
                ? "parse_javascript_source"
                : "process_javascript_artifact_metadata",
              completed: 0,
              total: 1,
              message: `${ast ? "Parsing and projecting" : "Processing metadata for"} ${file.path} (${String(completed + 1)}/${String(total)})`,
            });
            abortIfNeeded(signal);
          },
          signal,
          async (file, phase) => {
            abortIfNeeded(signal);
            await progress?.report({
              phase: `javascript_worker_${phase}`,
              completed: 0,
              total: 1,
              message: `JavaScript worker ${phase}: ${file.path}`,
            });
            abortIfNeeded(signal);
          },
        );
      } finally {
        try {
          const cleanup = await scope.release({
            kind: "javascript-source-analysis",
            analysis: worker,
            resource: `JavaScript source analyzer for ${path}`,
          });
          if (cleanup.kind === "failed") throw cleanup.cause;
        } catch (cause: unknown) {
          if (!(cause instanceof AnalysisError)) throw cause;
          cleanupFailure = cause;
        }
      }
      const analysis = outcome.analysis;
      let interruption = outcome.interruption;
      // Source facts are owned now. Finish their projection cooperatively so a
      // later cancellation can retain Evidence instead of discarding those facts.
      const checkpointCompletedAnalysis = async (): Promise<void> => {
        await setImmediate();
        if (interruption == null && signal?.aborted === true)
          interruption = new ArtifactOperationError(
            OPERATION,
            "cancelled",
            undefined,
            undefined,
            { cause: signal.reason },
          );
      };
      const reportCompletedPhase = async (
        phase: string,
        message: string,
      ): Promise<void> => {
        await checkpointCompletedAnalysis();
        if (interruption == null && cleanupFailure === undefined)
          await progress?.report({ phase, completed: 0, total: 1, message });
        await checkpointCompletedAnalysis();
      };
      await reportCompletedPhase(
        "build_javascript_application_graph",
        "Constructing application and Electron boundary relationships",
      );
      const applicationGraphSteps = buildImmutableJavaScriptArtifactGraphSteps(
        snapshot,
        files,
        analysis,
      );
      await reportCompletedPhase(
        "seal_javascript_application_graph",
        "Sealing the validated application graph",
      );
      const { graph, electronSummary } = await completeJavaScriptAnalysisSteps(
        applicationGraphSteps,
      );
      await reportCompletedPhase(
        "build_javascript_semantic_graph",
        "Binding and validating static semantic relationships",
      );
      const semanticGraphSteps = semanticProjection.finishImmutableSteps(
        snapshot.manifest.root_sha256,
        graph,
      );
      await reportCompletedPhase(
        "seal_javascript_semantic_graph",
        "Validating and sealing the semantic graph",
      );
      const semanticGraph =
        await completeJavaScriptAnalysisSteps(semanticGraphSteps);
      await checkpointCompletedAnalysis();
      const directoryPaths = new Set(
        snapshot.occurrences
          .filter(({ entry_kind }) => entry_kind === "directory")
          .map(({ logical_path }) => logical_path),
      );
      const nextAppContext = createJavaScriptNextAppContext(
        files,
        analysis.jsonDocuments,
        directoryPaths,
        snapshot.coverage,
      );
      const completed = {
        route_inventory: await completeJavaScriptAnalysisSteps(
          buildJavaScriptRouteInventorySteps([
            ...analysis.files
              .filter(({ file }) => file.kind === "javascript")
              .map(({ file, javascript, analysis_failure }) => ({
                key: file.path,
                next_app_context: nextAppContext(file),
                path: file.path,
                url: null,
                sha256: file.sha256,
                container_sha256: file.container_sha256,
                status:
                  javascript === null || javascript.parse_status === "failed"
                    ? ("unavailable" as const)
                    : javascript.parse_error_count > 0
                      ? ("partial" as const)
                      : ("complete" as const),
                reason: !file.text.included
                  ? file.text.reason
                  : (analysis_failure?.reason ??
                    (javascript === null
                      ? "Source analysis is unavailable"
                      : javascript.parse_status === "failed"
                        ? "Script parsing failed"
                        : javascript.parse_error_count > 0
                          ? "Script parsing recovered from errors"
                          : null)),
                facts: javascript?.routes ?? null,
              })),
            ...files.unavailable_relevant_files
              .filter((file) => file.kind === "javascript")
              .map((file) => ({
                key: file.path,
                next_app_context: nextAppContext(file),
                path: file.path,
                url: null,
                sha256: file.sha256,
                container_sha256: file.container_sha256,
                status: "unavailable" as const,
                reason: "Inventoried JavaScript source bytes are unavailable",
                facts: null,
              })),
          ]),
        ),
        input_path: path,
        format,
        root_artifact_sha256: snapshot.manifest.root_sha256,
        inventory_manifest_id: snapshot.manifest.manifest_id,
        inventory_graph_sha256: snapshot.manifest.graph_sha256,
        integrity_contradictions: snapshot.integrity_contradictions,
        ...(files.source_selection === undefined
          ? {}
          : { source_selection: files.source_selection }),
        graph,
        semantic_graph: semanticGraph,
        electron_summary: electronSummary,
        statistics: {
          relevant_files:
            files.files.length + files.unavailable_relevant_files.length,
          nested_asar_containers: files.containers.length,
          text_bytes_read: files.text_bytes_read,
          invalid_utf8_files: files.invalid_utf8_files,
          parsed_javascript_files: analysis.files.filter(
            ({ javascript }) => javascript !== null,
          ).length,
          skipped_javascript_files: analysis.files.filter(
            isSkippedJavaScriptAnalysis,
          ).length,
          visited_ast_nodes: analysis.visited_ast_nodes,
          findings: analysis.findings,
          modules: analysis.modules,
          parse_failures: analysis.parse_failures,
        },
        limitations: analysis.limitations,
      };
      await checkpointCompletedAnalysis();
      const failure =
        cleanupFailure === undefined
          ? interruption
          : interruption === null
            ? cleanupFailure
            : analysisErrorWithCleanupFailure(
                interruption,
                cleanupFailure,
                OPERATION,
              ).bindCleanupDependencies([interruption, cleanupFailure]);
      if (failure !== null) {
        const { electron_summary: summary, ...application } = completed;
        const partial = await completeJavaScriptAnalysisSteps(
          parseOwnedJavaScriptApplicationAnalysisSteps({
            ...application,
            summary,
            limitations: completed.graph.limitations,
          }),
        );
        const evidence =
          await createOwnedJavaScriptApplicationEvidenceCooperatively(
            input,
            partial,
          );
        throw failure.retainPartialObservation(evidence);
      }
      reconstructionOutcome = { kind: "completed", result: completed };
    } catch (cause: unknown) {
      reconstructionOutcome = { kind: "failed", cause };
    }
    if (readerOpen) {
      const cleanupAttempt = await scope.release(readerOwner);
      if (cleanupAttempt.kind === "failed") {
        const partialObservation: ArtifactInventoryPartialObservation = {
          kind: "artifact-inventory",
          inventory: snapshot,
        };
        throw scope.cleanupFailure(
          reconstructionOutcome,
          [cleanupAttempt],
          partialObservation,
        );
      }
    }
    if (reconstructionOutcome.kind === "failed")
      throw reconstructionOutcome.cause;
    return reconstructionOutcome.result;
  });

const OPERATION = "analyze_javascript_application";

/**
 * Resolve the caller-selected input. A missing, looping, overlong, or
 * unreadable selection is a caller or host-resolution failure, not a damaged
 * artifact.
 */
const resolveSelectedInput = async (
  inputPath: string,
): Promise<{ readonly path: string; readonly metadata: Stats }> => {
  try {
    // Native lookup must admit the selected traversal first: Darwin realpath
    // can collapse file/.. even though that path cannot be opened.
    const metadata = await stat(inputPath);
    const path = await realpath(inputPath);
    // Directory enumeration needs read access; resolving its entries also needs search access.
    await access(
      path,
      metadata.isDirectory() ? constants.R_OK | constants.X_OK : constants.R_OK,
    );
    return { path, metadata };
  } catch (cause: unknown) {
    const code =
      cause instanceof Error && "code" in cause ? String(cause.code) : "";
    if (code === "EACCES" || code === "EPERM")
      throw new AnalysisAccessDeniedError(OPERATION, inputPath, code, {
        cause,
      });
    if (code === "ENOENT" || code === "ENOTDIR")
      throw new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["input_path"],
          reason: "invalid_value",
          message: `No file or directory exists at the selected input path (${code}): ${inputPath}`,
        },
      ]);
    if (code === "ELOOP" || code === "ENAMETOOLONG")
      throw new AnalysisInputError(OPERATION, { cause }, [
        {
          path: ["input_path"],
          reason: "invalid_value",
          message: selectedInputResolutionMessage(code, inputPath),
        },
      ]);
    throw cause;
  }
};

const selectedInputResolutionMessage = (
  code: "ELOOP" | "ENAMETOOLONG",
  inputPath: string,
): string =>
  code === "ENAMETOOLONG"
    ? `Selected input path exceeds the host path or component length limit (ENAMETOOLONG): ${inputPath}`
    : `Selected input path could not be resolved because symbolic-link traversal looped or exceeded the host limit (ELOOP): ${inputPath}`;

/** The selected input's kind, checked against the caller's requested format. */
const resolveFormat = (
  path: string,
  metadata: Stats,
  input: AnalyzeJavaScriptApplicationInput,
  selectedPath: string,
): "asar" | "directory" => {
  const observed = metadata.isDirectory()
    ? "directory"
    : metadata.isFile() &&
        artifactNameForClassification(selectedPath, path)
          .toLowerCase()
          .endsWith(".asar")
      ? "asar"
      : undefined;
  if (observed === undefined)
    throw new AnalysisUnsupportedTargetError(
      OPERATION,
      input.input_path,
      "JavaScript application analysis accepts only a directory or an .asar file",
      {
        remediationAction:
          "Select an extracted application directory, an app bundle, or an .asar file such as Contents/Resources/app.asar.",
      },
    );
  if (input.format !== "auto" && input.format !== observed)
    throw new AnalysisInputError(OPERATION, undefined, [
      {
        path: ["format"],
        reason: "invalid_value",
        message: `Requested ${input.format} input, but the selected input is ${observed === "asar" ? "an .asar file" : "a directory"}: ${input.input_path}`,
        expected: ["auto", observed],
      },
    ]);
  return observed;
};

const abortIfNeeded = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new ArtifactReaderFailure(
      "cancelled",
      "JavaScript artifact reconstruction cancelled",
      { cause: signal.reason },
    );
};
