import { z } from "zod";
import { err, type Result } from "../result.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";

export const invalidNativeOutput = <T>(
  operation: string,
  expected: string,
  cause: z.ZodError,
): Result<T, AnalysisOutputError> =>
  err(
    new AnalysisOutputError(
      operation,
      `Provider returned an invalid ${expected}`,
      {
        cause,
      },
    ),
  );
