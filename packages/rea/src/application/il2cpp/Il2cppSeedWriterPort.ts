import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import type { Il2cppMetadata } from "../../domain/il2cpp/il2cppMetadata.js";
import type { Result } from "../../domain/result.js";
import type { ExecutionOptions } from "../AnalysisProvider.js";

/** Explicit file output, separate from read-only metadata inspection. */
export interface Il2cppSeedOutput {
  readonly path: string;
  readonly base?: string;
}
export interface Il2cppSeedReceipt {
  readonly path: string;
  readonly bytes: number;
  readonly functions: number;
  readonly folded: number;
  readonly no_body: number;
  readonly unknown: number;
  /** Seeded or folded generic instance rows; null when they were not linked. */
  readonly generic_instances: number | null;
}

/** Shared output workflow; adapters own file format and publication resources. */
export interface Il2cppSeedWriterPort {
  check(
    output: Il2cppSeedOutput,
    options?: ExecutionOptions,
  ): Promise<Result<void, AnalysisError>>;
  write(
    report: Il2cppMetadata,
    output: Il2cppSeedOutput,
    options?: ExecutionOptions,
  ): Promise<Result<Il2cppSeedReceipt, AnalysisError>>;
  close(): Promise<void>;
}
