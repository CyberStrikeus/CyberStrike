import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisCleanupLease } from "../artifacts/AnalysisCleanupLease.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { SWIFTC_INTERRUPT } from "../process/DarwinProcessRunTokenReader.js";
import { execFileOutput } from "../process/ExecFileOutput.js";
import { safeParseJson } from "../domain/safeJson.js";
import { DEFAULT_NATIVE_UI_DEADLINE_MS } from "../domain/native/nativeDeadlines.js";
import type { NativeUiHelper } from "./NativeUiObservation.js";
import { NATIVE_UI_HELPER_MAX_BUFFER } from "./NativeUiOutputBudget.js";

export interface NativeUiHelperRuntime {
  readonly invoke: NativeUiHelper;
  readonly cleanupLease: AnalysisCleanupLease;
  readonly signal: AbortSignal;
  /** Omitted by test doubles; production runtimes always set the selected deadline. */
  readonly deadlineMs?: number;
  close(): Promise<void>;
  resources(): readonly string[];
}

/** Lazily compile one owned helper per observation/scenario and remove its compiler cache. */
export const createNativeUiHelperRuntime = (
  environment: Readonly<NodeJS.ProcessEnv>,
  deadlineMs = DEFAULT_NATIVE_UI_DEADLINE_MS,
): NativeUiHelperRuntime => {
  const selectedEnvironment = snapshotEnvironment(environment);
  const deadlineSignal = AbortSignal.timeout(deadlineMs);
  const operations = new ArtifactResourceScope();
  // Both helper stages share the selected deadline. A shorter fixed exec
  // timeout would fail the subprocess before that deadline and hide it.
  let root: string | undefined;
  let preparation: Promise<string> | undefined;
  const cleanupLease = new AnalysisCleanupLease(async () => {
    await operations.close();
    if (root !== undefined) {
      await rm(root, { recursive: true, force: true });
      root = undefined;
      preparation = undefined;
    }
  });
  const prepare = async (signal: AbortSignal): Promise<string> => {
    root = await mkdtemp(join(tmpdir(), "rea-native-ui-"));
    const output = join(root, "observer");
    const main = join(root, "main.swift");
    await symlink(
      fileURLToPath(
        new URL("../../bridge/native/ReaNativeUI.swift", import.meta.url),
      ),
      main,
    );
    // Keep swiftc's intermediate objects inside the removable root.
    const compilerTemporary = join(root, "tmp");
    await mkdir(compilerTemporary);
    await execFileOutput(
      "/usr/bin/xcrun",
      [
        "swiftc",
        "-module-cache-path",
        join(root, "modules"),
        fileURLToPath(
          new URL(
            "../../bridge/native/NativeUIChildren.swift",
            import.meta.url,
          ),
        ),
        fileURLToPath(
          new URL("../../bridge/native/NativeUIValues.swift", import.meta.url),
        ),
        main,
        "-o",
        output,
      ],
      {
        timeout: deadlineMs,
        maxBuffer: 1024 * 1024,
        stopSignal: SWIFTC_INTERRUPT,
        env: { ...selectedEnvironment, TMPDIR: compilerTemporary },
        signal,
      },
    );
    return output;
  };
  const invoke: NativeUiHelper = (parameters, callerSignal) =>
    operations.run(async () => {
      const signal =
        callerSignal === undefined
          ? deadlineSignal
          : AbortSignal.any([callerSignal, deadlineSignal]);
      preparation ??= prepare(signal);
      const executable = await preparation;
      const output = await execFileOutput(
        executable,
        [JSON.stringify(parameters)],
        {
          timeout: deadlineMs,
          maxBuffer: NATIVE_UI_HELPER_MAX_BUFFER,
          stopSignal: "SIGTERM",
          env: selectedEnvironment,
          signal,
        },
      );
      const parsed = safeParseJson(output.stdout);
      if (!parsed.ok)
        throw new Error(
          `Native helper returned invalid JSON: ${parsed.error}`,
          {
            cause: parsed.cause,
          },
        );
      return parsed.value;
    });
  return {
    invoke,
    cleanupLease,
    signal: deadlineSignal,
    deadlineMs,
    close: () => cleanupLease.release(),
    resources: () => (root === undefined ? [] : [root]),
  };
};
