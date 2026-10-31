import {
  createJavaScriptSemanticFingerprint,
  type JavaScriptSemanticEvidenceContextRegistry,
} from "../../domain/javascript/javascriptSemanticGraph.js";
import type {
  JavaScriptSemanticFingerprint,
  JavaScriptSemanticGraphNode,
} from "../../domain/javascript/javascriptSemanticGraphSchemas.js";
import type { JavaScriptSemanticIr } from "../../domain/javascript/javascriptSemanticIr.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import { observedSemanticEvidence } from "./JavaScriptSemanticGraphEvidence.js";

/** Bind domain fingerprint components to exact semantic function nodes. */
export const projectSemanticFunctionFingerprints = (
  file: JavaScriptArtifactFile,
  ir: JavaScriptSemanticIr,
  callableNodes: ReadonlyMap<string, JavaScriptSemanticGraphNode>,
  evidenceContexts: JavaScriptSemanticEvidenceContextRegistry,
): JavaScriptSemanticFingerprint[] =>
  ir.functionFingerprints.flatMap((fingerprint) => {
    const callable = callableNodes.get(fingerprint.callableId);
    if (callable === undefined) return [];
    return [
      createJavaScriptSemanticFingerprint(
        {
          function_node_id: callable.node_id,
          algorithm: "rea.javascript-semantic-function",
          status: fingerprint.status,
          components: {
            parameter_arity: fingerprint.components.parameterArity,
            normalized_ast_sha256: fingerprint.components.normalizedAstSha256,
            control_flow_sha256: fingerprint.components.controlFlowSha256,
            relation_shape_sha256: fingerprint.components.relationShapeSha256,
            literal_set_sha256: fingerprint.components.literalSetSha256,
            effects: fingerprint.components.effects,
          },
          limitations: fingerprint.limitations,
          evidence: observedSemanticEvidence(
            file,
            callable.identity.source_range,
          ),
        },
        evidenceContexts,
      ),
    ];
  });
