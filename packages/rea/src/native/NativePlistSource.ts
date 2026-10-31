import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import { stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { FileHandle } from "node:fs/promises";
import type { z } from "zod";
import type { inspectPlistSchema } from "../domain/native/nativeInspection.js";
import type { ResolvedAppBundleResourceRoot } from "../application/AppBundleExecutable.js";
import type {
  AnalysisError,
  AnalysisErrorOptions,
} from "../domain/analysisErrorBase.js";
import {
  AnalysisArtifactChangedError,
  AnalysisCancelledError,
  AnalysisCapabilityUnavailableError,
  AnalysisInputError,
  AnalysisResourceConstraintError,
} from "../domain/analysisErrorCore.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { fixedAllowanceOptions } from "../domain/fixedAllowanceRemediation.js";
import { err, ok, type Result } from "../domain/result.js";
import { sameRegularFileState } from "../filesystem/RegularFile.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  ArtifactFileCleanupFailure,
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  artifactFileCancellationCause,
  bindArtifactFileCleanup,
  assertArtifactReadActive,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { NATIVE_MACOS_PROVIDER_IDENTITY as IDENTITY } from "./NativeMacOSProviderMetadata.js";
import {
  MAX_NATIVE_PLIST_BYTES,
  NATIVE_PLIST_INPUT_ALLOWANCE,
} from "./parsers/plist.js";

/** Resolved lookup identity and selection intent, independent of file readiness. */
export interface NativePlistSelection {
  readonly path: string;
  readonly origin: "selected" | "default";
}

/** Resolve intent once; consumers never infer it from an omitted tool argument. */
export const resolveNativePlistSelection = async (
  target: BinaryTarget,
  requested: string | undefined,
): Promise<Result<NativePlistSelection, AnalysisError>> => {
  try {
    if (requested !== undefined && isAbsolute(requested))
      return ok({ path: absoluteCallerPath(requested), origin: "selected" });
    if (
      requested === undefined &&
      target.kind === "artifact" &&
      target.format === "plist"
    )
      return ok({ path: target.path, origin: "selected" });
    const source = target.sourcePath ?? target.path;
    const sourceMetadata = await stat(source);
    const root = sourceMetadata.isDirectory()
      ? source
      : (macOSBundleRoot(target.path) ?? dirname(target.path));
    if (requested !== undefined)
      return ok({
        path: absoluteCallerPath(requested, { cwd: root }),
        origin: "selected",
      });
    return ok({
      path: target.bundleInfoPlist ?? resolve(root, "Contents/Info.plist"),
      origin: "default",
    });
  } catch (cause: unknown) {
    return err(
      new ProviderAdapterError(IDENTITY.id, "inspect_plist", { cause }),
    );
  }
};

/** Resolve a plist selection from the separately identified app resource root. */
export const resolveBundleResourcePlistSelection = (
  root: ResolvedAppBundleResourceRoot,
  requested: string | undefined,
): Result<NativePlistSelection, AnalysisError> => {
  if (requested === undefined)
    return ok({ path: root.infoPlistPath, origin: "default" });
  return ok({
    path: absoluteCallerPath(requested, { cwd: root.canonicalPath }),
    origin: "selected",
  });
};

/** The bundle whose Contents/MacOS directory directly holds the program. */
const macOSBundleRoot = (path: string): string | undefined => {
  const programs = dirname(path);
  const contents = dirname(programs);
  return basename(programs) === "MacOS" && basename(contents) === "Contents"
    ? dirname(contents)
    : undefined;
};

/**
 * Report a plist that cannot be decoded as the caller's selection, or as the
 * target's missing default, rather than as a failed tool run.
 */
export const unreadablePlist = (
  selection: NativePlistSelection,
  reason: string,
  options?: AnalysisErrorOptions,
): AnalysisError => {
  const { path } = selection;
  const sentence = reason.endsWith(".") ? reason : `${reason}.`;
  // Name the default that is missing and the selection that still works.
  const missingDefault = `The target has no readable default plist at ${path}: ${sentence} Select another plist in the target with the path input (CLI: --relative-path).`;
  return selection.origin === "default"
    ? new AnalysisCapabilityUnavailableError(
        IDENTITY.id,
        "inspect_plist",
        missingDefault,
        { ...options, userMessage: missingDefault },
      )
    : new AnalysisInputError("inspect_plist", options, [
        {
          path: ["path"],
          reason: "invalid_value",
          message: `Cannot inspect ${path}: ${sentence}`,
        },
      ]);
};

interface PlistFileInput {
  readonly selection: NativePlistSelection;
  readonly resources: ArtifactResourceScope;
  readonly signal: AbortSignal | undefined;
}

/** Translate only physical file outcomes, never a later signal or arbitrary abort value. */
export const nativePlistFailure = (
  cause: unknown,
  selection: NativePlistSelection | undefined,
): AnalysisError => {
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const physical =
      cause instanceof ArtifactFileCleanupFailure
        ? cause.fileCleanupFailure
        : undefined;
    const previous =
      physical?.outcome.kind === "failed"
        ? nativePlistPrimaryFailure(artifactFilePrimaryFacts(cause), selection)
        : physical?.completionCancellation === undefined
          ? undefined
          : new AnalysisCancelledError("inspect_plist", {
              cause: physical.completionCancellation.reason,
            });
    const previousProjection =
      previous === undefined ? null : projectAnalysisError(previous);
    const failure = new ProviderCleanupError(
      IDENTITY.id,
      cause.cleanup.resources,
      {
        reason: cause.cleanup.reason,
        previous_error: previousProjection,
      },
      {
        operation: "inspect_plist",
        cause,
        cleanupPrimary: previous,
      },
    );
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  return nativePlistPrimaryFailure(artifactFilePrimaryFacts(cause), selection);
};

const nativePlistPrimaryFailure = (
  { cause, origin }: ArtifactFilePrimaryFacts,
  selection: NativePlistSelection | undefined,
): AnalysisError => {
  if (origin === "owned-or-classified") {
    if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
      return new AnalysisCancelledError("inspect_plist", {
        cause: artifactFileCancellationCause(cause),
      });
    if (
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "unavailable"
    )
      return new AnalysisCapabilityUnavailableError(
        IDENTITY.id,
        "inspect_plist",
        cause.message,
        { cause },
      );
    if (
      selection !== undefined &&
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "integrity"
    )
      return new AnalysisArtifactChangedError(
        "inspect_plist",
        selection.path,
        cause.message,
        { cause },
      );
    if (cause instanceof ArtifactReaderFailure && cause.reason === "limit") {
      const resource = cause.boundary ?? "memory";
      return resource === "file-size"
        ? new AnalysisResourceConstraintError(
            "inspect_plist",
            resource,
            cause.message,
            { maximum_input_bytes: MAX_NATIVE_PLIST_BYTES },
            {
              cause,
              ...fixedAllowanceOptions(NATIVE_PLIST_INPUT_ALLOWANCE, "input"),
            },
          )
        : new AnalysisResourceConstraintError(
            "inspect_plist",
            resource,
            cause.message,
            null,
            { cause, retryable: false },
          );
    }
  }
  if (selection === undefined)
    return new ProviderAdapterError(IDENTITY.id, "inspect_plist", {
      cause,
      diagnostics: {
        phase: "plist-scope",
        reason: cause instanceof Error ? cause.message : String(cause),
      },
    });
  const { path } = selection;
  const code =
    cause instanceof Error && "code" in cause ? cause.code : undefined;
  if (code === "ENOENT" || code === "ENOTDIR")
    return unreadablePlist(selection, "no file exists there", {
      cause,
    });
  if (code === "EISDIR" || code === "ENOTFILE")
    return unreadablePlist(selection, "it is not a regular file", {
      cause,
    });
  if (code === "ELOOP" || code === "ENAMETOOLONG")
    return unreadablePlist(
      selection,
      code === "ELOOP"
        ? "symbolic-link traversal looped or exceeded the host limit (ELOOP)"
        : "the path exceeds the host path or component length limit (ENAMETOOLONG)",
      { cause },
    );
  if (code === "EACCES" || code === "EPERM")
    return new BinaryTargetError(
      path,
      `permission denied while reading plist (${code})`,
      { cause },
    );
  return new ProviderAdapterError(IDENTITY.id, "inspect_plist", {
    cause,
    diagnostics: {
      path,
      phase: "plist-file",
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};

const readPlistFile = async <Value>(
  input: PlistFileInput,
  read: (file: FileHandle) => Promise<Value>,
): Promise<Result<Value, AnalysisError>> => {
  try {
    return ok(
      await withArtifactRegularFile(
        input.selection.path,
        input.resources,
        input.signal,
        ({ handle }) => read(handle),
        "follow",
      ),
    );
  } catch (cause: unknown) {
    return err(nativePlistFailure(cause, input.selection));
  }
};

/** Shared admission verifies one readable regular descriptor without blocking on pipes. */
export const requireRegularPlist = (
  input: PlistFileInput,
): Promise<Result<null, AnalysisError>> =>
  readPlistFile(input, async () => null);

/** Read bounded source bytes through the same retained descriptor owner. */
export const readNativePlistBytes = (
  input: PlistFileInput,
): Promise<Result<Buffer, AnalysisError>> =>
  readPlistFile(input, async (file) => {
    const before = await file.stat({ bigint: true });
    if (before.size > BigInt(MAX_NATIVE_PLIST_BYTES))
      throw new ArtifactReaderFailure(
        "limit",
        `Selected plist exceeds ${String(MAX_NATIVE_PLIST_BYTES)} bytes: ${input.selection.path}. This release has no runtime override for this ${String(MAX_NATIVE_PLIST_BYTES)}-byte allowance.`,
        { boundary: "file-size" },
      );
    const bytes = Buffer.allocUnsafe(Number(before.size));
    let position = 0;
    while (position < bytes.length) {
      assertArtifactReadActive(input.signal);
      const length = Math.min(64 * 1024, bytes.length - position);
      const { bytesRead } = await file.read(bytes, position, length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
    }
    const after = await file.stat({ bigint: true });
    if (after.size > BigInt(MAX_NATIVE_PLIST_BYTES))
      throw new ArtifactReaderFailure(
        "limit",
        `Selected plist grew beyond ${String(MAX_NATIVE_PLIST_BYTES)} bytes: ${input.selection.path}. This release has no runtime override for this ${String(MAX_NATIVE_PLIST_BYTES)}-byte allowance.`,
        { boundary: "file-size" },
      );
    if (
      !sameRegularFileState(before, after) ||
      BigInt(position) !== before.size
    )
      throw new ArtifactReaderFailure(
        "integrity",
        `Selected plist changed during read: ${input.selection.path}`,
      );
    assertArtifactReadActive(input.signal);
    return bytes;
  });

/**
 * Bytes examined for leading markup when `file` reports only text.
 * This is a probe window, not a document cap, and has no runtime override.
 */
const PLIST_MARKUP_PROBE_BYTES = 4096;

/** Source classification remains independent of plutil's converted value format. */
export const plistSourceFormat = async (
  description: string,
  input: PlistFileInput,
): Promise<
  Result<z.infer<typeof inspectPlistSchema>["format"], AnalysisError>
> => {
  if (isBinaryPlistDescription(description)) return ok("binary");
  if (/\bXML\b/iu.test(description)) return ok("xml");
  if (/\bJSON\b/iu.test(description)) return ok("json");
  if (!/\btext\b/iu.test(description)) return ok("unknown");
  return readPlistFile(input, async (file) => {
    const head = await readFileHandleRange(
      file,
      0,
      PLIST_MARKUP_PROBE_BYTES,
      () => assertArtifactReadActive(input.signal),
    );
    const encoding =
      head[0] === 0xff && head[1] === 0xfe
        ? "utf-16le"
        : head[0] === 0xfe && head[1] === 0xff
          ? "utf-16be"
          : "utf-8";
    const text = new TextDecoder(encoding).decode(head).trimStart();
    return /^<(?:[!?]|(?:plist|dict|array|string|integer|real|data|date|true|false)[\s/>])/u.test(
      text,
    )
      ? "xml"
      : "unknown";
  });
};

export const isBinaryPlistDescription = (description: string): boolean =>
  /binary property list/iu.test(description);
