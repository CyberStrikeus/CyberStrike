import { z } from "zod";
import { jsonRecordSchema } from "../../src/domain/jsonRecord.js";

/** Independent expected outcomes supplied by the verification scenario. */
export const structuredScopeExpectationsSchema = jsonRecordSchema(
  z.strictObject({
    operation: z.enum([
      "parse-package-json",
      "parse-json-module",
      "parse-html-script-references",
      "parse-local-source-map",
    ]),
    analysis_status: z.enum(["interrupted", "not-started"]),
  }),
  z.string().min(1),
);

export type StructuredScopeExpectation = z.output<
  typeof structuredScopeExpectationsSchema
>[string];

export interface StructuredProcessingScope {
  readonly properties: Readonly<Record<string, unknown>>;
  readonly evidence: {
    readonly authority: string;
    readonly state: string;
    readonly confidence: string;
  };
}

/** Every retained gap must match the named phase and its unavailable status. */
export const matchesStructuredScopeExpectation = (
  scopes: readonly StructuredProcessingScope[],
  expected: StructuredScopeExpectation | undefined,
): boolean =>
  expected !== undefined &&
  scopes.length > 0 &&
  scopes.every(
    ({ evidence, properties }) =>
      evidence.authority === "artifact-bytes" &&
      evidence.state === "unavailable" &&
      evidence.confidence === "unknown" &&
      properties.operation === expected.operation &&
      properties.analysis_status === expected.analysis_status,
  );
