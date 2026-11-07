import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { ApplicationNode } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import type {
  ElectronBrowserWindowFinding,
  ElectronContextBridgeFinding,
  ElectronUtilityProcessFinding,
} from "../../domain/javascript/electronStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  artifactLocalIdentity,
  createElectronRoleNode,
  javascriptAnalysisCoverage,
  linkElectronRoleToAsset,
  type JavaScriptArtifactGraphContext,
  type JavaScriptArtifactGraphCoverage,
} from "./JavaScriptArtifactGraphContext.js";
import {
  astObservationEvidence,
  staticInferenceEvidence,
} from "./JavaScriptArtifactGraphEvidence.js";
import {
  addElectronAstEdge,
  addElectronInferenceEdge,
  electronFindingSourceNode,
} from "./ElectronBoundaryGraphContext.js";
import {
  artifactPathResolutionProperties,
  resolveArtifactPathByContext,
} from "./JavaScriptArtifactPathResolution.js";

interface FindingInput<Value> {
  readonly context: JavaScriptArtifactGraphContext;
  readonly file: JavaScriptArtifactFile;
  readonly source: ApplicationNode;
  readonly value: Value;
  readonly coverage: JavaScriptArtifactGraphCoverage;
}

/** Project BrowserWindow, contextBridge, preload, and utility-process facts. */
export const addElectronWindowBoundaries = (
  context: JavaScriptArtifactGraphContext,
): void => {
  for (const analyzed of context.analysis.files) {
    const { file, javascript } = analyzed;
    if (javascript === null) continue;
    const coverage = javascriptAnalysisCoverage(javascript);
    for (const value of javascript.electron.browser_windows) {
      const source = electronFindingSourceNode(
        context,
        file,
        value.module_key,
        value.module_runtime,
      );
      if (source !== undefined)
        addBrowserWindow({ context, file, source, value, coverage });
    }
    for (const value of javascript.electron.context_bridge_apis) {
      const source = electronFindingSourceNode(
        context,
        file,
        value.module_key,
        value.module_runtime,
      );
      if (source !== undefined)
        addContextBridge({ context, file, source, value, coverage });
    }
    for (const value of javascript.electron.utility_processes) {
      const source = electronFindingSourceNode(
        context,
        file,
        value.module_key,
        value.module_runtime,
      );
      if (source !== undefined)
        addUtilityProcess({ context, file, source, value, coverage });
    }
  }
};

const addBrowserWindow = (
  input: FindingInput<ElectronBrowserWindowFinding>,
): void => {
  const { context, file, value, coverage } = input;
  const window = context.accumulator.addNode({
    kind: "browser-window",
    identity: artifactLocalIdentity(
      file.sha256,
      "electron-browser-window",
      javascriptSourceRangeKey(value.location),
    ),
    observations: [
      {
        label: `BrowserWindow@${javascriptSourceRangeKey(value.location)}`,
        properties: {
          source_path: file.path,
          options_status: value.options_status,
          web_preferences_status: value.web_preferences_status,
          web_preferences: value.web_preferences,
          preload_path: value.preload_path,
          preload_resolution_context: value.preload_resolution_context,
          ...(value.resolution_sources === undefined
            ? {}
            : {
                resolution_sources: value.resolution_sources.map(
                  (location) => ({
                    source: file.path,
                    ...location,
                  }),
                ),
              }),
          absence_means_default: false,
        },
        evidence: (value.resolution_sources === undefined
          ? astObservationEvidence
          : staticInferenceEvidence)({
          sha256: file.sha256,
          path: file.path,
          range: value.location,
          operation:
            value.resolution_sources === undefined
              ? "observe-browser-window-construction"
              : "resolve-browser-window-constant-options",
          coverage,
          limitations: [
            "Only explicitly present webPreferences are reported; omitted properties are not interpreted as Electron defaults.",
          ],
        }),
      },
    ],
  });
  addElectronAstEdge(context, {
    source: input.source,
    target: window,
    file,
    range: value.location,
    coverage,
    relation: "contains",
    operation: "locate-browser-window-construction",
    properties: { source_path: file.path },
  });
  addWindowPreload(input, window);
};

const addWindowPreload = (
  input: FindingInput<ElectronBrowserWindowFinding>,
  window: ApplicationNode,
): void => {
  if (input.value.preload_path === null) return;
  const {
    preload_path: declared,
    preload_resolution_context: resolutionContext,
  } = input.value;
  const resolution = resolveArtifactPathByContext({
    declaredPath: declared,
    sourcePath: input.file.path,
    context: resolutionContext,
    files: input.context.filesByPath,
    jsonDocuments: input.context.analysis.jsonDocuments,
    directoryPaths: input.context.directoryPaths,
    unanalyzedFiles: input.context.unanalyzedFiles,
    runtimePathKind: "exact-file",
  });
  const role = createElectronRoleNode(input.context, {
    kind: "electron-preload",
    anchor: input.file,
    resolution,
    mechanism: "BrowserWindow:webPreferences.preload",
    range: input.value.location,
    coverage: input.coverage,
  });
  addElectronInferenceEdge(input.context, {
    source: window,
    target: role,
    file: input.file,
    range: input.value.location,
    coverage: input.coverage,
    relation: "loads",
    operation: "associate-browser-window-preload",
    properties: {
      declared_path: declared,
      resolution_context: resolution.resolution_context,
      resolved_path: resolution.resolved_path,
      resolution_status: resolution.resolution_status,
      limitations: resolution.limitations,
      ...artifactPathResolutionProperties(resolution),
    },
  });
  linkElectronRoleToAsset(input.context, {
    role,
    anchor: input.file,
    resolution,
    range: input.value.location,
    coverage: input.coverage,
  });
};

const addContextBridge = (
  input: FindingInput<ElectronContextBridgeFinding>,
): void => {
  const { context, file, value, coverage } = input;
  const bridge = context.accumulator.addNode({
    kind: "context-bridge-api",
    identity: artifactLocalIdentity(
      file.sha256,
      "electron-context-bridge",
      `${value.world}:${value.api_key ?? value.api_key_expression ?? "[missing]"}:${javascriptSourceRangeKey(value.location)}`,
    ),
    observations: [
      {
        label: value.api_key,
        properties: {
          world: value.world,
          world_id: value.world_id,
          api_key: value.api_key,
          api_key_expression: value.api_key_expression,
          api_status: value.api_status,
          members: value.members,
          unknown_members: value.unknown_members,
          resolution_basis: value.resolution_basis ?? "direct-syntax",
        },
        evidence: (value.resolution_basis === "wrapper-substitution"
          ? staticInferenceEvidence
          : astObservationEvidence)({
          sha256: file.sha256,
          path: file.path,
          range: value.location,
          operation: "observe-context-bridge-api",
          coverage,
        }),
      },
    ],
  });
  addElectronInferenceEdge(context, {
    source: input.source,
    target: bridge,
    file,
    range: value.location,
    coverage,
    relation: "exposes",
    operation: "map-context-bridge-exposure",
    properties: {
      world: value.world,
      api_key: value.api_key,
      resolution: value.api_key === null ? "dynamic" : "literal",
    },
  });
};

const addUtilityProcess = (
  input: FindingInput<ElectronUtilityProcessFinding>,
): void => {
  const { context, file, value, coverage } = input;
  const resolution =
    value.module_path === null
      ? undefined
      : resolveArtifactPathByContext({
          declaredPath: value.module_path,
          sourcePath: file.path,
          context: value.module_resolution_context,
          files: context.filesByPath,
          jsonDocuments: context.analysis.jsonDocuments,
          directoryPaths: context.directoryPaths,
          unanalyzedFiles: context.unanalyzedFiles,
          runtimePathKind: "node-entrypoint",
        });
  const resolutionProperties = {
    resolved_path: resolution?.resolved_path ?? null,
    resolution_status: resolution?.resolution_status ?? null,
    ...artifactPathResolutionProperties(resolution),
  };
  const utility = context.accumulator.addNode({
    kind: "electron-utility",
    identity: artifactLocalIdentity(
      file.sha256,
      "electron-utility-process",
      `${value.module_path ?? value.module_expression}:${javascriptSourceRangeKey(value.location)}`,
    ),
    observations: [
      {
        label: value.service_name ?? value.module_path,
        properties: {
          module_path: value.module_path,
          module_resolution_context: value.module_resolution_context,
          module_expression: value.module_expression,
          service_name: value.service_name,
        },
        evidence: astObservationEvidence({
          sha256: file.sha256,
          path: file.path,
          range: value.location,
          operation: "observe-utility-process-fork",
          coverage,
        }),
      },
      ...(resolution === undefined
        ? []
        : [
            {
              label: "utility process entrypoint resolution",
              properties: resolutionProperties,
              evidence: staticInferenceEvidence({
                sha256: file.sha256,
                path: file.path,
                range: value.location,
                operation: "resolve-utility-process-entrypoint",
                coverage,
                limitations: resolution.limitations,
              }),
            },
          ]),
    ],
  });
  addElectronInferenceEdge(context, {
    source: input.source,
    target: utility,
    file,
    range: value.location,
    coverage,
    relation: "loads",
    operation: "map-utility-process-launch",
    limitations: resolution?.limitations ?? [],
    properties: {
      declared_path: value.module_path,
      expression: value.module_expression,
      ...resolutionProperties,
    },
  });
  if (value.module_path === null) return;
  if (resolution === undefined) return;
  const resolved = resolution.resolved_path;
  const target =
    resolved === null
      ? undefined
      : (context.assetNodes.get(resolved) ?? context.fileNodes.get(resolved));
  if (target === undefined) return;
  addElectronInferenceEdge(context, {
    source: utility,
    target,
    file,
    range: value.location,
    coverage,
    relation: "maps_to",
    operation: "resolve-utility-process-entrypoint",
    properties: {
      declared_path: value.module_path,
      resolution_context: resolution.resolution_context,
      resolved_path: resolved,
      resolution_status: resolution.resolution_status,
      ...artifactPathResolutionProperties(resolution),
    },
  });
};
