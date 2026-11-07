import {
  JAVASCRIPT_APPLICATION_PROVIDER,
  JAVASCRIPT_RUNTIME_RECONCILIATION_PROVIDER,
  MANAGED_WORKFLOW_PROVIDER,
} from "../../domain/investigationProviders.js";
import { isImmutableEvidence, type Evidence } from "../../domain/evidence.js";
import { readEvidence } from "../../domain/evidenceValidation.js";
import { EvidenceIntegrityError } from "../../domain/evidenceErrors.js";
import {
  type AnalysisInputIssue,
  AnalysisInputError,
} from "../../domain/analysisErrorCore.js";
import { projectInputIssues } from "../../domain/inputIssueProjection.js";
import { err, ok, type Result } from "../../domain/result.js";
import { z } from "zod";
import {
  analyzeJavaScriptApplicationInputSchema,
  javascriptApplicationAnalysisResultSchema,
  type JavaScriptApplicationAnalysisResult,
} from "../../domain/javascript/javascriptApplicationAnalysis.js";
import type { JavaScriptApplicationGraph } from "../../domain/javascript/javascriptApplicationGraph.js";
import type { JavaScriptSemanticGraph } from "../../domain/javascript/javascriptSemanticGraph.js";
import { javascriptRuntimeReconciliationResultSchema } from "../../domain/javascript/javascriptRuntimeReconciliationSchemas.js";
import { managedApplicationGraphResultSchema } from "../../domain/managed/managedApplicationGraph.js";

/** Supported immutable source for an application-level graph workflow. */
export interface ApplicationGraphEvidenceSource {
  readonly evidence: Evidence;
  readonly graph: JavaScriptApplicationGraph;
  readonly kind:
    | "static-application"
    | "static-runtime-reconciliation"
    | "managed-application";
  readonly rootArtifactSha256: string;
  readonly semanticGraph: JavaScriptSemanticGraph | null;
}

/** Caller-owned Evidence failed validation at the application graph boundary. */
export interface ApplicationGraphEvidenceInputFailure {
  readonly issues: readonly AnalysisInputIssue[];
}

/** Convert typed parser issues into this workflow's caller-facing input error. */
export const applicationGraphEvidenceInputError = (
  operation: string,
  failure: ApplicationGraphEvidenceInputFailure | EvidenceIntegrityError,
): AnalysisInputError | EvidenceIntegrityError =>
  failure instanceof EvidenceIntegrityError
    ? failure
    : new AnalysisInputError(operation, undefined, failure.issues);

class InvalidApplicationGraphEvidence extends Error {
  constructor(readonly issues: readonly AnalysisInputIssue[]) {
    super("Application graph Evidence failed input validation");
  }
}

const ownedApplicationSources = new WeakMap<
  Evidence,
  ApplicationGraphEvidenceSource
>();

/** Retain the producer-validated meaning of its exact immutable result snapshot. */
export const rememberOwnedApplicationGraphEvidence = (
  evidence: Evidence,
  result: JavaScriptApplicationAnalysisResult,
): Evidence => {
  if (
    !isImmutableEvidence(evidence) ||
    evidence.normalized_result !== result ||
    evidence.operation !== "analyze_javascript_application" ||
    !providerMatches(evidence, JAVASCRIPT_APPLICATION_PROVIDER)
  )
    throw new TypeError(
      "Owned application Evidence must bind its exact validated immutable result",
    );
  ownedApplicationSources.set(
    evidence,
    Object.freeze(staticApplicationSourceForResult(evidence, result, [])),
  );
  return evidence;
};

/** Parse and authenticate one REA-produced JavaScript Application Graph Evidence. */
export const parseApplicationGraphEvidence = (
  input: unknown,
  path: readonly (string | number)[] = [],
): Result<
  ApplicationGraphEvidenceSource,
  ApplicationGraphEvidenceInputFailure | EvidenceIntegrityError
> =>
  captureInputValidation(() => {
    const evidence = parseEvidenceInput(input);
    const owned = ownedApplicationSources.get(evidence);
    if (owned !== undefined) return owned;
    if (evidence.operation === "analyze_javascript_application") {
      requirePredicate(evidence, "rea.javascript-application-analysis", path);
      requireProvider(evidence, JAVASCRIPT_APPLICATION_PROVIDER, path);
      return staticApplicationSource(evidence, path);
    }
    if (evidence.operation === "reconcile_javascript_runtime") {
      requirePredicate(evidence, "rea.javascript-runtime-reconciliation", path);
      requireProvider(
        evidence,
        JAVASCRIPT_RUNTIME_RECONCILIATION_PROVIDER,
        path,
      );
      return staticRuntimeSource(evidence, path);
    }
    if (evidence.operation === "project_managed_application_graph") {
      requirePredicate(evidence, "rea.managed-application-graph", path);
      requireProvider(evidence, MANAGED_WORKFLOW_PROVIDER, path);
      return managedApplicationSource(evidence, path);
    }
    throw invalidEvidence(
      path,
      "operation",
      "Expected authenticated JavaScript analysis, runtime reconciliation, or managed application graph Evidence.",
    );
  });

const staticApplicationSource = (
  evidence: Evidence,
  path: readonly (string | number)[],
): ApplicationGraphEvidenceSource => {
  const result = parseCallerValue(
    (input) => javascriptApplicationAnalysisResultSchema.parse(input),
    evidence.normalized_result,
    [...path, "normalized_result"],
  );
  return staticApplicationSourceForResult(evidence, result, path);
};

const staticApplicationSourceForResult = (
  evidence: Evidence,
  result: JavaScriptApplicationAnalysisResult,
  path: readonly (string | number)[],
): ApplicationGraphEvidenceSource => {
  if (
    evidence.authority !== "shipped-artifact" ||
    evidence.confidence !== "derived"
  )
    throw invalidEvidence(
      path,
      "authority",
      "JavaScript application Evidence must use shipped-artifact authority and derived confidence.",
    );
  if (evidence.predicate_type !== "rea.javascript-application-analysis")
    throw invalidEvidence(
      path,
      "predicate_type",
      "JavaScript application Evidence predicate does not match its result shape.",
    );
  parseCallerValue(
    (input) => analyzeJavaScriptApplicationInputSchema.parse(input),
    { input_path: result.input_path, ...evidence.parameters },
    [...path, "parameters"],
  );
  assertApplicationSubject(evidence, result, path);
  return {
    evidence,
    graph: result.graph,
    kind: "static-application",
    rootArtifactSha256: result.root_artifact_sha256,
    semanticGraph: result.semantic_graph,
  };
};

const staticRuntimeSource = (
  evidence: Evidence,
  path: readonly (string | number)[],
): ApplicationGraphEvidenceSource => {
  if (
    evidence.authority !== "analyst-inference" ||
    evidence.confidence !== "inferred"
  )
    throw invalidEvidence(
      path,
      "authority",
      "Runtime reconciliation Evidence must use analyst-inference authority and inferred confidence.",
    );
  const result = parseCallerValue(
    (input) => javascriptRuntimeReconciliationResultSchema.parse(input),
    evidence.normalized_result,
    [...path, "normalized_result"],
  );
  assertResultEvidenceLinksInEnvelope(
    result.evidence_links,
    evidence,
    path,
    "Runtime reconciliation result",
  );
  const applicationLayer = result.static_layers.find(
    ({ role }) => role === "application",
  );
  if (applicationLayer === undefined)
    throw invalidEvidence(
      [...path, "normalized_result"],
      "static_layers",
      "Runtime reconciliation Evidence must include its application layer.",
    );
  return {
    evidence,
    graph: result.graph,
    kind: "static-runtime-reconciliation",
    rootArtifactSha256: applicationLayer.root_artifact_sha256,
    semanticGraph: null,
  };
};

const managedApplicationSource = (
  evidence: Evidence,
  path: readonly (string | number)[],
): ApplicationGraphEvidenceSource => {
  if (
    evidence.authority !== "analyst-inference" ||
    evidence.confidence !== "inferred"
  )
    throw invalidEvidence(
      path,
      "authority",
      "Managed application graph Evidence must use analyst-inference authority and inferred confidence.",
    );
  const result = parseCallerValue(
    (input) => managedApplicationGraphResultSchema.parse(input),
    evidence.normalized_result,
    [...path, "normalized_result"],
  );
  assertResultEvidenceLinksInEnvelope(
    result.evidence_links,
    evidence,
    path,
    "Managed application graph result",
  );
  return {
    evidence,
    graph: result.graph,
    kind: "managed-application",
    rootArtifactSha256: result.root_artifact_sha256,
    semanticGraph: null,
  };
};

const assertResultEvidenceLinksInEnvelope = (
  resultEvidenceLinks: readonly string[],
  evidence: Evidence,
  path: readonly (string | number)[],
  resultLabel:
    | "Runtime reconciliation result"
    | "Managed application graph result",
): void => {
  const unmatchedLink = resultEvidenceLinks.find(
    (evidenceId) => !evidence.evidence_links.includes(evidenceId),
  );
  if (unmatchedLink !== undefined)
    throw invalidEvidence(
      [...path, "normalized_result"],
      "evidence_links",
      `${resultLabel} references Evidence ${unmatchedLink} outside its envelope.`,
    );
};

const assertApplicationSubject = (
  evidence: Evidence,
  result: JavaScriptApplicationAnalysisResult,
  path: readonly (string | number)[],
): void => {
  if (
    evidence.subject === null ||
    evidence.subject.digest.sha256 !== result.root_artifact_sha256 ||
    evidence.subject.format !== result.format ||
    evidence.subject.local_path !== result.input_path
  )
    throw invalidEvidence(
      path,
      "subject",
      "JavaScript application Evidence subject must match the analyzed artifact identity and input path.",
    );
};

const providerMatches = (
  evidence: Evidence,
  provider: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  },
): boolean =>
  evidence.provider.id === provider.id &&
  evidence.provider.name === provider.name &&
  evidence.provider.version === provider.version;

const requirePredicate = (
  evidence: Evidence,
  expected: string,
  path: readonly (string | number)[],
): void => {
  if (evidence.predicate_type !== expected)
    throw invalidEvidence(
      path,
      "predicate_type",
      `Expected predicate ${expected} for operation ${evidence.operation}.`,
    );
};

const requireProvider = (
  evidence: Evidence,
  expected: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  },
  path: readonly (string | number)[],
): void => {
  if (!providerMatches(evidence, expected))
    throw invalidEvidence(
      path,
      "provider",
      `Expected provider ${expected.id} v${expected.version} for operation ${evidence.operation}.`,
    );
};

/** Authenticate artifact-bound Evidence that may extend a native handoff. */
export const parseNativeApplicationEvidence = (
  inputs: readonly unknown[],
  path: readonly (string | number)[] = [],
): Result<
  readonly Evidence[],
  ApplicationGraphEvidenceInputFailure | EvidenceIntegrityError
> =>
  captureInputValidation(() => {
    const parsed = inputs.map((input) => parseEvidenceInput(input));
    const withoutSubject = parsed.findIndex(({ subject }) => subject === null);
    if (withoutSubject !== -1)
      throw invalidEvidence(
        [...path, withoutSubject],
        "subject",
        "Native handoff Evidence requires an artifact subject.",
      );
    return parsed;
  });

const captureInputValidation = <Value>(
  operation: () => Value,
): Result<
  Value,
  ApplicationGraphEvidenceInputFailure | EvidenceIntegrityError
> => {
  try {
    return ok(operation());
  } catch (cause: unknown) {
    if (cause instanceof InvalidApplicationGraphEvidence)
      return err({ issues: cause.issues });
    if (cause instanceof EvidenceIntegrityError) return err(cause);
    throw cause;
  }
};

const parseEvidenceInput = (input: unknown): Evidence => {
  const parsed = readEvidence(input);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

const parseCallerValue = <Value>(
  parse: (input: unknown) => Value,
  input: unknown,
  path: readonly (string | number)[],
): Value => {
  try {
    return parse(input);
  } catch (cause: unknown) {
    if (cause instanceof z.ZodError) throw zodInputFailure(cause, input, path);
    throw cause;
  }
};

const zodInputFailure = (
  cause: z.ZodError,
  input: unknown,
  path: readonly (string | number)[],
): InvalidApplicationGraphEvidence =>
  new InvalidApplicationGraphEvidence(
    projectInputIssues(cause.issues, input).map((issue) => ({
      ...issue,
      path: [...path, ...issue.path],
    })),
  );

const invalidEvidence = (
  path: readonly (string | number)[],
  field: string,
  message: string,
): InvalidApplicationGraphEvidence =>
  new InvalidApplicationGraphEvidence([
    { path: [...path, field], reason: "invalid_value", message },
  ]);
