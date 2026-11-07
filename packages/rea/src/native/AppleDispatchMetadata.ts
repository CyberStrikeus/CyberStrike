import { createHash } from "node:crypto";
import { isSelectedRegularFileError } from "../filesystem/RegularFile.js";
import {
  DEFAULT_DISPATCH_METADATA_INPUT_BYTES,
  MAXIMUM_DISPATCH_METADATA_INPUT_BYTES,
  objcSwiftMetadataSchema,
  nativeDispatchMetadataResultSchema,
  type DispatchMetadataInputAdmission,
  type ObjcSwiftMetadata,
} from "../domain/native/objcSwiftMetadata.js";
import {
  isMachOFormat,
  type BinaryTarget,
} from "../domain/binaryTargetTypes.js";
import {
  AnalysisCancelledError,
  AnalysisArtifactChangedError,
  AnalysisAccessDeniedError,
  AnalysisCapabilityUnavailableError,
  AnalysisResourceConstraintError,
  AnalysisUnsupportedTargetError,
} from "../domain/analysisErrorCore.js";
import {
  ArtifactFileCleanupFailure,
  artifactFileCancellationCause,
  artifactFilePrimaryFacts,
  type ArtifactFilePrimaryFacts,
  bindArtifactFileCleanup,
  withArtifactRegularFile,
} from "../artifacts/ArtifactFileOperation.js";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { ProviderAdapterError } from "../domain/providerAdapterError.js";
import { ProviderCleanupError } from "../domain/providerCleanupError.js";
import {
  APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE,
  NATIVE_MACOS_PROVIDER_IDENTITY as IDENTITY,
} from "./NativeMacOSProviderMetadata.js";
import { readBoundedFileBytes } from "../process/BoundedFileBytes.js";
import { EvidenceIntegrityError } from "../domain/evidenceErrors.js";
import { pushDispatchCoverage } from "./AppleDispatchCoverage.js";
import { parsePointerFixups } from "./AppleMachoFixups.js";
import { BinaryFormatFailure } from "./metadata/BinaryContainer.js";
import {
  parseMachoLayout,
  UnsupportedMachoMetadataFormatError,
} from "./AppleMachoSelection.js";
import { decodeObjcDispatchFacets } from "./AppleObjcDispatchFacets.js";
import {
  createSwiftRelativeReader,
  decodeSwiftDispatchFacets,
  type DispatchRecordBudget,
  type SwiftRelativeTargetLocation,
} from "./AppleSwiftDispatchFacets.js";
import { createSwiftClassVtableDecoder } from "./AppleSwiftVtables.js";
import {
  decodeSwiftNominalTypes,
  createSwiftContextReader,
} from "./AppleSwiftNominalTypes.js";
import { inspectObjcClassImportBindings } from "./AppleObjcClassImportBindings.js";

/** Decode validated little-endian 64-bit Apple Objective-C metadata without loading target code. */
export const decodeAppleDispatchMetadata = (
  bytes: Buffer,
  maxRecords: number,
  provenance: { path: string; sha256: string },
  architecture = "arm64",
  objcClassImportAddresses?: readonly string[],
  objcClassImportAddressesComplete = true,
): ObjcSwiftMetadata => {
  const layout = parseMachoLayout(bytes, architecture);
  const { segments, sections, offset } = layout;
  const fixups = parsePointerFixups(
    bytes,
    layout.fixups,
    segments,
    layout.baseAddress,
  );
  const objcClassImports = inspectObjcClassImportBindings({
    bytes,
    layout,
    fixups,
    addresses: objcClassImportAddresses,
    addressesComplete: objcClassImportAddressesComplete,
    maxRecords,
  });
  const u32 = (address: bigint) => bytes.readUInt32LE(offset(address, 4));
  const decodePointer = (address: bigint) =>
    fixups.decode(address, bytes.readBigUInt64LE(offset(address, 8)));
  /** In-image target of a raw or rebased pointer; a bind is not an address. */
  const pointer = (address: bigint) => {
    const decodedPointer = decodePointer(address);
    if (decodedPointer.kind === "rebase" || decodedPointer.kind === "raw")
      return decodedPointer.target;
    if (decodedPointer.kind === "bind") return 0n;
    // Preserve the on-disk observation for structural Objective-C metadata.
    // `raw` is not promoted to an authoritative fixup result: the shared
    // pointer-fixup coverage remains partial, and consumers that need to
    // distinguish null from an unresolved bind use resolvePointer directly.
    if (decodedPointer.kind === "unknown") return decodedPointer.raw;
    throw new RangeError(decodedPointer.reason);
  };
  const bound = (address: bigint) => {
    const decodedPointer = decodePointer(address);
    return decodedPointer.kind === "bind" ? decodedPointer : undefined;
  };
  const location = (address: bigint) => ({
    address: `0x${address.toString(16)}`,
    file_offset: offset(address),
  });
  const targetLocation = (address: bigint): SwiftRelativeTargetLocation => {
    let fileOffset: number | null;
    try {
      fileOffset = offset(address);
    } catch (cause) {
      if (!(cause instanceof RangeError)) throw cause;
      fileOffset = null;
    }
    return { address: `0x${address.toString(16)}`, file_offset: fileOffset };
  };
  const evidence = (address: bigint, description: string) => [
    {
      kind: "binary_metadata" as const,
      description,
      location: location(address),
      artifact_path: provenance.path,
      artifact_sha256: provenance.sha256,
    },
  ];
  const string = (address: bigint) => {
    const start = offset(address);
    let end = start;
    while (end < bytes.length && end - start < 4096 && bytes[end] !== 0) end++;
    if (end === bytes.length || end - start >= 4096)
      throw new RangeError("Unterminated or oversized metadata string");
    offset(address, end - start + 1);
    // A metadata C string owns every code point, including an initial U+FEFF.
    return new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
      bytes.subarray(start, end),
    );
  };
  const result = objcSwiftMetadataSchema.parse({
    db_save_result: null,
    target_selection: {
      kind: "macho-selected-image-v1",
      container: layout.selectedImage.container,
      offset: layout.selectedImage.offset,
      byte_length: layout.selectedImage.byteLength,
      cpu_type: layout.selectedImage.cpuType,
      cpu_subtype: layout.selectedImage.cpuSubtype,
      container_table_sha256: layout.selectedImage.containerTableSha256,
    },
    ...(objcClassImportAddresses === undefined
      ? {}
      : {
          objc_class_import_bindings: objcClassImports.bindings,
          objc_class_import_binding_coverage: {
            facet: "objc_class_import_bindings",
            ...objcClassImports.coverage,
          },
        }),
  });
  let records = 0;
  const budget: DispatchRecordBudget = {
    truncated: false,
    isFull: () => records >= maxRecords,
    markTruncated: () => {
      budget.truncated = true;
    },
    admit: () => {
      if (records >= maxRecords) {
        budget.truncated = true;
        return false;
      }
      records++;
      return true;
    },
  };
  const readers = {
    u32,
    i32: (address: bigint) => bytes.readInt32LE(offset(address, 4)),
    u64: (address: bigint) => bytes.readBigUInt64LE(offset(address, 8)),
    pointer,
    resolvePointer: decodePointer,
    bound,
    string,
    location,
    targetLocation,
    evidence,
    offset,
  };
  const {
    failures,
    categoryIssues,
    examined,
    categoriesExamined,
    objcListScanTruncated,
    objcClassListScanTruncated,
  } = decodeObjcDispatchFacets({
    bytes,
    sections,
    segments,
    readers,
    budget,
    maxListSlots: maxRecords,
    result,
  });
  const swiftRelative = createSwiftRelativeReader({
    bytes,
    readers,
    budget,
    result,
  });
  const contextReader = createSwiftContextReader({
    u32,
    string,
    relative: swiftRelative,
  });
  const swift = decodeSwiftDispatchFacets({
    contextReader,
    sections,
    segments,
    readers,
    relative: swiftRelative,
    budget,
    result,
  });
  const typeEntries: bigint[] = [];
  for (const section of sections.filter(
    ({ name }) => name === "__swift5_types",
  )) {
    if (section.size % 4 !== 0)
      throw new BinaryFormatFailure(
        "malformed",
        "Misaligned Swift type section",
      );
    for (let index = 0; index < section.size / 4 && index < maxRecords; index++)
      typeEntries.push(section.address + BigInt(index * 4));
    if (section.size / 4 > maxRecords) budget.truncated = true;
  }
  const admit = () => budget.admit();
  const executable = (address: bigint) =>
    segments.some(
      (segment) =>
        segment.executable &&
        address >= segment.address &&
        address < segment.address + segment.size,
    );
  const vtables = createSwiftClassVtableDecoder({
    result,
    readers: {
      u32,
      relative: swiftRelative,
      location,
      evidence,
      admit,
      executable,
    },
  });
  const declarations = decodeSwiftNominalTypes({
    contextReader,
    entries: typeEntries,
    result,
    visitor: vtables.visitor,
    readers: {
      u32,
      relative: swiftRelative,
      string,
      location,
      evidence,
      executable,
      admit,
    },
  });
  pushDispatchCoverage({
    result,
    failures,
    categoryIssues,
    examined,
    categoriesExamined,
    objcListScanTruncated,
    objcClassListScanTruncated,
    truncated: budget.truncated,
    fixups,
    declarations,
    vtables: vtables.facts(),
    swift,
  });
  return objcSwiftMetadataSchema.parse(result);
};

const OPERATION = "inspect_native_dispatch_metadata";
const MEBIBYTE = 1024 * 1024;
const bytesWithUnits = (bytes: number): string =>
  Number.isInteger(bytes / (MEBIBYTE * 1024))
    ? `${String(bytes)} bytes (${String(bytes / (MEBIBYTE * 1024))} GiB)`
    : Number.isInteger(bytes / MEBIBYTE)
      ? `${String(bytes)} bytes (${String(bytes / MEBIBYTE)} MiB)`
      : `${String(bytes)} bytes`;

/** Refuse a file larger than the effective budget, naming how to raise it if possible. */
const inputBudgetExceeded = (
  admission: Omit<DispatchMetadataInputAdmission, "retained_bytes">,
  observedBytes: number | null,
): AnalysisResourceConstraintError => {
  const budget = `${admission.source === "caller" ? "the selected max_input_bytes" : "the default input budget"} of ${bytesWithUnits(admission.maximum_bytes)}`;
  const observed =
    observedBytes === null ? "" : ` (${String(observedBytes)} bytes)`;
  const remediationAction =
    observedBytes === null
      ? "The file grew while it was read. Retry once the file is stable."
      : observedBytes <= MAXIMUM_DISPATCH_METADATA_INPUT_BYTES
        ? `Retry with max_input_bytes (CLI --max-input-bytes) of at least ${String(observedBytes)}, at most ${bytesWithUnits(MAXIMUM_DISPATCH_METADATA_INPUT_BYTES)}; REA holds that many bytes in memory for the read.`
        : `The file exceeds the largest selectable budget of ${bytesWithUnits(MAXIMUM_DISPATCH_METADATA_INPUT_BYTES)}; use a deep analysis provider for its Objective-C and Swift metadata.`;
  return new AnalysisResourceConstraintError(
    OPERATION,
    "memory",
    `Apple static metadata input${observed} exceeds ${budget}.`,
    {
      input_bytes: admission.maximum_bytes,
      input_bytes_source: admission.source,
      maximum_selectable_input_bytes: MAXIMUM_DISPATCH_METADATA_INPUT_BYTES,
      ...(observedBytes === null
        ? {}
        : { observed_input_bytes: observedBytes }),
    },
    { retryable: false, remediationAction },
  );
};

/** Optional per-read selections beyond the record budget. */
export interface AppleDispatchMetadataOptions {
  readonly signal?: AbortSignal | undefined;
  readonly objcClassImportAddresses?: readonly string[] | undefined;
  readonly objcClassImportAddressesComplete?: boolean | undefined;
  /** Caller-selected input budget; the default applies when omitted. */
  readonly maxInputBytes?: number | undefined;
}

/**
 * Read digest-verified target bytes under the effective input budget and
 * decode their static metadata. The caller's scope retains the target
 * descriptor when its final close fails.
 */
export const inspectAppleDispatchMetadata = async (
  target: BinaryTarget,
  maxRecords: number,
  resources: ArtifactResourceScope,
  options: AppleDispatchMetadataOptions = {},
) => {
  const { signal } = options;
  if (target.kind !== "executable" || !isMachOFormat(target.format))
    throw new TypeError("Apple dispatch metadata requires a Mach-O target");
  const admission =
    options.maxInputBytes === undefined
      ? {
          maximum_bytes: DEFAULT_DISPATCH_METADATA_INPUT_BYTES,
          source: "default" as const,
        }
      : { maximum_bytes: options.maxInputBytes, source: "caller" as const };
  const maximumBytes = admission.maximum_bytes;
  const cancelled = () =>
    new AnalysisCancelledError(OPERATION, {
      cause: signal?.reason,
    });
  const { bytes, digest } = await withArtifactRegularFile(
    target.path,
    resources,
    signal,
    async ({ handle, initial: before }) => {
      if (before.size > maximumBytes)
        throw inputBudgetExceeded(admission, before.size);
      if (signal?.aborted) throw cancelled();
      const read = await readBoundedFileBytes(handle, maximumBytes, {
        signal,
        cancellationFailure: () => cancelled(),
      });
      if (read === undefined) throw inputBudgetExceeded(admission, null);
      const sha256 = createHash("sha256").update(read).digest("hex");
      if (sha256 !== target.sha256)
        throw new EvidenceIntegrityError(
          "Apple metadata target digest changed after session binding",
        );
      return { bytes: read, digest: sha256 };
    },
    "reject",
  );
  return nativeDispatchMetadataResultSchema.parse({
    target_sha256: target.sha256,
    target_architecture: target.architecture,
    provider: APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE.provider,
    analysis_profile_digest: APPLE_DISPATCH_METADATA_ANALYSIS_PROFILE.digest,
    input_admission: { ...admission, retained_bytes: bytes.length },
    result: decodeAppleDispatchMetadata(
      bytes,
      maxRecords,
      { path: target.path, sha256: digest },
      target.architecture,
      options.objcClassImportAddresses,
      options.objcClassImportAddressesComplete ?? true,
    ),
  });
};

/** Translate the owned target read, keeping a failed close beside its physical outcome. */
export const appleDispatchMetadataFailure = (
  cause: unknown,
  path: string,
): AnalysisError => {
  if (cause instanceof ArtifactReaderFailure && cause.cleanup !== undefined) {
    const physical =
      cause instanceof ArtifactFileCleanupFailure
        ? cause.fileCleanupFailure
        : undefined;
    const previous =
      physical?.outcome.kind === "failed"
        ? appleDispatchMetadataPrimaryFailure(
            artifactFilePrimaryFacts(cause),
            path,
          )
        : physical?.completionCancellation === undefined
          ? undefined
          : new AnalysisCancelledError(OPERATION, {
              cause: physical.completionCancellation.reason,
            });
    const failure = new ProviderCleanupError(
      IDENTITY.id,
      cause.cleanup.resources,
      {
        reason: cause.cleanup.reason,
        previous_error:
          previous === undefined ? null : projectAnalysisError(previous),
      },
      { operation: OPERATION, cause, cleanupPrimary: previous },
    );
    bindArtifactFileCleanup(cause, failure);
    return failure;
  }
  return appleDispatchMetadataPrimaryFailure(
    artifactFilePrimaryFacts(cause),
    path,
  );
};

const appleDispatchMetadataPrimaryFailure = (
  { cause, origin }: ArtifactFilePrimaryFacts,
  path: string,
): AnalysisError => {
  if (origin === "owned-or-classified") {
    if (cause instanceof AnalysisError) return cause;
    if (cause instanceof BinaryFormatFailure)
      return new AnalysisUnsupportedTargetError(
        OPERATION,
        path,
        cause.message,
        {
          cause,
          remediationAction:
            cause.kind === "malformed"
              ? "Select a Mach-O artifact with well-formed metadata sections, reopen the target, then retry."
              : "Select a supported little-endian 64-bit Mach-O artifact, reopen the target, then retry.",
        },
      );
    if (cause instanceof UnsupportedMachoMetadataFormatError)
      return new AnalysisCapabilityUnavailableError(
        IDENTITY.id,
        OPERATION,
        cause.message,
        { cause },
      );
    if (cause instanceof ArtifactReaderFailure && cause.reason === "cancelled")
      return new AnalysisCancelledError(OPERATION, {
        cause: artifactFileCancellationCause(cause),
      });
    if (
      cause instanceof ArtifactReaderFailure &&
      cause.reason === "unavailable"
    )
      return new AnalysisCapabilityUnavailableError(
        IDENTITY.id,
        OPERATION,
        cause.message,
        { cause },
      );
    if (cause instanceof ArtifactReaderFailure && cause.reason === "integrity")
      return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
        cause,
      });
    if (cause instanceof ArtifactReaderFailure && cause.reason === "path")
      return new AnalysisArtifactChangedError(OPERATION, path, cause.message, {
        cause,
      });
  }
  const readCause =
    origin === "owned-or-classified" &&
    cause instanceof ArtifactReaderFailure &&
    cause.reason === "io"
      ? cause.cause
      : cause;
  if (
    readCause instanceof Error &&
    "code" in readCause &&
    (readCause.code === "EACCES" || readCause.code === "EPERM")
  )
    return new AnalysisAccessDeniedError(OPERATION, path, readCause.code, {
      cause,
    });
  // This path already belongs to the bound target; loss of readability is a
  // change to that artifact, rather than a new caller input-selection error.
  if (isSelectedRegularFileError(readCause))
    return new AnalysisArtifactChangedError(
      OPERATION,
      path,
      `Bound metadata target could not be read (${readCause.code}): ${path}`,
      { cause },
    );
  return new ProviderAdapterError(IDENTITY.id, OPERATION, {
    cause,
    diagnostics: {
      target_path: path,
      reason: cause instanceof Error ? cause.message : String(cause),
    },
  });
};
