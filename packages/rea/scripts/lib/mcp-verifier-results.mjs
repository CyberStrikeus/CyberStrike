import { isDeepStrictEqual } from "node:util";
import { authenticateParsedEvidenceBundle } from "../../dist/domain/evidenceBundle.js";
import { analysisErrorProjectionSchema } from "../../dist/contracts/errorSchemas.js";
import { toolContract } from "../../dist/contracts/toolContracts.js";
import {
  expandProviderCapabilities,
  expandToolAvailability,
  providerCapabilitySet,
} from "../../dist/contracts/toolOutputSchemaPrimitives.js";
import { compareUnicodeCodePoints } from "../../dist/domain/unicodeCodePointOrder.js";

/** Read the textual JSON projection from one MCP tool call. */
export const mcpTextValue = (result) => {
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (typeof text !== "string") throw new Error("Tool result omitted text");
  return text;
};

const jsonValue = (result) => JSON.parse(mcpTextValue(result));

/** Sort canonical contract names using REA's code-point ordering. */
export const sortVerifierNames = (names) =>
  [...names].sort(compareUnicodeCodePoints);

/** Read the complete canonical diagnostic from an MCP tool failure. */
export const requireMcpToolError = (result) => {
  if (result.isError !== true) throw new Error("Expected an MCP tool failure");
  return analysisErrorProjectionSchema.parse(jsonValue(result).error);
};

/** Validate the complete output against its exact named contract, retaining inline Evidence. */
export const requireMcpOutput = (
  result,
  operation,
  contract = toolContract(operation),
) => {
  if (result.isError === true)
    throw new Error(`${operation} failed: ${mcpTextValue(result)}`);
  if (contract.name !== operation)
    throw new Error(`${operation} received the ${contract.name} contract`);
  const text = jsonValue(result);
  const output = contract.outputSchema.parse(text);
  if (result.structuredContent !== undefined) {
    // The producer emits both representations from the same JSON value.
    // Compare before schema projection can discard disagreeing source fields.
    if (!isDeepStrictEqual(text, result.structuredContent))
      throw new Error(`${operation} text and structured results disagree`);
  }
  // Downstream parseEvidence must authenticate source facts, not a schema projection.
  return Object.hasOwn(output, "normalized_result") ? text : output;
};

const operationResultKey = (contract) => {
  const shape = contract.outputSchema.shape;
  if (shape === undefined)
    throw new Error(`${contract.name} has an unsupported MCP output schema`);
  const evidence = Object.hasOwn(shape, "normalized_result");
  const lifecycle = Object.hasOwn(shape, "result");
  if (evidence === lifecycle)
    throw new Error(`${contract.name} has an unsupported MCP output schema`);
  return evidence ? "normalized_result" : "result";
};

/**
 * Expand compact session metadata once at the verifier boundary. The caller
 * has validated the status against the binary_session contract, so a summary
 * carries summary candidates without capability sets; complete detail must
 * still expand every candidate's capabilities.
 */
export const expandMcpSessionStatus = (status) => ({
  ...status,
  capabilities: expandProviderCapabilities(status.capabilities),
  analysis_provider_candidates:
    status.detail === "summary"
      ? status.analysis_provider_candidates
      : expandProviderCandidates(status.analysis_provider_candidates),
  tool_availability: expandToolAvailability(status.tool_availability),
});

/** Expand provider capability groups while retaining candidate identity/state. */
export const expandProviderCandidates = (candidates) =>
  candidates.map((candidate) => ({
    ...candidate,
    capabilities: expandProviderCapabilities(
      providerCapabilitySet.array().parse(candidate.capabilities),
    ),
  }));

/** Expand CLI provider capability groups at the same owning boundary. */
export const expandProviderOutput = (providers) => ({
  ...providers,
  capabilities: expandProviderCapabilities(
    providerCapabilitySet.array().parse(providers.capabilities),
  ),
  analysis_provider_candidates: expandProviderCandidates(
    providers.analysis_provider_candidates,
  ),
});

/** Expand the CLI capabilities command's compact provider descriptor groups. */
export const expandCapabilitiesOutput = (capabilities) => ({
  ...capabilities,
  capabilities: expandProviderCapabilities(
    providerCapabilitySet.array().parse(capabilities.capabilities),
  ),
});

/** Validate an Evidence-producing tool output and return its normalized result. */
export const requireMcpEvidenceResult = (result, operation) => {
  const contract = toolContract(operation);
  if (operationResultKey(contract) !== "normalized_result")
    throw new Error(`${operation} requires the lifecycle result extractor`);
  return requireMcpOutput(result, operation, contract).normalized_result;
};

/** Validate a lifecycle tool output and return its operation result. */
export const requireMcpLifecycleResult = (result, operation) => {
  const contract = toolContract(operation);
  if (operationResultKey(contract) !== "result")
    throw new Error(`${operation} requires the Evidence result extractor`);
  const projected = requireMcpOutput(result, operation, contract).result;
  return operation === "binary_session"
    ? expandMcpSessionStatus(projected)
    : projected;
};

/** Require an authenticated complete bundle without changing summary-capable readers. */
export const requireMcpEvidenceBundle = (result) => {
  const operation = "get_evidence_bundle";
  const contract = toolContract(operation);
  const bundle = requireMcpOutput(result, operation, contract).result;
  if (bundle.kind === "evidence-bundle-summary")
    throw new Error(
      "get_evidence_bundle returned summary metadata instead of complete Evidence",
    );
  return authenticateParsedEvidenceBundle(bundle);
};

/** Project a mixed verifier call using its exact named canonical output schema. */
export const requireMcpOperationResult = (
  result,
  operation,
  contract = toolContract(operation),
) => {
  const key = operationResultKey(contract);
  const projected = requireMcpOutput(result, operation, contract)[key];
  return operation === "binary_session"
    ? expandMcpSessionStatus(projected)
    : projected;
};

/** Verify provider identity directly from the tool result. */
export const requireEvidenceProvider = (result, operation, providerId) => {
  const evidence = jsonValue(result);
  if (
    evidence?.provider?.id !== providerId ||
    evidence?.analysis_profile?.provider?.id !== providerId ||
    typeof evidence.analysis_profile.provider.version !== "string"
  ) {
    throw new Error(`${operation} omitted its concrete provider provenance`);
  }
};

/** Verify composed workflow and upstream provider provenance inline. */
export const requireWorkflowEvidenceProvider = (
  result,
  operation,
  expected,
) => {
  const evidence = jsonValue(result);
  const profile = evidence?.analysis_profile;
  const upstream = profile?.parameters?.upstream_analysis_profile;
  if (
    evidence?.provider?.id !== expected.workflowProviderId ||
    profile?.provider?.id !== expected.workflowProviderId ||
    upstream?.provider?.id !== expected.upstreamProviderId ||
    typeof upstream.provider.version !== "string"
  ) {
    throw new Error(
      `${operation} omitted its composed workflow or upstream provenance`,
    );
  }
};
