/** Keep the API path as evidence and parse its optional ref at the boundary. */
export function normalizeWorkflowRun(value) {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error("workflow_run_malformed");
  const match =
    typeof value.path === "string" && !/[\u0000-\u001f\u007f]/u.test(value.path)
      ? /^(\.github\/workflows\/[^/\\@\s]+\.ya?ml)(?:@([^\s]+))?$/u.exec(
          value.path,
        )
      : null;
  return {
    ...value,
    workflowPath: match ? { file: match[1], ref: match[2] ?? null } : null,
  };
}
