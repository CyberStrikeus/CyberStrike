import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import type {
  WebSourceLocationInput,
  WebSourceMapReport,
} from "../domain/webSourceLocation.js";
import type { SelectedWebScriptArtifacts } from "../domain/webScriptArtifacts.js";
import type { z } from "zod";
import type { webArtifactFileSchema } from "../domain/webScriptArtifacts.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";

/** Actual selected source and local map bytes; no provider URL fetching. */
export interface WebSourceLocationArtifacts extends SelectedWebScriptArtifacts {
  readonly sourceMap: {
    readonly file: z.output<typeof webArtifactFileSchema>;
    readonly url: string;
    readonly text: string;
  };
}

/** Replaceable artifact acquisition boundary for a caller-selected pairing. */
export interface WebSourceLocationArtifactPort {
  close?(): Promise<void>;
  load(
    input: WebSourceLocationInput,
    options?: ExecutionOptions,
  ): Promise<Result<WebSourceLocationArtifacts, AnalysisError>>;
}

/** Replaceable codec receives map data and one explicit generated point. */
export interface WebSourceMapPort {
  close?(): Promise<void>;
  trace(
    input: {
      readonly text: string;
      readonly path: string;
      readonly url: string;
      readonly position: WebSourceLocationInput["generated_position"];
      readonly decodeTimeoutMs?: number;
    },
    options?: ExecutionOptions,
  ): Promise<Result<WebSourceMapReport, AnalysisError>>;
}
