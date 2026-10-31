import type { JsonValue } from "../domain/jsonValue.js";
import type { Result } from "../domain/result.js";

interface CliInputFieldBinding {
  readonly operation: string;
  readonly fields: Readonly<Record<string, string>>;
}

/** Flatten a finalized outcome only when returning the command's JSON output. */
export const projectCliAnalysisResult = <Value>(
  result: Result<Value, JsonValue>,
  inputBinding?: CliInputFieldBinding,
): Value | JsonValue => {
  if (result.ok) return result.value;
  if (inputBinding === undefined) return result.error;
  return projectInputFields(result.error, inputBinding);
};

const isObject = (
  value: JsonValue | undefined,
): value is Record<string, JsonValue> =>
  value !== null && typeof value === "object" && !Array.isArray(value);

/** Rename only the actionable parameter paths owned by this operation binding. */
const projectInputFields = (
  error: JsonValue,
  binding: CliInputFieldBinding,
): JsonValue => {
  if (!isObject(error)) return error;
  const details = error.details;
  if (
    !isObject(details) ||
    details.operation !== binding.operation ||
    !Array.isArray(details.issues) ||
    (error.code !== "invalid_request" &&
      !(
        error.code === "cleanup_incomplete" &&
        details.execution_failure === "invalid_request"
      ))
  )
    return error;

  let changed = false;
  const issues = details.issues.map((issue) => {
    if (!isObject(issue) || !Array.isArray(issue.path)) return issue;
    const field = issue.path[0];
    if (typeof field !== "string" || !Object.hasOwn(binding.fields, field))
      return issue;
    const alias = binding.fields[field];
    if (alias === undefined || alias === field) return issue;
    changed = true;
    return { ...issue, path: [alias, ...issue.path.slice(1)] };
  });
  // Keep retained output, partial Evidence and cleanup history by reference;
  // their source fields are not CLI parameter names.
  return changed ? { ...error, details: { ...details, issues } } : error;
};
