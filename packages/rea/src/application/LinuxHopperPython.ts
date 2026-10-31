import { posix } from "node:path";

import { z } from "zod";

import { err, ok, type Result } from "../domain/result.js";
import {
  ExecFileOutputCancelledError,
  execFileOutput,
} from "../process/ExecFileOutput.js";

const libraryPath = z
  .string()
  .refine((value) => posix.isAbsolute(value) && !value.includes("\0"));
const runtimeSchema = z.object({
  version: z.tuple([z.literal(3), z.number().int().nonnegative()]),
  library: z.discriminatedUnion("status", [
    z.object({ status: z.literal("loadable"), path: libraryPath }),
    z.object({
      status: z.literal("unavailable"),
      path: libraryPath,
      reason: z.string().min(1),
    }),
    z.object({ status: z.literal("unknown"), reason: z.string().min(1) }),
  ]),
});

/** Facts reported by the isolated system interpreter, without a GUI launch. */
export type LinuxHopperPythonRuntime = z.infer<typeof runtimeSchema> & {
  readonly interpreter: "/usr/bin/python3";
};

/** A failed inspection does not establish that a shared library is absent. */
export class LinuxHopperPythonError extends Error {
  readonly _tag = "LinuxHopperPythonError";

  constructor(
    readonly reason:
      | "query_failed"
      | "invalid_response"
      | "configuration_unknown"
      | "runtime_unavailable"
      | "cancelled",
    message: string,
    cause?: unknown,
  ) {
    super(message, { cause });
  }
}

// Isolate caller Python paths/site hooks and disable bytecode writes. Inspect
// the distribution interpreter that the package manager installs, not PATH.
const query = `import ctypes, json, os, sys, sysconfig
directory = sysconfig.get_config_var("LIBDIR")
name = sysconfig.get_config_var("INSTSONAME")
if not isinstance(directory, str) or not os.path.isabs(directory) or not isinstance(name, str) or not name:
    library = {"status": "unknown", "reason": "Python did not report an absolute shared-library location"}
else:
    path = os.path.join(directory, name)
    try:
        ctypes.CDLL(path)
        library = {"status": "loadable", "path": path}
    except OSError as error:
        library = {"status": "unavailable", "path": path, "reason": str(error)}
print(json.dumps({"version": list(sys.version_info[:2]), "library": library}))
`;

const runtimeCommand = {
  executable: "/usr/bin/python3",
  args: ["-I", "-S", "-B", "-c", query],
} as const;

// AbortSignal changes while an awaited process runs, despite its readonly type.
const isAborted = (signal: AbortSignal | undefined): boolean =>
  signal?.aborted === true;

/** Fresh, bounded inspection; package or interpreter changes must be observable. */
export const inspectLinuxHopperPythonRuntime = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  signal?: AbortSignal,
  execute: typeof execFileOutput = execFileOutput,
): Promise<Result<LinuxHopperPythonRuntime, LinuxHopperPythonError>> => {
  const cancelled = (reason: unknown) =>
    err(
      new LinuxHopperPythonError(
        "cancelled",
        "Python runtime inspection was cancelled.",
        reason,
      ),
    );
  if (isAborted(signal)) return cancelled(signal?.reason);
  let output: string;
  try {
    const result = await execute(
      runtimeCommand.executable,
      runtimeCommand.args,
      {
        env: environment,
        signal,
        stopSignal: "SIGTERM",
        timeout: 10_000,
        maxBuffer: 64 * 1024,
      },
    );
    output = result.stdout;
  } catch (cause: unknown) {
    if (cause instanceof ExecFileOutputCancelledError)
      return cancelled(cause.cause);
    return err(
      new LinuxHopperPythonError(
        "query_failed",
        "Could not inspect the shared runtime of /usr/bin/python3.",
        cause,
      ),
    );
  }
  if (isAborted(signal)) return cancelled(signal?.reason);
  let value: unknown;
  try {
    value = JSON.parse(output);
  } catch (cause: unknown) {
    return err(
      new LinuxHopperPythonError(
        "invalid_response",
        "System Python returned an invalid shared-runtime description.",
        cause,
      ),
    );
  }
  const parsed = runtimeSchema.safeParse(value);
  if (!parsed.success)
    return err(
      new LinuxHopperPythonError(
        "invalid_response",
        "System Python returned an invalid shared-runtime description.",
        parsed.error,
      ),
    );
  return ok({
    ...parsed.data,
    interpreter: runtimeCommand.executable,
  });
};

/** Explain a known failed load separately from an unknown configuration. */
export const linuxHopperPythonUnavailable = (
  library: Exclude<
    LinuxHopperPythonRuntime["library"],
    { readonly status: "loadable" }
  >,
): LinuxHopperPythonError =>
  new LinuxHopperPythonError(
    library.status === "unknown"
      ? "configuration_unknown"
      : "runtime_unavailable",
    library.status === "unavailable"
      ? "The system Python shared runtime cannot load " +
          library.path +
          ": " +
          library.reason
      : "System Python did not identify its shared runtime: " + library.reason,
  );
