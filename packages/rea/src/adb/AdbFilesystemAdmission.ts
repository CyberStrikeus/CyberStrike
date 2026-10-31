import { stat } from "node:fs/promises";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";

export const adbFilesystemErrorCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;

/** Admit the caller's file once, retaining the selection and the host's reason. */
export const adbInputFileError = async (
  operation: string,
  field: "local_path" | "apk_path",
  selectedPath: string,
  absolutePath: string,
): Promise<AnalysisInputError | undefined> => {
  let info;
  try {
    info = await stat(absolutePath);
  } catch (cause) {
    const code = adbFilesystemErrorCode(cause);
    const message =
      code === "ENOENT" || code === "ENOTDIR"
        ? "The selected file does not exist or a parent is not a directory."
        : "The selected file could not be inspected.";
    return new AnalysisInputError(operation, { cause }, [
      {
        path: [field],
        reason: "invalid_value",
        message,
        observed: {
          path: selectedPath,
          ...(code === undefined ? {} : { code }),
        },
      },
    ]);
  }
  if (!info.isFile())
    return new AnalysisInputError(operation, undefined, [
      {
        path: [field],
        reason: "invalid_value",
        message: "The selected path is not a regular file.",
        observed: { path: selectedPath },
      },
    ]);
  return undefined;
};
