import type { ElectronBoundarySummary } from "../../domain/javascript/javascriptApplicationAnalysis.js";
import { ELECTRON_IDENTITY_LIMITATION } from "../../domain/javascript/javascriptElectronMemberWrites.js";
import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import {
  sealTransferredJavaScriptApplicationGraphSteps,
  type JavaScriptApplicationGraph,
} from "../../domain/javascript/javascriptApplicationGraph.js";
import type { JavaScriptArtifactAnalysis } from "./JavaScriptArtifactAnalysisTypes.js";
import type { JavaScriptArtifactFileSet } from "../../domain/javascript/javascriptArtifactFiles.js";
import { JavaScriptArtifactGraphAccumulator } from "./JavaScriptArtifactGraphAccumulator.js";
import {
  HTML_INLINE_SCRIPT_LOCATION_COVERAGE_LIMIT,
  omittedHtmlInlineScriptLocations,
  selfReferenceOmissions,
  dependencyManifest,
  applicationContainerIdentity,
  applicationRootPath,
  type JavaScriptArtifactGraphContext,
} from "./JavaScriptArtifactGraphContext.js";
import {
  addJavaScriptHtmlRoles,
  addJavaScriptSourceMapOriginals,
} from "./JavaScriptArtifactGraphDocuments.js";
import { addJavaScriptStaticFindingsSteps } from "./JavaScriptArtifactGraphFindings.js";
import {
  addJavaScriptModuleRelationshipsSteps,
  type JavaScriptModuleRelationshipOmissions,
  addJavaScriptSourceModules,
} from "./JavaScriptModuleRelationships.js";
import {
  completeApplicationCoverage,
  partialApplicationCoverage,
  truncatedApplicationCoverage,
} from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import type { JavaScriptSemanticResourceLimit } from "../../domain/javascript/javascriptSemanticValueTypes.js";
import {
  semanticCoverageResourceLimits,
  semanticResourceLimitCoverage,
} from "../../domain/javascript/javascriptSemanticCoverage.js";
import { semanticResourceLimitReason } from "../../domain/javascript/javascriptSemanticResourceLimits.js";
import {
  addJavaScriptArtifactContainers,
  addJavaScriptArtifactFiles,
  addJavaScriptPackageNodes,
  createJavaScriptArtifactRootNode,
} from "./JavaScriptArtifactGraphStructure.js";
import { addJavaScriptBundlerNodes } from "./JavaScriptArtifactGraphBundlers.js";
import { addElectronBoundaries } from "./ElectronBoundaryGraph.js";
import {
  createElectronIpcContext,
  summarizeElectronBoundaries,
  type ElectronIpcContext,
} from "./ElectronBoundaryAnalysis.js";

/**
 * Build a validated application graph with cooperative immutable ownership.
 * Constructing the graph input also runs in steps: projecting every module
 * relationship and finding at once held the event loop for seconds.
 */
export function* buildImmutableJavaScriptArtifactGraphSteps(
  snapshot: ArtifactInventorySnapshot,
  fileSet: JavaScriptArtifactFileSet,
  analysis: JavaScriptArtifactAnalysis,
): Generator<
  void,
  {
    readonly graph: JavaScriptApplicationGraph;
    readonly electronSummary: ElectronBoundarySummary;
  }
> {
  const input = yield* buildJavaScriptArtifactGraphInputSteps(
    snapshot,
    fileSet,
    analysis,
  );
  // The input was built here and is not retained, so it can be transferred.
  return {
    graph: yield* sealTransferredJavaScriptApplicationGraphSteps(input.graph),
    electronSummary: input.electronSummary,
  };
}

function* buildJavaScriptArtifactGraphInputSteps(
  snapshot: ArtifactInventorySnapshot,
  fileSet: JavaScriptArtifactFileSet,
  analysis: JavaScriptArtifactAnalysis,
): Generator<
  void,
  { readonly graph: unknown; readonly electronSummary: ElectronBoundarySummary }
> {
  const accumulator = new JavaScriptArtifactGraphAccumulator();
  const root = createJavaScriptArtifactRootNode(accumulator, snapshot);
  const parsedPackages = new Set(
    analysis.packages
      .filter((metadata) => metadata.status === "included")
      .map(({ path }) => path),
  );
  const applicationOwnershipUnknownContainers = new Set<string>();
  const applicationModuleGapSources = new Map<string, Set<string>>();
  const applicationModuleReferencesRetained = new Set<string>();
  let ipcSourceGap = false;
  const recordModuleGap = (file: {
    path: string;
    container_sha256: string;
    kind?: string;
  }) => {
    if (file.kind === "javascript" || file.kind === undefined)
      ipcSourceGap = true;
    const container = applicationContainerIdentity(fileSet, file);
    const sources =
      applicationModuleGapSources.get(container) ?? new Set<string>();
    sources.add(file.path);
    applicationModuleGapSources.set(container, sources);
  };
  for (const files of [fileSet.files, fileSet.unavailable_relevant_files]) {
    for (const file of files) {
      if (
        file.kind === "package-json" &&
        !dependencyManifest(file.path) &&
        !parsedPackages.has(file.path)
      )
        applicationOwnershipUnknownContainers.add(
          applicationContainerIdentity(fileSet, file),
        );
      if (
        file.kind === "javascript" &&
        (!("text" in file) || !file.text.included)
      )
        recordModuleGap(file);
      // Unread HTML can conceal inline scripts with Electron IPC calls.
      if (file.kind === "html" && (!("text" in file) || !file.text.included))
        ipcSourceGap = true;
    }
  }
  // Omitted module relationships can hide another launch owner. Do not expand
  // retained facts beyond the projection guard merely to recover ownership.
  for (const analyzed of analysis.files) {
    if (
      analyzed.file.kind === "javascript" &&
      (analyzed.javascript === null ||
        analyzed.javascript.analysis_coverage === undefined ||
        analyzed.javascript.analysis_coverage.examination
          .electron_call_paths_limited ||
        analyzed.javascript.analysis_coverage.examination
          .semantic_resource_limits.length > 0)
    )
      ipcSourceGap = true;
    if (
      analyzed.application_projection_failure !== undefined ||
      analyzed.analysis_failure !== undefined ||
      analyzed.javascript?.parse_status === "failed" ||
      (analyzed.javascript?.parse_error_count ?? 0) > 0
    )
      recordModuleGap(analyzed.file);
    else if (analyzed.javascript !== null)
      applicationModuleReferencesRetained.add(analyzed.file.path);
  }
  const unavailableFilesByPath = new Map(
    fileSet.unavailable_relevant_files.map((file) => [file.path, file]),
  );
  const context: JavaScriptArtifactGraphContext = {
    accumulator,
    snapshot,
    fileSet,
    analysis,
    directoryPaths: new Set(
      snapshot.occurrences
        .filter(({ entry_kind }) => entry_kind === "directory")
        .map(({ logical_path }) => logical_path),
    ),
    root,
    filesByPath: new Map(fileSet.files.map((file) => [file.path, file])),
    unanalyzedFiles: {
      coverage: snapshot.coverage,
      get: (path) =>
        unavailableFilesByPath.get(path) ?? fileSet.unanalyzed_files?.get(path),
      hasDirectory: (path, container) =>
        fileSet.unanalyzed_files?.hasDirectory(path, container) ?? false,
    },
    fileNodes: new Map(),
    assetNodes: new Map(),
    sourceModuleNodes: new Map(),
    chunkNodes: new Map(),
    moduleNodes: new Map(),
    containerNodes: new Map([[snapshot.manifest.root_sha256, root]]),
    applicationRootsBySource: new Map(),
    applicationOwnershipUnknownContainers,
    applicationModuleGapSources,
    applicationModuleReferencesRetained,
    applicationPossibleRootsByContainer: new Map(),
  };
  addJavaScriptArtifactContainers(context);
  yield;
  addJavaScriptArtifactFiles(context);
  yield;
  // Raw observations remain on the file nodes. Only admitted expansions feed
  // the relationship builders, including their Electron and bundler callers.
  const projectionContext = {
    ...context,
    analysis: {
      ...analysis,
      files: analysis.files.map((file) =>
        file.application_projection_failure === undefined
          ? file
          : { ...file, javascript: null, semantic: null },
      ),
    },
  };
  const packageRoots = addJavaScriptPackageNodes(projectionContext);
  yield;
  addJavaScriptSourceModules(projectionContext);
  yield;
  const bundlerLimitations = addJavaScriptBundlerNodes(projectionContext);
  const relationshipOmissions =
    yield* addJavaScriptModuleRelationshipsSteps(projectionContext);
  const findingLimitations =
    yield* addJavaScriptStaticFindingsSteps(projectionContext);
  const coverage = graphCoverage(context);
  // Graph-wide partial coverage can describe unrelated dynamic values or
  // source maps. Qualify IPC pairing by omitted JavaScript sources instead:
  // their hidden handlers could compete with an observed match.
  const ipc = createElectronIpcContext(
    projectionContext.analysis,
    (file) => applicationRootPath(projectionContext, file),
    snapshot.coverage.status === "complete" &&
      !ipcSourceGap &&
      analysis.html_inline_scripts.length === 0 &&
      !fileSet.unavailable_relevant_files.some(
        ({ kind }) => kind === undefined,
      ),
  );
  addElectronBoundaries(projectionContext, ipc);
  yield;
  addJavaScriptHtmlRoles(projectionContext);
  yield;
  addJavaScriptSourceMapOriginals(projectionContext);
  yield;
  return {
    electronSummary: summarizeElectronBoundaries(
      projectionContext.analysis,
      ipc,
      context.directoryPaths,
    ),
    graph: {
      schema: "JavaScriptApplicationGraph",
      root_node_ids:
        packageRoots.length === 0
          ? [root.node_id]
          : packageRoots.map(({ node_id: id }) => id),
      nodes: accumulator.nodes(),
      edges: accumulator.edges(),
      coverage,
      limitations: [
        ...bundlerLimitations,
        ...findingLimitations,
        ...graphLimitations(
          context,
          coverage.status,
          relationshipOmissions,
          ipc,
        ),
      ],
    },
  };
}

const graphCoverage = (context: JavaScriptArtifactGraphContext) => {
  const resourceLimits = semanticResourceLimits(context);
  const sourceMapPolicyGap = context.analysis.source_maps.some(
    ({ status }) => status === "invalid",
  );
  const malformedStructuredData =
    context.analysis.packages.some(({ status }) => status !== "included") ||
    context.analysis.json_modules.some(({ status }) => status !== "included") ||
    context.analysis.source_maps.some(({ status }) => status === "invalid");
  const partialJavaScript = context.analysis.files.some(
    ({ javascript }) =>
      javascript !== null && javascript.parse_status === "partial",
  );
  const unknownGap =
    context.snapshot.coverage.status !== "complete" ||
    (context.fileSet.source_selection?.unselected_files ?? 0) > 0 ||
    context.fileSet.unavailable_relevant_files.length > 0 ||
    context.analysis.files.some(
      ({ analysis_failure, application_projection_failure }) =>
        analysis_failure !== undefined ||
        application_projection_failure !== undefined,
    ) ||
    context.analysis.parse_failures > 0 ||
    context.fileSet.invalid_utf8_files > 0 ||
    context.analysis.html_inline_scripts.length > 0 ||
    sourceMapPolicyGap ||
    malformedStructuredData ||
    partialJavaScript;
  const executionLimits = context.analysis.files.flatMap(
    ({ analysis_failure, application_projection_failure }) =>
      [analysis_failure, application_projection_failure].flatMap((failure) =>
        failure === undefined
          ? []
          : javaScriptAnalysisCoverageLimits(failure.limits),
      ),
  );
  // Capped inline script locations truncate the result. The total omission
  // stays unknown because the unanalyzed bodies hide an unknown fact count.
  const inlineScriptsTruncated =
    omittedHtmlInlineScriptLocations(context.analysis.html_inline_scripts) > 0;
  if (
    resourceLimits.length > 0 ||
    executionLimits.length > 0 ||
    inlineScriptsTruncated
  ) {
    const limits = [
      ...new Map(
        [
          ...semanticResourceLimitCoverage(resourceLimits),
          ...executionLimits,
          ...(inlineScriptsTruncated
            ? [HTML_INLINE_SCRIPT_LOCATION_COVERAGE_LIMIT]
            : []),
        ].map((limit) => [JSON.stringify(limit), limit]),
      ).values(),
    ];
    return inlineScriptsTruncated
      ? truncatedApplicationCoverage(limits, null)
      : partialApplicationCoverage(limits, null);
  }
  if (unknownGap) return partialApplicationCoverage([], null);
  if (context.snapshot.integrity_contradictions.length > 0) {
    const nestedArchiveWasOpaque =
      context.snapshot.integrity_contradictions.some(({ logical_path }) =>
        logical_path.toLowerCase().endsWith(".asar"),
      );
    return partialApplicationCoverage([], nestedArchiveWasOpaque ? null : 0);
  }
  return completeApplicationCoverage();
};

const semanticResourceLimits = (
  context: JavaScriptArtifactGraphContext,
): JavaScriptSemanticResourceLimit[] =>
  [
    ...new Set(
      context.analysis.files.flatMap(({ semantic }) =>
        semantic === null
          ? []
          : semanticCoverageResourceLimits(semantic.ir.coverage),
      ),
    ),
  ].sort();

const graphLimitations = (
  context: JavaScriptArtifactGraphContext,
  coverage: "complete" | "partial" | "unknown" | "unavailable",
  relationshipOmissions: JavaScriptModuleRelationshipOmissions,
  ipcContext: ElectronIpcContext,
): string[] => {
  const ipc = ipcContext.records;
  const pairings = ipcContext.states;
  const electronFindings = context.analysis.files.reduce(
    (count, { javascript }) =>
      count +
      (javascript === null
        ? 0
        : javascript.electron.browser_windows.length +
          javascript.electron.context_bridge_apis.length +
          javascript.electron.ipc.length +
          javascript.electron.sender_validations.length +
          javascript.electron.utility_processes.length +
          javascript.electron.native_addon_bindings.length +
          javascript.electron.protocols.length),
    0,
  );
  return [
    ...context.analysis.limitations,
    ...((context.fileSet.source_selection?.unselected_files ?? 0) === 0
      ? []
      : [
          `Caller-selected source analysis leaves ${String(context.fileSet.source_selection?.unselected_files)} inventoried files outside analysis scope. Inventory identity covers the complete artifact; relationships through unselected sources remain unknown.`,
        ]),
    ...context.snapshot.limitations,
    ...context.snapshot.integrity_contradictions.map(
      ({ logical_path: path }) =>
        `Artifact integrity metadata contradicts observed bytes at ${path}; the observed bytes are untrusted.`,
    ),
    ...selfReferenceOmissions(
      relationshipOmissions.selfImports,
      ["import specifier", "import specifiers"],
      "the importing module",
    ),
    "CommonJS and ESM binding relationships were recovered from inert syntax and resolved only within the inventoried artifact container.",
    "Webpack/Rspack factories were recovered from AST literals; REA did not invoke push handlers or bundle bootstrap code.",
    "Static imports, entrypoints, workers, endpoints, and storage relationships do not prove runtime execution.",
    ...(context.analysis.files.some(({ javascript }) =>
      javascript?.limitations.includes(ELECTRON_IDENTITY_LIMITATION),
    )
      ? [ELECTRON_IDENTITY_LIMITATION]
      : []),
    ...(electronFindings === 0
      ? []
      : [
          "Electron relationships are derived from inert syntax; runtime registration, reachability, defaults, and enforcement remain unproven.",
        ]),
    ...(ipc.some(({ finding }) => finding.channel === null)
      ? [
          "Dynamic IPC channel expressions remain unresolved and are never paired by textual similarity.",
        ]
      : []),
    ...(pairings.some(({ status }) => status === "ambiguous")
      ? [
          "Some IPC transmissions have competing handlers or unresolved application ownership; ambiguous calls are not paired to any handler.",
        ]
      : []),
    ...(context.analysis.files.some(
      ({ javascript }) =>
        (javascript?.electron.sender_validations.length ?? 0) > 0,
    )
      ? [
          "Sender, frame, URL, and origin checks are observations only; REA does not claim that they enforce a complete authorization policy.",
        ]
      : []),
    ...semanticResourceLimits(context).map(semanticResourceLimitReason),
    ...(context.analysis.files.some(
      ({ javascript }) =>
        (javascript?.electron.native_addon_bindings.length ?? 0) > 0,
    )
      ? [
          "Native member names are requested by JavaScript syntax and are not verified binary exports in this workflow.",
        ]
      : []),
    ...(coverage === "complete"
      ? []
      : [
          "Graph coverage is incomplete; unavailable facts remain explicit and must not be read as absence.",
        ]),
  ];
};
import { javaScriptAnalysisCoverageLimits } from "../../domain/javascript/javascriptAnalysisResourceControls.js";
