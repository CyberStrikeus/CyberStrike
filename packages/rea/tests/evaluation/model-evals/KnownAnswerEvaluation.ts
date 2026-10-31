import { visit } from "jsonc-parser";
import { z } from "zod";

import {
  parseEvidence,
  evidenceAuthoritySchema,
  evidenceSchema,
  type Evidence,
} from "../../../src/domain/evidence.js";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../src/domain/jsonValue.js";
import { canonicalJson } from "../../../src/domain/comparisonSemantics.js";

/** Only authenticated, successful, non-conflicting transcript deliveries. */
export interface FixtureClaimContext {
  readonly evidence: Evidence;
  readonly deliveredEvidence: readonly Evidence[];
}

/** One closed fixture assertion and the producer facts that must support it. */
export interface FixtureClaimExpectation {
  readonly id: string;
  readonly expectedValue: JsonValue;
  readonly source: {
    readonly operation: string;
    readonly authority: Evidence["authority"];
    readonly confidence: Evidence["confidence"];
    readonly subject?: { readonly path: string; readonly sha256?: string };
    readonly parameters?: Readonly<Record<string, JsonValue>>;
    readonly linkedSubjects?: readonly {
      readonly operation: string;
      readonly path: string;
      readonly sha256?: string;
    }[];
    readonly select: (
      normalizedResult: JsonValue,
      context: FixtureClaimContext,
    ) => JsonValue | undefined;
  };
}

/** Failed fixture constraints, distinct from unrestricted natural-language correctness. */
export type FixtureClaimFailure =
  | "claim_missing"
  | "value_mismatch"
  | "claim_confidence_mismatch"
  | "claim_authority_mismatch"
  | "unknown_evidence"
  | "conflicting_evidence"
  | "source_operation_mismatch"
  | "source_confidence_mismatch"
  | "source_authority_mismatch"
  | "source_subject_mismatch"
  | "source_parameters_mismatch"
  | "source_links_mismatch"
  | "source_assertion_mismatch"
  | "selector_failed";

/** Diagnostics for a single configured fixture assertion. */
export interface FixtureClaimAssessment {
  readonly id: string;
  readonly status: "passed" | "failed";
  readonly failures: readonly FixtureClaimFailure[];
}

/** Only the configured closed fixture claims are assessed. */
export interface KnownAnswerAssessment {
  readonly scope: "configured_fixture_claims";
  readonly status: "passed" | "failed" | "not_assessed";
  readonly manifestFailures: readonly string[];
  readonly claims: readonly FixtureClaimAssessment[];
}

const subjectSchema = z.strictObject({
  path: z.string().min(1),
  sha256: z
    .string()
    .regex(/^[a-f0-9]{64}$/u)
    .optional(),
});
const expectationSchema = z.strictObject({
  id: z.string().min(1),
  expectedValue: jsonValueSchema,
  source: z.strictObject({
    operation: z.string().min(1),
    authority: evidenceAuthoritySchema,
    confidence: evidenceSchema.shape.confidence,
    subject: subjectSchema.optional(),
    parameters: z.record(z.string(), jsonValueSchema).optional(),
    linkedSubjects: z
      .array(subjectSchema.extend({ operation: z.string().min(1) }))
      .optional(),
    select: z.custom<FixtureClaimExpectation["source"]["select"]>(
      (value) => typeof value === "function",
    ),
  }),
});
const finalAnswerSchema = z.strictObject({
  claims: z.array(
    z.strictObject({
      id: z.string().min(1),
      value: jsonValueSchema,
      evidence_id: z.string().regex(/^ev_[a-f0-9]{64}$/u),
      confidence: evidenceSchema.shape.confidence,
      authority: evidenceAuthoritySchema,
    }),
  ),
});
type FinalClaim = z.infer<typeof finalAnswerSchema>["claims"][number];
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;
const sameJson = (left: unknown, right: unknown): boolean => {
  const parsedLeft = jsonValueSchema.safeParse(left);
  const parsedRight = jsonValueSchema.safeParse(right);
  return (
    parsedLeft.success &&
    parsedRight.success &&
    canonicalJson(parsedLeft.data) === canonicalJson(parsedRight.data)
  );
};

interface TranscriptJson {
  readonly value: unknown;
  readonly hasDuplicateMembers: boolean;
}

const parseTranscriptJson = (text: string): TranscriptJson | undefined => {
  const objects: Set<string>[] = [];
  let invalid = false;
  let hasDuplicateMembers = false;
  try {
    visit(
      text,
      {
        onObjectBegin: () => {
          objects.push(new Set());
        },
        onObjectProperty: (key) => {
          const keys = objects.at(-1);
          if (keys === undefined) invalid = true;
          else if (keys.has(key)) hasDuplicateMembers = true;
          keys?.add(key);
        },
        onObjectEnd: () => {
          objects.pop();
        },
        onError: () => {
          invalid = true;
        },
      },
      {
        disallowComments: true,
        allowTrailingComma: false,
        allowEmptyContent: false,
      },
    );
    if (invalid) return undefined;
    // Keep ambiguity separate from syntax: a failure can be observed without
    // choosing one contradictory code or authenticating ambiguous Evidence.
    return { value: JSON.parse(text) as unknown, hasDuplicateMembers };
  } catch (error) {
    // Syntax and nesting failures are malformed transcript input, not an evaluation crash.
    if (error instanceof SyntaxError || error instanceof RangeError)
      return undefined;
    throw error;
  }
};

interface DeliveredEvidence {
  readonly records: Map<string, Evidence>;
  readonly conflicts: Set<string>;
}

/** One completed tool call, with aliases normalized and successful Evidence authenticated. */
export interface ParsedCodexToolCall {
  readonly error: boolean;
  readonly errorCode: string | null;
  readonly id: string | null;
  readonly server: string | null;
  readonly tool: string;
  readonly arguments: JsonValue;
  readonly evidence: readonly Evidence[];
}

const consistentAliases = (
  value: Record<string, unknown>,
  left: string,
  right: string,
): boolean =>
  value[left] === undefined ||
  value[right] === undefined ||
  value[left] === value[right];

const consistentJsonFields = (
  value: Record<string, unknown>,
  left: string,
  right: string,
): boolean =>
  value[left] === undefined ||
  value[right] === undefined ||
  sameJson(value[left], value[right]);

const consistentJsonAliases = (
  value: Record<string, unknown>,
  left: string,
  right: string,
): boolean =>
  value[left] === undefined ||
  value[left] === null ||
  value[right] === undefined ||
  value[right] === null ||
  sameJson(value[left], value[right]);

/** Parse result representations once; authentication and diagnostic certainty stay distinct. */
const parseToolResult = (
  item: Record<string, unknown>,
  server: string | null,
): {
  readonly failed: boolean;
  readonly errorCode: string | null;
  readonly evidenceValue: unknown;
} => {
  const result = record(item.result ?? item.output);
  const structured = record(
    result?.structured_content ?? result?.structuredContent,
  );
  const direct = record(structured?.error ?? result?.error ?? item.error);
  let text: TranscriptJson | undefined;
  if (direct === undefined && structured === undefined) {
    // Only a complete single JSON block can supply a missing structured result.
    const content = result?.content;
    const block =
      Array.isArray(content) && content.length === 1
        ? record(content[0])
        : undefined;
    if (block?.type === "text" && typeof block.text === "string")
      text = parseTranscriptJson(block.text);
  }
  const error = direct ?? record(record(text?.value)?.error);
  const failed =
    item.status === "failed" ||
    (item.error !== undefined && item.error !== null) ||
    result?.isError === true ||
    structured?.error !== undefined ||
    error !== undefined;
  const errorCode =
    (direct !== undefined || text?.hasDuplicateMembers === false) &&
    typeof error?.code === "string" &&
    error.code.length > 0
      ? error.code
      : null;
  const evidenceValue =
    server?.toLowerCase() === "rea" &&
    item.status !== "failed" &&
    (item.error === undefined || item.error === null) &&
    consistentJsonAliases(item, "result", "output") &&
    result !== undefined &&
    result.isError !== true &&
    (result.error === undefined || result.error === null) &&
    (result.structuredContent === undefined ||
      result.structured_content === undefined ||
      sameJson(result.structuredContent, result.structured_content))
      ? (result.structuredContent ??
        result.structured_content ??
        (text?.hasDuplicateMembers === false ? text.value : undefined))
      : undefined;
  return { failed, errorCode, evidenceValue };
};

const evidenceFromCall = (
  value: unknown,
  tool: string,
): Evidence | undefined => {
  const structured = record(value);
  if (
    structured === undefined ||
    (structured.error !== undefined && structured.error !== null)
  )
    return undefined;
  let evidence: Evidence;
  try {
    evidence = parseEvidence(structured);
  } catch {
    // Transcript output is untrusted; invalid Evidence cannot support a claim.
    return undefined;
  }
  if (tool !== evidence.operation) return undefined;
  return evidence;
};

const completedToolItem = (
  event: unknown,
): Record<string, unknown> | undefined => {
  const value = record(event);
  const wrapped = value?.type === "item.completed";
  const item = wrapped
    ? record(value.item)
    : value?.type === "mcp_tool_call"
      ? value
      : undefined;
  if (item?.type !== "mcp_tool_call") return undefined;
  const terminalStatus =
    item.status === "completed" || item.status === "failed";
  if (
    (wrapped
      ? item.status !== undefined && !terminalStatus
      : !terminalStatus) ||
    !consistentAliases(item, "server", "server_name") ||
    !consistentAliases(item, "tool", "name") ||
    !consistentJsonFields(item, "arguments", "input")
  )
    return undefined;
  return item;
};

const artifactDelivery = (evidence: Evidence): readonly Evidence[] => {
  const records = [evidence];
  if (evidence.operation !== "inspect_artifact") return records;
  const substeps = record(evidence.normalized_result)?.substeps;
  if (!Array.isArray(substeps)) return records;
  // Artifact inspection delivers linked inventory Evidence inline; bare IDs in
  // normalized facts are references, not authenticated deliveries.
  for (const value of substeps) {
    const substep = record(value);
    if (
      substep?.status !== "completed" ||
      substep.operation !== "inventory_artifact" ||
      typeof substep.evidence_id !== "string" ||
      !evidence.evidence_links.includes(substep.evidence_id)
    )
      continue;
    try {
      const nested = parseEvidence(substep.evidence);
      if (
        nested.evidence_id === substep.evidence_id &&
        nested.operation === substep.operation
      )
        records.push(nested);
    } catch {
      // An authenticated parent does not authenticate an embedded record's ID.
    }
  }
  return records;
};

/** Parse one completed transcript call and authenticate any successful REA Evidence. */
export const parseCodexToolCall = (
  event: unknown,
): ParsedCodexToolCall | undefined => {
  const item = completedToolItem(event);
  if (item === undefined) return undefined;
  const server = item.server ?? item.server_name;
  const tool = item.tool ?? item.name;
  if (
    ((item.server !== undefined || item.server_name !== undefined) &&
      typeof server !== "string") ||
    typeof tool !== "string" ||
    tool.length === 0
  )
    return undefined;
  const argumentsValue =
    item.arguments !== undefined
      ? item.arguments
      : item.input !== undefined
        ? item.input
        : {};
  const parsedArguments = jsonValueSchema.safeParse(argumentsValue);
  if (!parsedArguments.success) return undefined;
  const serverName = typeof server === "string" ? server : null;
  const result = parseToolResult(item, serverName);
  const parsed: ParsedCodexToolCall = {
    error: result.failed,
    errorCode: result.errorCode,
    id: typeof item.id === "string" && item.id.length > 0 ? item.id : null,
    server: serverName,
    tool,
    arguments: parsedArguments.data,
    evidence: [],
  };
  const evidence = evidenceFromCall(result.evidenceValue, tool);
  if (evidence === undefined) return parsed;
  return { ...parsed, evidence: artifactDelivery(evidence) };
};

const collectDeliveredEvidence = (
  calls: readonly (ParsedCodexToolCall | undefined)[],
): DeliveredEvidence => {
  const records = new Map<string, Evidence>();
  const conflicts = new Set<string>();
  for (const call of calls) {
    for (const evidence of call?.evidence ?? []) {
      const previous = records.get(evidence.evidence_id);
      if (previous !== undefined && !sameJson(previous, evidence))
        conflicts.add(evidence.evidence_id);
      else records.set(evidence.evidence_id, evidence);
    }
  }
  return { records, conflicts };
};

const matchesSubject = (
  evidence: Evidence,
  expected: { readonly path: string; readonly sha256?: string },
): boolean =>
  evidence.subject?.local_path === expected.path &&
  (expected.sha256 === undefined ||
    evidence.subject.digest.sha256 === expected.sha256);

const matchesParameters = (
  evidence: Evidence,
  expected: Readonly<Record<string, JsonValue>> | undefined,
): boolean =>
  expected === undefined ||
  Object.entries(expected).every(
    ([key, value]) =>
      Object.hasOwn(evidence.parameters, key) &&
      sameJson(evidence.parameters[key], value),
  );

const matchesLinks = (
  evidence: Evidence,
  source: FixtureClaimExpectation["source"],
  delivered: DeliveredEvidence,
): boolean =>
  (source.linkedSubjects ?? []).every((expected) =>
    evidence.evidence_links.some((id) => {
      const linked = delivered.records.get(id);
      return (
        linked !== undefined &&
        !delivered.conflicts.has(id) &&
        linked.operation === expected.operation &&
        matchesSubject(linked, expected)
      );
    }),
  );

const assessClaim = (
  expected: FixtureClaimExpectation,
  claim: FinalClaim | undefined,
  delivered: DeliveredEvidence,
): FixtureClaimAssessment => {
  const failures: FixtureClaimFailure[] = [];
  if (claim === undefined)
    return { id: expected.id, status: "failed", failures: ["claim_missing"] };
  if (!sameJson(claim.value, expected.expectedValue))
    failures.push("value_mismatch");
  if (claim.confidence !== expected.source.confidence)
    failures.push("claim_confidence_mismatch");
  if (claim.authority !== expected.source.authority)
    failures.push("claim_authority_mismatch");
  const evidence = delivered.records.get(claim.evidence_id);
  if (evidence === undefined) failures.push("unknown_evidence");
  else if (delivered.conflicts.has(claim.evidence_id))
    failures.push("conflicting_evidence");
  else {
    if (evidence.operation !== expected.source.operation)
      failures.push("source_operation_mismatch");
    if (evidence.confidence !== expected.source.confidence)
      failures.push("source_confidence_mismatch");
    if (evidence.authority !== expected.source.authority)
      failures.push("source_authority_mismatch");
    if (
      expected.source.subject !== undefined &&
      !matchesSubject(evidence, expected.source.subject)
    )
      failures.push("source_subject_mismatch");
    if (!matchesParameters(evidence, expected.source.parameters))
      failures.push("source_parameters_mismatch");
    if (!matchesLinks(evidence, expected.source, delivered))
      failures.push("source_links_mismatch");
    try {
      if (
        !sameJson(
          expected.source.select(evidence.normalized_result, {
            evidence,
            deliveredEvidence: [...delivered.records.values()].filter(
              (record) => !delivered.conflicts.has(record.evidence_id),
            ),
          }),
          expected.expectedValue,
        )
      )
        failures.push("source_assertion_mismatch");
    } catch {
      // Producer-specific selectors may reject malformed representations; preserve a failed assessment.
      failures.push("selector_failed");
    }
  }
  return {
    id: expected.id,
    status: failures.length === 0 ? "passed" : "failed",
    failures,
  };
};

/** Grade closed answers only against configured fixture truth and delivered authenticated Evidence. */
export const evaluateKnownAnswers = (
  calls: readonly (ParsedCodexToolCall | undefined)[],
  finalMessage: string,
  expectations: readonly FixtureClaimExpectation[] | undefined,
): KnownAnswerAssessment => {
  const scope = "configured_fixture_claims";
  if (expectations === undefined)
    return { scope, status: "not_assessed", manifestFailures: [], claims: [] };
  const rubric = z.array(expectationSchema).min(1).safeParse(expectations);
  if (!rubric.success)
    return {
      scope,
      status: "failed",
      manifestFailures: ["invalid_fixture_rubric"],
      claims: [],
    };
  const expectedIds = new Set(expectations.map(({ id }) => id));
  if (expectedIds.size !== expectations.length)
    return {
      scope,
      status: "failed",
      manifestFailures: ["duplicate_fixture_claim_ids"],
      claims: [],
    };
  const answer = parseTranscriptJson(finalMessage);
  const manifest = finalAnswerSchema.safeParse(
    answer?.hasDuplicateMembers === false ? answer.value : undefined,
  );
  if (!manifest.success)
    return {
      scope,
      status: "failed",
      manifestFailures: ["invalid_final_claim_manifest"],
      claims: [],
    };
  const manifestFailures: string[] = [];
  const submitted = new Map<string, FinalClaim>();
  for (const claim of manifest.data.claims) {
    if (submitted.has(claim.id))
      manifestFailures.push(`duplicate_claim:${claim.id}`);
    if (!expectedIds.has(claim.id))
      manifestFailures.push(`unknown_claim:${claim.id}`);
    submitted.set(claim.id, claim);
  }
  const delivered = collectDeliveredEvidence(calls);
  const claims = expectations.map((expected) =>
    assessClaim(expected, submitted.get(expected.id), delivered),
  );
  return {
    scope,
    status:
      manifestFailures.length === 0 &&
      claims.every(({ status }) => status === "passed")
        ? "passed"
        : "failed",
    manifestFailures,
    claims,
  };
};
