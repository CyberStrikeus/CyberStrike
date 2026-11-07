import {
  evaluateKnownAnswers,
  parseCodexToolCall,
  type FixtureClaimExpectation,
  type KnownAnswerAssessment,
  type ParsedCodexToolCall,
} from "./KnownAnswerEvaluation.js";
import { canonicalJson } from "../../../src/domain/comparisonSemantics.js";
import { TOOL_CONTRACTS } from "../../../src/contracts/toolContracts.js";

/** One REA MCP invocation observed in a Codex JSONL transcript. */
interface CodexMcpCall {
  readonly id: string | null;
  readonly server: string | null;
  readonly tool: string;
  readonly arguments: unknown;
  readonly evidenceIds: readonly string[];
  readonly error: boolean;
  readonly errorCode: string | null;
}

/** Transcript measurements, text heuristics, and optional closed fixture-claim assessment. */
export interface CodexAgentMetrics {
  readonly naturalUse: boolean;
  readonly correctFirstTool: boolean;
  readonly firstTool: string | null;
  readonly reaCalls: readonly CodexMcpCall[];
  readonly repeatedCallCount: number;
  readonly inputValidationFailureCount: number;
  readonly requiredToolSubsequenceMet: boolean;
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly finalMessage: string;
  readonly evidenceIds: readonly string[];
  /** Whether the answer contains a produced Evidence ID; claim support is not checked. */
  readonly finalCitesEvidence: boolean;
  /** Case-insensitive substring coverage, including terms in negated claims. */
  readonly answerTermCoverageMet: boolean;
  /** Text length, term/cue coverage, and configured transcript checks only. */
  readonly answerHeuristicsMet: boolean;
  /** Whether an epistemic keyword occurs; this does not establish honest authority use. */
  readonly epistemicCuePresent: boolean;
  /** Limited to configured fixture claims; free-form factual correctness is not assessed. */
  readonly factualCorrectness: KnownAnswerAssessment["status"];
  readonly factualAssessment: KnownAnswerAssessment;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const record = (value: unknown): Record<string, unknown> | undefined =>
  isRecord(value) ? value : undefined;

const textValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const numberValue = (value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : 0;

const callFromParsed = (
  parsed: ParsedCodexToolCall | undefined,
): CodexMcpCall | undefined => {
  if (parsed === undefined) return undefined;
  return {
    id: parsed.id,
    server: parsed.server,
    tool: parsed.tool,
    arguments: parsed.arguments,
    evidenceIds: parsed.evidence.map(({ evidence_id }) => evidence_id),
    error: parsed.error,
    errorCode: parsed.errorCode,
  };
};

const agentTextFromItem = (value: unknown): string | undefined => {
  const item = record(value);
  if (item?.type !== "agent_message") return undefined;
  const direct = textValue(item.text) ?? textValue(item.message);
  if (direct !== undefined) return direct;
  if (!Array.isArray(item.content)) return undefined;
  const parts = item.content.flatMap((part) => {
    const object = record(part);
    const text = object === undefined ? undefined : textValue(object.text);
    return text === undefined ? [] : [text];
  });
  return parts.length === 0 ? undefined : parts.join("\n");
};

interface EvaluationState {
  readonly calls: CodexMcpCall[];
  readonly seenCallIds: Set<string>;
  readonly finalMessages: string[];
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
}

const consumeEvent = (
  state: EvaluationState,
  value: unknown,
  parsedCall: ParsedCodexToolCall | undefined,
): void => {
  const event = record(value);
  if (event === undefined) return;
  const completedItem =
    event.type === "item.completed" ? event.item : undefined;
  const call = callFromParsed(parsedCall);
  if (call !== undefined) {
    const identity =
      call.id ??
      `${call.server ?? ""}:${call.tool}:${canonicalJson(call.arguments)}`;
    if (!state.seenCallIds.has(identity)) {
      state.seenCallIds.add(identity);
      state.calls.push(call);
    }
  }
  const message = agentTextFromItem(completedItem);
  if (message !== undefined) state.finalMessages.push(message);
  if (event.type !== "turn.completed") return;
  const usage = record(event.usage);
  state.inputTokens = Math.max(
    state.inputTokens,
    numberValue(usage?.input_tokens),
  );
  state.cachedInputTokens = Math.max(
    state.cachedInputTokens,
    numberValue(usage?.cached_input_tokens),
  );
  state.outputTokens = Math.max(
    state.outputTokens,
    numberValue(usage?.output_tokens),
  );
};

/** Measure agent routing, repetition, model usage, and explicitly limited answer heuristics. */
export const evaluateCodexEvents = (
  events: readonly unknown[],
  expectedFirstTool: string | null,
  options: {
    readonly requireEvidence?: boolean;
    readonly requiredAnswerTermGroups?: readonly (readonly string[])[];
    readonly requiredToolSubsequence?: readonly string[];
    readonly forbidInputValidationFailures?: boolean;
    readonly fixtureClaims?: readonly FixtureClaimExpectation[];
  } = {},
): CodexAgentMetrics => {
  const state: EvaluationState = {
    calls: [],
    seenCallIds: new Set(),
    finalMessages: [],
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
  };
  const parsedCalls = events.map(parseCodexToolCall);
  events.forEach((event, index) =>
    consumeEvent(state, event, parsedCalls[index]),
  );

  const reaCalls = state.calls.filter(
    ({ server }) => server?.toLowerCase() === "rea",
  );
  const signatures = new Map<string, number>();
  let targetRevision = 0;
  for (const call of reaCalls) {
    // A status read before and after a successful target lifecycle change is
    // useful verification, not a duplicate analysis or unchanged failed retry.
    const context =
      call.tool === "binary_session" ? `${String(targetRevision)}:` : "";
    const signature = `${context}${call.tool}:${canonicalJson(call.arguments)}`;
    signatures.set(signature, (signatures.get(signature) ?? 0) + 1);
    if (
      !call.error &&
      (call.tool === "open_binary" || call.tool === "close_binary")
    )
      targetRevision += 1;
  }
  const repeatedCallCount = [...signatures.values()].reduce(
    (total, count) => total + Math.max(0, count - 1),
    0,
  );
  const inputValidationFailureCount = reaCalls.filter(
    (call) =>
      call.errorCode === "invalid_request" ||
      (call.error &&
        TOOL_CONTRACTS.find(
          ({ name }) => name === call.tool,
        )?.inputSchema.safeParse(call.arguments).success === false),
  ).length;
  const requiredToolSubsequenceMet = containsOrderedSubsequence(
    reaCalls.filter(({ error }) => !error).map(({ tool }) => tool),
    options.requiredToolSubsequence ?? [],
  );
  const finalMessage = state.finalMessages.at(-1) ?? "";
  const evidenceIds = [
    ...new Set(reaCalls.flatMap(({ evidenceIds: ids }) => ids)),
  ];
  const finalCitesEvidence = evidenceIds.some((evidenceId) =>
    finalMessage.includes(evidenceId),
  );
  const normalizedFinalMessage = finalMessage.toLocaleLowerCase("en-US");
  const answerTermCoverageMet = (options.requiredAnswerTermGroups ?? []).every(
    (terms) =>
      terms.some((term) =>
        normalizedFinalMessage.includes(term.toLocaleLowerCase("en-US")),
      ),
  );
  const epistemicCuePresent =
    /\b(evidence|observed|inferred|unknown|unavailable|limitation|authority|not configured|could not|requires approval)\b/iu.test(
      finalMessage,
    );
  const factualAssessment = evaluateKnownAnswers(
    parsedCalls,
    finalMessage,
    options.fixtureClaims,
  );
  return {
    naturalUse: reaCalls.length > 0,
    correctFirstTool: (reaCalls[0]?.tool ?? null) === expectedFirstTool,
    firstTool: reaCalls[0]?.tool ?? null,
    reaCalls,
    repeatedCallCount,
    inputValidationFailureCount,
    requiredToolSubsequenceMet,
    inputTokens: state.inputTokens,
    cachedInputTokens: state.cachedInputTokens,
    outputTokens: state.outputTokens,
    finalMessage,
    evidenceIds,
    finalCitesEvidence,
    answerTermCoverageMet,
    answerHeuristicsMet:
      finalMessage.trim().length >= 80 &&
      epistemicCuePresent &&
      answerTermCoverageMet &&
      requiredToolSubsequenceMet &&
      (options.forbidInputValidationFailures !== true ||
        inputValidationFailureCount === 0) &&
      (options.requireEvidence !== true || finalCitesEvidence),
    epistemicCuePresent,
    factualCorrectness: factualAssessment.status,
    factualAssessment,
  };
};

const containsOrderedSubsequence = (
  values: readonly string[],
  required: readonly string[],
): boolean => {
  let index = 0;
  for (const value of values) {
    if (value === required[index]) index += 1;
    if (index === required.length) return true;
  }
  return required.length === 0;
};
