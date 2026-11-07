import type {
  AnalysisExecution,
  ExecutionOptions,
} from "../AnalysisProvider.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { InspectWasmArtifactInput } from "../../domain/wasm/wasmArtifact.js";
import type { EvidenceSubjectTarget } from "../../domain/evidence.js";
import type { Result } from "../../domain/result.js";

/** Successful WASM inspection must identify the selected local file. */
export type WasmArtifactExecution = Omit<AnalysisExecution, "subject"> & {
  readonly subject: EvidenceSubjectTarget & { readonly format: "file" };
};

/** Effective operation budget, separate from caller-authored Evidence parameters. */
export interface WasmArtifactExecutionOptions extends ExecutionOptions {
  readonly commandTimeoutMs?: number;
}

/** Replaceable offline WASM inspection engine, independent of target execution and network clients. */
export interface WasmArtifactPort {
  /** Retry removal of retained workspaces; failures preserve ownership for another attempt. */
  close(): Promise<void>;
  inspect(
    input: InspectWasmArtifactInput,
    options?: WasmArtifactExecutionOptions,
  ): Promise<Result<WasmArtifactExecution, AnalysisError>>;
}
