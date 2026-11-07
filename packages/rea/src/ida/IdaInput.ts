import { TOOL_CONTRACTS } from "../contracts/toolContracts.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import { err, ok } from "../domain/result.js";
import { idaAddressSchema } from "./IdaProtocolValues.js";
import { projectInputIssues } from "../domain/inputIssueProjection.js";

/** Apply the named public contract and IDA's explicit-address boundary before startup. */
export const parseIdaInput = (
  operation: string,
  parameters: Readonly<Record<string, JsonValue>>,
) => {
  const contract = TOOL_CONTRACTS.find(({ name }) => name === operation);
  const parsed = contract?.inputSchema.safeParse(parameters);
  if (parsed?.success !== true)
    return err(
      new AnalysisInputError(
        operation,
        { cause: parsed?.error },
        parsed?.error === undefined
          ? []
          : projectInputIssues(parsed.error.issues, parameters),
      ),
    );
  if (operation === "xrefs" && typeof parameters.address !== "string")
    return err(
      new AnalysisInputError(operation, undefined, [
        {
          path: ["address"],
          reason: "missing_argument",
          message: "IDA requires an explicit hexadecimal address.",
        },
      ]),
    );
  if (
    parameters.address !== undefined &&
    !idaAddressSchema.safeParse(parameters.address).success
  )
    return err(
      new AnalysisInputError(operation, undefined, [
        {
          path: ["address"],
          reason: "invalid_format",
          message: "IDA requires a hexadecimal address.",
        },
      ]),
    );
  if (
    typeof parameters.procedure === "string" &&
    parameters.procedure.length === 0
  )
    return err(
      new AnalysisInputError(operation, undefined, [
        {
          path: ["procedure"],
          reason: "invalid_value",
          message: "Supply a function name or address.",
        },
      ]),
    );
  if (parameters.mode === "regex" && typeof parameters.pattern === "string") {
    try {
      new RegExp(
        parameters.pattern,
        parameters.case_sensitive === true ? "u" : "iu",
      );
    } catch (cause: unknown) {
      return err(
        new AnalysisInputError(operation, { cause }, [
          {
            path: ["pattern"],
            reason: "invalid_format",
            message: "Supply a valid regular expression.",
          },
        ]),
      );
    }
  }
  return ok(jsonObjectSchema.parse(parsed.data));
};
