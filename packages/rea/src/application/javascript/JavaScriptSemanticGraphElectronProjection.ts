import type { ElectronCallPath } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { electronCallPathId } from "./ElectronCallPathIdentity.js";
import {
  addSemanticGraphRelation,
  retainSemanticGraphNode,
  type SemanticGraphProjectionState,
} from "./JavaScriptSemanticGraphConstruction.js";
import { inferredSemanticEvidenceAt } from "./JavaScriptSemanticGraphEvidence.js";

/** Give discovered process-boundary paths budget before bulk library definitions. */
export function* projectElectronSemanticCallPaths(
  file: JavaScriptArtifactFile,
  paths: readonly ElectronCallPath[],
  state: SemanticGraphProjectionState,
): Generator<void, void> {
  for (const path of paths) {
    yield;
    const pathId = electronCallPathId(file.path, path);
    let previous: ReturnType<typeof retainSemanticGraphNode> = null;
    let previousKind: ElectronCallPath["steps"][number]["kind"] | undefined;
    for (const [index, step] of path.steps.entries()) {
      const node = retainSemanticGraphNode(state, file, {
        kind:
          step.kind === "function"
            ? "function"
            : step.kind === "exposure"
              ? "boundary"
              : "call-site",
        roleKey: `electron-path:${pathId}:${String(index)}`,
        location: step.location,
        label: step.label,
        functionNodeId: null,
        properties: {
          path_id: pathId,
          entry: path.entry,
          ...(path.entry_path === undefined
            ? {}
            : { entry_path: [...path.entry_path] }),
          channel: path.channel,
          terminal: path.terminal,
          step_kind: step.kind,
          resolution: "candidate",
          conditions: path.conditions.map((c) => ({
            expression: c.expression,
            location: {
              start: { ...c.location.start },
              end: { ...c.location.end },
            },
          })),
        },
      });
      if (index === 0 && node !== null) state.roots.add(node.node_id);
      addSemanticGraphRelation(state, {
        source: previous,
        target: node,
        relation:
          previousKind === "ipc"
            ? "registers-listener"
            : previousKind === "exposure" || previousKind === "factory"
              ? "aliases"
              : "calls",
        resolution: "candidate",
        evidence: inferredSemanticEvidenceAt(file, step.location),
        properties: {
          path_id: pathId,
          entry: path.entry,
          ...(path.entry_path === undefined
            ? {}
            : { entry_path: [...path.entry_path] }),
          channel: path.channel,
          basis: "lexical-wrapper-substitution",
        },
      });
      previous = node;
      previousKind = step.kind;
    }
  }
}
