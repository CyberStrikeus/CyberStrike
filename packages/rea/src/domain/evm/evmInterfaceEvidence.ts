import {
  createEvidence,
  type EvidenceLocation,
  type EvidenceProvider,
  type EvidenceSubjectTarget,
} from "../evidence.js";
import type { InspectEvmInterfaceInput } from "./evmInterface.js";
import type { JsonValue } from "../jsonValue.js";

interface EvmInterfaceObservation {
  readonly subject: EvidenceSubjectTarget & { readonly format: "file" };
  readonly provider: EvidenceProvider;
  readonly result: JsonValue;
  readonly rawResult: JsonValue | null;
  readonly locations: readonly EvidenceLocation[];
  readonly limitations: readonly string[];
}

/** Preserve the same validated inference and provenance on success and failed finalization. */
export const evmInterfaceEvidence = (
  input: InspectEvmInterfaceInput,
  execution: EvmInterfaceObservation,
) =>
  createEvidence(execution.subject, execution.provider, {
    operation: "inspect_evm_interface",
    parameters: {
      path: input.path,
      encoding: input.encoding,
      ...(input.timeout_ms === undefined
        ? {}
        : { timeout_ms: input.timeout_ms }),
    },
    result: execution.result,
    ...(execution.rawResult === null ? {} : { rawResult: execution.rawResult }),
    confidence: "inferred",
    locations: execution.locations,
    limitations: execution.limitations,
  });
