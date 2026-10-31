import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { ApplicationNode } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import { IPC_COVERAGE_LIMITED_PAIRING_BASIS } from "../../domain/javascript/javascriptApplicationGraphSchemas.js";
import type { ElectronCallPath } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { electronCallPathId } from "./ElectronCallPathIdentity.js";
import type {
  ElectronIpcContext,
  ElectronIpcRecord,
} from "./ElectronBoundaryAnalysis.js";
import {
  addElectronInferenceEdge,
  electronFindingSourceNode,
} from "./ElectronBoundaryGraphContext.js";
import {
  artifactLocalIdentity,
  javascriptAnalysisCoverage,
  type JavaScriptArtifactGraphContext,
  type JavaScriptArtifactGraphCoverage,
} from "./JavaScriptArtifactGraphContext.js";
import { staticInferenceEvidence } from "./JavaScriptArtifactGraphEvidence.js";

interface ProjectedPath {
  readonly file: JavaScriptArtifactFile;
  readonly path: ElectronCallPath;
  readonly coverage: JavaScriptArtifactGraphCoverage;
  readonly nodes: readonly ApplicationNode[];
}

/** Retain context-specific wrapper paths, then join only unique IPC records. */
export const addElectronCallPaths = (
  context: JavaScriptArtifactGraphContext,
  ipc: ElectronIpcContext,
): void => {
  const projected: ProjectedPath[] = [];
  for (const { file, javascript } of context.analysis.files) {
    if (javascript === null) continue;
    const coverage = javascriptAnalysisCoverage(javascript);
    for (const path of javascript.electron.call_paths ?? []) {
      const pathId = electronCallPathId(file.path, path);
      const nodes = path.steps.map((step, index) =>
        context.accumulator.addNode({
          kind: "javascript-expression",
          identity: artifactLocalIdentity(
            file.sha256,
            "electron-call-path-step",
            `${pathId}:${String(index)}`,
          ),
          observations: [
            {
              label: step.label,
              properties: {
                path_id: pathId,
                entry: path.entry,
                ...(path.entry_path === undefined
                  ? {}
                  : { entry_path: [...path.entry_path] }),
                entry_kind: path.entry_kind,
                channel: path.channel,
                terminal: path.terminal,
                step_kind: step.kind,
                step_index: index,
                module_key: step.module_key,
                module_runtime: step.module_runtime,
                conditions: path.conditions,
                resolution: "candidate",
              },
              evidence: staticInferenceEvidence({
                sha256: file.sha256,
                path: file.path,
                range: step.location,
                operation: "substitute-electron-wrapper",
                coverage,
                limitations: [
                  "Lexical wrapper substitution is a static candidate; guards, runtime overrides and execution remain unverified.",
                ],
              }),
            },
          ],
        }),
      );
      const first = nodes[0],
        entry = path.steps[0];
      const owner = entry
        ? electronFindingSourceNode(
            context,
            file,
            entry.module_key,
            entry.module_runtime ?? undefined,
          )
        : undefined;
      if (first && entry && owner)
        addElectronInferenceEdge(context, {
          source: owner,
          target: first,
          file,
          range: entry.location,
          coverage,
          relation: "contains",
          operation: "locate-electron-wrapper-path",
          properties: {
            path_id: pathId,
            entry: path.entry,
            ...(path.entry_path === undefined
              ? {}
              : { entry_path: [...path.entry_path] }),
            resolution: "candidate",
          },
        });
      for (let i = 1; i < nodes.length; i += 1) {
        const source = nodes[i - 1],
          target = nodes[i],
          previous = path.steps[i - 1],
          step = path.steps[i];
        if (!source || !target || !previous || !step) continue;
        addElectronInferenceEdge(context, {
          source,
          target,
          file,
          range: step.location,
          coverage,
          relation: ["exposure", "factory", "ipc"].includes(previous.kind)
            ? "maps_to"
            : "calls",
          operation: "trace-electron-wrapper-path",
          properties: {
            path_id: pathId,
            entry: path.entry,
            ...(path.entry_path === undefined
              ? {}
              : { entry_path: [...path.entry_path] }),
            channel: path.channel,
            resolution: "candidate",
            conditions: path.conditions,
          },
        });
      }
      projected.push({ file, path, coverage, nodes });
    }
  }
  const wrapperCandidates = [
    ...ipc.pairings.map((pairing) => ({ ...pairing, coverageLimited: false })),
    ...ipc.states.flatMap(({ transmission, coverageLimitedCandidate }) =>
      coverageLimitedCandidate === null
        ? []
        : [
            {
              transmission,
              handler: coverageLimitedCandidate,
              coverageLimited: true,
            },
          ],
    ),
  ];
  for (const { transmission, handler, coverageLimited } of wrapperCandidates) {
    const sources = projected.filter(
      (p) => p.path.entry_kind === "bridge-member" && matches(p, transmission),
    );
    const targets = projected.filter(
      (p) => p.path.entry_kind === "ipc-handler" && matches(p, handler),
    );
    for (const from of sources)
      for (const to of targets) {
        const source = from.nodes.at(-1),
          target = to.nodes[0];
        if (!source || !target) continue;
        addElectronInferenceEdge(context, {
          source,
          target,
          file: from.file,
          range: transmission.finding.location,
          coverage: from.coverage,
          relation:
            transmission.finding.mode === "invoke" ? "invokes" : "sends",
          operation: "join-electron-wrapper-paths",
          properties: {
            channel: transmission.finding.channel,
            pairing_basis: coverageLimited
              ? IPC_COVERAGE_LIMITED_PAIRING_BASIS
              : "unique-exact-literal-channel",
            resolution: "candidate",
            handler_path: to.file.path,
            bridge_conditions: from.path.conditions,
            handler_conditions: to.path.conditions,
          },
          limitations: coverageLimited
            ? [
                "Incomplete source coverage may hide competing handlers; uniqueness of this observed channel match cannot be established.",
                "The match does not establish runtime registration, sender acceptance, or dispatch.",
              ]
            : [
                "The unique static channel match does not establish runtime registration, sender acceptance, or dispatch.",
              ],
        });
      }
  }
};

const matches = (
  projected: ProjectedPath,
  record: ElectronIpcRecord,
): boolean => {
  const { path } = projected;
  const { finding } = record;
  const invocation = finding.invocation_location;
  const sourceStepKind =
    finding.mode === "send" || finding.mode === "invoke" ? "terminal" : "ipc";
  return (
    projected.file.path === record.file.path &&
    path.channel === finding.channel &&
    path.steps.some(
      (step) =>
        step.kind === sourceStepKind &&
        javascriptSourceRangeKey(step.location) ===
          javascriptSourceRangeKey(finding.location),
    ) &&
    (invocation === undefined ||
      path.steps.some(
        (step) =>
          (step.kind === "call" || step.kind === "exposure") &&
          javascriptSourceRangeKey(step.location) ===
            javascriptSourceRangeKey(invocation),
      ))
  );
};
