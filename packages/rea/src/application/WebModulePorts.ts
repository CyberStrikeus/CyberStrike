import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { Result } from "../domain/result.js";
import type {
  WebModuleFile,
  WebModuleResolutionBatch,
  WebModuleResolutionRequest,
  WebModuleTraceInput,
} from "../domain/webModuleTrace.js";
import type { SelectedWebScriptArtifacts } from "../domain/webScriptArtifacts.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";

type JsonObject = Record<string, JsonValue>;

/** Verified selected source and capture metadata; provider protocols stay outside. */
export interface WebModuleArtifacts extends SelectedWebScriptArtifacts {
  readonly importMap: {
    readonly file: WebModuleFile;
    readonly baseUrl: string;
    readonly value: JsonObject;
  } | null;
}

/** Read selected local artifacts without refetching website assets. */
export interface WebModuleArtifactPort {
  close?(): Promise<void>;
  load(
    input: WebModuleTraceInput,
    options?: ExecutionOptions,
  ): Promise<Result<WebModuleArtifacts, AnalysisError>>;
}

/** Replaceable native resolution engine, with no provider protocol in callers. */
export interface WebModuleResolutionPort {
  close?(): Promise<void>;
  resolve(
    input: WebModuleResolutionRequest,
    options?: ExecutionOptions,
  ): Promise<Result<WebModuleResolutionBatch, AnalysisError>>;
}
