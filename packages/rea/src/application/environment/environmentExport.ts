import { isAbsolute } from "node:path";
import { getHeapStatistics } from "node:v8";

import { AnalysisError } from "../../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../../domain/analysisErrorCleanup.js";
import {
  AnalysisAccessDeniedError,
  AnalysisArtifactChangedError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
  type AnalysisInputIssue,
} from "../../domain/analysisErrorCore.js";
import type { JsonValue } from "../../domain/jsonValue.js";
import type { Evidence } from "../../domain/evidence.js";
import { evidenceFileBytes } from "./environmentEvidenceBytes.js";
import { err, ok, type Result } from "../../domain/result.js";
import { RegularFileChangedError } from "../../filesystem/RegularFile.js";
import {
  bindArtifactFileCleanup,
  ArtifactFileCleanupFailure,
} from "../../artifacts/ArtifactFileOperation.js";
import { AnalysisCleanupLease } from "../../artifacts/AnalysisCleanupLease.js";
import { ArtifactResourceScope } from "../../artifacts/ArtifactResourceScope.js";
import { RegularFileCleanupFailure } from "../../filesystem/OwnedRegularFile.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  BundleFileHostFailure,
  bundleTarballDigest,
  packageTarballRefusal,
  withBundleTarball,
  writeEnvironmentBundle,
} from "./environmentBundleWrite.js";
import { sealOwnedJsonInput } from "../OwnedJsonInput.js";
import { nativeJsonParseRequiredBytes } from "../JsonInputFile.js";
import { readRegularFile } from "../RegularFileRead.js";
import {
  JSON_INPUT_RESOURCE_REMEDIATION,
  parseUtf8Json,
} from "../Utf8JsonInput.js";
import {
  ENVIRONMENT_EXPORT_OPERATION,
  planEnvironmentBundle,
  registryPackageSource,
  type EnvironmentPackageSource,
} from "./environmentBundle.js";
import type { EnvironmentSource } from "./environmentSource.js";
import { prepareServedState, type PreparedState } from "./environmentState.js";

/** One input file read once: the bytes the bundle copies and the value they parse to. */
export interface EnvironmentExportFile {
  readonly path: string;
  readonly bytes: Buffer;
  readonly value: unknown;
}

/** The manifest and capture files as read for authentication and copying. */
export interface EnvironmentExportInputs {
  readonly manifest: EnvironmentExportFile;
  readonly evidence: EnvironmentExportFile;
}

export interface EnvironmentExportInput extends EnvironmentExportInputs {
  /** The authenticated pair the bundle serves, loaded from the parsed values of the two files. */
  readonly source: EnvironmentSource;
  /** The state already prepared under `name` from the evidence value; prepared here when absent. */
  readonly served?: PreparedState | undefined;
  /** Refuse an existing directory and never create its parent; otherwise an empty directory is accepted. */
  readonly exclusiveDestination?: boolean | undefined;
  /** Absolute bundle root; absent or empty. */
  readonly directory: string;
  readonly name?: string | undefined;
  /** Absolute path of a packed CLI tarball the Dockerfile installs instead of the registry package. */
  readonly packageTarball?: string | undefined;
}

/** One written file with its size, as the command reports it. */
export interface WrittenBundleFile {
  readonly path: string;
  readonly bytes: number;
}

export interface EnvironmentExportResult {
  readonly status: "exported";
  readonly directory: string;
  readonly name: string;
  /** Tools the bundle serves. */
  readonly tool_count: number;
  readonly evidence_id: string;
  readonly manifest_evidence_id: string;
  /** Whether the bundle serves from the state the export derived, as `environment-serve` reports it. */
  readonly state: PreparedState["report"];
  readonly package_source: JsonValue;
  readonly files: readonly WrittenBundleFile[];
}

const inputError = (
  operation: string,
  issue: AnalysisInputIssue,
  userMessage: string,
): AnalysisInputError =>
  new AnalysisInputError(operation, { userMessage }, [issue]);

const systemCode = (cause: unknown): string | undefined =>
  cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;

/** Recovery for a host write failure that may leave partial output behind. */
const hostWriteFailure = (directory: string) => ({
  userMessage: `Writing the environment bundle to ${directory} failed on the host; the details name the cause and, when it failed on one bundle file, that file.`,
  remediationAction: `Resolve the reported host failure (for example, choose a shorter destination path or free disk space). Inspect ${directory} and remove any partial output this export wrote before retrying, since a retry refuses a non-empty directory.`,
  diagnostics: { output_directory: directory },
});

/** Recovery for a host failure reading the package tarball during the copy. */
const hostReadFailure = (source: string, directory: string) => ({
  userMessage: `Reading ${source} failed on the host while writing the environment bundle to ${directory}; the details name the cause.`,
  remediationAction: `Resolve the reported host failure reading ${source}. Inspect ${directory} and remove any partial output this export wrote before retrying, since a retry refuses a non-empty directory.`,
  diagnostics: { output_directory: directory },
});

/** The host failure beneath a wrapper, whose message names its code and absolute path. */
const hostSystemError = (cause: Error): Error | undefined => {
  const seen = new Set<unknown>([cause]);
  let current = cause.cause;
  while (current instanceof Error && !seen.has(current)) {
    if (systemCode(current) !== undefined) return current;
    seen.add(current);
    current = current.cause;
  }
  return undefined;
};

const accessDeniedError = (
  cause: unknown,
  path: string,
  diagnostics?: Readonly<Record<string, JsonValue>>,
  access: "read" | "write" = "read",
  operation: string = ENVIRONMENT_EXPORT_OPERATION,
): AnalysisAccessDeniedError | AnalysisOutputError | undefined => {
  const seen = new Set<Error>();
  let current = cause;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof BundleFileHostFailure)
      access = current.operation === "reading" ? "read" : "write";
    const code = systemCode(current);
    if (code === "EACCES" || code === "EPERM") {
      const options = {
        cause,
        ...(diagnostics === undefined ? {} : { diagnostics }),
        ...(cause instanceof ArtifactReaderFailure &&
        cause.cleanup !== undefined
          ? { cleanup: cause.cleanup }
          : {}),
      };
      const error =
        access === "read"
          ? new AnalysisAccessDeniedError(operation, path, code, options)
          : new AnalysisOutputError(
              operation,
              `Host filesystem permissions denied write access: ${path}`,
              {
                ...options,
                userMessage: `Host filesystem permissions denied writing the environment bundle at ${path}.`,
                remediationAction:
                  "Check write access or select a writable destination. Inspect the output directory for partial output before retrying; export refuses a non-empty directory.",
                diagnostics: {
                  ...diagnostics,
                  path,
                  system_code: code,
                  boundary: "filesystem-write",
                },
              },
            );
      bindArtifactFileCleanup(cause, error);
      return error;
    }
    current = current.cause;
  }
  return undefined;
};

/** The absolute path a host failure beneath wrappers names, if it names one. */
const hostFailurePath = (cause: unknown): string | undefined => {
  const seen = new Set<unknown>();
  let current = cause;
  while (current instanceof Error && !seen.has(current)) {
    seen.add(current);
    if (current instanceof BundleFileHostFailure) return current.path;
    const path = Reflect.get(current, "path");
    if (systemCode(current) !== undefined && typeof path === "string")
      return isAbsolute(path) ? path : undefined;
    current = current.cause;
  }
  return undefined;
};

/** A path that is not a readable regular file, including inline JSON text offered as one. */
const NOT_A_FILE_CODES = new Set([
  "ENOENT",
  "EISDIR",
  "ENOTFILE",
  "ENOTDIR",
  "ENAMETOOLONG",
]);

/** Refuse a whole read, native parse and owned snapshot traversal that cannot fit live heap headroom. */
const headroomRefusal = (
  operation: string,
  path: string,
  inputBytes: number,
): AnalysisResourceConstraintError | undefined => {
  const heap = getHeapStatistics();
  const requiredBytes = nativeJsonParseRequiredBytes(inputBytes, true);
  return requiredBytes <= heap.total_available_size
    ? undefined
    : new AnalysisResourceConstraintError(
        operation,
        "memory",
        "Insufficient heap headroom to read, parse and seal the complete JSON file",
        {
          input_path: path,
          input_file_bytes: inputBytes,
          required_heap_bytes: requiredBytes,
          available_heap_bytes: heap.total_available_size,
          heap_size_limit_bytes: heap.heap_size_limit,
        },
        { remediationAction: JSON_INPUT_RESOURCE_REMEDIATION },
      );
};

/** Measure and admit every serialized copy before allocating its buffer. */
export const environmentExportEvidenceFile = async (
  role: "manifest" | "evidence",
  path: string,
  evidence: Evidence,
  operation: string = ENVIRONMENT_EXPORT_OPERATION,
): Promise<Result<EnvironmentExportFile, AnalysisError>> => {
  try {
    const bytes = evidenceFileBytes(evidence, (size) => {
      const refused = headroomRefusal(operation, path, size);
      if (refused !== undefined) throw refused;
    });
    return await environmentExportFile(role, path, bytes, { operation });
  } catch (cause: unknown) {
    if (cause instanceof AnalysisResourceConstraintError) return err(cause);
    throw cause;
  }
};

/** Parse and seal bytes the bundle will copy, so authentication reads exactly what ships. */
export const environmentExportFile = async (
  role: "manifest" | "evidence",
  path: string,
  bytes: Buffer,
  context: {
    operation?: string;
    fieldPath?: AnalysisInputIssue["path"] | undefined;
  } = {},
): Promise<Result<EnvironmentExportFile, AnalysisError>> => {
  const operation = context.operation ?? ENVIRONMENT_EXPORT_OPERATION;
  const refusal = headroomRefusal(operation, path, bytes.length);
  if (refusal !== undefined) return err(refusal);
  let parsed: ReturnType<typeof parseUtf8Json>;
  try {
    parsed = parseUtf8Json(bytes, operation, path);
  } catch (cause: unknown) {
    if (cause instanceof AnalysisResourceConstraintError) return err(cause);
    throw cause;
  }
  if (!parsed.ok)
    return err(
      inputError(
        operation,
        {
          path: context.fieldPath ?? [role],
          reason: "invalid_format",
          expected: "JSON",
          message: parsed.error,
        },
        `${path} is not valid JSON: ${parsed.error}`,
      ),
    );
  const snapshot = await sealOwnedJsonInput(parsed.value, operation);
  if (!snapshot.ok) return snapshot;
  return ok({ path, bytes, value: snapshot.value });
};

/** Read one input once: the same bytes are parsed for authentication and copied into the bundle. */
export const readEnvironmentExportFile = async (
  role: "manifest" | "evidence",
  path: string,
  operation: string = ENVIRONMENT_EXPORT_OPERATION,
  fieldPath?: AnalysisInputIssue["path"],
): Promise<Result<EnvironmentExportFile, AnalysisError>> => {
  const resources = new ArtifactResourceScope();
  let bytes: Buffer;
  try {
    // Admit the whole read against the opened file's own size, before materializing the
    // exact bytes the bundle copies.
    bytes = await readRegularFile(path, {
      resources,
      admit: (state) => {
        const refused = headroomRefusal(operation, path, state.size);
        if (refused !== undefined) throw refused;
      },
    });
  } catch (cause: unknown) {
    if (cause instanceof RegularFileCleanupFailure) {
      const failure = new ArtifactFileCleanupFailure(
        cause,
        AnalysisCleanupLease.forCloseOwner(cause.owner, path),
      );
      const cleanup = new AnalysisOutputError(
        operation,
        `Could not confirm closing the ${role} input file.`,
        {
          cause: failure,
          cleanup: failure.cleanup,
          diagnostics: { input_path: path, input_role: role },
        },
      );
      bindArtifactFileCleanup(failure, cleanup);
      const primary =
        cause.outcome.kind === "failed" ? cause.outcome.cause : undefined;
      return err(
        primary instanceof AnalysisError
          ? analysisErrorWithCleanupFailure(
              primary,
              cleanup,
              operation,
            ).bindCleanupDependencies([primary, cleanup])
          : cleanup,
      );
    }
    if (cause instanceof AnalysisResourceConstraintError) return err(cause);
    if (cause instanceof RegularFileChangedError)
      return err(
        inputError(
          operation,
          {
            path: fieldPath ?? [role],
            reason: "invalid_value",
            expected: "one stable regular file snapshot",
            message: `The ${role} file changed while it was read.`,
          },
          `${path} changed while being read; retry with stable input files.`,
        ),
      );
    if (NOT_A_FILE_CODES.has(systemCode(cause) ?? ""))
      return err(
        inputError(
          operation,
          {
            path: fieldPath ?? [role],
            reason: "invalid_value",
            message:
              fieldPath === undefined
                ? `The ${role} argument must be a readable file path; inline JSON cannot be exported.`
                : "The selected source path must be a readable regular file.",
          },
          `${path} could not be read as the ${role} file.`,
        ),
      );
    const denied = accessDeniedError(cause, path, undefined, "read", operation);
    if (denied !== undefined) return err(denied);
    throw cause;
  }
  return environmentExportFile(role, path, bytes, { operation, fieldPath });
};

/** Read both files once; the caller authenticates the parsed values and the export copies the same bytes. */
export const readEnvironmentExportInputs = async (
  manifestPath: string,
  evidencePath: string,
): Promise<Result<EnvironmentExportInputs, AnalysisError>> => {
  const manifest = await readEnvironmentExportFile("manifest", manifestPath);
  if (!manifest.ok) return manifest;
  const evidence = await readEnvironmentExportFile("evidence", evidencePath);
  if (!evidence.ok) return evidence;
  return ok({ manifest: manifest.value, evidence: evidence.value });
};

const packageSourceValue = (source: EnvironmentPackageSource): JsonValue =>
  source.kind === "registry"
    ? { kind: "registry", specifier: source.specifier }
    : { kind: "tarball", path: source.path };

const changedArtifact = (
  cause: RegularFileChangedError,
): AnalysisArtifactChangedError =>
  new AnalysisArtifactChangedError(
    ENVIRONMENT_EXPORT_OPERATION,
    cause.path,
    cause.message,
    { cause },
  );

/** A reader failure as an output refusal that keeps an unconfirmed cleanup bound to its owner. */
const readerFailureError = (
  cause: ArtifactReaderFailure,
  directory: string | undefined,
): AnalysisOutputError => {
  const host = hostSystemError(cause);
  const error = new AnalysisOutputError(
    ENVIRONMENT_EXPORT_OPERATION,
    host === undefined ? cause.message : `${cause.message}: ${host.message}`,
    {
      cause,
      // Only a host failure gets host recovery; an integrity or other
      // refusal keeps its own message without disk-space advice.
      ...(cause.cleanup !== undefined
        ? { cleanup: cause.cleanup }
        : directory === undefined
          ? {}
          : host === undefined
            ? { diagnostics: { output_directory: directory } }
            : hostWriteFailure(directory)),
    },
  );
  bindArtifactFileCleanup(cause, error);
  return error;
};

/** The package tarball's size after the same complete read and integrity check export uses. */
export const packageTarballBytes = async (
  path: string,
): Promise<Result<number, AnalysisError>> => {
  try {
    return ok(
      await withBundleTarball(path, async (tarball) => {
        await bundleTarballDigest(tarball);
        return tarball.size;
      }),
    );
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    if (cause instanceof RegularFileChangedError)
      return err(changedArtifact(cause));
    if (cause instanceof ArtifactReaderFailure)
      return err(readerFailureError(cause, undefined));
    if (cause instanceof BundleFileHostFailure)
      return err(packageTarballRefusal(path, cause));
    if (systemCode(cause) !== undefined)
      return err(packageTarballRefusal(path, cause));
    throw cause;
  }
};

/** Export the authenticated pair as an agent environment bundle folder. */
export const exportEnvironmentBundle = async (
  input: EnvironmentExportInput,
): Promise<Result<EnvironmentExportResult, AnalysisError>> => {
  const packageSource: EnvironmentPackageSource =
    input.packageTarball === undefined
      ? registryPackageSource()
      : { kind: "tarball", path: input.packageTarball };
  // The bundle's server prepares the state at startup; preparing it here, once the name is checked, predicts what it serves.
  const plan = planEnvironmentBundle(input.source, {
    name: input.name,
    packageSource,
    served: (name) =>
      input.served ??
      prepareServedState(input.source, input.evidence.value, {
        name,
        operation: ENVIRONMENT_EXPORT_OPERATION,
      }),
  });
  if (!plan.ok) return plan;
  let files: readonly WrittenBundleFile[];
  try {
    files = await writeEnvironmentBundle(input, plan.value);
  } catch (cause: unknown) {
    if (cause instanceof AnalysisError) return err(cause);
    // A refused bundle write names the path the host refused, which may be a
    // nested file after earlier files were written into the directory.
    const denied = accessDeniedError(
      cause,
      hostFailurePath(cause) ?? input.directory,
      { output_directory: input.directory },
      cause instanceof BundleFileHostFailure && cause.operation === "reading"
        ? "read"
        : "write",
    );
    if (denied !== undefined) return err(denied);
    if (cause instanceof RegularFileChangedError)
      return err(changedArtifact(cause));
    if (cause instanceof ArtifactReaderFailure)
      return err(readerFailureError(cause, input.directory));
    if (
      cause instanceof BundleFileHostFailure ||
      (cause instanceof Error && systemCode(cause) !== undefined)
    )
      return err(
        new AnalysisOutputError(ENVIRONMENT_EXPORT_OPERATION, cause.message, {
          cause,
          ...(cause instanceof BundleFileHostFailure &&
          cause.operation === "reading"
            ? hostReadFailure(cause.path, input.directory)
            : hostWriteFailure(input.directory)),
        }),
      );
    throw cause;
  }
  return ok({
    status: "exported",
    directory: input.directory,
    name: plan.value.name,
    tool_count: plan.value.toolCount,
    evidence_id: input.source.evidenceId,
    manifest_evidence_id: input.source.manifestEvidenceId,
    state: plan.value.state,
    package_source: packageSourceValue(plan.value.packageSource),
    files,
  });
};
