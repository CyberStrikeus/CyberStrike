import { javascriptSourceRangeKey } from "../../domain/javascript/javascriptSourceCoordinates.js";
import type { ElectronProtocolFinding } from "../../domain/javascript/electronStaticAnalysisTypes.js";
import type { JavaScriptArtifactFile } from "../../domain/javascript/javascriptArtifactFiles.js";
import {
  artifactLocalIdentity,
  javascriptAnalysisCoverage,
  type JavaScriptArtifactGraphContext,
  type JavaScriptArtifactGraphCoverage,
} from "./JavaScriptArtifactGraphContext.js";
import { astObservationEvidence } from "./JavaScriptArtifactGraphEvidence.js";
import {
  addElectronInferenceEdge,
  electronFindingSourceNode,
  electronObservationIdentity,
} from "./ElectronBoundaryGraphContext.js";

interface ProtocolInput {
  readonly context: JavaScriptArtifactGraphContext;
  readonly file: JavaScriptArtifactFile;
  readonly value: ElectronProtocolFinding;
  readonly coverage: JavaScriptArtifactGraphCoverage;
}

const URL_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*$/u;

const REGISTRATION_LIMITATION =
  "A registration call is present in source; successful registration, control-flow reachability and operating-system or session routing are not established.";

/** Project custom URL scheme registrations as schemes the application claims. */
export const addElectronProtocolBoundaries = (
  context: JavaScriptArtifactGraphContext,
): void => {
  for (const analyzed of context.analysis.files) {
    const { file, javascript } = analyzed;
    if (javascript === null) continue;
    const coverage = javascriptAnalysisCoverage(javascript);
    for (const value of javascript.electron.protocols)
      addProtocolRegistration({ context, file, value, coverage });
  }
};

const addProtocolRegistration = (input: ProtocolInput): void => {
  const { context, file, value, coverage } = input;
  const source = electronFindingSourceNode(
    context,
    file,
    value.module_key,
    value.module_runtime,
  );
  if (source === undefined) return;
  const literal = value.scheme.status === "literal";
  const raw = value.scheme.value;
  // RFC 3986: ALPHA *( ALPHA / DIGIT / "+" / "-" / "." ).
  const scheme =
    literal && typeof raw === "string" && URL_SCHEME.test(raw)
      ? raw.toLowerCase()
      : null;
  // A non-string or malformed literal is observed exactly but names no scheme.
  const invalid = literal && scheme === null;
  const facts = {
    scheme,
    scheme_expression: value.scheme.expression,
    scheme_literal: literal ? raw : null,
    resolution:
      scheme !== null ? "literal" : invalid ? "invalid-literal" : "dynamic",
    api: value.api,
    role: value.role,
    session: value.session,
    enabled_privileges: value.enabled_privileges,
  };
  const limitations =
    scheme !== null
      ? [REGISTRATION_LIMITATION]
      : invalid
        ? [
            REGISTRATION_LIMITATION,
            "The scheme argument is a literal that is not a valid URL scheme, so no URL can target it as written.",
          ]
        : [
            REGISTRATION_LIMITATION,
            "The scheme expression is dynamic; its runtime value remains unknown.",
          ];
  // Scheme names are case-insensitive; retain their spelling separately from
  // canonical identity. One node per scheme across the artifact, so one both
  // privileged and handled is one entry point with several registrations.
  const node = context.accumulator.addNode({
    kind: "url-scheme",
    identity:
      scheme === null
        ? artifactLocalIdentity(
            file.sha256,
            "electron-dynamic-url-scheme",
            // Identical bytes at two paths are separate occurrences whose
            // expressions can resolve differently.
            `${file.path}:${value.api}:${javascriptSourceRangeKey(value.location)}`,
          )
        : electronObservationIdentity(
            context,
            "electron-url-scheme",
            `literal:${scheme}`,
          ),
    observations: [
      {
        label: scheme ?? value.scheme.expression ?? String(value.scheme.value),
        properties: facts,
        evidence: astObservationEvidence({
          sha256: file.sha256,
          path: file.path,
          range: value.location,
          operation: "observe-protocol-registration",
          coverage,
          limitations,
        }),
      },
    ],
  });
  addElectronInferenceEdge(context, {
    source,
    target: node,
    file,
    range: value.location,
    coverage,
    // Granting privileges exposes the scheme; the other roles claim its links.
    relation: value.role === "privileged-scheme" ? "exposes" : "handles",
    operation: "map-protocol-registration",
    properties: facts,
    limitations,
  });
};
