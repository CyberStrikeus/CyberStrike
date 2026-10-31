import type { z } from "zod";
import type { JavaScriptApplicationAnalysisResult } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import type { toolContract } from "../../../src/contracts/toolContracts.js";

type FixtureContract = ReturnType<
  typeof toolContract<"analyze_javascript_application">
>;
type FixtureEvidence = Omit<
  z.output<FixtureContract["outputSchema"]>,
  "normalized_result"
> & {
  readonly normalized_result: JavaScriptApplicationAnalysisResult;
};
type FixtureProperties =
  FixtureEvidence["normalized_result"]["graph"]["nodes"][number]["observations"][number]["properties"];

export const CLIENT_JAVASCRIPT_FIXTURE_SOURCE: string;
export function assertClientJavaScriptFixtureEvidence(
  value: unknown,
  inputPath: string,
): Promise<{ evidence: FixtureEvidence; shapes: FixtureProperties[] }>;
