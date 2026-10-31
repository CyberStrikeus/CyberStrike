import type { Stats } from "node:fs";
import { open, realpath, stat } from "node:fs/promises";
import { isAbsolute, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { analysisErrorWithCleanupFailure } from "../domain/analysisErrorCleanup.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  ArtifactFileCleanupFailure,
  assertArtifactReadActive,
  bindArtifactFileCleanup,
  withArtifactFileHandle,
} from "../artifacts/ArtifactFileOperation.js";
import { asarNodeSchema } from "../artifacts/AsarNode.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  regularFileState,
  sameRegularFileState,
  type RegularFileState,
} from "../filesystem/RegularFile.js";

import {
  admitAsarHeader,
  asarHeaderAdmissionFailure,
} from "../artifacts/AsarHeader.js";
import {
  DEFAULT_ASAR_HEADER_ADMISSION,
  type AsarHeaderAdmission,
} from "../config/asarHeaderAdmission.js";

type ElectronFileOperation =
  | "inspect_electron_page"
  | "list_electron_targets"
  | "observe_javascript_runtime"
  | "list_javascript_runtime_targets";

/**
 * ASAR descriptor ownership for one host. Authorization and shutdown share
 * this scope so another host's file work does not block or fail this one.
 */
export class ElectronFileScope {
  readonly #resources = new ArtifactResourceScope();

  async authorize(
    value: string,
    signal?: AbortSignal,
    operation: ElectronFileOperation = "inspect_electron_page",
    asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
  ): Promise<string | undefined> {
    try {
      return await this.#resources.run(
        async () =>
          await resolveAuthorizedElectronFile(
            value,
            signal,
            asarHeaderAdmission,
            this.#resources,
          ),
      );
    } catch (cause: unknown) {
      if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
        throw cause;
      if (signal?.aborted === true)
        throw new AnalysisCancelledError(operation, { cause: signal.reason });
      throw cause;
    }
  }

  retryCleanup(): Promise<void> {
    return this.#resources.retryCleanup();
  }
}

/** Electron providers that do not pass a host scope. */
const processElectronFiles = new ElectronFileScope();

/** Resolve one local file URL while rejecting remote hosts and encoded separators. */
export const authorizedElectronFile = (
  value: string,
  signal?: AbortSignal,
  operation: ElectronFileOperation = "inspect_electron_page",
  asarHeaderAdmission: AsarHeaderAdmission = DEFAULT_ASAR_HEADER_ADMISSION,
  files: ElectronFileScope = processElectronFiles,
): Promise<string | undefined> =>
  files.authorize(value, signal, operation, asarHeaderAdmission);

/** Retry retained ASAR descriptor cleanup during provider shutdown. */
export const retryElectronFileCleanup = (
  files: ElectronFileScope = processElectronFiles,
): Promise<void> => files.retryCleanup();

/** Translate a retained ASAR descriptor failure at its provider boundary. */
export const mapElectronFileAuthorizationFailure = (
  cause: unknown,
  providerId: string,
  operation: ElectronFileOperation,
  diagnostics?: Readonly<Record<string, JsonValue>>,
): AnalysisError | undefined => {
  if (!(cause instanceof ArtifactReaderFailure) || cause.cleanup === undefined)
    return undefined;
  const physical =
    cause instanceof ArtifactFileCleanupFailure
      ? cause.fileCleanupFailure
      : undefined;
  const physicalPrimary =
    physical?.outcome.kind === "failed" ? physical.outcome.cause : undefined;
  const cancellationReason =
    physical?.completionCancellation === undefined
      ? physicalPrimary instanceof ArtifactReaderFailure &&
        physicalPrimary.reason === "cancelled"
        ? physicalPrimary.cancellation === undefined
          ? physicalPrimary.cause
          : physicalPrimary.cancellation.reason
        : undefined
      : physical.completionCancellation.reason;
  const hasCancellation =
    physical?.completionCancellation !== undefined ||
    (physicalPrimary instanceof ArtifactReaderFailure &&
      physicalPrimary.reason === "cancelled");
  const primary = hasCancellation
    ? new AnalysisCancelledError(operation, {
        cause: cancellationReason,
      })
    : physicalPrimary instanceof AnalysisError
      ? physicalPrimary
      : physicalPrimary === undefined
        ? undefined
        : new ProviderAdapterError(providerId, operation, {
            cause: physicalPrimary,
          });
  const cleanup = new ProviderCleanupError(
    providerId,
    cause.cleanup.resources,
    { reason: cause.cleanup.reason },
    { operation, cause },
  );
  bindArtifactFileCleanup(cause, cleanup);
  if (diagnostics !== undefined)
    (primary ?? cleanup).retainDiagnostics(diagnostics);
  if (primary === undefined) return cleanup;
  const composed = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    operation,
  ).bindCleanupDependencies([primary, cleanup]);
  bindArtifactFileCleanup(cause, composed);
  return composed;
};

const resolveAuthorizedElectronFile = async (
  value: string,
  signal: AbortSignal | undefined,
  asarHeaderAdmission: AsarHeaderAdmission,
  resources: ArtifactResourceScope,
): Promise<string | undefined> => {
  throwIfAborted(signal);
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    // Non-URL input cannot authorize a local file.
    void cause;
    return undefined;
  }
  if (
    url.protocol !== "file:" ||
    url.hostname !== "" ||
    url.username !== "" ||
    url.password !== "" ||
    /%(?:2f|5c)/iu.test(url.pathname)
  )
    return undefined;
  let path: string;
  try {
    path = fileURLToPath(url);
  } catch (cause: unknown) {
    // Unconvertible file URLs cannot authorize a local file.
    void cause;
    return undefined;
  }
  if (!isAbsolute(path) || path.includes("\0")) return undefined;
  try {
    const metadata = await stat(path);
    throwIfAborted(signal);
    if (metadata.isFile()) {
      const canonical = await realpath(path);
      throwIfAborted(signal);
      return canonical;
    }
  } catch (cause: unknown) {
    throwIfAborted(signal);
    // Electron serves packaged pages from inside app.asar, which the host
    // filesystem cannot stat; resolve those through the archive header below.
    void cause;
  }
  throwIfAborted(signal);
  return await authorizedAsarMember(
    path,
    signal,
    asarHeaderAdmission,
    resources,
  );
};

/**
 * Resolve `<archive>.asar/<member>` the way Electron's file protocol does: the
 * first `.asar` path component that is a regular file is the archive, and the
 * remainder must name a regular file in its header (packed or unpacked).
 */
const authorizedAsarMember = async (
  path: string,
  signal: AbortSignal | undefined,
  asarHeaderAdmission: AsarHeaderAdmission,
  resources: ArtifactResourceScope,
): Promise<string | undefined> => {
  const segments = path.split(sep);
  for (let index = 1; index < segments.length - 1; index += 1) {
    throwIfAborted(signal);
    if (!(segments[index] ?? "").toLowerCase().endsWith(".asar")) continue;
    const archive = segments.slice(0, index + 1).join(sep);
    const member = segments.slice(index + 1);
    if (member.some((part) => part === "" || part === "." || part === ".."))
      return undefined;
    try {
      const metadata = await stat(archive);
      throwIfAborted(signal);
      if (!metadata.isFile()) continue;
      const canonical = await realpath(archive);
      throwIfAborted(signal);
      const files = await asarFiles(
        canonical,
        metadata,
        asarHeaderAdmission,
        signal,
        resources,
      );
      throwIfAborted(signal);
      return isAsarRegularFile(files, member)
        ? join(canonical, ...member)
        : undefined;
    } catch (cause: unknown) {
      if (cause instanceof ArtifactFileCleanupFailure) throw cause;
      if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined)
        throw cause;
      throwIfAborted(signal);
      // An unreadable or malformed archive cannot authorize its members.
      void cause;
      return undefined;
    }
  }
  return undefined;
};

// This is a retained-memory budget for JSON headers, shared across all archives.
const MAX_CACHED_HEADERS = 8;
const headerCache = new Map<
  string,
  {
    readonly identity: RegularFileState;
    readonly files: unknown;
    readonly bytes: number;
    readonly headerBytes: number;
  }
>();
/** Read the two Chromium pickle headers on one handle before allocating JSON. */
const asarFiles = async (
  archive: string,
  metadata: Stats,
  admission: AsarHeaderAdmission,
  signal?: AbortSignal,
  resources?: ArtifactResourceScope,
): Promise<unknown> => {
  throwIfAborted(signal);
  const identity = regularFileState(metadata);
  const cached = headerCache.get(archive);
  if (cached !== undefined && sameRegularFileState(cached.identity, metadata)) {
    // A header cached under a larger caller's admission stays refused here.
    if (cached.headerBytes > admission.maximumBytes)
      throw asarHeaderAdmissionFailure(admission, cached.headerBytes);
    return cached.files;
  }
  const handle = await open(archive, "r");
  const admitted = await withArtifactFileHandle(
    archive,
    handle,
    resources,
    signal,
    async (file) => {
      let jsonBytes: number;
      let headerBytes: number;
      throwIfAborted(signal);
      const opened = await file.stat();
      throwIfAborted(signal);
      if (!sameRegularFileState(identity, opened))
        throw new Error("ASAR identity changed before header read");
      const header = await admitAsarHeader(file, signal, admission);
      throwIfAborted(signal);
      jsonBytes = header.jsonBytes;
      headerBytes = header.headerBytes;
      const json = Buffer.alloc(jsonBytes);
      let offset = 0;
      while (offset < json.length) {
        throwIfAborted(signal);
        const part = await file.read(
          json,
          offset,
          json.length - offset,
          16 + offset,
        );
        throwIfAborted(signal);
        if (part.bytesRead === 0) throw new Error("Truncated ASAR JSON header");
        offset += part.bytesRead;
      }
      const afterRead = await file.stat();
      throwIfAborted(signal);
      if (!sameRegularFileState(identity, afterRead))
        throw new Error("ASAR identity changed during header read");
      const parsed: unknown = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(json),
      );
      if (!isRecord(parsed) || !isRecord(parsed.files))
        throw new Error("ASAR header has no file tree");
      return { files: parsed.files, jsonBytes, headerBytes };
    },
  );
  throwIfAborted(signal);
  headerCache.delete(archive);
  headerCache.set(archive, {
    identity,
    files: admitted.files,
    bytes: admitted.jsonBytes,
    headerBytes: admitted.headerBytes,
  });
  const retainedBytes = () =>
    [...headerCache.values()].reduce((sum, entry) => sum + entry.bytes, 0);
  while (
    headerCache.size > MAX_CACHED_HEADERS ||
    retainedBytes() > admission.maximumBytes
  )
    headerCache.delete(headerCache.keys().next().value ?? archive);
  return admitted.files;
};

// File authorization interprets structure and size, not optional integrity or
// executable declarations that belong to artifact analysis.
const asarFileScopeNodeSchema = asarNodeSchema
  .pick({ files: true, link: true, size: true })
  .strip();

const isAsarRegularFile = (
  files: unknown,
  member: readonly string[],
): boolean => {
  let node: unknown = { files };
  for (const part of member) {
    // Electron follows a directory link before looking up its child. Its
    // co-declared file tree cannot establish the requested member's identity;
    // link resolution is outside this authorization boundary.
    if (!isRecord(node) || Object.hasOwn(node, "link")) return false;
    const children = node.files;
    if (!isRecord(children) || !Object.hasOwn(children, part)) return false;
    node = children[part];
  }
  const parsed = asarFileScopeNodeSchema.safeParse(node);
  return (
    parsed.success &&
    parsed.data.size !== undefined &&
    parsed.data.files === undefined &&
    parsed.data.link === undefined
  );
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const throwIfAborted = (signal?: AbortSignal): void => {
  assertArtifactReadActive(signal);
};
