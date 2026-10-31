import { z } from "zod";
import { ok, type Result } from "../result.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import { invalidNativeOutput } from "./nativeProviderOutput.js";

/** Parse the provider document-name array. */
export const parseDocuments = (
  value: JsonValue,
  operation = "list_documents",
): Result<readonly string[], AnalysisOutputError> => {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : invalidNativeOutput(operation, "document list", parsed.error);
};
