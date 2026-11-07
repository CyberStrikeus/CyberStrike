import type { ArtifactInventorySnapshot } from "../../domain/artifactInventorySnapshot.js";
import { isJsonModuleTarget } from "../../domain/javascript/javascriptModuleResolutionMode.js";
import type { ApplicationNode } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import { htmlInlineScriptLimitation } from "./JavaScriptArtifactAnalysis.js";
import {
  completeApplicationCoverage,
  partialApplicationCoverage,
} from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import type { JavaScriptArtifactAnalysis } from "./JavaScriptArtifactAnalysisTypes.js";
import {
  javascriptArtifactAnalysisScopes,
  isSkippedJavaScriptAnalysis,
} from "./JavaScriptArtifactAnalysisTypes.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { freezeJsonSnapshot } from "../../domain/immutableJson.js";
import type { JavaScriptSourceRange } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import { unexaminedJavaScriptStaticCoverage } from "../../domain/javascript/javascriptStaticCoverage.js";
import type {
  JavaScriptArtifactContainer,
  JavaScriptArtifactFile,
} from "../../domain/javascript/javascriptArtifactFiles.js";
import type { JavaScriptArtifactGraphAccumulator } from "./JavaScriptArtifactGraphAccumulator.js";
import {
  addArtifactContainsEdge,
  applicationManifestPath,
  applicationContainerIdentity,
  addApplicationRootCandidate,
  dependencyManifest,
  addUnavailableStaticParseScope,
  artifactFileNodeKind,
  fileOccurrenceIdentity,
  artifactLocalIdentity,
  javascriptAnalysisCoverage,
  createElectronRoleNode,
  HTML_INLINE_SCRIPT_LOCATION_COVERAGE_LIMIT,
  omittedHtmlInlineScriptLocations,
  linkElectronRoleToAsset,
  type JavaScriptArtifactGraphContext,
} from "./JavaScriptArtifactGraphContext.js";
import {
  artifactObservationEvidence,
  astObservationEvidence,
  staticInferenceEvidence,
} from "./JavaScriptArtifactGraphEvidence.js";
import {
  artifactPathResolutionProperties,
  resolveArtifactPathByContext,
  type ArtifactPathResolution,
} from "./JavaScriptArtifactPathResolution.js";

interface PackageRoleInput {
  readonly packageNode: ApplicationNode;
  readonly packageFile: JavaScriptArtifactFile;
  readonly kind: "electron-main" | "electron-renderer";
  readonly declaredPath: string | null;
  readonly field: "main" | "renderer" | "browser" | "module";
}

/** Create the exact root artifact node from the inventory manifest. */
export const createJavaScriptArtifactRootNode = (
  accumulator: JavaScriptArtifactGraphAccumulator,
  snapshot: ArtifactInventorySnapshot,
): ApplicationNode => {
  const root = snapshot.nodes.find(
    ({ artifact_id: id }) => id === snapshot.manifest.root_artifact_id,
  );
  if (root === undefined)
    throw new TypeError("Artifact inventory root is missing");
  return accumulator.addNode({
    kind: "artifact",
    identity: {
      strategy: "content-digest",
      stability: "global-exact",
      sha256: root.sha256,
    },
    observations: [
      {
        label: "artifact root",
        properties: {
          format: snapshot.manifest.root_format,
          bytes: root.size,
          inventory_manifest_id: snapshot.manifest.manifest_id,
          inventory_graph_sha256: snapshot.manifest.graph_sha256,
          inventory_artifact_id: root.artifact_id,
        },
        evidence: artifactObservationEvidence({
          sha256: root.sha256,
          path: "artifact-root",
          operation: "inventory-root",
          coverage: completeApplicationCoverage(),
          limitations: [
            "artifact-root is a path-independent alias; the application result retains the canonical local input path.",
          ],
        }),
      },
    ],
  });
};

/** Project nested ASAR containers inventoried inside a directory. */
export const addJavaScriptArtifactContainers = (
  context: JavaScriptArtifactGraphContext,
): void => {
  for (const container of context.fileSet.containers) {
    const node = context.accumulator.addNode({
      kind: "artifact",
      identity: {
        strategy: "content-digest",
        stability: "global-exact",
        sha256: container.sha256,
      },
      observations: [
        {
          label: container.path,
          properties: containerProperties(container),
          evidence: artifactObservationEvidence({
            sha256: container.sha256,
            path: container.path,
            operation: "inventory-nested-asar",
            coverage: completeApplicationCoverage(),
          }),
        },
      ],
    });
    context.containerNodes.set(container.sha256, node);
    context.accumulator.addEdge({
      source_node_id: context.root.node_id,
      target_node_id: node.node_id,
      relation: "contains",
      properties: { path: container.path, format: "asar" },
      evidence: artifactObservationEvidence({
        sha256: context.snapshot.manifest.root_sha256,
        path: container.path,
        operation: "inventory-nested-asar",
        coverage: completeApplicationCoverage(),
      }),
    });
  }
};

/** Project relevant files, ASAR entries, and explicit unavailable parse scopes. */
export const addJavaScriptArtifactFiles = (
  context: JavaScriptArtifactGraphContext,
): void => {
  const packagesByPath = indexFirstByPath(context.analysis.packages);
  const jsonModulesByPath = indexFirstByPath(context.analysis.json_modules);
  const sourceMapsByPath = indexFirstByPath(context.analysis.source_maps);
  const inlineScriptsByPath = indexFirstByPath(
    context.analysis.html_inline_scripts,
  );
  for (const analyzed of context.analysis.files) {
    const { file } = analyzed;
    const jsonValue = jsonModulesByPath.get(file.path);
    const target = createFileTarget(
      context,
      file,
      analyzed.javascript,
      jsonValue,
      packagesByPath.get(file.path),
      isSkippedJavaScriptAnalysis(analyzed),
    );
    if (
      analyzed.application_projection_failure !== undefined &&
      analyzed.javascript !== null
    )
      context.accumulator.addNode({
        kind: target.kind,
        identity: target.identity,
        observations: [
          {
            label: file.path,
            properties: {
              static_analysis: freezeJsonSnapshot(
                jsonValueSchema.parse(analyzed.javascript),
              ),
              semantic_module_analysis:
                analyzed.semantic === null
                  ? null
                  : freezeJsonSnapshot(
                      jsonValueSchema.parse(analyzed.semantic.ir),
                    ),
              application_projection_failure:
                analyzed.application_projection_failure.error,
            },
            evidence: astObservationEvidence({
              sha256: file.sha256,
              path: file.path,
              operation: "retain-unexpanded-static-findings",
              range: sourceFileRange(file),
              coverage: javascriptAnalysisCoverage(analyzed.javascript),
              limitations: [analyzed.application_projection_failure.reason],
            }),
          },
        ],
      });
    context.fileNodes.set(file.path, target);
    if (file.kind === "javascript") context.assetNodes.set(file.path, target);
    const entry = createAsarEntry(context, file);
    const parent =
      context.containerNodes.get(file.container_sha256) ?? context.root;
    if (entry === undefined)
      addArtifactContainsEdge(context, {
        source: parent,
        target,
        file,
        operation: "inventory-file",
      });
    else {
      addArtifactContainsEdge(context, {
        source: parent,
        target: entry,
        file,
        operation: "inventory-entry",
      });
      context.accumulator.addEdge({
        source_node_id: entry.node_id,
        target_node_id: target.node_id,
        relation: "maps_to",
        properties: { sha256: file.sha256 },
        evidence: artifactObservationEvidence({
          sha256: file.container_sha256,
          path: file.path,
          operation: "map-entry-content",
          coverage: completeApplicationCoverage(),
        }),
      });
    }
    const analysisScope = javascriptArtifactAnalysisScopes[file.kind];
    if (
      !file.text.included &&
      file.text.reason === "outside-analysis-scope" &&
      analysisScope !== null
    )
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        operation: "select-javascript-sources",
        authority: analysisScope.authority,
        limitation:
          "Source is outside the caller-selected source_paths; it was inventoried but not analyzed.",
      });
    else if (analyzed.analysis_failure !== undefined)
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        ...analyzed.analysis_failure.scope,
        limitation: analyzed.analysis_failure.reason,
        failure: analyzed.analysis_failure.error,
        limits: javaScriptAnalysisCoverageLimits(
          analyzed.analysis_failure.limits,
        ),
        details: { analysis_status: analyzed.analysis_failure.status },
      });
    else if (file.kind === "html" && !file.text.included)
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        ...javascriptArtifactAnalysisScopes.html,
        limitation: `HTML text could not be decoded: ${file.text.reason}.`,
      });
    else if (
      file.kind === "javascript" &&
      (analyzed.javascript === null ||
        analyzed.javascript.parse_status === "failed")
    )
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        operation: "parse-javascript",
        authority: javascriptArtifactAnalysisScopes.javascript.authority,
        limitation: file.text.included
          ? "JavaScript syntax could not be parsed."
          : `JavaScript text was unavailable: ${file.text.reason}.`,
      });
    if (analyzed.application_projection_failure !== undefined)
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        operation: "project-javascript-application",
        authority: javascriptArtifactAnalysisScopes.javascript.authority,
        limitation: analyzed.application_projection_failure.reason,
        failure: analyzed.application_projection_failure.error,
        limits: javaScriptAnalysisCoverageLimits(
          analyzed.application_projection_failure.limits,
        ),
      });
    const packageValue = packagesByPath.get(file.path);
    if (packageValue !== undefined && packageValue.status !== "included")
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        ...javascriptArtifactAnalysisScopes["package-json"],
        limitation: packageValue.limitation,
      });
    if (jsonValue !== undefined && jsonValue.status !== "included")
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        ...javascriptArtifactAnalysisScopes.json,
        limitation: jsonValue.limitation,
      });
    const sourceMap = sourceMapsByPath.get(file.path);
    if (sourceMap !== undefined && sourceMap.status === "invalid")
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        ...javascriptArtifactAnalysisScopes["source-map"],
        limitation: sourceMap.limitation,
        ...(sourceMap.external_sections === undefined &&
        sourceMap.invalid_sections === undefined
          ? {}
          : {
              details: {
                ...(sourceMap.external_sections === undefined
                  ? {}
                  : {
                      external_sections: sourceMap.external_sections.map(
                        ({ section_path, url }) => ({
                          section_path: [...section_path],
                          url,
                        }),
                      ),
                    }),
                ...(sourceMap.invalid_sections === undefined
                  ? {}
                  : {
                      invalid_sections: sourceMap.invalid_sections.map(
                        ({ section_path, reason }) => ({
                          section_path: [...section_path],
                          reason,
                        }),
                      ),
                    }),
              },
            }),
      });
    const inlineScripts = inlineScriptsByPath.get(file.path);
    if (inlineScripts !== undefined)
      addUnavailableStaticParseScope(context, {
        file,
        asset: target,
        operation: "parse-html-inline-scripts",
        authority: javascriptArtifactAnalysisScopes.javascript.authority,
        limitation: htmlInlineScriptLimitation(inlineScripts),
        limits:
          inlineScripts.script_count > inlineScripts.scripts.length
            ? [HTML_INLINE_SCRIPT_LOCATION_COVERAGE_LIMIT]
            : [],
        omittedCount: omittedHtmlInlineScriptLocations([inlineScripts]),
        details: {
          inline_script_count: inlineScripts.script_count,
          inline_scripts: inlineScripts.scripts.map(
            ({ script_type, location }) => ({
              script_type,
              location: {
                start: { ...location.start },
                end: { ...location.end },
              },
            }),
          ),
        },
      });
  }
  addUnavailableArtifactEntries(context);
};

const addUnavailableArtifactEntries = (
  context: JavaScriptArtifactGraphContext,
): void => {
  for (const file of context.fileSet.unavailable_relevant_files) {
    const asar = isAsarContainer(context, file.container_sha256);
    const operation = asar
      ? "inventory-asar-unavailable-entry"
      : "inventory-unavailable-entry";
    const limitations = [
      ...(file.limitations ?? []),
      `The inventoried ${file.kind ?? "relevant"} entry has unavailable bytes; no content artifact identity can be established.`,
    ];
    const entry = context.accumulator.addNode({
      kind: asar ? "asar-entry" : "artifact",
      identity: {
        strategy: "canonical-path",
        stability: "artifact-version",
        artifact_sha256: file.container_sha256,
        path: file.path,
      },
      observations: [
        {
          label: file.path,
          properties: {
            path: file.path,
            entry_sha256: file.sha256,
            bytes: file.bytes,
            inventory_artifact_id: file.inventory_artifact_id,
            ...(file.inventory_occurrence_id === undefined
              ? {}
              : { inventory_occurrence_id: file.inventory_occurrence_id }),
            ...(file.hash_status === undefined
              ? {}
              : { hash_status: file.hash_status }),
            ...(file.artifact_kind === undefined
              ? {}
              : { artifact_kind: file.artifact_kind }),
            ...(file.kind === undefined ? {} : { kind: file.kind }),
            content_available: false,
          },
          evidence: artifactObservationEvidence({
            sha256: file.container_sha256,
            path: file.path,
            operation,
            coverage: partialApplicationCoverage([], null),
            limitations,
          }),
        },
      ],
    });
    const parent =
      context.containerNodes.get(file.container_sha256) ?? context.root;
    context.accumulator.addEdge({
      source_node_id: parent.node_id,
      target_node_id: entry.node_id,
      relation: "contains",
      properties: {
        path: file.path,
        content_available: false,
        ...(file.hash_status === undefined
          ? {}
          : { hash_status: file.hash_status }),
      },
      evidence: artifactObservationEvidence({
        sha256: file.container_sha256,
        path: file.path,
        operation,
        coverage: partialApplicationCoverage([], null),
        limitations,
      }),
    });
    const scope =
      file.kind === undefined
        ? null
        : javascriptArtifactAnalysisScopes[file.kind];
    if (scope !== null)
      addUnavailableStaticParseScope(context, {
        file,
        asset: entry,
        ...scope,
        limitation: limitations.join(" "),
        ...(file.inventory_occurrence_id === undefined
          ? {}
          : {
              details: {
                inventory_occurrence_id: file.inventory_occurrence_id,
              },
            }),
      });
    if (file.kind === "native-addon" || file.artifact_kind === "native-addon") {
      const addon = context.accumulator.addNode({
        kind: "native-addon",
        identity: {
          strategy: "canonical-path",
          stability: "artifact-version",
          artifact_sha256: file.container_sha256,
          path: file.path,
        },
        observations: [
          {
            label: file.path,
            properties: {
              availability: "unavailable",
              ...(file.hash_status === undefined
                ? {}
                : { hash_status: file.hash_status }),
              ...(file.artifact_kind === undefined
                ? {}
                : { artifact_kind: file.artifact_kind }),
              bytes: file.bytes,
              inventory_artifact_id: file.inventory_artifact_id,
              ...(file.inventory_occurrence_id === undefined
                ? {}
                : { inventory_occurrence_id: file.inventory_occurrence_id }),
            },
            evidence: artifactObservationEvidence({
              sha256: file.container_sha256,
              path: file.path,
              operation: "classify-unavailable-native-addon",
              coverage: partialApplicationCoverage([], null),
              limitations,
            }),
          },
        ],
      });
      context.accumulator.addEdge({
        source_node_id: entry.node_id,
        target_node_id: addon.node_id,
        relation: "contains",
        properties: {
          classification: "native-addon",
          content_available: false,
        },
        evidence: artifactObservationEvidence({
          sha256: file.container_sha256,
          path: file.path,
          operation: "classify-unavailable-native-addon",
          coverage: partialApplicationCoverage([], null),
          limitations,
        }),
      });
    }
  }
};

const isAsarContainer = (
  context: JavaScriptArtifactGraphContext,
  containerSha256: string,
): boolean =>
  context.snapshot.manifest.root_format === "asar" ||
  containerSha256 !== context.snapshot.manifest.root_sha256;

const sourceFileRange = (
  file: JavaScriptArtifactFile,
): JavaScriptSourceRange => {
  if (!file.text.included)
    throw new TypeError("Retained static facts require their source text");
  let line = 1;
  let lastLineStart = 0;
  for (const match of file.text.value.matchAll(/\r\n|[\n\r\u2028\u2029]/gu)) {
    line += 1;
    lastLineStart = match.index + match[0].length;
  }
  return {
    start: { line: 1, column: 0 },
    end: { line, column: file.text.value.length - lastLineStart },
  };
};

/** Project package metadata and its declared Electron roles. */
export const addJavaScriptPackageNodes = (
  context: JavaScriptArtifactGraphContext,
): ApplicationNode[] => {
  const roots: ApplicationNode[] = [];
  const rootPath = applicationManifestPath(context);
  for (const packageValue of context.analysis.packages) {
    const file = context.filesByPath.get(packageValue.path);
    if (file === undefined) continue;
    const node = context.accumulator.addNode({
      kind: "package",
      identity: artifactLocalIdentity(file.sha256, "package-json", file.path),
      observations: [
        {
          label: packageValue.name ?? file.path,
          properties: {
            path: file.path,
            name: packageValue.name,
            version: packageValue.version,
            main: packageValue.main,
            main_status: packageValue.main_status,
            renderer_declarations: packageValue.renderer_declarations,
            parse_status: packageValue.status,
          },
          evidence: artifactObservationEvidence({
            sha256: file.sha256,
            path: file.path,
            operation: "parse-package-json",
            coverage: completeApplicationCoverage(),
            limitations:
              packageValue.limitation === null ? [] : [packageValue.limitation],
          }),
        },
      ],
    });
    if (file.path === rootPath) {
      roots.push(node);
      context.accumulator.addEdge({
        source_node_id: node.node_id,
        target_node_id: context.root.node_id,
        relation: "contains",
        properties: { basis: "package-metadata-within-artifact" },
        evidence: staticInferenceEvidence({
          sha256: file.sha256,
          path: file.path,
          operation: "associate-package-artifact",
          coverage: completeApplicationCoverage(),
        }),
      });
    } else
      addArtifactContainsEdge(context, {
        source: context.root,
        target: node,
        file,
        operation: "inventory-package",
      });
    if (dependencyManifest(file.path)) continue;
    if (
      packageValue.status === "included" &&
      packageValue.main_entrypoint === ""
    ) {
      registerPackageResolutionOwner(
        context,
        file,
        resolveArtifactPathByContext({
          declaredPath: packageValue.main_entrypoint,
          sourcePath: file.path,
          context: "package-entrypoint",
          runtimePathKind: "node-entrypoint",
          files: context.filesByPath,
          jsonDocuments: context.analysis.jsonDocuments,
          directoryPaths: context.directoryPaths,
          unanalyzedFiles: context.unanalyzedFiles,
        }),
      );
    }
    addPackageRole(context, {
      packageNode: node,
      packageFile: file,
      kind: "electron-main",
      declaredPath: packageValue.main,
      field: "main",
    });
    if (packageValue.renderer_entrypoint !== null)
      addPackageRole(context, {
        packageNode: node,
        packageFile: file,
        kind: "electron-renderer",
        declaredPath: packageValue.renderer_entrypoint.path,
        field: packageValue.renderer_entrypoint.field,
      });
  }
  return roots;
};

const createFileTarget = (
  context: JavaScriptArtifactGraphContext,
  file: JavaScriptArtifactFile,
  javascript: JavaScriptArtifactAnalysis["files"][number]["javascript"],
  json: JavaScriptArtifactAnalysis["json_modules"][number] | undefined,
  packageValue: JavaScriptArtifactAnalysis["packages"][number] | undefined,
  skipped: boolean,
): ApplicationNode => {
  const kind = artifactFileNodeKind(file.kind);
  return context.accumulator.addNode({
    kind,
    identity: {
      strategy: "content-digest",
      stability: "global-exact",
      sha256: file.sha256,
    },
    observations: [
      {
        label: file.path,
        properties: {
          file_occurrence: fileOccurrenceIdentity(file),
          path: file.path,
          bytes: file.bytes,
          inventory_artifact_id: file.inventory_artifact_id,
          unpacked: file.unpacked,
          file_kind: file.kind,
          text_status: file.text.included ? "included" : file.text.reason,
          parse_status:
            javascript?.parse_status ?? (skipped ? "skipped" : null),
          ...(javascript?.analysis_coverage !== undefined
            ? { analysis_coverage: javascript.analysis_coverage }
            : javascript === null && file.kind === "javascript"
              ? {
                  analysis_coverage: unexaminedJavaScriptStaticCoverage(
                    !file.text.included
                      ? file.text.reason === "outside-analysis-scope"
                        ? "Source is outside the caller-selected source_paths."
                        : `JavaScript text was unavailable: ${file.text.reason}.`
                      : skipped
                        ? "JavaScript analysis did not complete."
                        : "JavaScript source analysis was not performed.",
                  ),
                }
              : {}),
          json_parse_status: json?.status ?? null,
          ...(file.kind === "package-json"
            ? { package_parse_status: packageValue?.status ?? null }
            : {}),
          json_top_level_keys: json?.top_level_keys ?? [],
          omitted_json_top_level_keys:
            json === undefined
              ? file.kind === "json" || file.kind === "package-json"
                ? null
                : 0
              : json.omitted_top_level_keys,
          vendor_markers: javascript?.vendors ?? [],
        },
        evidence: artifactObservationEvidence({
          sha256: file.sha256,
          path: file.path,
          operation: "inventory-relevant-file",
          coverage: completeApplicationCoverage(),
        }),
      },
    ],
  });
};

const indexFirstByPath = <Value extends { readonly path: string }>(
  values: readonly Value[],
): ReadonlyMap<string, Value> => {
  const index = new Map<string, Value>();
  for (const value of values) {
    if (!index.has(value.path)) index.set(value.path, value);
  }
  return index;
};

const createAsarEntry = (
  context: JavaScriptArtifactGraphContext,
  file: JavaScriptArtifactFile,
): ApplicationNode | undefined => {
  if (!isAsarContainer(context, file.container_sha256)) return undefined;
  return context.accumulator.addNode({
    kind: "asar-entry",
    identity: {
      strategy: "canonical-path",
      stability: "artifact-version",
      artifact_sha256: file.container_sha256,
      path: file.path,
    },
    observations: [
      {
        label: file.path,
        properties: {
          entry_sha256: file.sha256,
          bytes: file.bytes,
          unpacked: file.unpacked,
          inventory_artifact_id: file.inventory_artifact_id,
        },
        evidence: artifactObservationEvidence({
          sha256: file.container_sha256,
          path: file.path,
          operation: "inventory-asar-entry",
          coverage: completeApplicationCoverage(),
        }),
      },
    ],
  });
};

const addPackageRole = (
  context: JavaScriptArtifactGraphContext,
  input: PackageRoleInput,
): void => {
  if (input.declaredPath === null) return;
  const resolution = resolveArtifactPathByContext({
    declaredPath: input.declaredPath,
    sourcePath: input.packageFile.path,
    context: "package-entrypoint",
    // Launch main uses Node's filesystem lookup, independently of renderer
    // metadata. Literal percent bytes are filename bytes at this boundary.
    ...(input.kind === "electron-main"
      ? { runtimePathKind: "node-entrypoint" as const }
      : {}),
    files: context.filesByPath,
    jsonDocuments: context.analysis.jsonDocuments,
    directoryPaths: context.directoryPaths,
    unanalyzedFiles: context.unanalyzedFiles,
  });
  if (input.kind === "electron-main")
    registerPackageResolutionOwner(context, input.packageFile, resolution);
  const role = createElectronRoleNode(context, {
    kind: input.kind,
    anchor: input.packageFile,
    resolution,
    mechanism: `package.json:${input.field}`,
  });
  context.accumulator.addEdge({
    source_node_id: input.packageNode.node_id,
    target_node_id: role.node_id,
    relation: "loads",
    properties: {
      source_field: input.field,
      declared_path: input.declaredPath,
      resolution_context: resolution.resolution_context,
      resolved_path: resolution.resolved_path,
      resolution_status: resolution.resolution_status,
      ...artifactPathResolutionProperties(resolution),
      limitations: resolution.limitations,
    },
    evidence: staticInferenceEvidence({
      sha256: input.packageFile.sha256,
      path: input.packageFile.path,
      operation: "discover-package-entrypoint",
      coverage: completeApplicationCoverage(),
      limitations: resolution.limitations,
    }),
  });
  linkElectronRoleToAsset(context, {
    role,
    anchor: input.packageFile,
    resolution,
  });
};

const registerPackageResolutionOwner = (
  context: JavaScriptArtifactGraphContext,
  packageFile: JavaScriptArtifactFile,
  resolution: ArtifactPathResolution,
): void => {
  if (resolution.resolution_status === "resolved")
    registerPackageEntrypointOwner(
      context,
      packageFile,
      resolution.resolved_path,
    );
  else if (
    resolution.resolution_status === "unavailable" &&
    !(
      resolution.candidate_path !== undefined &&
      isJsonModuleTarget(
        resolution.candidate_path,
        context.unanalyzedFiles?.get(resolution.candidate_path)?.kind,
      )
    )
  )
    registerPossiblePackageOwner(context, packageFile);
};

const registerPackageEntrypointOwner = (
  context: JavaScriptArtifactGraphContext,
  packageFile: JavaScriptArtifactFile,
  sourcePath: string,
): void => {
  const roots =
    context.applicationRootsBySource.get(sourcePath) ?? new Set<string>();
  addApplicationRootCandidate(roots, packageRoot(packageFile));
  context.applicationRootsBySource.set(sourcePath, roots);
  if (
    !context.applicationModuleReferencesRetained.has(sourcePath) &&
    !isJsonModuleTarget(sourcePath, context.filesByPath.get(sourcePath)?.kind)
  )
    registerPossiblePackageOwner(context, packageFile);
};

const packageRoot = (file: JavaScriptArtifactFile): string =>
  file.path.slice(0, -"package.json".length).replace(/\/$/u, "");

const registerPossiblePackageOwner = (
  context: JavaScriptArtifactGraphContext,
  file: JavaScriptArtifactFile,
): void => {
  const container = applicationContainerIdentity(context.fileSet, file);
  const roots =
    context.applicationPossibleRootsByContainer.get(container) ??
    new Set<string>();
  addApplicationRootCandidate(roots, packageRoot(file));
  context.applicationPossibleRootsByContainer.set(container, roots);
};

const containerProperties = (container: JavaScriptArtifactContainer) => ({
  path: container.path,
  format: "asar",
  bytes: container.bytes,
  inventory_artifact_id: container.inventory_artifact_id,
});
import { javaScriptAnalysisCoverageLimits } from "../../domain/javascript/javascriptAnalysisResourceControls.js";
