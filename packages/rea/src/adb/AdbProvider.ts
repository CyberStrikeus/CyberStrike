import {
  absoluteCallerPath,
  appendCallerPath,
} from "../filesystem/callerPath.js";
import { execFileFailureCapturedOutput } from "../process/ExecFileOutput.js";
import { collectNumericIssues } from "./AdbNumericIssues.js";
import {
  adbFilesystemErrorCode,
  adbInputFileError,
} from "./AdbFilesystemAdmission.js";
import { analysisClientFailureForOperation } from "../providers/AnalysisClientFailure.js";
import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  copyFile,
  lstat,
  link,
  mkdtemp,
  mkdir,
  open,
  rmdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

import {
  type ExecutionOptions,
  type ProviderAvailability,
  createAnalysisExecution,
  type AnalysisExecution,
} from "../application/AnalysisProvider.js";
import { providerConfigurationRefusal } from "../domain/providerConfigurationRefusal.js";
import type {
  AdbDisplayNumericIssues,
  AdbDisplayPartialObservation,
  AdbActivityStartPartialObservation,
  AdbAcquiredFilePartialObservation,
  AdbPackagePullPartialObservation,
  AdbRequest,
} from "../domain/adb/adbDeviceAnalysis.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactResourceRetryFailure,
  ArtifactResourceScope,
} from "../artifacts/ArtifactResourceScope.js";
import {
  AnalysisCleanupLease,
  AnalysisCleanupLeaseGroup,
} from "../artifacts/AnalysisCleanupLease.js";
import {
  adbDisplayPartialObservationSchema,
  adbResultSchemas,
} from "../domain/adb/adbDeviceAnalysis.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisProtocolError,
  AnalysisResourceConstraintError,
  AnalysisTimeoutError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { readPngHeaderDimensions } from "../domain/pngHeader.js";
import { err, ok, type Result } from "../domain/result.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import {
  hashStableFile,
  stableFileHashCause,
} from "../filesystem/StableFileHash.js";
import {
  regularFileCancellation,
  RegularFileCancelled,
  RegularFileCleanupFailure,
} from "../filesystem/OwnedRegularFile.js";
import { RegularFileOperationCancelled } from "../filesystem/RegularFile.js";
import { OwnedFileHandle } from "../filesystem/OwnedFileHandle.js";
import { createEvidence } from "../domain/evidence.js";
import {
  PrivateRuntimeRoot,
  type PrivateRuntimeRootOptions,
} from "../process/PrivateRuntimeRoot.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  RuntimeControlUnavailableError,
  runtimeControlCapabilityError,
} from "../process/RuntimeControlUnavailableError.js";
import {
  adbCommandOutputFailure,
  adbArguments,
  runAdb,
  runAdbCapture,
  packageChangeRefusal,
  probeAdbPathDirectory,
  probeAdbPathExistence,
  type AdbRunLimits,
} from "./AdbCommand.js";
import {
  AdbConfigurationFailure,
  adbConfigurationAvailability,
  inspectAdbClient,
  resolveAdbBinary,
  type AdbBinarySelection,
  type AdbClientIdentity,
} from "./AdbConfiguration.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import {
  displayDevicePath,
  parsePackageListOutput,
  parsePmPathOutput,
} from "./AdbDeviceOutput.js";
import { adbHostFileName } from "./AdbHostFileName.js";
import {
  AdbInputSnapshotFailure,
  snapshotAdbInput,
} from "./AdbInputSnapshot.js";
import {
  ADB_DIRECTORY_BATCH_SCRIPT,
  parseAdbDirectoryListing,
} from "./AdbDirectoryListing.js";
import {
  parseAmStartOutput,
  parseBugreportCopiedPath,
  parseDumpsysPackageOutput,
  parseFeatureListOutput,
  parsePackageChangeOutput,
  parseProcessListOutput,
  parseResolveActivityOutput,
  parseServiceListOutput,
  parseSettingsGetOutput,
  parseSha256sumOutput,
  parseWindowFocusOutput,
  parseWmDensityOutput,
  parseWmSizeOutput,
} from "./AdbShellOutput.js";
import {
  clientIdentityResult,
  parsedListingExecution,
  type AdbClientResult,
  type AdbProviderIdentity,
} from "./AdbOperationResults.js";
import {
  inspectAdbClientOperation,
  inspectAdbDeviceOperation,
  listAdbDevicesOperation,
  type AdbCommandContext,
} from "./AdbDeviceOperations.js";

/** Stable identity for the ADB device-acquisition provider. */
export const ADB_PROVIDER_IDENTITY = {
  id: "adb",
  name: "Android Debug Bridge",
  version: null,
} as const;

const SHELL_TIMEOUT_MS = 30_000;
const PACKAGE_LIST_TIMEOUT_MS = 60_000;
const PACKAGE_LIST_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const PM_PATH_TIMEOUT_MS = 30_000;
const PM_PATH_MAX_OUTPUT_BYTES = 64 * 1024;
const PULL_TIMEOUT_MS = 600_000;
const PULL_MAX_OUTPUT_BYTES = 1024 * 1024;
const LOGCAT_TIMEOUT_MS = 60_000;
const LOGCAT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const DUMPSYS_PACKAGE_TIMEOUT_MS = 60_000;
const DUMPSYS_PACKAGE_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const DUMPSYS_WINDOW_MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const LISTING_TIMEOUT_MS = 30_000;
const LISTING_MAX_OUTPUT_BYTES = 4 * 1024 * 1024;
const SETTINGS_TIMEOUT_MS = 20_000;
const SETTINGS_MAX_OUTPUT_BYTES = 1024 * 1024;
const SCREEN_TIMEOUT_MS = 60_000;
const SCREEN_MAX_OUTPUT_BYTES = 32 * 1024 * 1024;
const BUGREPORT_TIMEOUT_MS = 600_000;
const BUGREPORT_MAX_OUTPUT_BYTES = 1024 * 1024;

/** Carry the exact digest owner through caller-specific partial-result mapping. */
class AdbDigestFailure extends Error {
  constructor(
    readonly fileFailure:
      | RegularFileCleanupFailure<AdbFileDigest>
      | RegularFileCancelled<AdbFileDigest>,
    readonly bindCleanupError: (error: AnalysisError) => void,
  ) {
    super(fileFailure.message, { cause: fileFailure });
  }
}

const hashAdbFile = async (
  path: string,
  operation: string,
  signal: AbortSignal | undefined,
  resources: ArtifactResourceScope,
) => {
  let closeLease: AnalysisCleanupLease | undefined;
  try {
    return await hashStableFile(path, {
      ...(signal === undefined ? {} : { signal }),
      retainFailedClose: (handle) => {
        closeLease = new AnalysisCleanupLease(() => handle.close(), [path]);
        resources.retain({
          kind: "lease",
          resource: `${path} (ADB digest handle)`,
          lease: closeLease,
        });
      },
    });
  } catch (cause: unknown) {
    if (
      cause instanceof RegularFileCleanupFailure ||
      cause instanceof RegularFileCancelled
    )
      throw new AdbDigestFailure(
        cause as
          | RegularFileCleanupFailure<AdbFileDigest>
          | RegularFileCancelled<AdbFileDigest>,
        (error) => {
          closeLease?.bindCleanupError(error);
        },
      );
    if (cause instanceof RegularFileOperationCancelled)
      throw new AnalysisCancelledError(operation, { cause: cause.reason });
    throw cause;
  }
};

const adbDigestError = (
  cause: unknown,
  operation: string,
  partialObservation:
    | AdbAcquiredFilePartialObservation
    | AdbPackagePullPartialObservation,
): AnalysisError | undefined => {
  if (!(cause instanceof AdbDigestFailure)) return undefined;
  const digestFailure = cause.fileFailure;
  const digestOutcome = digestFailure.outcome;
  if (digestOutcome.kind === "completed")
    partialObservation = partialObservationWithDigest(
      partialObservation,
      digestOutcome.value,
    );
  if (digestFailure instanceof RegularFileCancelled)
    return new AnalysisCancelledError(operation, {
      cause: digestFailure.reason,
      partialObservation,
    });
  const resource = `${digestFailure.path} (ADB digest handle)`;
  const reason =
    digestFailure.cleanupCause instanceof Error
      ? digestFailure.cleanupCause.message
      : String(digestFailure.cleanupCause);
  const cleanup = new ProviderCleanupError(
    ADB_PROVIDER_IDENTITY.id,
    [resource],
    { reason },
    {
      operation,
      cause: digestFailure,
      partialObservation,
    },
  );
  const primaryCause =
    digestOutcome.kind === "failed" ? digestOutcome.cause : undefined;
  const cancellation = regularFileCancellation(digestFailure);
  if (cancellation !== undefined) {
    const error = new AnalysisCancelledError(operation, {
      cause: cancellation.reason,
      cleanup: { reason, resources: [resource] },
      partialObservation,
    });
    cause.bindCleanupError(error);
    return error;
  }

  const primary =
    primaryCause instanceof AnalysisError
      ? primaryCause
      : new AnalysisOutputError(
          operation,
          `The pulled file could not be fully digested or its handle could not be closed: ${digestFailure.path}`,
          {
            cause:
              digestOutcome.kind === "failed" ? primaryCause : digestFailure,
            partialObservation,
          },
        );
  primary.retainPartialObservation(partialObservation);
  const error = analysisErrorWithCleanupFailure(primary, cleanup, operation);
  cause.bindCleanupError(error);
  return error;
};

type AdbFileDigest = Awaited<ReturnType<typeof hashStableFile>>;

/**
 * A pushed file's device-side digest together with its source, so a receipt
 * cannot name `sha256sum` as the source of a digest that was never parsed.
 */
type AdbDeviceDigest =
  | {
      readonly device_sha256: string;
      readonly device_digest_source: "device_sha256sum";
    }
  | {
      readonly device_sha256: null;
      readonly device_digest_source: "unavailable";
      readonly reason: string;
    };

const partialObservationWithDigest = (
  observation:
    | AdbAcquiredFilePartialObservation
    | AdbPackagePullPartialObservation,
  digest: AdbFileDigest,
): AdbAcquiredFilePartialObservation | AdbPackagePullPartialObservation => {
  if (observation.operation === "pull_adb_file") {
    const { result } = observation;
    if (!("digest_status" in result)) return observation;
    return {
      ...observation,
      result: {
        client: result.client,
        serial: result.serial,
        local_path: result.local_path,
        device_path: result.device_path,
        bytes: digest.bytes,
        sha256: digest.sha256,
      },
    };
  }
  if (observation.operation === "collect_adb_bugreport") {
    const { result } = observation;
    if (!("digest_status" in result)) return observation;
    return {
      ...observation,
      result: {
        client: result.client,
        serial: result.serial,
        local_path: result.local_path,
        adb_reported_path: result.adb_reported_path,
        bytes: digest.bytes,
        sha256: digest.sha256,
      },
    };
  }
  return observation;
};

const syncStagedAdbFile = async (
  path: string,
  resources: ArtifactResourceScope,
  operation: string,
): Promise<void> => {
  let owner: OwnedFileHandle | undefined;
  let primary: unknown;
  try {
    owner = new OwnedFileHandle(await open(path, "r+"));
    await owner.handle.sync();
  } catch (cause: unknown) {
    primary = cause;
  }
  if (owner === undefined) {
    if (primary !== undefined) throw primary;
    return;
  }
  const resource = `${path} (ADB staged-output handle)`;
  const stagedOwner = owner;
  const closeLease = new AnalysisCleanupLease(
    () => stagedOwner.close(),
    [resource],
  );
  const released = await resources.release({
    kind: "lease",
    resource,
    lease: closeLease,
  });
  if (released.kind === "failed") {
    const cleanup = new ProviderCleanupError(
      ADB_PROVIDER_IDENTITY.id,
      [resource],
      {
        reason:
          released.cause instanceof Error
            ? released.cause.message
            : String(released.cause),
      },
      { operation, cause: released.cause },
    );
    let reported: AnalysisError;
    if (primary !== undefined) {
      const failure = new AnalysisOutputError(
        operation,
        `The staged ADB output could not be synchronized: ${path}`,
        { cause: primary },
      );
      reported = analysisErrorWithCleanupFailure(failure, cleanup, operation);
    } else {
      reported = cleanup;
    }
    closeLease.bindCleanupError(reported);
    throw reported;
  }
  if (primary !== undefined) throw primary;
};

/** Materialize the caller's output directory, refusing existing files inside. */
const prepareOutputDirectory = async (
  operation: string,
  directory: string,
): Promise<Result<string, AnalysisError>> => {
  const root = absoluteCallerPath(directory);
  try {
    await mkdir(root, { recursive: true });
    await access(root, fsConstants.W_OK);
  } catch (cause) {
    const code = adbFilesystemErrorCode(cause);
    if (code === "EEXIST" || code === "ENOTDIR")
      return err(
        new AnalysisInputError(operation, { cause }, [
          {
            path: ["output_directory"],
            reason: "invalid_value",
            message: "The selected output path or a parent is not a directory.",
            observed: { path: directory, code },
          },
        ]),
      );
    return err(
      new AnalysisOutputError(
        operation,
        `The output directory is not writable or could not be created: ${root}`,
        { cause },
      ),
    );
  }
  return ok(root);
};

const refuseExistingTarget = async (
  operation: string,
  path: string,
): Promise<AnalysisError | undefined> => {
  if (
    await lstat(path).then(
      () => true,
      () => false,
    )
  )
    return new AnalysisOutputError(
      operation,
      `The output file already exists: ${path}`,
    );
  return undefined;
};

const hardLinksUnsupported = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  ["EPERM", "EOPNOTSUPP", "ENOTSUP", "ENOSYS", "EXDEV"].includes(
    String(cause.code),
  );

const describeAdbFailure = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);

interface ScreenPublicationCloseFailure {
  readonly cause: unknown;
  readonly resource: string;
  bindCleanupError(error: ProviderCleanupError): void;
}

/** Exclusive-create fallback for filesystems that cannot hard-link staged files. */
const publishScreenExclusively = async (
  outputPath: string,
  bytes: Buffer,
  resources: ArtifactResourceScope,
  operation: string,
  signal: AbortSignal | undefined,
): Promise<ScreenPublicationCloseFailure | undefined> => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError(operation, { cause: signal.reason });
  const output = await open(outputPath, "wx", 0o600);
  // Successful exclusive creation is this fallback's cutoff. Finish and sync
  // the visible file despite later cancellation so its receipt remains known.
  const ownedOutput = new OwnedFileHandle(output);
  const handleResource = `${outputPath} (ADB publication handle)`;
  const closeOnly = new AnalysisCleanupLease(
    () => ownedOutput.close(),
    [handleResource],
  );
  const removeOutput = async (
    expected: Awaited<ReturnType<typeof output.stat>>,
  ): Promise<void> => {
    let current: Awaited<ReturnType<typeof lstat>>;
    try {
      current = await lstat(outputPath);
    } catch (cause: unknown) {
      if (cause instanceof Error && Reflect.get(cause, "code") === "ENOENT")
        return;
      throw cause;
    }
    if (
      current.dev !== expected.dev ||
      current.ino !== expected.ino ||
      current.mode !== expected.mode
    )
      throw new Error(
        `The screen output changed before cleanup: ${outputPath}`,
      );
    await rm(outputPath);
  };
  let rollbackIdentity: Awaited<ReturnType<typeof output.stat>> | undefined;
  const inspectCloseAndRollback = new AnalysisCleanupLease(async () => {
    rollbackIdentity ??= await output.stat();
    await ownedOutput.close();
    await removeOutput(rollbackIdentity);
  });
  let identity: Awaited<ReturnType<typeof output.stat>>;
  try {
    identity = await output.stat();
  } catch (cause: unknown) {
    resources.retain({
      kind: "lease",
      resource: `${outputPath} (screen output and descriptor)`,
      lease: inspectCloseAndRollback,
    });
    const error = new ProviderCleanupError(
      ADB_PROVIDER_IDENTITY.id,
      [handleResource, outputPath],
      {
        reason:
          "The newly created screen output identity could not be established; its descriptor remains owned for cleanup retry",
      },
      { operation, cause },
    );
    inspectCloseAndRollback.bindCleanupError(error);
    throw error;
  }
  let writeFailure: { readonly cause: unknown } | undefined;
  try {
    await output.writeFile(bytes);
    await output.sync();
  } catch (cause: unknown) {
    writeFailure = { cause };
  }
  if (writeFailure === undefined) {
    try {
      await ownedOutput.close();
      return undefined;
    } catch (cause: unknown) {
      resources.retain({
        kind: "lease",
        resource: handleResource,
        lease: closeOnly,
      });
      return {
        cause,
        resource: handleResource,
        bindCleanupError(error) {
          closeOnly.bindCleanupError(error);
        },
      };
    }
  }

  const rollback = new AnalysisCleanupLease(async () => {
    await ownedOutput.close();
    await removeOutput(identity);
  });
  try {
    await ownedOutput.close();
  } catch (closeCause: unknown) {
    resources.retain({ kind: "lease", resource: outputPath, lease: rollback });
    const error = new ProviderCleanupError(
      ADB_PROVIDER_IDENTITY.id,
      [outputPath],
      { reason: describeAdbFailure(closeCause) },
      {
        operation,
        cause: new AggregateError(
          [writeFailure.cause, closeCause],
          "Screen output write and descriptor cleanup failed",
          { cause: writeFailure.cause },
        ),
      },
    );
    rollback.bindCleanupError(error);
    throw error;
  }
  const removed = await resources.release({
    kind: "lease",
    resource: outputPath,
    lease: rollback,
  });
  if (removed.kind === "failed") {
    const error = new ProviderCleanupError(
      ADB_PROVIDER_IDENTITY.id,
      [outputPath],
      { reason: describeAdbFailure(removed.cause) },
      {
        operation,
        cause: new AggregateError(
          [writeFailure.cause, removed.cause],
          "Screen output write and rollback failed",
          { cause: writeFailure.cause },
        ),
      },
    );
    rollback.bindCleanupError(error);
    throw error;
  }
  throw writeFailure.cause;
};

const cancellationWithCleanupFailure = (
  primary: AnalysisCancelledError,
  cleanup: AnalysisError,
  resources: readonly string[],
): AnalysisCancelledError =>
  new AnalysisCancelledError(primary.operation, {
    cause: new AggregateError(
      [primary, cleanup],
      "ADB cancellation cleanup failed",
      { cause: primary },
    ),
    diagnostics: primary.diagnostics,
    ...(primary.capturedOutput === undefined
      ? {}
      : { capturedOutput: primary.capturedOutput }),
    cleanup: {
      reason: [primary.cleanup?.reason, cleanup.message]
        .filter((reason): reason is string => reason !== undefined)
        .join("; "),
      resources: [...new Set([...primary.cleanupResources, ...resources])],
    },
    partialObservation: primary.partialObservation,
  });

/** Publish an ADB-produced archive without replacing an existing caller file. */
const publishBugreport = async (
  source: string,
  directory: string,
): Promise<string> => {
  const fileName = basename(source);
  const extension = extname(fileName);
  const stem =
    extension === "" ? fileName : fileName.slice(0, -extension.length);
  for (let suffix = 0; ; suffix += 1) {
    const destination = appendCallerPath(
      directory,
      suffix === 0 ? fileName : `${stem} (${String(suffix)})${extension}`,
    );
    try {
      await copyFile(source, destination, fsConstants.COPYFILE_EXCL);
      return destination;
    } catch (cause: unknown) {
      if (cause instanceof Error && "code" in cause && cause.code === "EEXIST")
        continue;
      throw cause;
    }
  }
};

export interface AdbProviderOptions {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  /** Override runtime-root creation at the provider's owned-resource boundary. */
  readonly createRuntimeRoot?: (
    options?: PrivateRuntimeRootOptions,
  ) => Promise<AdbRuntimeRoot>;
}

type AdbRuntimeRoot = Pick<PrivateRuntimeRoot, "path" | "close">;

/** A root lease releases its children before removing their containing root. */
const runtimeRootLease = (
  root: AdbRuntimeRoot,
  children: ArtifactResourceScope,
): AnalysisCleanupLease =>
  new AnalysisCleanupLease(async () => {
    await children.close();
    await root.close();
  });

interface PendingOutputDirectoryCleanup {
  readonly operation: "pull_adb_package" | "collect_adb_bugreport";
  readonly path: string;
  readonly primary: AnalysisError;
  readonly remove: () => Promise<void>;
  readonly lease: AnalysisCleanupLease;
}

interface OutputDirectoryIdentity {
  readonly dev: number;
  readonly ino: number;
  readonly mode: number;
}

const removeOwnedOutputDirectory = async (
  path: string,
  identity: OutputDirectoryIdentity | undefined,
): Promise<void> => {
  if (identity === undefined)
    throw new Error(
      `Cannot verify the created output directory identity; refusing to remove ${path}`,
    );
  let current: Awaited<ReturnType<typeof lstat>>;
  try {
    current = await lstat(path);
  } catch (cause: unknown) {
    if (cause instanceof Error && Reflect.get(cause, "code") === "ENOENT")
      return;
    throw cause;
  }
  if (
    !current.isDirectory() ||
    current.isSymbolicLink() ||
    current.dev !== identity.dev ||
    current.ino !== identity.ino ||
    current.mode !== identity.mode
  )
    throw new Error(
      `The created output directory was replaced or changed; refusing to remove ${path}`,
    );
  await rm(path, { recursive: true, force: true });
};

const reservePackageDestinations = async (
  operation: string,
  packageName: string,
  packageDirectory: string,
  entries: readonly {
    readonly file_name: string;
    readonly device_path: string;
  }[],
  capturedOutput: {
    readonly stdout: string;
    readonly stderr: string;
    readonly truncated: boolean;
  },
): Promise<AnalysisOutputError | undefined> => {
  const reservations: {
    readonly path: string;
    readonly file_name: string;
    readonly device_path: string;
    readonly identity: OutputDirectoryIdentity;
  }[] = [];
  for (const entry of entries) {
    const path = appendCallerPath(packageDirectory, entry.file_name);
    try {
      await mkdir(path);
      const created = await lstat(path);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new Error(`Could not reserve local filename ${entry.file_name}`);
      reservations.push({
        path,
        file_name: entry.file_name,
        device_path: entry.device_path,
        identity: {
          dev: created.dev,
          ino: created.ino,
          mode: created.mode,
        },
      });
    } catch (cause: unknown) {
      const errorCode =
        cause instanceof Error &&
        "code" in cause &&
        typeof cause.code === "string"
          ? cause.code
          : null;
      return new AnalysisOutputError(
        operation,
        "local_destination_unavailable",
        {
          cause,
          capturedOutput,
          userMessage: `pm path for ${packageName} reported ${displayDevicePath(entry.device_path)}, whose file name ${displayDevicePath(entry.file_name)} cannot be written to a unique local destination (${errorCode ?? "unknown error"}). No APK was pulled.`,
          remediationAction:
            "Review details.diagnostics and details.captured_output for the refused destination. Correct the output filesystem conflict before retrying; REA does not rename APKs.",
          diagnostics: {
            package_name: packageName,
            device_path: entry.device_path,
            file_name: entry.file_name,
            error_code: errorCode,
          },
        },
      );
    }
  }
  for (const reservation of reservations) {
    try {
      const current = await lstat(reservation.path);
      if (
        !current.isDirectory() ||
        current.isSymbolicLink() ||
        current.dev !== reservation.identity.dev ||
        current.ino !== reservation.identity.ino ||
        current.mode !== reservation.identity.mode
      )
        throw new Error(
          `The local filename reservation changed before release: ${reservation.path}`,
        );
      await rmdir(reservation.path);
    } catch (cause: unknown) {
      const errorCode =
        cause instanceof Error &&
        "code" in cause &&
        typeof cause.code === "string"
          ? cause.code
          : null;
      return new AnalysisOutputError(
        operation,
        "local_destination_unavailable",
        {
          cause,
          capturedOutput,
          userMessage: `Could not release the local filename reservation for ${displayDevicePath(reservation.device_path)} (${errorCode ?? "unknown error"}); no APK was pulled.`,
          remediationAction:
            "Review details.diagnostics and details.captured_output for the refused destination. Correct the output filesystem conflict before retrying; REA does not rename APKs.",
          diagnostics: {
            package_name: packageName,
            device_path: reservation.device_path,
            file_name: reservation.file_name,
            error_code: errorCode,
          },
        },
      );
    }
  }
  return undefined;
};

/**
 * ADB device inspection and acquisition over a caller-selected adb binary.
 *
 * Every operation composes fixed adb argument vectors: caller values occupy
 * positional arguments, escaped when adb forwards them to the device shell. The provider never
 * starts an emulator, installs platform tools, or drives the device UI; the
 * only device mutation is the caller-requested file push, which requires an
 * explicit overwrite choice and verifies its transfer digest.
 */
export class AdbProvider {
  private readonly environment: Readonly<Record<string, string | undefined>>;
  readonly #createRuntimeRoot: (
    options?: PrivateRuntimeRootOptions,
  ) => Promise<AdbRuntimeRoot>;
  readonly #resources = new ArtifactResourceScope();
  readonly #outputDirectoryRetryLeases = new WeakMap<
    AnalysisError,
    readonly AnalysisCleanupLease[]
  >();
  readonly #pendingOutputDirectoryCleanup =
    new Set<PendingOutputDirectoryCleanup>();
  readonly #activeOperations = new Set<Promise<void>>();
  #closing = false;
  #closePromise: Promise<void> | undefined;
  #outputCleanupPromise: Promise<void> | undefined;

  constructor(options: AdbProviderOptions = {}) {
    this.environment = snapshotEnvironment(options.environment ?? process.env);
    this.#createRuntimeRoot =
      options.createRuntimeRoot ??
      ((rootOptions) => PrivateRuntimeRoot.create(rootOptions));
  }

  private selection(signal?: AbortSignal): Promise<AdbBinarySelection> {
    return resolveAdbBinary(this.environment, process.platform, signal);
  }

  /** Probe the selected adb binary; never contacts devices or the server. */
  async inspectAvailability(
    signal?: AbortSignal,
  ): Promise<ProviderAvailability> {
    try {
      const selection = await this.selection(signal);
      await inspectAdbClient(selection, signal);
      return {
        status: "available",
        code: null,
        reason: null,
        diagnostics: {
          selected_binary: selection.binary,
          path_source: selection.pathSource,
        },
      };
    } catch (cause) {
      if (cause instanceof AdbConfigurationFailure)
        return adbConfigurationAvailability(cause);
      throw cause;
    }
  }

  /** Retry removal of owned output directories retained after failed cleanup. */
  close(): Promise<void> {
    this.#closing = true;
    if (this.#closePromise !== undefined) return this.#closePromise;
    const closing = (async () => {
      await Promise.all(this.#activeOperations);
      const failures: unknown[] = [];
      const failedLeases = new Set<AnalysisCleanupLease>();
      let allFailuresHaveExactLeaseOwners = true;
      // Directory errors may also depend on a retained digest descriptor.
      // Settle those owners before deciding whether the directory error resolved.
      for (const cleanup of [
        () => this.#resources.close(),
        () => this.#retryOutputDirectoryCleanup(),
      ]) {
        try {
          await cleanup();
        } catch (cause: unknown) {
          failures.push(cause);
          const leases =
            (cause instanceof AnalysisError
              ? this.#outputDirectoryRetryLeases.get(cause)
              : undefined) ??
            (cause instanceof ArtifactResourceRetryFailure
              ? cause.cleanupLeases
              : undefined);
          if (leases === undefined) allFailuresHaveExactLeaseOwners = false;
          for (const lease of leases ?? []) failedLeases.add(lease);
        }
      }
      if (failures.length > 0) {
        const resources = failures.flatMap((cause) =>
          this.#cleanupResources(cause, "ADB provider-owned resource"),
        );
        const error = new ProviderCleanupError(
          ADB_PROVIDER_IDENTITY.id,
          [...new Set(resources)],
          {
            reason: failures
              .map((cause) =>
                cause instanceof Error ? cause.message : String(cause),
              )
              .join("; "),
          },
          {
            operation: "close_binary",
            cause: new AggregateError(
              failures,
              "ADB cleanup remains incomplete",
            ),
          },
        );
        if (allFailuresHaveExactLeaseOwners && failedLeases.size > 0)
          new AnalysisCleanupLeaseGroup(error, [...failedLeases]);
        throw error;
      }
    })().finally(() => {
      if (this.#closePromise === closing) this.#closePromise = undefined;
    });
    this.#closePromise = closing;
    return this.#closePromise;
  }

  #cleanupResources(cause: unknown, resource: string): readonly string[] {
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
      return cause.cleanup.resources;
    if (cause instanceof AnalysisError && cause.cleanupResources.length > 0)
      return cause.cleanupResources;
    return [resource];
  }

  #cleanupError(
    operation: string,
    parameters: Record<string, JsonValue>,
    causes: readonly unknown[],
    resources: readonly string[],
    execution?: AnalysisExecution,
  ): ProviderCleanupError {
    const partialObservation =
      execution === undefined
        ? undefined
        : createEvidence(execution.subject ?? undefined, execution.provider, {
            operation,
            parameters,
            result: execution.result,
            rawResult: execution.rawResult,
            limitations: execution.limitations,
            locations: execution.locations,
            confidence: "observed",
          });
    return new ProviderCleanupError(
      ADB_PROVIDER_IDENTITY.id,
      resources,
      {
        reason: causes
          .map((cause) =>
            cause instanceof Error ? cause.message : String(cause),
          )
          .join("; "),
      },
      {
        operation,
        cause: new AggregateError(causes, "ADB operation cleanup failed"),
        ...(partialObservation === undefined ? {} : { partialObservation }),
      },
    );
  }

  async #withRuntimeRoot(
    operation: string,
    parameters: Record<string, JsonValue>,
    options: PrivateRuntimeRootOptions,
    signal: AbortSignal | undefined,
    work: (
      root: AdbRuntimeRoot,
      children: ArtifactResourceScope,
    ) => Promise<Result<AnalysisExecution, AnalysisError>>,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    let root: AdbRuntimeRoot;
    try {
      root = await this.#createRuntimeRoot(options);
    } catch (cause: unknown) {
      return err(
        cause instanceof AnalysisError
          ? cause
          : cause instanceof RuntimeControlUnavailableError
            ? runtimeControlCapabilityError(
                ADB_PROVIDER_IDENTITY.id,
                operation,
                cause,
              )
            : new AnalysisOutputError(
                operation,
                "Could not create an ADB private workspace",
                {
                  cause,
                },
              ),
      );
    }

    let result: Result<AnalysisExecution, AnalysisError> | undefined;
    let primary: AnalysisError | undefined;
    const children = new ArtifactResourceScope();
    try {
      result = await work(root, children);
    } catch (cause: unknown) {
      if (cause instanceof AdbInputSnapshotFailure) {
        primary =
          cause.primaryCause instanceof AnalysisError
            ? cause.primaryCause
            : new AnalysisOutputError(
                operation,
                `The caller input could not be staged for adb: ${cause.sourcePath}`,
                { cause: cause.primaryCause ?? cause },
              );
        // Snapshot handle cleanup may recover when the runtime-root lease is
        // drained below. Keep that historical failure linked to the typed
        // primary error while the lease owns and clears live cleanup state.
        primary.retainSecondaryFailure(
          new AnalysisOutputError(
            operation,
            `ADB input snapshot cleanup previously failed for ${cause.sourcePath}`,
            { cause },
          ),
          {},
        );
      } else {
        primary =
          cause instanceof AnalysisError
            ? cause
            : new AnalysisProtocolError(`ADB ${operation} failed`, { cause });
      }
    }

    const rootLease = runtimeRootLease(root, children);
    const released = await this.#resources.release({
      kind: "lease",
      resource: root.path,
      lease: rootLease,
    });
    if (primary === undefined && result?.ok && signal?.aborted === true) {
      const completed = result.value;
      primary = new AnalysisCancelledError(operation, {
        cause: signal.reason,
        partialObservation: createEvidence(
          completed.subject ?? undefined,
          completed.provider,
          {
            operation,
            parameters,
            result: completed.result,
            rawResult: completed.rawResult,
            limitations: completed.limitations,
            locations: completed.locations,
            confidence: "observed",
          },
        ),
      });
    }
    if (released.kind === "failed") {
      const cleanupResources = [
        root.path,
        ...(released.cause instanceof ArtifactReaderFailure &&
        released.cause.cleanup !== undefined
          ? released.cause.cleanup.resources
          : []),
      ];
      const cleanup = this.#cleanupError(
        operation,
        parameters,
        [released.cause],
        cleanupResources,
        result?.ok ? result.value : undefined,
      );
      const returnCleanupError = (error: AnalysisError) => {
        rootLease.bindCleanupError(error);
        return err(error);
      };
      if (primary instanceof AnalysisCancelledError) {
        return returnCleanupError(
          cancellationWithCleanupFailure(primary, cleanup, cleanupResources),
        );
      }
      if (primary !== undefined)
        return returnCleanupError(
          analysisErrorWithCleanupFailure(primary, cleanup, operation),
        );
      if (result !== undefined && !result.ok) {
        if (result.error instanceof AnalysisCancelledError) {
          return returnCleanupError(
            cancellationWithCleanupFailure(
              result.error,
              cleanup,
              cleanupResources,
            ),
          );
        }
        return returnCleanupError(
          analysisErrorWithCleanupFailure(result.error, cleanup, operation),
        );
      }
      return returnCleanupError(cleanup);
    }
    if (primary !== undefined) return err(primary);
    if (result === undefined)
      return err(
        new AnalysisProtocolError(`ADB ${operation} returned no result`),
      );
    return result;
  }

  #retainOutputDirectoryCleanup(
    owner: Omit<PendingOutputDirectoryCleanup, "lease">,
    cleanup: ProviderCleanupError,
  ): AnalysisError {
    const lease = new AnalysisCleanupLease(async () => {
      await owner.remove();
      if (owner.primary.cleanupIncomplete)
        throw new Error(
          "ADB output directory primary cleanup remains incomplete",
        );
    });
    const error = analysisErrorWithCleanupFailure(
      owner.primary,
      cleanup,
      owner.operation,
    );
    lease.bindCleanupError(error);
    this.#pendingOutputDirectoryCleanup.add({ ...owner, lease });
    return error;
  }

  #retryOutputDirectoryCleanup(): Promise<void> {
    if (this.#outputCleanupPromise !== undefined)
      return this.#outputCleanupPromise;
    const cleanup = this.#performOutputDirectoryCleanup().finally(() => {
      if (this.#outputCleanupPromise === cleanup)
        this.#outputCleanupPromise = undefined;
    });
    this.#outputCleanupPromise = cleanup;
    return cleanup;
  }

  async #performOutputDirectoryCleanup(): Promise<void> {
    const failures: AnalysisError[] = [];
    for (const owner of this.#pendingOutputDirectoryCleanup) {
      try {
        await owner.lease.release();
        this.#pendingOutputDirectoryCleanup.delete(owner);
      } catch (cause: unknown) {
        const cleanup = new ProviderCleanupError(
          ADB_PROVIDER_IDENTITY.id,
          [owner.path],
          {
            reason: cause instanceof Error ? cause.message : String(cause),
          },
          { operation: owner.operation, cause },
        );
        const error = analysisErrorWithCleanupFailure(
          owner.primary,
          cleanup,
          owner.operation,
        );
        owner.lease.bindCleanupError(error);
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      const error =
        failures.length === 1
          ? failures[0]!
          : new ProviderCleanupError(
              ADB_PROVIDER_IDENTITY.id,
              [
                ...new Set(
                  failures.flatMap((failure) => failure.cleanupResources),
                ),
              ],
              {
                reason:
                  "Failed ADB output directories remain after cleanup retry",
                operations: [...this.#pendingOutputDirectoryCleanup].map(
                  ({ operation }) => operation,
                ),
                failures: failures.map(({ message, cleanupResources }) => ({
                  message,
                  resources: [...cleanupResources],
                })),
              },
              {
                operation: "close_binary",
                cause: new AggregateError(
                  failures,
                  "Multiple ADB output directory cleanups failed",
                ),
              },
            );
      const leases = [...this.#pendingOutputDirectoryCleanup].map(
        ({ lease }) => lease,
      );
      this.#outputDirectoryRetryLeases.set(error, leases);
      if (failures.length > 1) new AnalysisCleanupLeaseGroup(error, leases);
      throw error;
    }
  }

  async execute(
    request: AdbRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    if (this.#closing)
      return err(new AnalysisCancelledError(request.operation));
    let release!: () => void;
    const active = new Promise<void>((resolve) => {
      release = resolve;
    });
    this.#activeOperations.add(active);
    try {
      try {
        await this.#resources.retryCleanup();
      } catch (cause: unknown) {
        const error = this.#cleanupError(
          request.operation,
          jsonObjectSchema.parse(request.input),
          [cause],
          this.#cleanupResources(cause, "ADB provider-owned resource"),
        );
        const leases =
          cause instanceof ArtifactResourceRetryFailure
            ? cause.cleanupLeases
            : undefined;
        if (leases !== undefined) new AnalysisCleanupLeaseGroup(error, leases);
        return err(error);
      }
      if (this.#pendingOutputDirectoryCleanup.size > 0) {
        try {
          await this.#retryOutputDirectoryCleanup();
        } catch (cause: unknown) {
          return err(
            cause instanceof AnalysisError
              ? cause
              : new ProviderCleanupError(
                  ADB_PROVIDER_IDENTITY.id,
                  [...this.#pendingOutputDirectoryCleanup].map(
                    ({ path }) => path,
                  ),
                  {
                    reason:
                      cause instanceof Error ? cause.message : String(cause),
                  },
                  { operation: request.operation, cause },
                ),
          );
        }
      }
      return await this.#executeOperation(request, options);
    } finally {
      this.#activeOperations.delete(active);
      release();
    }
  }

  async #executeOperation(
    request: AdbRequest,
    options?: ExecutionOptions,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const signal = options?.signal;
    if (signal?.aborted === true)
      return err(
        new AnalysisCancelledError(request.operation, { cause: signal.reason }),
      );
    let selection: AdbBinarySelection;
    let identity: AdbClientIdentity;
    try {
      selection = await this.selection(signal);
      identity = await inspectAdbClient(selection, signal);
    } catch (cause) {
      if (cause instanceof AnalysisError)
        return err(
          analysisClientFailureForOperation(
            cause,
            ADB_PROVIDER_IDENTITY.id,
            request.operation,
            { prerequisite_operation: "inspect_adb_client" },
          ),
        );
      if (cause instanceof AdbConfigurationFailure)
        return err(
          providerConfigurationRefusal(
            ADB_PROVIDER_IDENTITY.id,
            request.operation,
            cause,
          ),
        );
      return err(
        new AnalysisProtocolError(
          `adb version probe failed for ${request.operation}`,
          { cause },
        ),
      );
    }
    const client = clientIdentityResult(selection, identity);
    const provider: AdbProviderIdentity = {
      ...ADB_PROVIDER_IDENTITY,
      version: identity.version,
    };
    const { operation } = request;
    const shell = (arguments_: readonly string[], limits: AdbRunLimits) =>
      runAdb(
        operation,
        {
          device: "serial" in request.input ? request.input.serial : operation,
        },
        selection,
        adbArguments(
          "serial" in request.input ? request.input.serial : undefined,
          ["shell", ...arguments_],
        ),
        { ...limits, volatileOutput: true },
        signal,
      );
    const context: AdbCommandContext = {
      operation,
      request,
      selection,
      client,
      provider,
      signal,
      shell,
    };
    switch (operation) {
      case "inspect_adb_client":
        return inspectAdbClientOperation(context);
      case "list_adb_devices":
        return listAdbDevicesOperation(context);
      case "inspect_adb_device":
        return inspectAdbDeviceOperation(context);
      case "list_adb_packages": {
        const scopeFlag =
          request.input.scope === "third_party"
            ? "-3"
            : request.input.scope === "system"
              ? "-s"
              : null;
        const ran = await shell(
          [
            "pm",
            "list",
            "packages",
            "-f",
            ...(scopeFlag === null ? [] : [scopeFlag]),
          ],
          {
            timeoutMs: PACKAGE_LIST_TIMEOUT_MS,
            maxOutputBytes: PACKAGE_LIST_MAX_OUTPUT_BYTES,
          },
        );
        if (!ran.ok) return ran;
        const { packages, unparsedLines } = parsePackageListOutput(
          ran.value.stdout,
        );
        return ok(
          parsedListingExecution(
            {
              client,
              serial: request.input.serial,
              scope: request.input.scope,
              packages,
            },
            unparsedLines,
            provider,
            [
              "base_apk_device_path is a device filesystem path, not a host-local path",
            ],
          ),
        );
      }
      case "pull_adb_package":
        return this.pullPackage(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "read_adb_logcat": {
        const ran = await shell(
          [
            "logcat",
            "-d",
            "-b",
            request.input.buffer,
            "-t",
            String(request.input.count),
            ...(request.input.pid === undefined
              ? []
              : ["--pid", String(request.input.pid)]),
          ],
          {
            timeoutMs: LOGCAT_TIMEOUT_MS,
            maxOutputBytes: LOGCAT_MAX_OUTPUT_BYTES,
          },
        );
        if (!ran.ok) return ran;
        const lines = ran.value.stdout.split(/\r?\n/u);
        if (lines.length > 0 && lines[lines.length - 1] === "") lines.pop();
        const bounded = lines.slice(-request.input.count);
        return ok(
          createAnalysisExecution(
            {
              client,
              serial: request.input.serial,
              count: request.input.count,
              buffer: request.input.buffer,
              pid: request.input.pid ?? null,
              lines: bounded,
              total_bytes: ran.value.stdoutBytes,
              coverage:
                bounded.length !== lines.length ||
                bounded.length === request.input.count
                  ? "partial"
                  : "complete",
            },
            provider,
            {
              limitations: [
                "Reads a bounded dump (logcat -d); the newest lines are kept when the count cap trims",
                "coverage is partial when the requested count or capture budget truncated the dump",
              ],
            },
          ),
        );
      }
      case "inspect_adb_package": {
        const ran = await shell(["dumpsys", "package", request.input.package], {
          timeoutMs: DUMPSYS_PACKAGE_TIMEOUT_MS,
          maxOutputBytes: DUMPSYS_PACKAGE_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        const stdout = ran.value.stdout;
        if (/Unable to find package:/u.test(stdout) || stdout.trim() === "")
          return err(
            new AnalysisUnsupportedTargetError(
              operation,
              request.input.serial,
              `Package Manager did not report details for ${request.input.package}; it may not be installed for user 0`,
            ),
          );
        const details = parseDumpsysPackageOutput(stdout);
        return ok(
          createAnalysisExecution(
            {
              client,
              serial: request.input.serial,
              package_name: request.input.package,
              version_name: details.versionName,
              version_code: details.versionCode,
              first_install_time: details.firstInstallTime,
              last_update_time: details.lastUpdateTime,
              installer_package_name: details.installerPackageName,
              user_id: details.userId,
              pkg_flags: details.pkgFlags,
              requested_permissions_count: details.requestedPermissions,
              numeric_issues: details.numericIssues,
              coverage:
                details.numericIssues.total > 0 ||
                details.requestedPermissions === null ||
                (details.versionCode === null && details.versionName === null)
                  ? "partial"
                  : "complete",
            },
            provider,
            {
              limitations: [
                "Fields are a fixed projection of dumpsys package output; version-dependent sections are ignored rather than guessed",
                "requested_permissions_count counts the listed requested permissions section; an absent section is zero only when dumpsys confirms a loaded parsed package",
                "A null requested_permissions_count means dumpsys reported pkg=null or did not establish that an omitted permission section is an empty inventory",
              ],
            },
          ),
        );
      }
      case "pull_adb_file":
        return this.pullFile(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "push_adb_file":
        return this.pushFile(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "capture_adb_screen":
        return this.captureScreen(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "collect_adb_bugreport":
        return this.collectBugreport(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "list_adb_processes": {
        const ran = await shell(["ps", "-A"], {
          timeoutMs: LISTING_TIMEOUT_MS,
          maxOutputBytes: LISTING_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        const { columns, processes, unparsedLines } = parseProcessListOutput(
          ran.value.stdout,
        );
        return ok(
          parsedListingExecution(
            { client, serial: request.input.serial, columns, processes },
            unparsedLines,
            provider,
          ),
        );
      }
      case "list_adb_directory": {
        const ran = await runAdbCapture(
          operation,
          { device: request.input.serial, path: request.input.device_path },
          selection,
          adbArguments(request.input.serial, [
            "shell",
            "sh",
            "-c",
            'cd "$1" || exit\nexec find . -mindepth 1 -maxdepth 1 -exec sh -c "$2" rea-list-directory {} +',
            "rea-list-directory",
            request.input.device_path,
            ADB_DIRECTORY_BATCH_SCRIPT,
          ]),
          {
            timeoutMs: LISTING_TIMEOUT_MS,
            maxOutputBytes: LISTING_MAX_OUTPUT_BYTES,
            volatileOutput: true,
          },
          signal,
        );
        if (!ran.ok) return ran;
        const { entries, unparsedLines } = parseAdbDirectoryListing(
          ran.value.stdout,
        );
        return ok(
          parsedListingExecution(
            {
              client,
              serial: request.input.serial,
              device_path: request.input.device_path,
              entries,
            },
            unparsedLines,
            provider,
            [
              "Entry kinds derive from stat permission mode; directory contents and link targets may change during capture",
            ],
          ),
        );
      }
      case "list_adb_features": {
        const ran = await shell(["pm", "list", "features"], {
          timeoutMs: LISTING_TIMEOUT_MS,
          maxOutputBytes: LISTING_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        const { features, unparsedLines } = parseFeatureListOutput(
          ran.value.stdout,
        );
        return ok(
          parsedListingExecution(
            { client, serial: request.input.serial, features },
            unparsedLines,
            provider,
          ),
        );
      }
      case "list_adb_services": {
        const ran = await shell(["service", "list"], {
          timeoutMs: LISTING_TIMEOUT_MS,
          maxOutputBytes: LISTING_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        const { services, unparsedLines } = parseServiceListOutput(
          ran.value.stdout,
        );
        return ok(
          parsedListingExecution(
            { client, serial: request.input.serial, services },
            unparsedLines,
            provider,
          ),
        );
      }
      case "inspect_adb_display": {
        const size = await shell(["wm", "size"], {
          timeoutMs: SETTINGS_TIMEOUT_MS,
          maxOutputBytes: SETTINGS_MAX_OUTPUT_BYTES,
        });
        if (!size.ok) return size;
        const density = await shell(["wm", "density"], {
          timeoutMs: SETTINGS_TIMEOUT_MS,
          maxOutputBytes: SETTINGS_MAX_OUTPUT_BYTES,
        });
        if (!density.ok) return density;
        const parsedSize = parseWmSizeOutput(size.value.stdout);
        const parsedDensity = parseWmDensityOutput(density.value.stdout);
        const issues =
          collectNumericIssues<AdbDisplayNumericIssues["sample"][number]>();
        issues.append(parsedSize.numericIssues);
        issues.append(parsedDensity.numericIssues);
        const numericIssues = issues.facts();
        const displayFacts = {
          client,
          serial: request.input.serial,
          override_size: parsedSize.override,
          physical_density: parsedDensity.physical,
          override_density: parsedDensity.override,
          numeric_issues: numericIssues,
        };
        if (parsedSize.physical === null) {
          const reason = parsedSize.physicalDeclared
            ? "physical_size_malformed"
            : "physical_size_absent";
          const partialObservation: AdbDisplayPartialObservation =
            adbDisplayPartialObservationSchema.parse({
              provider_id: "adb",
              operation: "inspect_adb_display",
              reason,
              result: {
                ...displayFacts,
                physical_size: null,
                coverage: "partial",
              },
            });
          return err(
            new AnalysisProtocolError(
              parsedSize.physicalDeclared
                ? "wm size reported a malformed physical size"
                : "wm size did not report a physical size; the build may use an unsupported format",
              { partialObservation },
            ),
          );
        }
        return ok(
          createAnalysisExecution(
            {
              ...displayFacts,
              physical_size: parsedSize.physical,
              coverage:
                numericIssues.total > 0 || parsedDensity.physical === null
                  ? "partial"
                  : "complete",
            },
            provider,
            {
              limitations: [
                "Override fields are null when no declaration was reported or its value was malformed; numeric_issues retains malformed declarations",
              ],
            },
          ),
        );
      }
      case "inspect_adb_window": {
        let section: "windows" | "displays" = "windows";
        const ran = await shell(["dumpsys", "window", section], {
          timeoutMs: SHELL_TIMEOUT_MS,
          maxOutputBytes: DUMPSYS_WINDOW_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        let focus = parseWindowFocusOutput(ran.value.stdout);
        if (focus.focus_summary === "unavailable") {
          section = "displays";
          const fallback = await shell(["dumpsys", "window", section], {
            timeoutMs: SHELL_TIMEOUT_MS,
            maxOutputBytes: DUMPSYS_WINDOW_MAX_OUTPUT_BYTES,
          });
          if (!fallback.ok) return fallback;
          focus = parseWindowFocusOutput(fallback.value.stdout);
        }
        const declared = focus.focus_summary !== "unavailable";
        return ok(
          createAnalysisExecution(
            {
              client,
              serial: request.input.serial,
              source_section: section,
              ...focus,
            },
            provider,
            {
              limitations: [
                "Focus values are the window manager's declarations at read time; no interaction occurred",
                declared
                  ? `Focus declarations were read from \`dumpsys window ${section}\``
                  : "Neither `dumpsys window windows` nor `dumpsys window displays` declared mCurrentFocus or mFocusedApp; focus is unknown, not absent",
                ...(focus.focus_summary === "ambiguous"
                  ? [
                      "Multiple focus contexts or repeated declarations prevent a singular focus summary; inspect focus_contexts for every declaration",
                    ]
                  : []),
              ],
            },
          ),
        );
      }
      case "read_adb_setting": {
        const ran = await shell(
          ["settings", "get", request.input.namespace, request.input.key],
          {
            timeoutMs: SETTINGS_TIMEOUT_MS,
            maxOutputBytes: SETTINGS_MAX_OUTPUT_BYTES,
          },
        );
        if (!ran.ok) return ran;
        const { value, deviceReportedNull } = parseSettingsGetOutput(
          ran.value.stdout,
        );
        return ok(
          createAnalysisExecution(
            {
              client,
              serial: request.input.serial,
              namespace: request.input.namespace,
              key: request.input.key,
              value,
              device_reported_null: deviceReportedNull,
            },
            provider,
            {
              limitations: [
                "Android prints the literal string null for absent keys; that is reported as a device-side null observation",
              ],
            },
          ),
        );
      }
      case "resolve_adb_packages": {
        const ran = await shell(["pm", "list", "packages", "-f"], {
          timeoutMs: PACKAGE_LIST_TIMEOUT_MS,
          maxOutputBytes: PACKAGE_LIST_MAX_OUTPUT_BYTES,
        });
        if (!ran.ok) return ran;
        const { packages, unparsedLines } = parsePackageListOutput(
          ran.value.stdout,
        );
        const needle = request.input.query.toLowerCase();
        const matches = packages.filter((entry) =>
          entry.package_name.toLowerCase().includes(needle),
        );
        return ok(
          parsedListingExecution(
            {
              client,
              serial: request.input.serial,
              query: request.input.query,
              matches,
              exact_match:
                matches.length === 1 &&
                matches[0]!.package_name.toLowerCase() === needle,
            },
            unparsedLines,
            provider,
            [
              "Matching is a case-insensitive substring over package names; application display labels are not part of pm output",
            ],
          ),
        );
      }
      case "install_adb_package":
        return this.installPackage(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "uninstall_adb_package":
        return this.uninstallPackage(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "start_adb_app":
        return this.startApp(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "start_adb_activity":
        return this.startActivity(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
      case "stop_adb_app":
        return this.stopApp(
          operation,
          selection,
          client,
          provider,
          request.input,
          signal,
        );
    }
  }

  private async pullPackage(
    operation: "pull_adb_package",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: {
      readonly serial: string;
      readonly package: string;
      readonly output_directory: string;
    },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const { serial, package: packageName } = input;
    const paths = await runAdb(
      operation,
      { device: serial },
      selection,
      adbArguments(serial, ["shell", "pm", "path", packageName]),
      {
        timeoutMs: PM_PATH_TIMEOUT_MS,
        maxOutputBytes: PM_PATH_MAX_OUTPUT_BYTES,
        volatileOutput: true,
      },
      signal,
    );
    if (!paths.ok) return paths;
    const parsed = parsePmPathOutput(paths.value.stdout);
    const capturedOutput = {
      stdout: paths.value.stdout,
      stderr: paths.value.stderr,
      truncated: false,
    };
    if (parsed.rejectedPaths.length > 0) {
      const first = parsed.rejectedPaths[0]!;
      const otherCount = parsed.rejectedPaths.length - 1;
      return err(
        new AnalysisOutputError(operation, "unsafe_device_path", {
          capturedOutput,
          userMessage: `pm path for ${packageName} reported an APK path that cannot be written as a file on this host: ${displayDevicePath(first.device_path)} (${first.reason})${otherCount > 0 ? ` and ${String(otherCount)} other path(s)` : ""}. No APK was pulled.`,
          remediationAction:
            "Review details.diagnostics for the refused device paths and details.captured_output for the retained pm path output. REA does not rename device-reported APK paths; correct the device path policy before retrying.",
          diagnostics: {
            package_name: packageName,
            rejected_paths: parsed.rejectedPaths.map(
              ({ device_path, reason }) => ({
                device_path,
                reason,
              }),
            ),
          },
        }),
      );
    }
    if (parsed.paths.length === 0 && parsed.unparsedLines.total === 0)
      return err(
        new AnalysisUnsupportedTargetError(
          operation,
          serial,
          `Package Manager reported no APK paths for ${packageName}; it may not be installed for user 0`,
        ),
      );
    if (parsed.unparsedLines.total > 0)
      return err(
        new AnalysisProtocolError(
          `pm path reported an unrecognized line: ${parsed.unparsedLines.sample[0]!}`,
          { capturedOutput },
        ),
      );
    const destinationNames = new Set<string>();
    for (const entry of parsed.paths) {
      if (destinationNames.has(entry.file_name))
        return err(
          new AnalysisOutputError(operation, "duplicate_local_destination", {
            capturedOutput,
            userMessage: `pm path for ${packageName} reported multiple APK paths with the same local file name ${displayDevicePath(entry.file_name)}; no APK was pulled.`,
            remediationAction:
              "Review details.diagnostics and details.captured_output for the conflicting device paths. REA does not rename device-reported paths; correct Package Manager's path response before retrying.",
            diagnostics: {
              package_name: packageName,
              file_name: entry.file_name,
              device_paths: parsed.paths
                .filter((candidate) => candidate.file_name === entry.file_name)
                .map((candidate) => candidate.device_path),
            },
          }),
        );
      destinationNames.add(entry.file_name);
    }
    const directory = await prepareOutputDirectory(
      operation,
      input.output_directory,
    );
    if (!directory.ok) return directory;
    const packageDirectory = appendCallerPath(directory.value, packageName);
    let packageDirectoryCreated = false;
    let packageDirectoryIdentity: OutputDirectoryIdentity | undefined;
    try {
      if (
        await lstat(packageDirectory).then(
          () => true,
          () => false,
        )
      )
        throw new Error(
          `The package output directory already exists: ${packageDirectory}`,
        );
      await mkdir(packageDirectory);
      packageDirectoryCreated = true;
      const created = await lstat(packageDirectory);
      if (!created.isDirectory() || created.isSymbolicLink())
        throw new Error(
          `The created package output is not a regular directory: ${packageDirectory}`,
        );
      packageDirectoryIdentity = {
        dev: created.dev,
        ino: created.ino,
        mode: created.mode,
      };
    } catch (cause) {
      const primary = new AnalysisOutputError(
        operation,
        cause instanceof Error ? cause.message : String(cause),
        { cause },
      );
      if (!packageDirectoryCreated) return err(primary);
      const owner = {
        operation,
        path: packageDirectory,
        primary,
        remove: () =>
          removeOwnedOutputDirectory(
            packageDirectory,
            packageDirectoryIdentity,
          ),
      };
      const cleanup = new ProviderCleanupError(
        ADB_PROVIDER_IDENTITY.id,
        [packageDirectory],
        {
          reason: "Could not establish an owned package directory identity",
        },
        { operation, cause },
      );
      return err(this.#retainOutputDirectoryCleanup(owner, cleanup));
    }
    const failOwnedPackage = async (
      primary: AnalysisError,
    ): Promise<Result<AnalysisExecution, AnalysisError>> => {
      const owner = {
        operation,
        path: packageDirectory,
        primary,
        remove: () =>
          removeOwnedOutputDirectory(
            packageDirectory,
            packageDirectoryIdentity,
          ),
      };
      try {
        await owner.remove();
      } catch (cause: unknown) {
        const cleanup = new ProviderCleanupError(
          ADB_PROVIDER_IDENTITY.id,
          [packageDirectory],
          { reason: cause instanceof Error ? cause.message : String(cause) },
          { operation, cause },
        );
        return err(this.#retainOutputDirectoryCleanup(owner, cleanup));
      }
      return err(primary);
    };
    const destinationError = await reservePackageDestinations(
      operation,
      packageName,
      packageDirectory,
      parsed.paths,
      capturedOutput,
    );
    if (destinationError !== undefined)
      return failOwnedPackage(destinationError);
    const artifacts: {
      device_path: string;
      file_name: string;
      local_path: string;
      bytes: number;
      sha256: string;
      role: "base" | "split" | "unknown";
      role_basis: "file_name";
    }[] = [];
    const failures: {
      device_path: string | null;
      stage: "resolve_paths" | "pull" | "digest";
      message: string;
      cause: unknown;
    }[] = [];
    const observedFailures = () =>
      failures.map(({ device_path, stage, message }) => ({
        device_path,
        stage,
        message,
      }));
    const cancelledPackagePull = (
      error: AnalysisCancelledError,
      localPath: string,
      devicePath: string,
      stage: "pull" | "digest",
    ) => {
      error.retainPartialObservation({
        provider_id: "adb",
        operation,
        result: {
          client,
          serial,
          package_name: packageName,
          output_directory: directory.value,
          artifacts,
          failures: [
            ...observedFailures(),
            {
              device_path: devicePath,
              stage,
              message:
                stage === "pull"
                  ? `Pull cancelled; any incomplete file is retained at ${localPath}. Remaining APKs were not attempted.`
                  : `Digesting the pulled file was cancelled; the file is retained at ${localPath}. Remaining APKs were not attempted.`,
            },
          ],
          coverage: "partial",
        },
      });
      return err(error);
    };
    for (const entry of parsed.paths) {
      const localPath = appendCallerPath(packageDirectory, entry.file_name);
      const pulled = await runAdb(
        operation,
        {
          device: serial,
          path: entry.device_path,
          localPath,
        },
        selection,
        adbArguments(serial, ["pull", entry.device_path, localPath]),
        { timeoutMs: PULL_TIMEOUT_MS, maxOutputBytes: PULL_MAX_OUTPUT_BYTES },
        signal,
      );
      if (!pulled.ok) {
        if (pulled.error instanceof AnalysisCancelledError)
          return cancelledPackagePull(
            pulled.error,
            localPath,
            entry.device_path,
            "pull",
          );
        failures.push({
          device_path: entry.device_path,
          stage: "pull",
          message: pulled.error.message,
          cause: pulled.error,
        });
        continue;
      }
      try {
        const digest = await hashAdbFile(
          localPath,
          operation,
          signal,
          this.#resources,
        );
        artifacts.push({
          device_path: entry.device_path,
          file_name: entry.file_name,
          local_path: localPath,
          bytes: digest.bytes,
          sha256: digest.sha256,
          role: entry.role,
          role_basis: "file_name",
        });
      } catch (cause: unknown) {
        const digestFailure =
          cause instanceof AdbDigestFailure ? cause.fileFailure : undefined;
        const completedDigest =
          digestFailure?.outcome.kind === "completed"
            ? digestFailure.outcome.value
            : undefined;
        const partialObservation: AdbPackagePullPartialObservation = {
          provider_id: "adb",
          operation,
          result: {
            client,
            serial,
            package_name: packageName,
            output_directory: directory.value,
            artifacts:
              completedDigest === undefined
                ? artifacts
                : [
                    ...artifacts,
                    {
                      device_path: entry.device_path,
                      file_name: entry.file_name,
                      local_path: localPath,
                      bytes: completedDigest.bytes,
                      sha256: completedDigest.sha256,
                      role: entry.role,
                      role_basis: "file_name",
                    },
                  ],
            failures: [
              ...observedFailures(),
              {
                device_path: entry.device_path,
                stage: "digest",
                message:
                  completedDigest === undefined
                    ? `The pulled file remains at ${localPath}, but its digest and descriptor cleanup are unconfirmed.`
                    : digestFailure instanceof RegularFileCancelled
                      ? `The pulled file digest and descriptor cleanup are confirmed; the request was cancelled: ${localPath}`
                      : `The pulled file digest is known, but its descriptor cleanup is unconfirmed: ${localPath}`,
              },
            ],
            coverage: "partial",
          },
        };
        const cleanupError = adbDigestError(
          cause,
          operation,
          partialObservation,
        );
        if (cleanupError !== undefined) return err(cleanupError);
        if (cause instanceof AnalysisCancelledError)
          return cancelledPackagePull(
            cause,
            localPath,
            entry.device_path,
            "digest",
          );
        const physicalCause = stableFileHashCause(cause);
        failures.push({
          device_path: entry.device_path,
          stage: "digest",
          message: `The pulled file could not be read back after pulling: ${localPath}: ${physicalCause instanceof Error ? physicalCause.message : String(physicalCause)}`,
          cause,
        });
      }
    }
    if (artifacts.length === 0 && failures.length > 0) {
      const firstCause = failures[0]!.cause;
      const primary =
        firstCause instanceof AnalysisError
          ? firstCause
          : new AnalysisProtocolError(
              `Every APK pull failed for ${packageName} on ${serial}: ${failures[0]!.message}`,
              {
                cause: new AggregateError(
                  failures.map(({ cause }) => cause),
                  "APK pulls failed",
                ),
              },
            );
      primary.retainPartialObservation({
        provider_id: "adb",
        operation,
        result: {
          client,
          serial,
          package_name: packageName,
          output_directory: directory.value,
          artifacts,
          failures: observedFailures(),
          coverage: "partial",
        },
      });
      return failOwnedPackage(primary);
    }
    return ok(
      createAnalysisExecution(
        {
          client,
          serial,
          package_name: packageName,
          output_directory: directory.value,
          artifacts,
          failures: observedFailures(),
          coverage: failures.length === 0 ? "complete" : "partial",
        },
        provider,
        {
          limitations: [
            "APK role names derive from the pulled file names (base.apk, split_*.apk)",
            "Pulled artifacts are host-local copies; the device retains the originals",
          ],
        },
      ),
    );
  }

  private async pullFile(
    operation: "pull_adb_file",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: {
      readonly serial: string;
      readonly device_path: string;
      readonly output_directory: string;
    },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const derived = adbHostFileName(input.device_path);
    if (!derived.ok)
      return err(
        new AnalysisInputError(operation, undefined, [
          {
            path: ["device_path"],
            reason: "invalid_value",
            message: `The device path ${JSON.stringify(input.device_path)} does not name a file that can be written on this host (${derived.reason}); REA never renames a device-reported file.`,
          },
        ]),
      );
    const directory = await prepareOutputDirectory(
      operation,
      input.output_directory,
    );
    if (!directory.ok) return directory;
    const localPath = appendCallerPath(directory.value, derived.fileName);
    const existing = await refuseExistingTarget(operation, localPath);
    if (existing !== undefined) return err(existing);
    const pulled = await runAdb(
      operation,
      {
        device: input.serial,
        path: input.device_path,
        localPath,
      },
      selection,
      adbArguments(input.serial, ["pull", input.device_path, localPath]),
      { timeoutMs: PULL_TIMEOUT_MS, maxOutputBytes: PULL_MAX_OUTPUT_BYTES },
      signal,
    );
    if (!pulled.ok) return pulled;
    try {
      const digest = await hashAdbFile(
        localPath,
        operation,
        signal,
        this.#resources,
      );
      return ok(
        createAnalysisExecution(
          {
            client,
            serial: input.serial,
            device_path: input.device_path,
            local_path: localPath,
            bytes: digest.bytes,
            sha256: digest.sha256,
          },
          provider,
          {
            limitations: [
              "The pulled file is a host-local copy; the device retains the original",
            ],
          },
        ),
      );
    } catch (cause) {
      const partialObservation: AdbAcquiredFilePartialObservation = {
        provider_id: "adb",
        operation,
        result: {
          client,
          serial: input.serial,
          local_path: localPath,
          device_path: input.device_path,
          digest_status: "unknown",
        },
      };
      const cleanupError = adbDigestError(cause, operation, partialObservation);
      if (cleanupError !== undefined) return err(cleanupError);
      if (cause instanceof AnalysisCancelledError) {
        cause.retainPartialObservation(partialObservation);
        return err(cause);
      }
      return err(
        new AnalysisOutputError(
          operation,
          `The pulled file could not be read back after pulling: ${localPath}`,
          { cause, partialObservation },
        ),
      );
    }
  }

  private async pushFile(
    operation: "push_adb_file",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: {
      readonly serial: string;
      readonly local_path: string;
      readonly device_path: string;
      readonly overwrite: boolean;
    },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const localPath = absoluteCallerPath(input.local_path);
    const invalid = await adbInputFileError(
      operation,
      "local_path",
      input.local_path,
      localPath,
    );
    if (invalid !== undefined) return err(invalid);
    return this.#withRuntimeRoot(
      operation,
      {
        serial: input.serial,
        local_path: localPath,
        device_path: input.device_path,
        overwrite: input.overwrite,
      },
      { prefix: "rea-adb-input-" },
      signal,
      async (root, resources) => {
        const digest = await snapshotAdbInput(
          localPath,
          root,
          resources,
          operation,
          signal,
        );
        const directoryProbe = await probeAdbPathDirectory(
          operation,
          input.serial,
          input.device_path,
          selection,
          { timeoutMs: SETTINGS_TIMEOUT_MS, maxOutputBytes: 1024 },
          signal,
        );
        if (!directoryProbe.ok) return directoryProbe;
        const devicePath = directoryProbe.value
          ? `${input.device_path}${input.device_path.endsWith("/") ? "" : "/"}${basename(localPath)}`
          : input.device_path;
        const existsProbe = await probeAdbPathExistence(
          operation,
          input.serial,
          devicePath,
          selection,
          { timeoutMs: SETTINGS_TIMEOUT_MS, maxOutputBytes: 1024 },
          signal,
        );
        if (!existsProbe.ok) return existsProbe;
        const deviceExists = existsProbe.value;
        if (deviceExists && !input.overwrite)
          return err(
            new AnalysisOutputError(
              operation,
              `The device path already exists and overwrite was not requested: ${devicePath}`,
            ),
          );
        const pushed = await runAdb(
          operation,
          {
            device: input.serial,
            path: input.device_path,
            localPath: digest.path,
          },
          selection,
          adbArguments(input.serial, ["push", digest.path, input.device_path]),
          { timeoutMs: PULL_TIMEOUT_MS, maxOutputBytes: PULL_MAX_OUTPUT_BYTES },
          signal,
        );
        if (!pushed.ok) return pushed;
        const receipt = (
          deviceDigest: AdbDeviceDigest,
          rawResult?: {
            readonly device_sha256sum: {
              readonly stdout: string;
              readonly stderr: string;
            };
          },
        ) =>
          createAnalysisExecution(
            {
              client,
              serial: input.serial,
              local_path: localPath,
              device_path: devicePath,
              bytes: digest.bytes,
              sha256: digest.sha256,
              device_sha256: deviceDigest.device_sha256,
              overwritten: deviceExists,
              device_digest_source: deviceDigest.device_digest_source,
            },
            provider,
            {
              ...(rawResult === undefined ? {} : { rawResult }),
              limitations: [
                "Push writes a private snapshot of the caller's file to the device",
                ...(deviceDigest.device_digest_source === "unavailable"
                  ? [deviceDigest.reason]
                  : []),
              ],
            },
          );
        const deviceDigest = await runAdb(
          operation,
          { device: input.serial, path: devicePath },
          selection,
          adbArguments(input.serial, ["shell", "sha256sum", devicePath]),
          {
            timeoutMs: SHELL_TIMEOUT_MS,
            // sha256sum echoes the path, escaping special characters, so a
            // long path must not exhaust the budget for the digest line.
            maxOutputBytes: 1024 + 2 * Buffer.byteLength(devicePath),
          },
          signal,
        );
        if (!deviceDigest.ok) {
          const cancelled =
            deviceDigest.error instanceof AnalysisCancelledError;
          const verificationFailed =
            cancelled ||
            deviceDigest.error instanceof AnalysisResourceConstraintError ||
            deviceDigest.error instanceof AnalysisTimeoutError;
          const completed = receipt({
            device_sha256: null,
            device_digest_source: "unavailable",
            reason: cancelled
              ? "The device-side digest check was cancelled after push completed"
              : verificationFailed
                ? `Device-side digest verification failed after push completed: ${deviceDigest.error.message}`
                : "The device did not answer sha256sum, so the transfer is not device-side verified",
          });
          if (verificationFailed)
            deviceDigest.error.retainPartialObservation(
              createEvidence(
                completed.subject ?? undefined,
                completed.provider,
                {
                  operation,
                  parameters: input,
                  result: completed.result,
                  rawResult: completed.rawResult,
                  limitations: completed.limitations,
                  locations: completed.locations,
                  confidence: "observed",
                },
              ),
            );
          return verificationFailed ? err(deviceDigest.error) : ok(completed);
        }
        const parsedDigest = parseSha256sumOutput(deviceDigest.value.stdout);
        const completed =
          parsedDigest === null
            ? receipt(
                {
                  device_sha256: null,
                  device_digest_source: "unavailable",
                  reason:
                    "The device's sha256sum output contained no recognizable digest, so the transfer is not device-side verified",
                },
                {
                  device_sha256sum: {
                    stdout: deviceDigest.value.stdout,
                    stderr: deviceDigest.value.stderr,
                  },
                },
              )
            : receipt({
                device_sha256: parsedDigest,
                device_digest_source: "device_sha256sum",
              });
        if (parsedDigest !== null && parsedDigest !== digest.sha256)
          return err(
            new AnalysisArtifactChangedError(
              operation,
              devicePath,
              `The device-reported digest does not match the staged local file: ${localPath}`,
              {
                partialObservation: createEvidence(
                  completed.subject ?? undefined,
                  completed.provider,
                  {
                    operation,
                    parameters: input,
                    result: completed.result,
                    rawResult: completed.rawResult,
                    limitations: completed.limitations,
                    locations: completed.locations,
                    confidence: "observed",
                  },
                ),
              },
            ),
          );
        return ok(completed);
      },
    );
  }

  private async installPackage(
    operation: "install_adb_package",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: {
      readonly serial: string;
      readonly apk_path: string;
      readonly replace: boolean;
    },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const apkPath = absoluteCallerPath(input.apk_path);
    const invalid = await adbInputFileError(
      operation,
      "apk_path",
      input.apk_path,
      apkPath,
    );
    if (invalid !== undefined) return err(invalid);
    return this.#withRuntimeRoot(
      operation,
      {
        serial: input.serial,
        apk_path: apkPath,
        replace: input.replace,
      },
      { prefix: "rea-adb-apk-" },
      signal,
      async (root, resources) => {
        const digest = await snapshotAdbInput(
          apkPath,
          root,
          resources,
          operation,
          signal,
        );
        const installed = await runAdb(
          operation,
          { device: input.serial, path: apkPath, localPath: digest.path },
          selection,
          adbArguments(input.serial, [
            "install",
            ...(input.replace ? ["-r"] : []),
            digest.path,
          ]),
          { timeoutMs: PULL_TIMEOUT_MS, maxOutputBytes: PULL_MAX_OUTPUT_BYTES },
          signal,
        );
        if (!installed.ok)
          return (
            packageChangeRefusal(operation, input.serial, installed.error) ??
            installed
          );
        const verdict = parsePackageChangeOutput(installed.value.stdout);
        if (verdict.status === "unknown")
          return err(
            new AnalysisOutputError(
              operation,
              "ADB returned no installation verdict",
              {
                capturedOutput: {
                  stdout: installed.value.stdout,
                  stderr: installed.value.stderr,
                  truncated: false,
                },
              },
            ),
          );
        if (verdict.status === "failure")
          return err(
            new AnalysisUnsupportedTargetError(
              operation,
              input.serial,
              verdict.reason,
            ),
          );
        return ok(
          createAnalysisExecution(
            {
              client,
              serial: input.serial,
              apk_path: apkPath,
              bytes: digest.bytes,
              sha256: digest.sha256,
              replace_requested: input.replace,
              replaced: null,
            },
            provider,
            {
              limitations: [
                "Install changes device state; the installed APK's digest identifies the private host snapshot",
                "Whether an existing package was replaced is unknown; replace_requested records only the adb install mode",
              ],
            },
          ),
        );
      },
    );
  }

  private async uninstallPackage(
    operation: "uninstall_adb_package",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: { readonly serial: string; readonly package: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const uninstalled = await runAdb(
      operation,
      { device: input.serial },
      selection,
      adbArguments(input.serial, [
        "shell",
        "pm",
        "uninstall",
        "--user",
        "0",
        input.package,
      ]),
      {
        timeoutMs: PACKAGE_LIST_TIMEOUT_MS,
        maxOutputBytes: PULL_MAX_OUTPUT_BYTES,
      },
      signal,
    );
    if (!uninstalled.ok)
      return (
        packageChangeRefusal(operation, input.serial, uninstalled.error) ??
        uninstalled
      );
    const verdict = parsePackageChangeOutput(uninstalled.value.stdout);
    if (verdict.status === "unknown")
      return err(
        new AnalysisOutputError(operation, "ADB returned no removal verdict", {
          capturedOutput: {
            stdout: uninstalled.value.stdout,
            stderr: uninstalled.value.stderr,
            truncated: false,
          },
        }),
      );
    if (verdict.status === "failure")
      return err(
        new AnalysisUnsupportedTargetError(
          operation,
          input.serial,
          verdict.reason,
        ),
      );
    return ok(
      createAnalysisExecution(
        {
          client,
          serial: input.serial,
          package_name: input.package,
        },
        provider,
        {
          limitations: [
            "Uninstall explicitly requests user 0 without data retention (-k); device enforcement is not independently verified",
          ],
        },
      ),
    );
  }

  private async startApp(
    operation: "start_adb_app",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: { readonly serial: string; readonly package: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const resolved = await runAdb(
      operation,
      { device: input.serial },
      selection,
      adbArguments(input.serial, [
        "shell",
        "cmd",
        "package",
        "resolve-activity",
        "--brief",
        "-c",
        "android.intent.category.LAUNCHER",
        input.package,
      ]),
      {
        timeoutMs: SHELL_TIMEOUT_MS,
        maxOutputBytes: PM_PATH_MAX_OUTPUT_BYTES,
        volatileOutput: true,
      },
      signal,
    );
    if (!resolved.ok) return resolved;
    const component = parseResolveActivityOutput(resolved.value.stdout);
    if (component === null)
      return err(
        new AnalysisUnsupportedTargetError(
          operation,
          input.serial,
          `No launcher activity is declared for ${input.package}`,
        ),
      );
    return this.runAmStart(
      operation,
      selection,
      client,
      provider,
      input.serial,
      ["-n", component],
      {
        client,
        serial: input.serial,
        package_name: input.package,
        component,
      },
      signal,
    );
  }

  private async startActivity(
    operation: "start_adb_activity",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: {
      readonly serial: string;
      readonly action: string;
      readonly data_uri?: string | undefined;
      readonly component?: string | undefined;
      readonly extras: readonly {
        readonly key: string;
        readonly type: "string" | "boolean" | "int" | "long" | "float";
        readonly value: string;
      }[];
    },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const extraFlags: Record<
      "string" | "boolean" | "int" | "long" | "float",
      string
    > = {
      string: "--es",
      boolean: "--ez",
      int: "--ei",
      long: "--el",
      float: "--ef",
    };
    const arguments_ = [
      "-a",
      input.action,
      ...(input.data_uri === undefined ? [] : ["-d", input.data_uri]),
      ...(input.component === undefined ? [] : ["-n", input.component]),
      ...input.extras.flatMap((extra) => [
        extraFlags[extra.type],
        extra.key,
        // Android decodes --ei with Integer.decode, whose leading zero is octal.
        // Encode decimal intent at this boundary; Evidence retains caller text.
        extra.type === "int"
          ? extra.value.replace(/^(-?)0+(?=\d)/u, "$1")
          : extra.value,
      ]),
    ];
    return this.runAmStart(
      operation,
      selection,
      client,
      provider,
      input.serial,
      arguments_,
      {
        client,
        serial: input.serial,
        action: input.action,
        data_uri: input.data_uri ?? null,
        component: input.component ?? null,
        extras: input.extras.map((extra) => ({ ...extra })),
      },
      signal,
    );
  }

  private async runAmStart(
    operation: "start_adb_app" | "start_adb_activity",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    serial: string,
    arguments_: readonly string[],
    resultFields: Record<string, unknown>,
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const started = await runAdb(
      operation,
      { device: serial },
      selection,
      adbArguments(serial, ["shell", "am", "start", "-W", ...arguments_]),
      { timeoutMs: SHELL_TIMEOUT_MS, maxOutputBytes: PM_PATH_MAX_OUTPUT_BYTES },
      signal,
    );
    let stdout: string;
    let stderr: string;
    let capturedOutput: ReturnType<typeof execFileFailureCapturedOutput>;
    let verdict: ReturnType<typeof parseAmStartOutput>;
    if (started.ok) {
      stdout = started.value.stdout;
      stderr = started.value.stderr;
      capturedOutput = { stdout, stderr, truncated: false };
      verdict = parseAmStartOutput(stdout, stderr);
    } else {
      const commandFailure = adbCommandOutputFailure(started.error);
      // AOSP ActivityManagerShellCommand returns 1 for class-not-found and
      // emits its refusal report on stdout. Other exits remain command errors.
      if (
        commandFailure === undefined ||
        commandFailure.code !== 1 ||
        commandFailure.signal !== null ||
        commandFailure.killed ||
        commandFailure.outputTruncated ||
        commandFailure.collectionFailure === true
      )
        return started;
      stdout = commandFailure.stdout;
      stderr = commandFailure.stderr;
      capturedOutput = execFileFailureCapturedOutput(commandFailure);
      // Stderr carries adb transport diagnostics, not the Activity Manager
      // report, so it cannot establish a target refusal on this path.
      verdict = parseAmStartOutput(stdout);
      if (verdict.status !== "refused" || verdict.startedActivity === null)
        return started;
    }
    const result = {
      ...resultFields,
      started_activity: verdict.startedActivity,
      reported_activity: verdict.activity,
      reported_status: verdict.reportedStatus,
    };
    if (verdict.status === "refused") {
      const partialObservation: AdbActivityStartPartialObservation =
        operation === "start_adb_app"
          ? {
              provider_id: "adb",
              operation,
              result: adbResultSchemas.start_adb_app.parse(result),
            }
          : {
              provider_id: "adb",
              operation,
              result: adbResultSchemas.start_adb_activity.parse(result),
            };
      return err(
        new AnalysisUnsupportedTargetError(
          operation,
          serial,
          verdict.reason ?? "am start refused the intent",
          { capturedOutput, partialObservation },
        ),
      );
    }
    return ok(
      createAnalysisExecution(result, provider, {
        rawResult: {
          stdout,
          stderr,
        },
        limitations: [
          "Starting an activity changes device state; am start -W waits for launch completion but no lifecycle observation is captured",
        ],
      }) as AnalysisExecution,
    );
  }

  private async stopApp(
    operation: "stop_adb_app",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: { readonly serial: string; readonly package: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const stopped = await runAdb(
      operation,
      { device: input.serial },
      selection,
      adbArguments(input.serial, ["shell", "am", "force-stop", input.package]),
      { timeoutMs: SHELL_TIMEOUT_MS, maxOutputBytes: PM_PATH_MAX_OUTPUT_BYTES },
      signal,
    );
    if (!stopped.ok) return stopped;
    return ok(
      createAnalysisExecution(
        {
          client,
          serial: input.serial,
          package_name: input.package,
        },
        provider,
        {
          limitations: [
            "Force-stop succeeds even for packages with no running process; it reports completion, not prior state",
          ],
        },
      ),
    );
  }

  private async captureScreen(
    operation: "capture_adb_screen",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: { readonly serial: string; readonly output_directory: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const directory = await prepareOutputDirectory(
      operation,
      input.output_directory,
    );
    if (!directory.ok) return directory;
    const localPath = appendCallerPath(directory.value, "screen.png");
    const existing = await refuseExistingTarget(operation, localPath);
    if (existing !== undefined) return err(existing);
    const captured = await runAdbCapture(
      operation,
      { device: input.serial },
      selection,
      adbArguments(input.serial, ["exec-out", "screencap", "-p"]),
      {
        timeoutMs: SCREEN_TIMEOUT_MS,
        maxOutputBytes: SCREEN_MAX_OUTPUT_BYTES,
        volatileOutput: true,
      },
      signal,
    );
    if (!captured.ok) return captured;
    if (signal?.aborted === true)
      return err(
        new AnalysisCancelledError(operation, { cause: signal.reason }),
      );
    const dimensions = readPngHeaderDimensions(captured.value.stdout);
    if (dimensions === undefined)
      return err(
        new AnalysisProtocolError(
          "screencap returned an invalid PNG header; the device may not expose a display",
        ),
      );
    return this.#withRuntimeRoot(
      operation,
      { serial: input.serial, output_directory: directory.value },
      { parent: directory.value, prefix: ".rea-screen-" },
      signal,
      async (stage, resources) => {
        let publicationCloseFailure: ScreenPublicationCloseFailure | undefined;
        let usedExclusiveFallback = false;
        try {
          const stagedPath = join(stage.path, "screen.png");
          await writeFile(stagedPath, captured.value.stdout, { flag: "wx" });
          await syncStagedAdbFile(stagedPath, resources, operation);
          if (signal?.aborted === true)
            return err(
              new AnalysisCancelledError(operation, { cause: signal.reason }),
            );
          try {
            // A same-filesystem hard link atomically publishes without replacing
            // caller output. Its success is the publication cutoff.
            await link(stagedPath, localPath);
          } catch (cause: unknown) {
            if (!hardLinksUnsupported(cause)) throw cause;
            // Exclusive creation prevents replacement, but makes the path
            // visible while the fallback writes the complete file.
            usedExclusiveFallback = true;
            publicationCloseFailure =
              (await publishScreenExclusively(
                localPath,
                captured.value.stdout,
                resources,
                operation,
                signal,
              )) ?? undefined;
          }
        } catch (cause: unknown) {
          if (cause instanceof AnalysisError) return err(cause);
          return err(
            new AnalysisOutputError(
              operation,
              `The screen output could not be published exclusively: ${localPath}`,
              { cause },
            ),
          );
        }
        const sha256 = createHash("sha256")
          .update(captured.value.stdout)
          .digest("hex");
        const completed = createAnalysisExecution(
          {
            client,
            serial: input.serial,
            local_path: localPath,
            bytes: captured.value.stdout.byteLength,
            sha256,
            width: dimensions.width,
            height: dimensions.height,
          },
          provider,
          {
            limitations: [
              "The capture is one frame at read time; no recording or interaction occurred",
              "PNG signature, IHDR framing, checksum, and dimensions are validated; encoding and image contents are not validated",
              ...(usedExclusiveFallback
                ? [
                    "The exclusive-create fallback makes the output path visible while its bytes are being written",
                  ]
                : []),
            ],
          },
        );
        if (publicationCloseFailure !== undefined) {
          const cleanupError = this.#cleanupError(
            operation,
            { serial: input.serial, output_directory: directory.value },
            [publicationCloseFailure.cause],
            [publicationCloseFailure.resource],
            completed,
          );
          publicationCloseFailure.bindCleanupError(cleanupError);
          return err(cleanupError);
        }
        return ok(completed);
      },
    );
  }

  private async collectBugreport(
    operation: "collect_adb_bugreport",
    selection: AdbBinarySelection,
    client: AdbClientResult,
    provider: AdbProviderIdentity,
    input: { readonly serial: string; readonly output_directory: string },
    signal: AbortSignal | undefined,
  ): Promise<Result<AnalysisExecution, AnalysisError>> {
    const directory = await prepareOutputDirectory(
      operation,
      input.output_directory,
    );
    if (!directory.ok) return directory;
    let stagingDirectory: string;
    let stagingIdentity: OutputDirectoryIdentity | undefined;
    let retainedObservation: AdbAcquiredFilePartialObservation | undefined;
    let publishedPath: string | undefined;
    try {
      stagingDirectory = await mkdtemp(
        appendCallerPath(directory.value, ".rea-bugreport-"),
      );
    } catch (cause) {
      return err(
        new AnalysisOutputError(
          operation,
          "The bugreport staging directory could not be created",
          { cause },
        ),
      );
    }
    const collectedResult = await (async (): Promise<
      Result<AnalysisExecution, AnalysisError>
    > => {
      let reportedPath: string | null = null;
      try {
        const created = await lstat(stagingDirectory);
        if (!created.isDirectory() || created.isSymbolicLink())
          throw new Error(
            `The created bugreport staging output is not a regular directory: ${stagingDirectory}`,
          );
        stagingIdentity = {
          dev: created.dev,
          ino: created.ino,
          mode: created.mode,
        };
        const collected = await runAdb(
          operation,
          { device: input.serial },
          selection,
          adbArguments(input.serial, ["bugreport", stagingDirectory]),
          {
            timeoutMs: BUGREPORT_TIMEOUT_MS,
            maxOutputBytes: BUGREPORT_MAX_OUTPUT_BYTES,
          },
          signal,
        );
        if (!collected.ok) return collected;
        reportedPath = parseBugreportCopiedPath(collected.value.stdout);
        if (reportedPath === null)
          return err(
            new AnalysisProtocolError(
              "adb bugreport did not report an archive path; the build may use an unsupported format",
            ),
          );
        const reportedParent = await stat(
          dirname(absoluteCallerPath(reportedPath)),
        );
        if (
          !reportedParent.isDirectory() ||
          reportedParent.dev !== stagingIdentity.dev ||
          reportedParent.ino !== stagingIdentity.ino
        )
          return err(
            new AnalysisProtocolError(
              `adb bugreport reported an archive outside its staging directory: ${reportedPath}`,
            ),
          );
        const archive = await lstat(reportedPath);
        if (!archive.isFile() || archive.isSymbolicLink())
          return err(
            new AnalysisProtocolError(
              `adb bugreport did not report a regular archive file: ${reportedPath}`,
            ),
          );
        retainedObservation = {
          provider_id: "adb",
          operation,
          result: {
            client,
            serial: input.serial,
            local_path: reportedPath,
            adb_reported_path: reportedPath,
            digest_status: "unknown",
          },
        };
        try {
          publishedPath = await publishBugreport(reportedPath, directory.value);
        } catch (cause) {
          return err(
            new AnalysisOutputError(
              operation,
              `The reported bugreport archive could not be published: ${reportedPath}`,
              { cause, partialObservation: retainedObservation },
            ),
          );
        }
        retainedObservation = {
          ...retainedObservation,
          result: { ...retainedObservation.result, local_path: publishedPath },
        };
        const digest = await hashAdbFile(
          publishedPath,
          operation,
          signal,
          this.#resources,
        );
        const report = {
          client,
          serial: input.serial,
          local_path: publishedPath,
          bytes: digest.bytes,
          sha256: digest.sha256,
          adb_reported_path: reportedPath,
        };
        retainedObservation = {
          provider_id: "adb",
          operation,
          result: report,
        };
        return ok(
          createAnalysisExecution(report, provider, {
            limitations: [
              "The archive is device-generated: dumpstate, dumpsys, and logcat content is the device's own report",
            ],
          }),
        );
      } catch (cause) {
        const cleanupError =
          retainedObservation === undefined
            ? undefined
            : adbDigestError(cause, operation, retainedObservation);
        if (cleanupError !== undefined) return err(cleanupError);
        if (cause instanceof AnalysisCancelledError) {
          if (retainedObservation !== undefined)
            cause.retainPartialObservation(retainedObservation);
          return err(cause);
        }
        return err(
          new AnalysisOutputError(
            operation,
            `The reported bugreport archive could not be read back: ${reportedPath ?? stagingDirectory}`,
            { cause, partialObservation: retainedObservation },
          ),
        );
      }
    })();
    // A completed acquisition becomes caller evidence even if publication fails.
    // Its staging directory must not enter automatic cleanup or cleanup retries.
    if (retainedObservation !== undefined && publishedPath === undefined)
      return collectedResult;
    try {
      await removeOwnedOutputDirectory(stagingDirectory, stagingIdentity);
    } catch (cause) {
      const primary = collectedResult.ok
        ? signal?.aborted === true
          ? new AnalysisCancelledError(operation, { cause: signal.reason })
          : new AnalysisOutputError(
              operation,
              "The archive was published, but its staging directory could not be removed",
            )
        : collectedResult.error;
      if (retainedObservation !== undefined)
        primary.retainPartialObservation(retainedObservation);
      return err(
        this.#retainOutputDirectoryCleanup(
          {
            operation,
            path: stagingDirectory,
            primary,
            remove: () =>
              removeOwnedOutputDirectory(stagingDirectory, stagingIdentity),
          },
          new ProviderCleanupError(
            ADB_PROVIDER_IDENTITY.id,
            [stagingDirectory],
            { reason: cause instanceof Error ? cause.message : String(cause) },
            { operation, cause },
          ),
        ),
      );
    }
    return collectedResult;
  }
}
