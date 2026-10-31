import type { ApplicationGraphEvidence } from "../../domain/javascript/javascriptApplicationEvidenceSchemas.js";
import type { JavaScriptSourceRange } from "../../domain/javascript/javascriptStaticAnalysisTypes.js";
import type { JavaScriptArtifactAnalysisScope } from "./JavaScriptArtifactAnalysisTypes.js";

const EXTRACTOR = {
  name: "rea-javascript-artifact-reconstruction",
  version: "1",
  executable_sha256: null,
} as const;

/** Coverage shape accepted by reconstruction evidence helpers. */
export type ReconstructionEvidenceCoverage =
  ApplicationGraphEvidence["coverage"];

/** Shared exact artifact location and bounded coverage for static evidence. */
export interface EvidenceInput {
  readonly sha256: string;
  readonly path: string;
  readonly operation: string;
  readonly coverage: ReconstructionEvidenceCoverage;
  readonly limitations?: readonly string[];
  readonly range?: JavaScriptSourceRange;
}

/** Exact artifact-byte evidence for one safely inventoried local file. */
export const artifactObservationEvidence = (
  input: EvidenceInput,
): ApplicationGraphEvidence => ({
  authority: "artifact-bytes",
  state: "observed",
  confidence: "exact",
  artifact: artifactReference(input.sha256),
  location: {
    available: true,
    value: { kind: "artifact-path", path: input.path },
  },
  extractor: { ...EXTRACTOR, operation: input.operation },
  coverage: input.coverage,
  limitations: [...(input.limitations ?? [])],
  evidence_ids: [],
});

/** Exact AST syntax evidence with an actionable source range. */
export const astObservationEvidence = (
  input: EvidenceInput & { readonly range: JavaScriptSourceRange },
): ApplicationGraphEvidence => {
  const limitations = [
    ...(input.limitations ?? []),
    ...(input.coverage.status === "complete"
      ? []
      : [
          "AST coverage is incomplete; omitted or dynamic facts must not be interpreted as absence.",
        ]),
  ];
  return {
    authority: "ast-static-analysis",
    state: "observed",
    confidence: "exact",
    artifact: artifactReference(input.sha256),
    location: {
      available: true,
      value: { kind: "source-range", source: input.path, ...input.range },
    },
    extractor: { ...EXTRACTOR, operation: input.operation },
    coverage: input.coverage,
    limitations,
    evidence_ids: [],
  };
};

/** Explicit static relationship inference; never promoted to observation. */
export const staticInferenceEvidence = (
  input: EvidenceInput & {
    readonly confidence?: "high" | "medium" | "low";
  },
): ApplicationGraphEvidence => ({
  authority: "static-relationship-inference",
  state: "inferred",
  confidence: input.confidence ?? "high",
  artifact: artifactReference(input.sha256),
  location:
    input.range === undefined
      ? { available: true, value: { kind: "artifact-path", path: input.path } }
      : {
          available: true,
          value: { kind: "source-range", source: input.path, ...input.range },
        },
  extractor: { ...EXTRACTOR, operation: input.operation },
  coverage: input.coverage,
  limitations: [
    "Static syntax does not prove that this relationship executes at runtime.",
    ...(input.limitations ?? []),
  ],
  evidence_ids: [],
});

/** Unavailable static fact with the authority of its applicable processing phase. */
export const unavailableStaticEvidence = (
  input: EvidenceInput & {
    readonly authority: JavaScriptArtifactAnalysisScope["authority"];
    readonly limitation: string;
  },
): ApplicationGraphEvidence => ({
  authority: input.authority,
  state: "unavailable",
  confidence: "unknown",
  artifact: artifactReference(input.sha256),
  location: {
    available: true,
    value: { kind: "artifact-path", path: input.path },
  },
  extractor: { ...EXTRACTOR, operation: input.operation },
  coverage: input.coverage,
  limitations: [input.limitation, ...(input.limitations ?? [])],
  evidence_ids: [],
});

const artifactReference = (sha256: string) => ({
  available: true as const,
  artifact_id: `art_${sha256}`,
  sha256,
});
