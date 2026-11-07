import type { CallToolResult } from "@modelcontextprotocol/server";
import { STDIO_DEFAULT_MAX_BUFFER_SIZE } from "@modelcontextprotocol/server";

import type { ToolContract } from "../contracts/toolContractTypes.js";
import type { EvidenceWriter } from "../application/investigation/InvestigationRecordPort.js";
import type { Evidence } from "../domain/evidence.js";
import { safeParseEvidence } from "../domain/evidenceValidation.js";
import {
  projectAnalysisError,
  type AnalysisErrorProjection,
} from "../domain/analysisErrorProjection.js";
import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { jsonValueSchema, type JsonValue } from "../domain/jsonValue.js";
import type { Result } from "../domain/result.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import {
  MCP_TRANSPORT_EVIDENCE_DISCOVERY,
  MCP_TRANSPORT_EVIDENCE_EXPORT,
} from "../domain/analysisErrorPresentation.js";
import {
  nodeStringCeilingRecovery,
  stdioResponseBudgetRecovery,
} from "../config/mcpResponseBudget.js";
import {
  encodeToolResult,
  MCP_RESULT_STRING_LIMIT,
  NODE_MAX_STRING_LENGTH,
  TARGET_CONTENT_RESULT_META,
} from "./toolResultEncoding.js";

/** Project a response-budget refusal without labeling REA's reserved string limit as Node's ceiling. */
export const mcpResponseOverflowProjection = (input: {
  readonly completed: boolean;
  readonly constraint: "receive-buffer" | "string-length";
  readonly effectiveResponseBytes: number;
  readonly nextStep: string;
}): { readonly reason: string; readonly remediationAction: string } => {
  const facts =
    input.constraint === "string-length"
      ? nodeStringCeilingRecovery(
          MCP_RESULT_STRING_LIMIT,
          NODE_MAX_STRING_LENGTH,
        )
      : stdioResponseBudgetRecovery(
          input.effectiveResponseBytes,
          MCP_RESULT_STRING_LIMIT,
          NODE_MAX_STRING_LENGTH,
        );
  const summary =
    input.constraint === "string-length"
      ? input.completed
        ? "The operation completed, but its complete MCP response exceeds REA's reserved single-string limit."
        : "The tool failed, but its complete error response exceeds REA's reserved single-string limit."
      : input.completed
        ? "The operation completed, but its complete MCP response exceeds the stdio response budget. The analysis result was not truncated."
        : "The tool failed, but its complete error response exceeds the MCP response budget.";
  return {
    reason: `${summary} ${facts} ${input.nextStep}`,
    remediationAction: `${input.nextStep} ${facts}`,
  };
};

/**
 * A summary projection has already used `detail: "summary"`.
 * Export still writes the retained bundle outside one MCP frame.
 */
const evidenceBundleSummary = (value: JsonValue): boolean => {
  const payload =
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    "result" in value
      ? value.result
      : value;
  return (
    typeof payload === "object" &&
    payload !== null &&
    !Array.isArray(payload) &&
    payload.kind === "evidence-bundle-summary"
  );
};

/** Immutable encoding and recovery policy shared by one MCP server. */
export class ToolResultDelivery {
  readonly maximumResponseBytes: number;
  readonly resultBudgetBytes: number;
  constructor(
    maximumResponseBytes: number,
    private readonly nativeContinuation: (
      evidence: Evidence,
    ) => Readonly<Record<string, JsonValue>> = () => ({}),
  ) {
    this.maximumResponseBytes = maximumResponseBytes;
    this.resultBudgetBytes = maximumResponseBytes - 1024;
    Object.freeze(this);
  }

  /** Serialize a plain application result or its actionable error. */
  toCallToolResult(
    result: Result<JsonValue, AnalysisError>,
    contract: ToolContract,
    recovery: Readonly<Record<string, JsonValue>> = {},
  ): CallToolResult {
    return result.ok
      ? this.successResult(
          contract.kind === "session" ? { result: result.value } : result.value,
          contract,
          recovery,
        )
      : this.toErrorToolResult(result.error, contract.returnsTargetContent);
  }

  /** Deliver Evidence using the producer's explicit recording acknowledgment. */
  toEvidenceToolResult(
    evidence: Evidence,
    contract: ToolContract,
    recorded: Result<unknown, AnalysisError> | undefined,
  ): CallToolResult {
    return recorded !== undefined && !recorded.ok
      ? this.toErrorToolResult(recorded.error, contract.returnsTargetContent)
      : this.successResult(evidence, contract, {
          evidence_id: evidence.evidence_id,
          ...(recorded === undefined
            ? {}
            : {
                evidence_reference: {
                  kind: "retained-evidence",
                  evidence_id: evidence.evidence_id,
                },
                ...this.nativeContinuation(evidence),
              }),
        });
  }

  /**
   * Project an error without allocating oversized repeated MCP text.
   * `targetContent` is the failing tool's `returnsTargetContent`: a failure
   * can carry target-derived text (a message, captured output, or a partial
   * observation), so it is marked exactly like that tool's successful results.
   */
  toErrorToolResult(
    error: AnalysisError,
    targetContent: boolean,
  ): CallToolResult {
    return this.projectedErrorResult(
      projectAnalysisError(error),
      targetContent,
    );
  }

  /** Retain valid partial Evidence and reference it only after recording succeeds. */
  toPartialErrorToolResult(
    error: AnalysisError,
    targetContent: boolean,
    recordEvidence?: EvidenceWriter["recordEvidence"],
  ): CallToolResult {
    if (recordEvidence === undefined)
      return this.toErrorToolResult(error, targetContent);
    const partial = safeParseEvidence(error.partialObservation);
    if (!partial.ok) return this.toErrorToolResult(error, targetContent);
    const recorded = recordEvidence(partial.value);
    if (!recorded.ok) return this.toErrorToolResult(error, targetContent);
    const projected = projectAnalysisError(error);
    return this.projectedErrorResult(
      {
        ...projected,
        details: {
          ...projected.details,
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: partial.value.evidence_id,
          },
        },
      },
      targetContent,
    );
  }

  private projectedErrorResult(
    projected: AnalysisErrorProjection,
    targetContent: boolean,
  ): CallToolResult {
    const structuredContent = { error: projected };
    // Errors reach the wire as text only; the structured copy is a private
    // carrier the transport removes after its own budget check.
    const encoded = encodeToolResult(
      structuredContent,
      this.resultBudgetBytes,
      "error-text",
      targetContent,
    );
    // The transport retains an oversized projected error before replacing it
    // with a recoverable delivery constraint, using this same budget.
    return {
      content: encoded.ok ? [{ type: "text", text: encoded.text }] : [],
      structuredContent,
      isError: true,
      ...(targetContent ? { _meta: TARGET_CONTENT_RESULT_META } : {}),
    };
  }

  private successResult(
    value: JsonValue,
    contract: ToolContract,
    recovery: Readonly<Record<string, JsonValue>> = {},
  ): CallToolResult {
    const encoded = encodeToolResult(
      value,
      this.resultBudgetBytes,
      "structured-and-text",
      contract.returnsTargetContent,
    );
    if (encoded.ok)
      return {
        content: [{ type: "text", text: encoded.text }],
        structuredContent: value,
        ...(contract.returnsTargetContent
          ? { _meta: TARGET_CONTENT_RESULT_META }
          : {}),
      };
    const retainedEvidence = recovery.evidence_reference !== undefined;
    const nextStep =
      recovery.committed_unknown !== undefined
        ? "Export this session with export_evidence_bundle to inspect the committed unknown and its mutation Evidence. Do not repeat the completed mutation; an individual unknown may be too large for a list_unknowns page."
        : recovery.continuation !== undefined
          ? "Call inspect_analysis_view with the supplied continuation arguments to read retained analysis. Follow coverage.next_offset for subsequent pages; reduce the page limit if needed, or export the complete retained Evidence."
          : retainedEvidence
            ? "Export retained evidence to consume the complete analysis, or use complete CLI JSON output."
            : contract.name === "list_unknowns"
              ? "Call list_unknowns on this same connection with the same filters and offset, using a smaller limit, then follow next_offset. If a single unknown cannot fit, export the session with export_evidence_bundle to recover it."
              : contract.name === "get_evidence_bundle"
                ? evidenceBundleSummary(value)
                  ? MCP_TRANSPORT_EVIDENCE_EXPORT
                  : MCP_TRANSPORT_EVIDENCE_DISCOVERY
                : "Use complete CLI JSON output to consume the analysis.";
    const projected = mcpResponseOverflowProjection({
      completed: true,
      constraint: encoded.constraint,
      effectiveResponseBytes: this.maximumResponseBytes,
      nextStep,
    });
    return this.toErrorToolResult(
      new AnalysisResourceConstraintError(
        contract.name,
        "transport",
        projected.reason,
        {
          boundary: "mcp-response",
          default_receive_buffer_bytes: STDIO_DEFAULT_MAX_BUFFER_SIZE,
          result_budget_bytes: this.resultBudgetBytes,
          max_string_code_units: MCP_RESULT_STRING_LIMIT,
          response_bytes_at_least: encoded.bytesAtLeast,
          response_code_units_at_least: encoded.codeUnitsAtLeast,
          constraint: encoded.constraint,
          ...recovery,
        },
        { remediationAction: projected.remediationAction },
      ),
      contract.returnsTargetContent,
    );
  }
}
