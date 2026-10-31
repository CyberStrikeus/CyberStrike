import { createHash } from "node:crypto";
import {
  nativeLoadImageSchema,
  type NativeLoadImage,
  type NativeLoadImageCheck,
  type NativeLoadImageObservation,
} from "../domain/native/nativeLoadImage.js";
import type { DosMzHeader, MzHeaderEvidence } from "../domain/dosMz.js";
import type { JsonValue } from "../domain/jsonValue.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import { validateDosComLength } from "../domain/dosCom.js";
import { err, ok, type Result } from "../domain/result.js";
import { ghidraRawBinaryLanguage } from "./GhidraRawBinaryLanguage.js";

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");
const address = (offset: number): string => `0x${offset.toString(16)}`;
const limitations = [
  "Verification covers original/modified FileBytes, every initialized target-backed header/module mapping, relocation records and the external entry point. Mapping ends are inclusive.",
  "Appended overlay bytes are identified by file extent and included in FileBytes identity; they must not be mapped as initialized header/module memory. Uninitialized allocations are reported but their contents and DOS runtime behavior are not verified.",
  "The fixed load segment 0x1000 describes Ghidra's analysis image, not a running DOS process. Verified import does not establish original source ownership or recovered program behavior.",
  "A mismatching memory digest identifies the reported source range; it does not locate the first differing byte inside that range.",
];

/** Record one attestation's checks, preserving compared values and source locations. */
const createLoadImageChecks = () => {
  const checks: NativeLoadImageCheck[] = [];
  const check = (
    name: string,
    expected: JsonValue,
    observed: JsonValue,
    fileOffset: number | null = null,
    location: string | null = null,
  ): void => {
    checks.push({
      name,
      matched: JSON.stringify(expected) === JSON.stringify(observed),
      expected,
      observed,
      file_offset: fileOffset,
      address: location,
    });
  };
  return { checks, check };
};

export type GhidraDosImage = {
  readonly header: DosMzHeader;
  readonly loadSegment: number;
  readonly modified: Buffer;
  readonly expectedRelocations: NativeLoadImageObservation["relocations"];
};

/** Prepare initialized bytes and relocation facts without copying overlays. */
export const prepareGhidraDosLoadImage = (
  bytes: Buffer,
  evidence: MzHeaderEvidence,
): Result<GhidraDosImage, string> => {
  if (evidence.windowsHeader.state === "candidate")
    return err("MZ Windows new-header candidate is unresolved");
  if (evidence.windowsHeader.state === "header-needed")
    return err("MZ Windows new-header pointer is outside the bounded prefix");
  if (evidence.windowsHeader.state === "signature-needed")
    return err("MZ Windows new-header signature is outside the bounded prefix");
  if (evidence.windowsHeader.state === "declared")
    return err("MZ declares a Windows new header; it is not a DOS-only image");
  const parsed = evidence.dos;
  if (!parsed.ok) return parsed;
  const header = parsed.value;
  if (header.imageBytes > bytes.length)
    return err("DOS MZ initialized image was not completely captured");
  const loadSegment = 0x1000;
  const modified = Buffer.from(bytes.subarray(0, header.imageBytes));
  const applied = [];
  for (const {
    segment,
    offset,
    moduleOffset,
    fileOffset,
  } of header.relocations) {
    const original = modified
      .subarray(fileOffset, fileOffset + 2)
      .toString("hex");
    const relocated =
      (modified.readUInt16LE(fileOffset) + loadSegment) & 0xffff;
    modified.writeUInt16LE(relocated, fileOffset);
    applied.push({
      segment,
      offset,
      moduleOffset,
      fileOffset,
      original,
      relocated,
    });
  }
  // Application records describe their own fixup; the bridge reads memory
  // once all fixups have completed, including later overlapping writes.
  const expectedRelocations = applied.map(
    ({ segment, offset, moduleOffset, fileOffset, original, relocated }) => ({
      address: address(loadSegment * 16 + moduleOffset),
      segment: (loadSegment + segment) & 0xffff,
      offset,
      status: "APPLIED",
      type: 0,
      values: [segment, offset, relocated],
      original_bytes_hex: original,
      memory_bytes_hex: modified
        .subarray(fileOffset, fileOffset + 2)
        .toString("hex"),
    }),
  );
  return ok({ header, loadSegment, modified, expectedRelocations });
};

export type GhidraDosLoadImageSource = {
  readonly sha256: string;
  readonly fileBytes: number;
  readonly modifiedSha256: string;
  readonly image: GhidraDosImage;
};

/** Verify measured MZ import state against complete identity and prepared image facts. */
export const attestGhidraDosLoadImage = (
  source: GhidraDosLoadImageSource,
  targetSha256: string,
  observations: NativeLoadImageObservation,
): Result<NativeLoadImage, string> => {
  if (source.sha256 !== targetSha256)
    return err(
      "Ghidra load-image snapshot digest does not match the admitted target",
    );
  const { header, loadSegment, modified, expectedRelocations } = source.image;
  const { checks, check } = createLoadImageChecks();
  check(
    "executable_format",
    "Old-style DOS Executable (MZ)",
    observations.executable_format,
  );
  check("language_id", "x86:LE:16:Real Mode", observations.language_id);
  check("compiler_spec_id", "default", observations.compiler_spec_id);
  check("image_base", "0x0", observations.image_base);
  check("default_address_space", "ram", observations.default_address_space);
  check("source_file_count", 1, observations.source_files.length);
  const observedSource = observations.source_files[0];
  check("source_file_size", source.fileBytes, observedSource?.size ?? null);
  check(
    "original_file_sha256",
    targetSha256,
    observedSource?.original_sha256 ?? null,
  );
  check(
    "modified_file_sha256",
    source.modifiedSha256,
    observedSource?.modified_sha256 ?? null,
  );
  const entryAddress = address(
    ((loadSegment + header.entrySegment) & 0xffff) * 16 + header.entryOffset,
  );
  check("entry_points", [entryAddress], [...observations.entry_points].sort());
  // A multiset preserves duplicate relocations and aliases; iteration order is not semantic.
  const rows = (values: NativeLoadImageObservation["relocations"]): string[] =>
    values
      .map(({ segment: _segment, offset: _offset, ...value }) =>
        JSON.stringify(value),
      )
      .sort();
  check(
    "relocation_address_aliases",
    [],
    observations.relocations.filter(
      (row) =>
        row.segment === null ||
        row.offset === null ||
        address(row.segment * 16 + row.offset) !== row.address,
    ),
  );
  check(
    "relocation_records",
    rows(expectedRelocations),
    rows(observations.relocations),
  );

  checkMappings(header, loadSegment * 16, modified, observations, check);
  return ok(
    nativeLoadImageSchema.parse({
      status: checks.every((item) => item.matched) ? "verified" : "mismatch",
      format: "dos-mz",
      target_sha256: targetSha256,
      load_segment: loadSegment,
      header_bytes: header.headerBytes,
      module_bytes: header.moduleBytes,
      overlay_bytes: header.overlayBytes,
      entry: {
        relative_segment: header.entrySegment,
        offset: header.entryOffset,
        linear_address: entryAddress,
      },
      observations,
      checks,
      limitations,
    }),
  );
};

const checkMappings = (
  header: Pick<DosMzHeader, "headerBytes" | "imageBytes">,
  loadBase: number,
  modified: Buffer,
  observations: NativeLoadImageObservation,
  check: ReturnType<typeof createLoadImageChecks>["check"],
): void => {
  const backed = observations.mappings.filter(
    (mapping) => mapping.source_file_index !== null,
  );
  const sorted = [...backed].sort(
    (left, right) => (left.file_offset ?? -1) - (right.file_offset ?? -1),
  );
  let covered = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const mapping = sorted[index];
    if (mapping === undefined) continue;
    const start = mapping.file_offset;
    const end = start === null ? null : start + mapping.length;
    const headerMapping =
      start !== null && end !== null && start >= 0 && end <= header.headerBytes;
    const moduleMapping =
      start !== null &&
      end !== null &&
      start >= header.headerBytes &&
      end <= header.imageBytes;
    const at = `mapping[${index}]`;
    check(
      `${at}.source_file_index`,
      0,
      mapping.source_file_index,
      start,
      mapping.start,
    );
    check(`${at}.file_coverage_start`, covered, start, start, mapping.start);
    check(
      `${at}.partition`,
      true,
      headerMapping || moduleMapping,
      start,
      mapping.start,
    );
    check(`${at}.initialized`, true, mapping.initialized, start, mapping.start);
    check(`${at}.loaded`, moduleMapping, mapping.loaded, start, mapping.start);
    check(
      `${at}.overlay`,
      headerMapping,
      mapping.overlay,
      start,
      mapping.start,
    );
    check(
      `${at}.address_space`,
      headerMapping ? "HEADER" : observations.default_address_space,
      mapping.address_space,
      start,
      mapping.start,
    );
    const expectedStart =
      start === null
        ? null
        : headerMapping
          ? `HEADER:${address(start)}`
          : address(loadBase + start - header.headerBytes);
    const expectedEnd =
      start === null
        ? null
        : headerMapping
          ? `HEADER:${address(start + mapping.length - 1)}`
          : address(loadBase + start - header.headerBytes + mapping.length - 1);
    check(`${at}.start`, expectedStart, mapping.start, start, mapping.start);
    check(`${at}.end`, expectedEnd, mapping.end, start, mapping.end);
    check(
      `${at}.memory_sha256`,
      start !== null && end !== null && end <= modified.length
        ? sha256(modified.subarray(start, end))
        : null,
      mapping.sha256,
      start,
      mapping.start,
    );
    covered = end ?? covered;
  }
  check("initialized_file_coverage_end", header.imageBytes, covered);
  check(
    "initialized_unbacked_mappings",
    [],
    observations.mappings
      .filter(
        (mapping) => mapping.initialized && mapping.source_file_index === null,
      )
      // Unmeasured permissions serialize as null so the observed value stays JSON.
      .map((mapping) => ({
        ...mapping,
        readable: mapping.readable ?? null,
        writable: mapping.writable ?? null,
        executable: mapping.executable ?? null,
      })),
  );
};

/** Verify the explicit DOS COM interpretation against measured bytes and context. */
export const attestGhidraDosComLoadImage = (
  bytes: Buffer,
  targetSha256: string,
  observations: NativeLoadImageObservation,
): Result<NativeLoadImage, string> => {
  if (sha256(bytes) !== targetSha256)
    return err("Ghidra COM snapshot digest does not match the admitted target");
  const length = validateDosComLength(bytes.length);
  if (!length.ok) return length;
  const { checks, check } = createLoadImageChecks();
  const source = observations.source_files[0];
  check("executable_format", "Raw Binary", observations.executable_format);
  check("language_id", "x86:LE:16:Real Mode", observations.language_id);
  check("compiler_spec_id", "default", observations.compiler_spec_id);
  check("image_base", "0x0", observations.image_base);
  check("default_address_space", "ram", observations.default_address_space);
  check("source_file_count", 1, observations.source_files.length);
  check("source_file_size", bytes.length, source?.size ?? null);
  check("original_file_sha256", targetSha256, source?.original_sha256 ?? null);
  check("modified_file_sha256", targetSha256, source?.modified_sha256 ?? null);
  check("entry_points", ["0x10100"], [...observations.entry_points].sort());
  check(
    "entry_context",
    [
      {
        address: "0x10100",
        registers: ["CS", "DS", "ES", "SS"].map((name) => ({
          name,
          value_hex: "0x1000",
        })),
      },
    ],
    observations.entry_context,
  );
  check("relocation_records", [], observations.relocations);
  checkMappings(
    { headerBytes: 0, imageBytes: bytes.length },
    0x10100,
    bytes,
    observations,
    check,
  );
  return ok(
    nativeLoadImageSchema.parse({
      status: checks.every((item) => item.matched) ? "verified" : "mismatch",
      format: "dos-com",
      target_sha256: targetSha256,
      load_segment: 0x1000,
      header_bytes: 0,
      module_bytes: bytes.length,
      overlay_bytes: 0,
      entry: { relative_segment: 0, offset: 0x100, linear_address: "0x10100" },
      observations,
      checks,
      limitations: [
        "DOS COM is a headerless interpretation explicitly selected by the caller, not format identification from file bytes.",
        "Verification covers complete original/modified source identity, mapped file bytes, entry and measured CS/DS/ES/SS entry context. Context 0x1000 is imposed for analysis; it is not an observed running process.",
        "The PSP, initial stack contents/registers, DOS interrupts, PC-98 devices and runtime behavior are not modeled or verified. No original executable bytes are changed.",
        "Mapping ends are inclusive; a mismatching digest identifies its source range, not the first differing byte.",
      ],
    }),
  );
};

const hexAddress = (value: bigint): string => `0x${value.toString(16)}`;

/** Verify a caller-supplied raw-binary mapping against measured Ghidra import facts. */
export const attestGhidraRawBinaryLoadImage = (
  snapshot: { readonly sha256: string; readonly bytes: number },
  target: Extract<BinaryTarget, { format: "raw-binary" }>,
  observations: NativeLoadImageObservation,
): Result<NativeLoadImage, string> => {
  if (snapshot.sha256 !== target.sha256)
    return err(
      "Ghidra raw-binary snapshot digest does not match the admitted target",
    );
  const language = ghidraRawBinaryLanguage(target.architecture);
  const base = BigInt(target.entryPoint);
  const last = hexAddress(base + BigInt(snapshot.bytes) - 1n);
  const { checks, check } = createLoadImageChecks();
  const source = observations.source_files[0];
  const fileMappings = observations.mappings.filter(
    (item) => item.source_file_index !== null,
  );
  const mapping = fileMappings[0];
  check("executable_format", "Raw Binary", observations.executable_format);
  check("language_id", language.languageId, observations.language_id);
  check(
    "compiler_spec_id",
    language.compilerSpecId,
    observations.compiler_spec_id,
  );
  // BinaryLoader's block base is independent of the Program image base.
  check("image_base", "0x0", observations.image_base);
  check(
    "default_address_space",
    language.defaultAddressSpace,
    observations.default_address_space,
  );
  check("source_file_count", 1, observations.source_files.length);
  check("source_file_size", snapshot.bytes, source?.size ?? null);
  check("original_file_sha256", target.sha256, source?.original_sha256 ?? null);
  check("modified_file_sha256", target.sha256, source?.modified_sha256 ?? null);
  // Language-defined uninitialized zero page/stack blocks are observations, not file bytes.
  check("mapping_count", 1, fileMappings.length);
  check(
    "initialized_unbacked_mappings",
    0,
    observations.mappings.filter(
      (item) => item.initialized && item.source_file_index === null,
    ).length,
  );
  check("mapping.source_file_index", 0, mapping?.source_file_index ?? null);
  // Matching bytes alone do not establish the admitted default-space load.
  check("mapping.initialized", true, mapping?.initialized ?? null);
  check("mapping.loaded", true, mapping?.loaded ?? null);
  check("mapping.overlay", false, mapping?.overlay ?? null);
  check(
    "mapping.address_space",
    observations.default_address_space,
    mapping?.address_space ?? null,
  );
  check(
    "mapping.file_offset",
    0,
    mapping?.file_offset ?? null,
    0,
    mapping?.start ?? null,
  );
  check(
    "mapping.start",
    target.entryPoint,
    mapping?.start ?? null,
    0,
    mapping?.start ?? null,
  );
  check("mapping.end", last, mapping?.end ?? null, 0, mapping?.end ?? null);
  check(
    "mapping.length",
    snapshot.bytes,
    mapping?.length ?? null,
    0,
    mapping?.start ?? null,
  );
  check(
    "mapping.sha256",
    snapshot.sha256,
    mapping?.sha256 ?? null,
    0,
    mapping?.start ?? null,
  );
  check(
    "entry_point",
    target.entryPoint,
    observations.entry_points.find((entry) => entry === target.entryPoint) ??
      null,
  );
  check("relocation_records", [], observations.relocations);
  return ok(
    nativeLoadImageSchema.parse({
      status: checks.every((item) => item.matched) ? "verified" : "mismatch",
      format: "raw-binary",
      target_sha256: target.sha256,
      architecture: target.architecture,
      language_id: language.languageId,
      compiler_spec_id: language.compilerSpecId,
      base_address: target.entryPoint,
      file_bytes: snapshot.bytes,
      entry: { address: target.entryPoint, file_offset: 0 },
      observations,
      checks,
      limitations: [
        "Raw binary is a headerless interpretation explicitly selected by the caller, not format identification from file bytes.",
        "Verification covers complete original/modified source identity, initialized and loaded non-overlay file bytes in the default address space, the caller-supplied entry, and the bound Ghidra language with its fixed byte order. File offset 0 is mapped at the entry address.",
        "Ghidra may report additional language-defined external entries outside the mapped image. They are preserved as observations; verification requires the caller-supplied entry and does not attest other entries.",
        "Language-defined uninitialized memory, such as 6502 zero page and stack, is preserved as observations but is not attested as file-backed bytes.",
        "Reset vectors, memory-mapped I/O, alternate-endian and Thumb-only variants, and runtime boot behavior are not modeled or verified. No original executable bytes are changed.",
        "Mapping ends are inclusive; a mismatching digest identifies its source range, not the first differing byte.",
      ],
    }),
  );
};
