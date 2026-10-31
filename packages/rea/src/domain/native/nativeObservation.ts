import { invalidNativeOutput } from "./nativeProviderOutput.js";
import { z } from "zod";
import { procedureIdentitySchema } from "./procedureInfo.js";
import { AnalysisOutputError } from "../analysisErrorCore.js";
import type { JsonValue } from "../jsonValue.js";
import { err, ok, type Result } from "../result.js";
import { nativeCallGraphSchema } from "./nativeCallGraph.js";

/** Exact containing-procedure outcome; valid absence is distinct from unreadable output. */
export const containingProcedureResolutionSchema = z.discriminatedUnion(
  "found",
  [
    z.object({
      query_address: z.string(),
      found: z.literal(true),
      procedure: procedureIdentitySchema,
    }),
    z.object({
      query_address: z.string(),
      found: z.literal(false),
      procedure: z.null(),
      reason: z.enum(["outside_segments", "not_in_procedure"]),
    }),
  ],
);
export type ContainingProcedureResolution = z.infer<
  typeof containingProcedureResolutionSchema
>;

/** Validate provider procedure facts before a workflow interprets absence. */
export const parseContainingProcedureResolution = (
  value: JsonValue,
): Result<ContainingProcedureResolution, AnalysisOutputError> => {
  const parsed = containingProcedureResolutionSchema.safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : err(
        new AnalysisOutputError(
          "resolve_containing_procedure",
          "expected a containing-procedure resolution",
          { cause: parsed.error },
        ),
      );
};

export const NATIVE_PRIMITIVE_OBSERVATION_OPERATIONS = [
  "procedure_address",
  "procedure_callees",
  "procedure_callers",
  "resolve_containing_procedure",
] as const;
export const NATIVE_OBSERVATION_OPERATIONS = [
  ...NATIVE_PRIMITIVE_OBSERVATION_OPERATIONS,
  "get_call_graph",
] as const;
export type NativeObservationOperation =
  (typeof NATIVE_OBSERVATION_OPERATIONS)[number];
export const nativeAddressListSchema = z.array(z.string());
export const nativeObservationSourceSchemas = {
  procedure_address: z.string(),
  procedure_callees: nativeAddressListSchema,
  procedure_callers: nativeAddressListSchema,
  resolve_containing_procedure: containingProcedureResolutionSchema,
  get_call_graph: nativeCallGraphSchema,
};
export type NativeObservation = {
  [Operation in NativeObservationOperation]: {
    operation: Operation;
    result: z.output<(typeof nativeObservationSourceSchemas)[Operation]>;
  };
}[NativeObservationOperation];

/** One operation family shared by view projection and response-budget recovery. */
export const isNativeObservationOperation = (
  operation: string,
): operation is NativeObservationOperation =>
  NATIVE_OBSERVATION_OPERATIONS.some((supported) => supported === operation);

/** Parse the provider callee/caller address array. */
export const parseRelatedAddresses = (
  value: JsonValue,
  relation: "callees" | "callers",
  operation = relation === "callees"
    ? "procedure_callees"
    : "procedure_callers",
): Result<readonly string[], AnalysisOutputError> => {
  const parsed = z.array(z.string()).safeParse(value);
  return parsed.success
    ? ok(parsed.data)
    : invalidNativeOutput(operation, `${relation} list`, parsed.error);
};
