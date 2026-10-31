import type { RegularFileState } from "../filesystem/RegularFile.js";
import { createHash } from "node:crypto";
import {
  assertKunaProjectState,
  type KunaProjectFileStates,
} from "./KunaProjectState.js";
import { createReadStream } from "node:fs";
import { lstat, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
} from "../domain/analysisErrorCore.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  hashStableFile,
  observeStableFile,
  StableFileHashFailure,
} from "../filesystem/StableFileHash.js";
import type { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { prepareProcessOwnershipInspection } from "../process/ProcessOwnershipObservation.js";
import { assertArtifactCommandPath } from "../process/ArtifactCommandPath.js";
import type { ProviderProcessSupervisor } from "../process/ProviderProcess.js";
import {
  copyAndHash,
  KUNA_INVENTORY_OUTPUT_BYTES,
  kunaFileCleanupError,
  runKunaCommand,
  type KunaProcessLauncher,
} from "./KunaCommand.js";
import { kunaProjectDeadline } from "./KunaConfiguration.js";
import type { KunaInstallation } from "./KunaInstallation.js";
import { KUNA_DIAGNOSTIC_BYTES } from "./KunaLimits.js";
import {
  parseKunaExportSummary,
  parseKunaInventory,
  scanKunaProjectSource,
  type KunaExportSummary,
  type KunaInventoryFunction,
  type KunaProjectFunction,
} from "./KunaProjectFiles.js";
import { KUNA_PROVIDER_ID } from "./KunaRelease.js";
import {
  RegularFileCleanupFailure,
  regularFileCancellation,
} from "../filesystem/OwnedRegularFile.js";

/** Operation name every export and cache failure reports. */
export const KUNA_EXPORT_OPERATION = "kuna:decompile-project";

const INVENTORY_FILE = "functions.json";

/** Exact flat file layout emitted for the selected target's native basename. */
export const kunaExportFileNames = (targetPath: string) => {
  const stem = basename(targetPath);
  return {
    c: `${stem}.c`,
    h: `${stem}.h`,
    asm: `${stem}.asm`,
    readme: "README.md",
    inventory: INVENTORY_FILE,
  } as const;
};

/** Identity of one file an export consists of. */
export interface KunaExportFile {
  readonly path: string;
  readonly bytes: number;
  readonly sha256: string;
}

/** The files of one export, by role. */
export interface KunaExportFiles {
  readonly c: KunaExportFile;
  readonly h: KunaExportFile;
  readonly asm: KunaExportFile;
  readonly readme: KunaExportFile;
  readonly inventory: KunaExportFile;
}

/** One validated export: its files, Kuna's counts and the facts parsed from them. */
export interface KunaExport {
  readonly fileStates: KunaProjectFileStates;
  readonly files: KunaExportFiles;
  readonly summary: KunaExportSummary;
  /** Decompiled function blocks in `.c` order. */
  readonly functions: readonly KunaProjectFunction[];
  /** Every callable entry Kuna found, including imports it does not decompile. */
  readonly inventory: readonly KunaInventoryFunction[];
}

/** The step an export is in; Kuna itself reports no progress until it finishes. */
export interface KunaExportStatus {
  readonly phase: "inventory" | "decompiling" | "sealing";
  /**
   * Every callable entry the export's inventory found, once known. Listings
   * use it while the export still decompiles, so no second inventory runs.
   */
  readonly inventory: readonly KunaInventoryFunction[] | null;
}

/**
 * How an export ended. `retained` means an owned Kuna process could not be
 * proven stopped, so it may still write into the workspace, which therefore
 * stays with the caller's cleanup owner.
 */
export type KunaExportOutcome =
  | {
      readonly kind: "done";
      readonly result: Result<KunaExport, AnalysisError>;
      readonly fileCleanupFailure?: RegularFileCleanupFailure;
    }
  | {
      readonly kind: "retained";
      readonly error: ProviderCleanupError;
      readonly owner: ProviderProcessSupervisor | undefined;
    };

/** One export of a target into a private workspace. */
export interface KunaExportRequest {
  readonly installation: KunaInstallation;
  /** Caller-selected target path; Kuna decompiles a verified copy of it. */
  readonly targetPath: string;
  readonly targetSha256: string;
  /** Private directory for the copy, Kuna's temporary files and its output. */
  readonly workspace: string;
  /** Directory, inside the workspace, that receives the export's files. */
  readonly output: string;
  readonly signal: AbortSignal;
  readonly retainFailedFileClose: (
    owner: OwnedFileHandle,
    resource: string,
  ) => void;
  readonly onStatus: (status: KunaExportStatus) => void;
  readonly launcher?: KunaProcessLauncher | undefined;
}

const message = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

/** Map an unexpected failure to a typed one, preferring cancellation. */
export const kunaExportFailure = (
  cause: unknown,
  signal: AbortSignal | undefined,
): AnalysisError => {
  if (cause instanceof RegularFileCleanupFailure)
    return kunaFileCleanupError(cause, KUNA_EXPORT_OPERATION);
  const cancellation = regularFileCancellation(cause);
  if (cancellation !== undefined)
    return new AnalysisCancelledError(KUNA_EXPORT_OPERATION, {
      cause: cancellation.reason,
    });
  if (cause instanceof AnalysisError) return cause;
  if (!(cause instanceof StableFileHashFailure) && signal?.aborted === true)
    return new AnalysisCancelledError(KUNA_EXPORT_OPERATION, { cause });
  return new ProviderAdapterError(KUNA_PROVIDER_ID, KUNA_EXPORT_OPERATION, {
    cause,
    userMessage: `Kuna project cache failed: ${message(cause)}`,
  });
};

const unusable = (reason: string): KunaExportOutcome => ({
  kind: "done",
  result: err(
    new ProviderAdapterError(KUNA_PROVIDER_ID, KUNA_EXPORT_OPERATION, {
      userMessage: `Kuna's project export is not usable: ${reason}`,
    }),
  ),
});

/** Verify the selected installation at each execution and publication boundary. */
const verifyKunaExecutable = async (
  installation: KunaInstallation,
  signal: AbortSignal,
  retainFailedFileClose: KunaExportRequest["retainFailedFileClose"],
): Promise<Result<null, ProviderAdapterError>> => {
  const invocationPath = installation.configuration.command;
  await assertArtifactCommandPath(
    { invocationPath, resolvedPath: installation.executable },
    KUNA_EXPORT_OPERATION,
  );
  const executable = await hashStableFile(invocationPath, {
    signal,
    retainFailedClose: (owner) => retainFailedFileClose(owner, invocationPath),
  });
  if (executable.sha256 === installation.sha256) return ok(null);
  return err(
    new ProviderAdapterError(KUNA_PROVIDER_ID, KUNA_EXPORT_OPERATION, {
      userMessage: `${installation.executable} changed after readiness inspection; reopen the target so REA probes the current Kuna executable.`,
      diagnostics: {
        expected_sha256: installation.sha256,
        observed_sha256: executable.sha256,
      },
    }),
  );
};

/**
 * Inventory and export one target with Kuna, then validate the result.
 *
 * Kuna runs on a copy hashed while copying, so the export always describes
 * the digest the caller selected. Both Kuna runs share one deadline.
 */
export const exportKunaProject = async (
  request: KunaExportRequest,
): Promise<KunaExportOutcome> => {
  const { installation, signal } = request;
  const { configuration } = installation;
  const deadline = Date.now() + configuration.projectTimeoutMs;
  const input = join(request.workspace, "input", basename(request.targetPath));
  await mkdir(join(request.workspace, "input"), { mode: 0o700 });
  await mkdir(request.output, { recursive: true, mode: 0o700 });

  const copied = await copyAndHash(request.targetPath, input, signal);
  if (copied !== request.targetSha256)
    return {
      kind: "done",
      result: err(
        new AnalysisArtifactChangedError(
          KUNA_EXPORT_OPERATION,
          request.targetPath,
          "the target no longer matches the digest selected for analysis",
        ),
      ),
    };
  await prepareProcessOwnershipInspection(signal);
  const run = async (arguments_: readonly string[], outputBytes: number) => {
    const outcome = await runKunaCommand({
      installation,
      arguments: arguments_,
      workspace: request.workspace,
      operation: KUNA_EXPORT_OPERATION,
      timeoutMs: deadline - Date.now(),
      deadline: kunaProjectDeadline(configuration),
      outputBytes,
      signal,
      launcher: request.launcher,
      retainFailedFileClose: request.retainFailedFileClose,
    });
    if (outcome.kind === "ok")
      return { ok: true as const, snapshot: outcome.snapshot };
    return {
      ok: false as const,
      outcome:
        outcome.kind === "retained"
          ? ({
              kind: "retained",
              error: outcome.error,
              owner: outcome.owner,
            } as const)
          : ({
              kind: "done",
              result: err(outcome.error),
              ...(outcome.fileCleanupFailure === undefined
                ? {}
                : { fileCleanupFailure: outcome.fileCleanupFailure }),
            } as const),
    };
  };

  request.onStatus({ phase: "inventory", inventory: null });
  const listed = await run(
    ["functions", input, "--json"],
    KUNA_INVENTORY_OUTPUT_BYTES,
  );
  if (!listed.ok) return listed.outcome;
  const inventory = parseKunaInventory(listed.snapshot.stdout.text);
  if (!inventory.ok) return unusable(inventory.error);
  if (listed.snapshot.stdout.invalidUtf8 === true)
    return unusable("the function inventory is not valid UTF-8");
  await writeFile(
    join(request.output, INVENTORY_FILE),
    listed.snapshot.stdout.text,
    { mode: 0o600 },
  );

  request.onStatus({ phase: "decompiling", inventory: inventory.value });
  const exported = await run(
    [
      "decompile-project",
      input,
      "-o",
      request.output,
      "--jobs",
      String(configuration.jobs),
    ],
    // Kuna prints one summary line per export on stdout.
    KUNA_DIAGNOSTIC_BYTES,
  );
  if (!exported.ok) return exported.outcome;

  request.onStatus({ phase: "sealing", inventory: inventory.value });
  const summary = parseKunaExportSummary(exported.snapshot.stdout.text);
  if (summary === undefined)
    return unusable(
      "Kuna did not print its `functions: N ok, M failed` summary.",
    );
  const names = kunaExportFileNames(request.targetPath);
  const files: Partial<Record<keyof KunaExportFiles, KunaExportFile>> = {};
  const fileStates: Partial<
    Record<keyof KunaProjectFileStates, RegularFileState>
  > = {};
  for (const [role, name] of Object.entries(names) as [
    keyof KunaExportFiles,
    string,
  ][]) {
    const path = join(request.output, name);
    const status = await lstat(path).catch((cause: unknown) => {
      if (isMissing(cause)) return undefined;
      throw cause;
    });
    if (status === undefined || !status.isFile())
      return unusable(`Kuna's export has no regular ${name}.`);
    const observed = await observeStableFile(path, {
      signal,
      retainFailedClose: (owner) => request.retainFailedFileClose(owner, path),
    });
    files[role] = {
      path: name,
      sha256: observed.sha256,
      bytes: observed.bytes,
    };
    fileStates[role] = observed.state;
  }
  const complete = files as KunaExportFiles;
  const states = fileStates as KunaProjectFileStates;
  if (
    complete.inventory.sha256 !==
    createHash("sha256").update(listed.snapshot.stdout.text).digest("hex")
  )
    return unusable("the retained inventory changed before export sealing");
  await assertKunaProjectState(request.output, complete, states, signal);
  const functions = await readKunaExportSource(
    request.output,
    complete.c,
    summary,
    signal,
  );
  if (!functions.ok) return unusable(functions.error);
  await assertKunaProjectState(request.output, complete, states, signal);
  const identity = await verifyKunaExecutable(
    installation,
    signal,
    request.retainFailedFileClose,
  );
  if (!identity.ok) return { kind: "done", result: identity };
  // `functions.json` holds exactly the text this inventory was parsed from, so
  // publishing reuses it rather than holding a second parsed copy.
  return {
    kind: "done",
    result: ok({
      files: complete,
      fileStates: states,
      summary,
      functions: functions.value,
      inventory: inventory.value,
    }),
  };
};

/** Split an export's `.c` into its function blocks without buffering the file. */
const readKunaExportSource = (
  directory: string,
  file: KunaExportFile,
  summary: KunaExportSummary,
  signal: AbortSignal | undefined,
): Promise<Result<readonly KunaProjectFunction[], string>> =>
  scanKunaProjectSource(
    createReadStream(
      join(directory, file.path),
      signal === undefined ? {} : { signal },
    ),
    summary,
  );

/** Parse a published export's function blocks and inventory from its own files. */
export const readKunaExport = async (
  directory: string,
  files: KunaExportFiles,
  summary: KunaExportSummary,
  fileStates: KunaProjectFileStates,
  signal?: AbortSignal,
): Promise<
  Result<
    {
      readonly functions: readonly KunaProjectFunction[];
      readonly inventory: readonly KunaInventoryFunction[];
    },
    string
  >
> => {
  await assertKunaProjectState(directory, files, fileStates, signal);
  const functions = await readKunaExportSource(
    directory,
    files.c,
    summary,
    signal,
  );
  if (!functions.ok) return functions;
  const inventory = parseKunaInventory(
    await readFile(join(directory, files.inventory.path), {
      encoding: "utf8",
      ...(signal === undefined ? {} : { signal }),
    }),
  );
  if (!inventory.ok) return inventory;
  await assertKunaProjectState(directory, files, fileStates, signal);
  return ok({ functions: functions.value, inventory: inventory.value });
};
