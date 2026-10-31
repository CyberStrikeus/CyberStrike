import type { AnalysisError } from "../domain/analysisErrorBase.js";
import { AnalysisResourceConstraintError } from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";

/** Host storage exhaustion; only these errors establish a storage constraint. */
const STORAGE_EXHAUSTION_CODES: ReadonlySet<string> = new Set([
  "ENOSPC",
  "EDQUOT",
]);

/** Host or process descriptor exhaustion; the workspace location is usable. */
const DESCRIPTOR_EXHAUSTION_CODES: ReadonlySet<string> = new Set([
  "EMFILE",
  "ENFILE",
]);

const systemCode = (cause: unknown): string | null =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : null;

const systemPath = (cause: unknown): string | null =>
  cause instanceof Error && "path" in cause && typeof cause.path === "string"
    ? cause.path
    : null;

/**
 * Project a filesystem failure while allocating or writing a provider-owned
 * private analysis workspace.
 *
 * Storage exhaustion and file-size refusal are resource constraints. Every
 * other failure, such as a denied, read-only, missing or non-directory
 * temporary parent, is an unusable workspace location: it keeps its system
 * code and failing path instead of being reported as an exceeded allowance.
 */
export const privateWorkspaceFailure = (
  providerId: string,
  operation: string,
  cause: unknown,
  workspacePath: string | null,
): AnalysisError => {
  const code = systemCode(cause);
  const path = systemPath(cause) ?? workspacePath;
  const reason = cause instanceof Error ? cause.message : String(cause);
  if (code !== null && (STORAGE_EXHAUSTION_CODES.has(code) || code === "EFBIG"))
    return new AnalysisResourceConstraintError(
      operation,
      "file-size",
      `Private analysis workspace failed (${code}): ${reason}`,
      { workspace_path: workspacePath, path, system_code: code },
      {
        cause,
        // EFBIG is a file-size refusal, so the worker file-size recovery applies.
        ...(STORAGE_EXHAUSTION_CODES.has(code)
          ? {
              remediationAction:
                "Free disk space or quota on the filesystem holding details.reported_limits.path (the host temporary directory, TMPDIR), then retry.",
            }
          : {}),
      },
    );
  return new ProviderAdapterError(providerId, operation, {
    cause,
    userMessage: `Cannot prepare the private analysis workspace${code === null ? "" : ` (${code})`}: ${reason}`,
    remediationAction:
      code !== null && DESCRIPTOR_EXHAUSTION_CODES.has(code)
        ? "Close unused files or raise the open-file limit of the REA process, then retry."
        : "Review details.diagnostics.system_code and details.diagnostics.path. Make the host temporary directory (TMPDIR) an existing directory this user can create files in on a writable filesystem, then retry.",
    diagnostics: {
      stage: "workspace",
      workspace_path: workspacePath,
      path,
      system_code: code,
      reason,
    },
  });
};
