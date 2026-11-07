import {
  artifactNameForClassification,
  namedArtifactFormat,
} from "../domain/artifactNameSelection.js";
import { readFileHandleRange } from "../filesystem/readFileHandleRange.js";
import { readPeCoffHeader } from "../domain/peCoffHeader.js";
import {
  nesContainerFormat,
  parseInesLayout,
} from "../domain/inesContainer.js";
import {
  regularFileCancellation,
  RegularFileCleanupFailure,
  RegularFileCancelled,
  withOwnedRegularFile,
  OwnedRegularFileOperationFailure,
} from "../filesystem/OwnedRegularFile.js";
import {
  bindRegularFileCleanup,
  RetainedRegularFileCleanupFailure,
  retryRegularFileCleanup,
} from "./RegularFileRead.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { constants, type Stats } from "node:fs";
import { createHash } from "node:crypto";
import { access, realpath, stat, type FileHandle } from "node:fs/promises";
import { extname } from "node:path";

import { BinaryTargetError } from "../domain/configurationErrors.js";
import {
  assertStableRegularFileIdentity,
  RegularFileChangedError,
  type StableRegularFileDescriptor,
} from "../filesystem/RegularFile.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import type {
  BinaryTarget,
  BinaryArchitecture,
  PeCodeViewRecord,
  UniversalMachOSlice,
} from "../domain/binaryTargetTypes.js";
import { err, ok, type Result } from "../domain/result.js";
import { readMipsElfMetadata } from "./MipsElfMetadata.js";
import {
  validateElfDeclaredRanges,
  type ElfDeclarationRead,
} from "../domain/elfDeclaredRanges.js";
import { readRiscvIsaDeclaration } from "../domain/riscvIsaDeclaration.js";
import {
  resolveAppleBundleExecutable,
  type ResolvedAppBundle,
} from "./AppBundleExecutable.js";
import {
  OPENABLE_APPLE_BUNDLE_TYPES_TEXT,
  isUnopenedAppleBundleExtension,
  openableAppleBundleExtension,
} from "../domain/apple/appleBundleTypes.js";
import {
  validateDosComLength,
  type ExecutableFormatHint,
} from "../domain/dosCom.js";
import {
  admitRawBinary,
  rawBinarySelectionError,
} from "../domain/rawBinary.js";
import { admitGamecubeDol } from "../domain/gamecubeDolAdmission.js";
import { DOL_HEADER_SIZE } from "../domain/gamecubeDol.js";
import {
  mzWindowsHeaderLayoutLimitation,
  parseMzHeaderEvidence,
  withMzWindowsHeaderSignature,
  type DosMzHeader,
  type MzHeaderEvidence,
  type MzWindowsHeaderObservation,
} from "../domain/dosMz.js";
import {
  createXmlPlistSignatureProbe,
  hasBinaryPlistSignature,
  MAX_XML_PLIST_PROBE_BYTES,
} from "../domain/apple/appleArchiveFormat.js";
import { hasDiskImageSignature } from "../domain/apple/diskImageFormat.js";
import { hasGodotPckHeader } from "../domain/godotPckFormat.js";
import { hasUImageMagic } from "../domain/uimageFormat.js";
import { hasUnityFsHeader } from "../domain/unityfsFormat.js";
import { detectHexRecordEncoding } from "../domain/firmware/hexRecords.js";
import { hasUf2Block } from "../domain/firmware/uf2.js";
import {
  DFUSE_SUFFIX_BYTES,
  hasDfuSePrefix,
  isDfuSeFile,
} from "../domain/firmware/dfuse.js";
import { hasFitImagesNode } from "../domain/firmware/fitImage.js";
import {
  locateEspFlashLayout,
  type EspFlashSelection,
} from "../domain/firmware/espFlashLocation.js";
import { espFlashSelectionError } from "../domain/firmware/espFlashSelection.js";
import {
  ESP8266_REFUSAL,
  recognizeEspImage,
} from "../domain/firmware/espImage.js";
import {
  hasZipSignature,
  locateTrailingZipArchive,
  isZipPackageFormat,
  zipRootPackageFormat,
} from "../domain/zipPackageFormat.js";

import {
  parseCodeViewData,
  claimsExecutableHeader,
  parseExecutableHeader,
  parseMzExecutableMetadata,
  parsePeRecordFacts,
  peDebugDirectoryEntry,
  peCodeViewDataRanges,
  peRvaToFileOffset,
  type ExecutableMetadata,
} from "../domain/binaryTarget.js";
import {
  classifyFatContainerIdentity,
  readFatContainerHeader,
  readMachoHeaderPrefixFacts,
  type FatSliceHeaderEvidence,
  type MachoHeaderPrefixFacts,
} from "../domain/apple/machoContainer.js";
import {
  isJvmClassFile,
  MAX_JVM_CLASS_IDENTITY_BYTES,
  JVM_CLASS_IDENTITY_LIMIT_REASON,
} from "../domain/apple/jvmClassFile.js";
import {
  MachoLoadCommandCursor,
  readMachoLoadCommandTableHeader,
  type MachoLoadCommandTableHeader,
} from "../domain/apple/machoLoadCommands.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import type { JsonValue } from "../domain/jsonValue.js";

const XML_PLIST_PROBE_CHUNK_BYTES = 64 * 1024;

/** Options for resolving a local binary target and its stable identity. */
export interface BinaryTargetResolverOptions {
  readonly cwd?: string;
  readonly hostArchitecture?: NodeJS.Architecture;
  readonly targetKind?: BinaryTarget["kind"];
  readonly formatHint?: ExecutableFormatHint;
  readonly architecture?: BinaryArchitecture;
  readonly entryPoint?: string;
  /** Inputs for format=esp-flash-image; rejected with any other format. */
  readonly espFlash?: EspFlashSelection;
  readonly signal?: AbortSignal;
  readonly resources?: ArtifactResourceScope;
}

/**
 * Resolve and classify a readable local target before a provider is selected.
 * FAT Mach-O inputs select the host-compatible architecture, otherwise their
 * first declared supported slice, so setup remains non-interactive; unsupported
 * or ambiguous inputs are returned as typed errors.
 */
export const parseBinaryTarget = async (
  input: string,
  options: BinaryTargetResolverOptions = {},
): Promise<
  Result<BinaryTarget, BinaryTargetError | AnalysisCancelledError>
> => {
  const cwd = options.cwd ?? process.cwd();
  const { signal } = options;
  const candidate = absoluteCallerPath(input, { cwd });
  // Failures before canonicalization concern the selected path itself; later
  // failures concern the canonical path opened with symbolic links rejected.
  let stage: TargetFilesystemStage = "resolve";
  const resolve = async (): Promise<TargetResolution> => {
    throwIfTargetResolutionCancelled(signal);
    await access(candidate, constants.R_OK);
    throwIfTargetResolutionCancelled(signal);
    const canonical = await realpath(candidate);
    stage = "read";
    // Windows native admission must inspect the caller-selected reparse components.
    const sourcePath = process.platform === "win32" ? candidate : canonical;
    throwIfTargetResolutionCancelled(signal);
    const resolved = await resolveAppBundle(canonical);
    throwIfTargetResolutionCancelled(signal);
    if (!resolved.ok) return err(resolved.error);
    const { executable: path, infoPlist } = resolved.value;
    const bundle =
      infoPlist === undefined ? {} : { bundleInfoPlist: infoPlist };
    return withOwnedRegularFile<TargetResolution>(
      path,
      {
        symlinks: "reject",
        ...(signal === undefined ? {} : { signal }),
      },
      async (source) => {
        try {
          return await readOpenedBinaryTarget(
            source,
            { path, sourcePath, selectedPath: candidate, ...bundle },
            options,
          );
        } catch (cause: unknown) {
          throw new OwnedRegularFileOperationFailure(cause);
        }
      },
    );
  };
  try {
    const resolved = await (options.resources === undefined
      ? resolve()
      : options.resources.run(resolve));
    return finalizedTargetResolution(resolved, signal);
  } catch (cause: unknown) {
    // A caller-selected abort value never transfers file ownership.
    if (signal?.aborted === true && cause === signal.reason)
      return err(
        new AnalysisCancelledError("resolve_binary_target", { cause }),
      );
    if (cause instanceof RegularFileCleanupFailure) {
      const fileFailure = cause as RegularFileCleanupFailure<TargetResolution>;
      if (options.resources === undefined)
        return err(
          targetFileCleanupError(
            new RetainedRegularFileCleanupFailure(fileFailure),
            candidate,
            stage,
          ),
        );
      const retried = await retryRegularFileCleanup(
        fileFailure,
        options.resources,
        signal,
      );
      if (retried.failure !== undefined)
        return err(targetFileCleanupError(retried.failure, candidate, stage));
      if (retried.outcome.kind === "failed")
        return targetResolutionFailure(
          fileFailure.operationFailure ?? retried.outcome.cause,
          candidate,
          stage,
          signal,
        );
      return finalizedTargetResolution(retried.outcome.value, signal);
    }
    if (cause instanceof RegularFileCancelled)
      return finalizedTargetResolution(
        cause.outcome.value as TargetResolution,
        signal,
      );
    if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
      const error = new BinaryTargetError(
        candidate,
        "A previous target file could not be closed",
        {
          cause,
          cleanup: cause.cleanup,
          partialObservation: cause.partialObservation,
        },
      );
      bindRegularFileCleanup(cause, error);
      return err(error);
    }
    return targetResolutionFailure(cause, candidate, stage, signal);
  }
};

type TargetResolution = Result<
  BinaryTarget,
  BinaryTargetError | AnalysisCancelledError
>;

/** Classify and hash the one descriptor admitted by the lifetime owner. */
const readOpenedBinaryTarget = async (
  source: StableRegularFileDescriptor,
  selected: {
    readonly path: string;
    readonly sourcePath: string;
    readonly selectedPath: string;
    readonly bundleInfoPlist?: string;
  },
  options: BinaryTargetResolverOptions,
): Promise<TargetResolution> => {
  const { handle, initial: metadata } = source;
  const { path, sourcePath, selectedPath, bundleInfoPlist } = selected;
  const bundle = bundleInfoPlist === undefined ? {} : { bundleInfoPlist };
  const hostArchitecture = options.hostArchitecture ?? process.arch;
  const { targetKind, formatHint, signal, architecture, entryPoint } = options;
  throwIfTargetResolutionCancelled(signal);
  // Flash inputs pair with one format; check before any hint branch.
  const flashPairing = espFlashSelectionError({
    format: formatHint,
    flashOffset: options.espFlash?.flashOffset,
    partitionTableOffset: options.espFlash?.partitionTableOffset,
  });
  if (flashPairing !== undefined)
    return err(
      new BinaryTargetError(path, flashPairing, {
        constraint: "load_selection_rejected",
      }),
    );
  if (formatHint === "raw-binary") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "raw-binary format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    const admitted = admitRawBinary({
      architecture,
      entryPoint,
      fileBytes: metadata.size,
    });
    if (!admitted.ok)
      return err(
        new BinaryTargetError(path, admitted.error.reason, {
          constraint: admitted.error.constraint,
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "raw-binary",
      architecture: admitted.value.architecture,
      availableArchitectures: [admitted.value.architecture],
      entryPoint: admitted.value.entryPoint,
      entryPointSource: admitted.value.entryPointSource,
    });
  }
  const pairing = rawBinarySelectionError({
    ...(formatHint === undefined ? {} : { format: formatHint }),
    architecture,
    entryPoint,
  });
  if (pairing !== undefined)
    return err(
      new BinaryTargetError(path, pairing, {
        constraint: "load_selection_rejected",
      }),
    );
  if (formatHint === "gamecube-dol") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "gamecube-dol format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    // Only the fixed header is parsed; section bounds use the file size from metadata.
    const headerBytes = await readLeadingBytes(
      handle,
      Math.min(metadata.size, DOL_HEADER_SIZE),
      path,
      signal,
    );
    const admitted = admitGamecubeDol({
      bytes: headerBytes,
      fileSize: metadata.size,
      entryPoint,
    });
    if (!admitted.ok)
      return err(
        new BinaryTargetError(path, admitted.error.reason, {
          constraint: admitted.error.constraint,
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "gamecube-dol",
      architecture: admitted.value.architecture,
      availableArchitectures: [admitted.value.architecture],
      byteOrder: "big",
      bits: 32,
      entryPoint: admitted.value.entryPoint,
      entryPointSource: admitted.value.entryPointSource,
      dol: admitted.value.header,
    });
  }
  if (formatHint === "esp-flash-image") {
    if (targetKind !== undefined && targetKind !== "archive")
      return err(
        new BinaryTargetError(
          path,
          "ESP flash image format requires an archive target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    const selection = options.espFlash ?? {};
    // An encrypted dump has no readable table: unknown, not malformed.
    const located = await locateEspFlashLayout(
      metadata.size,
      (position, length) => readHandleRange(handle, position, length, signal),
      selection,
      { explicit: true, ...(signal === undefined ? {} : { signal }) },
    );
    if (!located.ok)
      return err(
        new BinaryTargetError(
          path,
          `ESP flash image layout is not recognized: ${located.error}`,
          { constraint: "file_format_rejected" },
        ),
      );
    return ok({
      path,
      sourcePath,
      artifactSelectedPath: selectedPath,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "archive",
      format: "esp-flash-image",
      espFlash: {
        selected: true,
        flashOffset: selection.flashOffset ?? null,
        partitionTableOffset: selection.partitionTableOffset ?? null,
      },
    });
  }
  if (formatHint === "dos-com") {
    if (targetKind !== undefined && targetKind !== "executable")
      return err(
        new BinaryTargetError(
          path,
          "DOS COM format requires an executable target kind",
          { constraint: "load_selection_rejected" },
        ),
      );
    const length = validateDosComLength(metadata.size);
    if (!length.ok)
      return err(
        new BinaryTargetError(path, length.error, {
          constraint: "file_format_rejected",
        }),
      );
    return ok({
      path,
      sourcePath,
      ...bundle,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "executable",
      format: "dos-com",
      architecture: "x86",
      availableArchitectures: ["x86"],
    });
  }
  // Probe WASM content before suffix-only database routing; an explicit
  // database selection keeps the caller's chosen interpretation.
  const classificationPath = artifactNameForClassification(selectedPath, path);
  const artifactFormat =
    targetKind === "database"
      ? undefined
      : await detectArtifactFormat(classificationPath, source, signal, path);
  if (
    targetKind === "database" ||
    (targetKind === undefined &&
      artifactFormat !== "ines" &&
      artifactFormat !== "plist" &&
      path.toLowerCase().endsWith(".hop"))
  )
    return ok({
      path,
      sourcePath,
      sha256: await sha256Handle(handle, path, metadata, signal),
      kind: "database",
      format: "analysis-database",
    });
  if (artifactFormat !== undefined) {
    const identity = {
      path,
      sourcePath,
      artifactSelectedPath: selectedPath,
      sha256: await sha256Handle(handle, path, metadata, signal),
    };
    if (artifactFormat === "esp-flash-image")
      return ok({
        ...identity,
        kind: "archive",
        format: artifactFormat,
        espFlash: {
          selected: false,
          flashOffset: null,
          partitionTableOffset: null,
        },
      });
    return isArchiveFormat(artifactFormat)
      ? ok({ ...identity, kind: "archive", format: artifactFormat })
      : ok({ ...identity, kind: "artifact", format: artifactFormat });
  }
  const detected = await readExecutableMetadata(
    source,
    hostArchitecture,
    signal,
  );
  if (!detected.ok) {
    // Only bytes no other format claims may lead a located ZIP, so an
    // executable with an appended archive keeps its executable route.
    if (
      !(await claimsLeadingExecutableHeader(handle, metadata.size, signal)) &&
      (await locateTrailingZipArchive(metadata.size, (position, length) =>
        readHandleRange(handle, position, length, signal),
      )) !== undefined
    )
      return ok({
        path,
        sourcePath,
        sha256: await sha256Handle(handle, path, metadata, signal),
        kind: "archive",
        format: zipRootPackageFormat(classificationPath),
        artifactSelectedPath: selectedPath,
      });
    const reason =
      typeof detected.error === "string"
        ? detected.error
        : detected.error.reason;
    const diagnostics =
      typeof detected.error === "string"
        ? undefined
        : detected.error.diagnostics;
    return err(
      new BinaryTargetError(path, reason, {
        constraint: "file_format_rejected",
        ...(diagnostics === undefined ? {} : { diagnostics }),
      }),
    );
  }
  return ok({
    path,
    sourcePath,
    ...bundle,
    sha256: await sha256Handle(handle, path, metadata, signal),
    kind: "executable",
    ...detected.value,
  });
};

/** Preserve an earlier admission refusal over an interruption during final close. */
const finalizedTargetResolution = (
  result: TargetResolution,
  signal?: AbortSignal,
): TargetResolution => {
  if (!result.ok || signal?.aborted !== true) return result;
  return err(
    new AnalysisCancelledError("resolve_binary_target", {
      cause: signal.reason,
      diagnostics: { completed_target: jsonValueSchema.parse(result.value) },
    }),
  );
};

/** Descriptor cleanup retains the physical result and binds its exact release lease. */
const targetFileCleanupError = (
  failure: RetainedRegularFileCleanupFailure<TargetResolution>,
  candidate: string,
  stage: TargetFilesystemStage,
): BinaryTargetError => {
  const cancellation = regularFileCancellation(failure);
  const completed =
    failure.outcome.kind === "completed" ? failure.outcome.value : undefined;
  const completedTarget =
    completed?.ok === true ? jsonValueSchema.parse(completed.value) : undefined;
  let primary: BinaryTargetError | AnalysisCancelledError | undefined;
  if (failure.outcome.kind === "failed") {
    const physical = failure.outcome.cause;
    primary =
      physical instanceof BinaryTargetError ||
      physical instanceof AnalysisCancelledError
        ? physical
        : cancellation !== undefined
          ? new AnalysisCancelledError("resolve_binary_target", {
              cause: cancellation.reason,
            })
          : (classifyTargetFilesystemFailure(candidate, physical, stage) ??
            new BinaryTargetError(
              failure.path,
              "Target read failed before file cleanup",
              { cause: physical },
            ));
  } else if (completed?.ok === false) primary = completed.error;
  else if (cancellation !== undefined)
    primary = new AnalysisCancelledError("resolve_binary_target", {
      cause: cancellation.reason,
      ...(completedTarget === undefined
        ? {}
        : { diagnostics: { completed_target: completedTarget } }),
    });
  const error = new BinaryTargetError(
    failure.path,
    "The target file handle could not be closed",
    {
      cause: failure,
      cleanupPrimary: primary,
      cleanup: {
        reason:
          failure.cleanupCause instanceof Error
            ? failure.cleanupCause.message
            : String(failure.cleanupCause),
        resources: [failure.path],
      },
      diagnostics: {
        ...(primary === undefined
          ? {}
          : { primary_error: projectAnalysisError(primary) }),
        ...(completedTarget === undefined
          ? {}
          : { completed_target: completedTarget }),
      },
    },
  );
  bindRegularFileCleanup(failure, error);
  return error;
};

const targetResolutionFailure = (
  cause: unknown,
  candidate: string,
  stage: TargetFilesystemStage,
  signal?: AbortSignal,
): TargetResolution => {
  // Physical rejection values do not grant ownership of foreign descriptors.
  const physical =
    cause instanceof OwnedRegularFileOperationFailure
      ? cause.operationCause
      : cause;
  if (
    physical instanceof AnalysisCancelledError ||
    physical instanceof BinaryTargetError
  )
    return err(physical);
  if (!(cause instanceof OwnedRegularFileOperationFailure)) {
    const cancellation = regularFileCancellation(cause);
    if (cancellation !== undefined)
      return err(
        new AnalysisCancelledError("resolve_binary_target", {
          cause: cancellation.reason,
        }),
      );
  }
  if (signal?.aborted === true && physical === signal.reason)
    return err(
      new AnalysisCancelledError("resolve_binary_target", { cause: physical }),
    );
  const failure = classifyTargetFilesystemFailure(candidate, physical, stage);
  if (failure === undefined) throw physical;
  return err(failure);
};

/**
 * `resolve` covers the caller-selected path before canonicalization; `read`
 * covers a canonical path opened with symbolic links rejected.
 */
type TargetFilesystemStage = "resolve" | "read";

/** Classify a filesystem failure while reading a previously selected target. */
export const classifyBinaryTargetFilesystemFailure = (
  path: string,
  cause: unknown,
): BinaryTargetError | undefined =>
  classifyTargetFilesystemFailure(path, cause, "read");

const classifyTargetFilesystemFailure = (
  path: string,
  cause: unknown,
  stage: TargetFilesystemStage,
): BinaryTargetError | undefined => {
  if (!(cause instanceof Error)) return undefined;
  const code = filesystemErrorCode(cause);
  return code === undefined
    ? undefined
    : new BinaryTargetError(
        path,
        targetFailureReason(code, cause.message, stage),
        { cause },
      );
};

const filesystemErrorCode = (cause: Error): string | undefined => {
  const code: unknown = Reflect.get(cause, "code");
  return typeof code === "string" ? code : undefined;
};

const targetFailureReason = (
  code: string,
  detail: string,
  stage: TargetFilesystemStage,
): string => {
  switch (code) {
    case "ENOENT":
    case "ENOTDIR":
      return `target does not exist or a path component is not a directory: ${detail}`;
    case "EACCES":
    case "EPERM":
      return `permission denied while reading target: ${detail}`;
    case "EISDIR":
      return `target is a directory, not a readable file: ${detail}`;
    case "ENOTFILE":
      return "target is not a regular file";
    case "ELOOP":
      // A canonical path has no symbolic links left, so a link rejected while
      // reading it appeared after resolution. Before that, ELOOP is a loop or
      // an over-deep link chain in the selected path itself.
      return stage === "resolve"
        ? `target path could not be resolved: too many symbolic links or a symbolic link loop: ${detail}`
        : `target changed while being opened: ${detail}`;
    default:
      return `target could not be read (${code}): ${detail}`;
  }
};

const throwIfTargetResolutionCancelled = (signal?: AbortSignal): void => {
  if (signal?.aborted === true)
    throw new AnalysisCancelledError("resolve_binary_target", {
      cause: signal.reason,
    });
};

const detectArtifactFormat = async (
  path: string,
  source: StableRegularFileDescriptor,
  signal?: AbortSignal,
  sourcePath = path,
): Promise<
  | Exclude<
      BinaryTarget["format"],
      | "analysis-database"
      | "mach-o"
      | "mach-o-universal"
      | "elf"
      | "pe"
      | "dos-mz"
      | "dos-com"
      | "raw-binary"
      | "gamecube-dol"
    >
  | undefined
> => {
  const { handle, initial } = source;
  throwIfTargetResolutionCancelled(signal);
  const lower = path.toLowerCase();
  // Fill the prefix so a short host read cannot hide a signature.
  const magic = Buffer.from(await readHandleRange(handle, 0, 4096, signal));
  try {
    await assertStableRegularFileIdentity(handle, sourcePath, initial, {
      symlinks: "reject",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause: unknown) {
    throwIfTargetResolutionCancelled(signal);
    throw cause;
  }
  throwIfTargetResolutionCancelled(signal);
  if (
    magic.length >= 8 &&
    magic.subarray(0, 8).equals(Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]))
  )
    throw new BinaryTargetError(
      path,
      "WebAssembly v1 artifacts are not supported by the native opening route",
      { constraint: "wasm_requires_static_inspection" },
    );
  if (nesContainerFormat(magic) !== undefined) {
    const parsed = parseInesLayout(magic, initial.size);
    throwIfTargetResolutionCancelled(signal);
    if (!parsed.ok)
      throw new BinaryTargetError(path, parsed.error, {
        constraint: "file_format_rejected",
      });
    return "ines";
  }
  if (hasZipSignature(magic)) return zipRootPackageFormat(lower);
  if (hasGodotPckHeader(magic)) return "godot-pck";
  if (hasUnityFsHeader(magic)) return "unityfs";
  if (hasUImageMagic(magic)) return "uimage";
  const hexRecords = detectHexRecordEncoding(magic);
  if (hexRecords !== undefined) return hexRecords;
  if (hasUf2Block(magic)) return "uf2";
  if (
    hasDfuSePrefix(magic) &&
    initial.size >= DFUSE_SUFFIX_BYTES &&
    isDfuSeFile(
      magic,
      await readHandleRange(
        handle,
        initial.size - DFUSE_SUFFIX_BYTES,
        DFUSE_SUFFIX_BYTES,
        signal,
      ),
      initial.size,
    )
  )
    return "dfuse";
  // A C3 or S3 dump begins with its bootloader, so a layout comes first.
  const flash = await locateEspFlashLayout(
    initial.size,
    (position, length) => readHandleRange(handle, position, length, signal),
    {},
    { explicit: false, ...(signal === undefined ? {} : { signal }) },
  );
  if (flash.ok) return "esp-flash-image";
  const esp = recognizeEspImage(magic, initial.size);
  if (esp === "esp8266")
    throw new BinaryTargetError(path, ESP8266_REFUSAL, {
      constraint: "file_format_rejected",
    });
  if (esp === "esp-image") return "esp-image";
  if (hasFitImagesNode(magic)) return "fit";
  // Binary plists, including keyed archives, often use other extensions.
  if (hasBinaryPlistSignature(magic)) return "plist";
  const named = namedArtifactFormat(lower);
  if (named !== undefined && !claimsExecutableHeader(magic, initial.size))
    return named;
  if (
    lower.endsWith(".pkg") &&
    magic.length >= 4 &&
    magic.subarray(0, 4).equals(Buffer.from("xar!"))
  )
    return "pkg";
  if (
    lower.endsWith(".dmg") &&
    (await hasDiskImageSignature(initial.size, (position, length) =>
      readHandleRange(handle, position, length, signal),
    ))
  )
    return "dmg";
  // XML property lists can use archive-specific suffixes such as .archive.
  // The named-format check above keeps .js, .map, and .asar classifications.
  const xmlProbe = createXmlPlistSignatureProbe();
  let xmlState = xmlProbe.write(magic);
  if (xmlState === "matched") return "plist";
  const chunk = Buffer.alloc(XML_PLIST_PROBE_CHUNK_BYTES);
  let bytesRead = magic.length;
  while (xmlState === "pending" && bytesRead < MAX_XML_PLIST_PROBE_BYTES) {
    throwIfTargetResolutionCancelled(signal);
    const read = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, MAX_XML_PLIST_PROBE_BYTES - bytesRead),
      bytesRead,
    );
    throwIfTargetResolutionCancelled(signal);
    if (read.bytesRead === 0) break;
    bytesRead += read.bytesRead;
    xmlState = xmlProbe.write(chunk.subarray(0, read.bytesRead));
    if (xmlState === "matched") return "plist";
  }
  if (bytesRead === MAX_XML_PLIST_PROBE_BYTES) {
    const { size } = initial;
    throwIfTargetResolutionCancelled(signal);
    if (size > bytesRead)
      throw new BinaryTargetError(
        path,
        "XML plist prolog was not found within the 1 MiB format probe limit",
        { constraint: "file_format_rejected" },
      );
  }
  return undefined;
};

const isArchiveFormat = (
  format: Exclude<
    BinaryTarget["format"],
    | "analysis-database"
    | "mach-o"
    | "mach-o-universal"
    | "elf"
    | "pe"
    | "dos-mz"
    | "dos-com"
    | "raw-binary"
    | "gamecube-dol"
  >,
): format is Extract<BinaryTarget, { kind: "archive" }>["format"] =>
  isZipPackageFormat(format) ||
  [
    "asar",
    "ines",
    "godot-pck",
    "unityfs",
    "uimage",
    "dmg",
    "pkg",
    "intel-hex",
    "srec",
    "esp-image",
    "uf2",
    "dfuse",
    "esp-flash-image",
    "fit",
  ].includes(format);

/** Whether the leading bytes begin any executable header family, valid or not. */
const claimsLeadingExecutableHeader = async (
  handle: FileHandle,
  size: number,
  signal?: AbortSignal,
): Promise<boolean> =>
  claimsExecutableHeader(
    Buffer.from(await readHandleRange(handle, 0, Math.min(size, 4096), signal)),
    size,
  );

/** Fill one bounded range, honoring cancellation; a short result means end of file. */
const readHandleRange = async (
  handle: FileHandle,
  position: number,
  length: number,
  signal?: AbortSignal,
): Promise<Buffer> => {
  const bytes = await readFileHandleRange(handle, position, length, () =>
    throwIfTargetResolutionCancelled(signal),
  );
  throwIfTargetResolutionCancelled(signal);
  return bytes;
};

/** Read exactly `size` bytes by offset; a short read means the file changed or ended early. */
const readLeadingBytes = async (
  handle: FileHandle,
  size: number,
  path: string,
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const bytes = Buffer.allocUnsafe(size);
  let position = 0;
  while (position < size) {
    throwIfTargetResolutionCancelled(signal);
    const observed = await handle.read(
      bytes,
      position,
      size - position,
      position,
    );
    if (observed.bytesRead === 0)
      throw new BinaryTargetError(path, "target changed while being read");
    position += observed.bytesRead;
  }
  return bytes;
};

const sha256Handle = async (
  handle: FileHandle,
  path: string,
  initial: Stats,
  signal?: AbortSignal,
): Promise<string> => {
  const hash = createHash("sha256");
  const chunk = Buffer.allocUnsafe(64 * 1024);
  let position = 0;
  while (true) {
    throwIfTargetResolutionCancelled(signal);
    const observed = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, initial.size - position + 1),
      position,
    );
    throwIfTargetResolutionCancelled(signal);
    if (observed.bytesRead === 0) break;
    hash.update(chunk.subarray(0, observed.bytesRead));
    position += observed.bytesRead;
    if (position > initial.size)
      throw new BinaryTargetError(path, "target grew while being read");
  }
  throwIfTargetResolutionCancelled(signal);
  try {
    await assertStableRegularFileIdentity(handle, path, initial, {
      symlinks: "reject",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause: unknown) {
    throwIfTargetResolutionCancelled(signal);
    if (cause instanceof RegularFileChangedError)
      throw new BinaryTargetError(path, "target changed while being read", {
        cause,
      });
    throw cause;
  }
  throwIfTargetResolutionCancelled(signal);
  if (position !== initial.size)
    throw new BinaryTargetError(path, "target changed while being read");
  return hash.digest("hex");
};

const resolveAppBundle = async (
  path: string,
): Promise<Result<ResolvedAppBundle, BinaryTargetError>> => {
  const metadata = await stat(path);
  if (!metadata.isDirectory()) return ok({ executable: path });
  if (openableAppleBundleExtension(extname(path)) !== undefined)
    return resolveAppleBundleExecutable(path);
  // Another Apple bundle type, such as a driver or kernel extension, is not
  // an application directory and has no JavaScript route.
  if (isUnopenedAppleBundleExtension(extname(path)))
    return err(
      new BinaryTargetError(
        path,
        `${extname(path)} bundle directories are not opened by this route; it opens ${OPENABLE_APPLE_BUNDLE_TYPES_TEXT} bundle directories`,
        { constraint: "bundle_type_unsupported" },
      ),
    );
  return err(
    new BinaryTargetError(
      path,
      "this opening route requires a file or a supported Apple bundle directory",
      {
        constraint: "directory_requires_file",
      },
    ),
  );
};

const readExecutableMetadata = async (
  source: StableRegularFileDescriptor,
  hostArchitecture: NodeJS.Architecture,
  signal?: AbortSignal,
): Promise<Result<ExecutableMetadata, ExecutableMetadataFailure>> => {
  const { handle, initial } = source;
  throwIfTargetResolutionCancelled(signal);
  const bytes = await readHandleRange(handle, 0, 4096, signal);
  // Header commitments such as Mach-O load commands and FAT slices are
  // checked against the whole file, not the probed prefix.
  const fileSize = initial.size;
  if (bytes.length >= 2 && bytes[0] === 0x4d && bytes[1] === 0x5a) {
    let evidence = parseMzHeaderEvidence(bytes, fileSize);
    let signatureEvidence:
      | { readonly offset: number; readonly bytes: Buffer }
      | undefined;
    if (evidence.windowsHeader.state === "signature-needed") {
      const { offset } = evidence.windowsHeader;
      signatureEvidence = {
        offset,
        bytes: await readHandleRange(
          handle,
          offset,
          Math.min(4, fileSize - offset),
          signal,
        ),
      };
      evidence = withMzWindowsHeaderSignature(
        bytes,
        fileSize,
        evidence,
        signatureEvidence,
      );
    }
    const { windowsHeader } = evidence;
    if (windowsHeader.state === "declared") {
      const limitation = mzWindowsHeaderLayoutLimitation(windowsHeader);
      if (limitation !== undefined)
        return err({
          reason: limitation,
          diagnostics: {
            unsupported_layout: true,
            mz_windows_header: { ...windowsHeader },
          },
        });
      return readPeMetadata(handle, windowsHeader.offset, {
        mzPrefix: bytes,
        fileSize,
        mzEvidence: evidence,
        signal,
      });
    }
    // MZ relocation records may extend past the initial probe; their format
    // bounds are at most 65535 records inside a 65535-paragraph header.
    const { relocationTableRead } = evidence;
    if (relocationTableRead !== undefined) {
      const observedBytes = await readHandleRange(
        handle,
        relocationTableRead.offset,
        relocationTableRead.byteLength,
        signal,
      );
      evidence = parseMzHeaderEvidence(
        observedBytes,
        fileSize,
        signatureEvidence,
      );
      if (evidence.windowsHeader.state === "candidate")
        return err(
          unresolvedMzHeaderFailure(evidence.windowsHeader, evidence.dos),
        );
      return parseMzExecutableMetadata(observedBytes, evidence);
    }
    if (windowsHeader.state === "candidate")
      return err(unresolvedMzHeaderFailure(windowsHeader, evidence.dos));
    return parseMzExecutableMetadata(bytes, evidence);
  }
  if (bytes.length >= 4 && bytes.toString("hex", 0, 4) === "7f454c46")
    return readElfMetadata(handle, bytes, {
      fileSize,
      hostArchitecture,
      signal,
    });
  const thin = await readThinMachoMetadata(handle, bytes, {
    fileSize,
    hostArchitecture,
    signal,
  });
  if (thin !== null) return thin;
  const hasJvmMagic = bytes.length >= 4 && bytes.readUInt32BE(0) === 0xcafebabe;
  if (
    hasJvmMagic &&
    fileSize > bytes.length &&
    fileSize <= MAX_JVM_CLASS_IDENTITY_BYTES
  ) {
    const complete = await readHandleRange(handle, 0, fileSize, signal);
    if (complete.byteLength === fileSize && isJvmClassFile(complete))
      return err("unsupported binary format");
  }
  const fatEvidence = await readFatSliceHeaderEvidence(
    handle,
    bytes,
    fileSize,
    signal,
  );
  if (
    hasJvmMagic &&
    fileSize > MAX_JVM_CLASS_IDENTITY_BYTES &&
    fatEvidence !== undefined &&
    classifyFatContainerIdentity(
      fatEvidence.header,
      (offset) => fatEvidence.sliceHeadersByOffset.get(offset)?.magic,
    ).state === "malformed"
  )
    return err(JVM_CLASS_IDENTITY_LIMIT_REASON);
  const parsed = parseExecutableHeader(
    bytes,
    hostArchitecture,
    fileSize,
    undefined,
    fatEvidence,
  );
  if (
    parsed.ok &&
    parsed.value.format === "mach-o-universal" &&
    fatEvidence !== undefined
  ) {
    for (const slice of fatEvidence.header.slices) {
      const framed = await readMachoSliceCommandFrames(handle, slice, signal);
      if (!framed.ok) return framed;
    }
  }
  return parsed;
};

/** ELF structure and family declarations share one descriptor before provider selection. */
const readElfMetadata = async (
  handle: FileHandle,
  bytes: Buffer,
  options: {
    readonly fileSize: number;
    readonly hostArchitecture: NodeJS.Architecture;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<ExecutableMetadata, ExecutableMetadataFailure>> => {
  const { fileSize, hostArchitecture, signal } = options;
  const parsed = parseExecutableHeader(bytes, hostArchitecture, fileSize);
  if (!parsed.ok || parsed.value.format !== "elf") return parsed;
  const ranges = await readElfDeclarations(
    handle,
    bytes,
    validateElfDeclaredRanges(bytes, fileSize),
    signal,
  );
  if (!ranges.ok) return ranges;
  if (parsed.value.architecture === "riscv")
    return ok({
      ...parsed.value,
      riscv: {
        ...parsed.value.riscv,
        isa: await readElfDeclarations(
          handle,
          bytes,
          readRiscvIsaDeclaration(bytes, fileSize),
          signal,
        ),
      },
    });
  if (parsed.value.architecture !== "mips" || parsed.value.mips.elfClass !== 32)
    return parsed;
  const declarations = await readMipsElfMetadata(
    handle,
    parsed.value.mips,
    () => throwIfTargetResolutionCancelled(signal),
  );
  if (!declarations.ok) return declarations;
  return ok({
    ...parsed.value,
    mips: {
      ...parsed.value.mips,
      abiFlags: declarations.value.abiFlags,
      gnuAttributes: declarations.value.gnuAttributes,
      ...(declarations.value.sharedLoad === undefined
        ? {}
        : { sharedLoad: declarations.value.sharedLoad }),
      ...(declarations.value.limitations.length === 0
        ? {}
        : { limitations: declarations.value.limitations }),
    },
  });
};

/**
 * Satisfy one ELF declaration reader from the admitted descriptor. Every
 * request is at most one 64 KiB chunk, and the reader consumes each chunk
 * before its next request reuses the window.
 */
const readElfDeclarations = async <T>(
  handle: FileHandle,
  prefix: Buffer,
  steps: Generator<ElfDeclarationRead, T, Buffer>,
  signal?: AbortSignal,
): Promise<T> => {
  let next = steps.next();
  let window: Buffer | undefined;
  while (!next.done) {
    throwIfTargetResolutionCancelled(signal);
    const { offset, size } = next.value;
    let bytes: Buffer;
    if (offset + size <= prefix.length)
      bytes = prefix.subarray(offset, offset + size);
    else {
      window ??= Buffer.allocUnsafe(64 * 1024);
      bytes = window.subarray(0, size);
      let length = 0;
      while (length < size) {
        const read = await handle.read(
          bytes,
          length,
          size - length,
          offset + length,
        );
        throwIfTargetResolutionCancelled(signal);
        if (read.bytesRead === 0) break;
        length += read.bytesRead;
      }
      bytes = bytes.subarray(0, length);
    }
    next = steps.next(bytes);
  }
  return next.value;
};

type ExecutableMetadataFailure =
  | string
  | {
      readonly reason: string;
      readonly diagnostics: Readonly<Record<string, JsonValue>>;
    };

const unresolvedMzHeaderFailure = (
  windowsHeader: Extract<MzWindowsHeaderObservation, { state: "candidate" }>,
  dos: Result<DosMzHeader, string>,
): Exclude<ExecutableMetadataFailure, string> => {
  return {
    reason: "MZ Windows new-header candidate is unresolved",
    diagnostics: {
      mz_windows_header: {
        state: windowsHeader.state,
        offset: windowsHeader.offset,
        signature: windowsHeader.signature,
      },
      mz_dos: dos.ok
        ? {
            state: "valid",
            header_bytes: dos.value.headerBytes,
            image_bytes: dos.value.imageBytes,
            module_bytes: dos.value.moduleBytes,
            overlay_bytes: dos.value.overlayBytes,
            relocation_count: dos.value.relocationCount,
            relocation_table_offset: dos.value.relocationTableOffset,
            entry_segment: dos.value.entrySegment,
            entry_offset: dos.value.entryOffset,
          }
        : { state: "invalid", reason: dos.error },
    },
  };
};

/** Establish a complete thin-command framing proof before provider admission. */
const readThinMachoMetadata = async (
  handle: FileHandle,
  prefix: Buffer,
  input: {
    readonly fileSize: number;
    readonly hostArchitecture: NodeJS.Architecture;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<ExecutableMetadata, string> | null> => {
  const table = readMachoLoadCommandTableHeader(prefix, input.fileSize);
  if (!table.ok) return table;
  if (table.value === null) return null;
  const parsed = parseExecutableHeader(
    prefix.subarray(0, table.value.headerSize),
    input.hostArchitecture,
    input.fileSize,
  );
  if (!parsed.ok) return parsed;
  const framed = await readMachoCommandFrames(handle, table.value, {
    prefix,
    fileSize: input.fileSize,
    signal: input.signal,
  });
  return framed.ok ? parsed : framed;
};

/** Walk thin command headers through one probe window, skipping payload bytes. */
const readMachoCommandFrames = async (
  handle: FileHandle,
  table: MachoLoadCommandTableHeader,
  input: {
    readonly prefix: Buffer;
    readonly fileSize: number;
    readonly fileOffset?: number | undefined;
    readonly signal?: AbortSignal | undefined;
  },
): Promise<Result<null, string>> => {
  const commands = new MachoLoadCommandCursor(table);
  let window = input.prefix;
  let windowOffset = 0;
  while (commands.nextOffset !== null) {
    const offset = table.headerSize + commands.nextOffset;
    if (
      offset + 8 <= input.fileSize &&
      (offset < windowOffset || offset + 8 > windowOffset + window.length)
    ) {
      windowOffset = offset;
      window = await readHandleRange(
        handle,
        (input.fileOffset ?? 0) + offset,
        Math.min(4096, input.fileSize - offset),
        input.signal,
      );
    }
    const relative = offset - windowOffset;
    const frame = commands.read(
      relative >= 0 ? window.subarray(relative, relative + 8) : Buffer.alloc(0),
    );
    if (!frame.ok) return frame;
  }
  return commands.finish();
};

/** Validate declared FAT slices after the canonical table/identity admission succeeds. */
const readMachoSliceCommandFrames = async (
  handle: FileHandle,
  slice: UniversalMachOSlice,
  signal?: AbortSignal,
): Promise<Result<null, string>> => {
  const bytes = await readHandleRange(
    handle,
    slice.offset,
    Math.min(4096, slice.size),
    signal,
  );
  const table = readMachoLoadCommandTableHeader(bytes, slice.size);
  if (!table.ok) return table;
  if (table.value === null)
    return err("FAT slice does not identify a thin Mach-O image");
  return readMachoCommandFrames(handle, table.value, {
    prefix: bytes,
    fileSize: slice.size,
    fileOffset: slice.offset,
    signal,
  });
};

/** Read the validated FAT table and bounded thin-header identity prefixes. */
const readFatSliceHeaderEvidence = async (
  handle: FileHandle,
  prefix: Buffer,
  fileSize: number,
  signal?: AbortSignal,
): Promise<FatSliceHeaderEvidence | undefined> => {
  let header = readFatContainerHeader(prefix, fileSize);
  if (header.state === "needs-data") {
    // readFatContainerHeader enforces the 128-entry format bound before this
    // allocation; this is only the table, never a synthesized file image.
    const table = await readHandleRange(
      handle,
      0,
      header.requiredBytes,
      signal,
    );
    header = readFatContainerHeader(table, fileSize);
  }
  if (header.state !== "parsed") return undefined;

  const sliceHeadersByOffset = new Map<number, MachoHeaderPrefixFacts>();
  for (let index = 0; index < header.slices.length; index += 1) {
    const slice = header.slices[index];
    if (slice === undefined) continue;
    if (header.rangeIssues[index] !== null) {
      sliceHeadersByOffset.set(
        slice.offset,
        readMachoHeaderPrefixFacts(Buffer.alloc(0)),
      );
      continue;
    }
    const observedLength = Math.min(12, slice.size);
    const thinHeader = await readHandleRange(
      handle,
      slice.offset,
      observedLength,
      signal,
    );
    sliceHeadersByOffset.set(
      slice.offset,
      readMachoHeaderPrefixFacts(thinHeader),
    );
  }
  return { header, sliceHeadersByOffset };
};

const readPeMetadata = async (
  handle: FileHandle,
  offset: number,
  {
    mzPrefix,
    fileSize,
    mzEvidence,
    signal,
  }: {
    readonly mzPrefix: Buffer;
    readonly fileSize: number;
    readonly mzEvidence: MzHeaderEvidence;
    readonly signal: AbortSignal | undefined;
  },
): Promise<Result<ExecutableMetadata, string>> => {
  throwIfTargetResolutionCancelled(signal);
  const fileHeader = await readHandleRange(handle, offset, 24, signal);
  if (fileHeader.length !== 24) return err("invalid or truncated PE header");
  const { windowsHeader } = withMzWindowsHeaderSignature(
    mzPrefix,
    fileSize,
    mzEvidence,
    { offset, bytes: fileHeader.subarray(0, 4) },
  );
  if (windowsHeader.state !== "declared")
    return err("invalid Windows new-header signature in MZ image");
  if (["NE", "LE", "LX"].includes(windowsHeader.signature))
    return err(`unsupported ${windowsHeader.signature} executable in MZ image`);
  const coff = readPeCoffHeader(fileHeader.subarray(4));
  if (!coff.ok) return err("invalid or truncated PE header");
  const optionalHeaderSize = coff.value.optionalHeaderSize;
  if (optionalHeaderSize > 4096) return err("invalid PE optional header size");
  const numberOfSections = coff.value.sectionCount;
  const record = await readHandleRange(
    handle,
    offset,
    24 + optionalHeaderSize,
    signal,
  );
  if (record.length !== 24 + optionalHeaderSize)
    return err("invalid or truncated PE header");
  const codeView = await readPeCodeView(
    handle,
    offset,
    numberOfSections,
    record.subarray(24),
    optionalHeaderSize,
    signal,
  );
  const parsed = parsePeRecordFacts(record, codeView);
  return parsed.ok ? ok(parsed.value.metadata) : parsed;
};

const readPeCodeView = async (
  handle: FileHandle,
  peOffset: number,
  numberOfSections: number,
  optionalHeader: Buffer,
  optionalHeaderSize: number,
  signal?: AbortSignal,
): Promise<PeCodeViewRecord | undefined> => {
  throwIfTargetResolutionCancelled(signal);
  const debugDir = peDebugDirectoryEntry(optionalHeader);
  if (debugDir === undefined || numberOfSections > 96) return undefined;
  const sectionTableOffset = peOffset + 24 + optionalHeaderSize;
  const sectionTableSize = numberOfSections * 40;
  const sectionTable = await readHandleRange(
    handle,
    sectionTableOffset,
    sectionTableSize,
    signal,
  );
  if (sectionTable.length !== sectionTableSize) return undefined;
  const debugFileOffset = peRvaToFileOffset(
    debugDir.debugRva,
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
    Math.min(debugDir.debugSize, 4096),
  );
  if (debugFileOffset === undefined) return undefined;
  const maxDebugSize = Math.min(debugDir.debugSize, 4096);
  const debugDirectoryBuffer = await readHandleRange(
    handle,
    debugFileOffset,
    maxDebugSize,
    signal,
  );
  for (const {
    fileOffset: pointerToRawData,
    declaredSize: sizeOfData,
  } of peCodeViewDataRanges(
    debugDirectoryBuffer,
    sectionTable,
    numberOfSections,
    debugDir.sizeOfHeaders,
  )) {
    const maxCodeViewRead = Math.min(sizeOfData, 4096);
    const codeViewBuffer = await readHandleRange(
      handle,
      pointerToRawData,
      maxCodeViewRead,
      signal,
    );
    const parsed = parseCodeViewData(codeViewBuffer, sizeOfData);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
};
