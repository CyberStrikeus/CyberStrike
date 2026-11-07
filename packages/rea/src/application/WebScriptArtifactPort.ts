import type { AnalysisError } from "../domain/analysisErrorBase.js";
import type { Result } from "../domain/result.js";
import type {
  SelectedWebScriptArtifacts,
  SelectedWebScriptInput,
} from "../domain/webScriptArtifacts.js";
import type { ExecutionOptions } from "./AnalysisProvider.js";

/** Read the caller-selected capture export and verify the selected source identity. */
export interface WebScriptArtifactPort {
  close?(): Promise<void>;
  load(
    input: SelectedWebScriptInput,
    options?: ExecutionOptions,
  ): Promise<Result<SelectedWebScriptArtifacts, AnalysisError>>;
}
