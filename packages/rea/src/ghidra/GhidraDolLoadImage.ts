import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { DolHeader } from "../domain/gamecubeDol.js";
import type { JsonValue } from "../domain/jsonValue.js";
import { nativeAddressCoordinateInputSchema } from "../domain/native/nativeAddress.js";
import {
  nativeLoadImageSchema,
  type NativeLoadImage,
  type NativeLoadImageCheck,
  type NativeLoadImageObservation,
} from "../domain/native/nativeLoadImage.js";
import { err, ok, type Result } from "../domain/result.js";
import { ghidraDolLanguage } from "./GhidraDolProfile.js";

type DolTarget = Extract<BinaryTarget, { format: "gamecube-dol" }>;

/**
 * Digests of the immutable DOL snapshot, streamed by the Ghidra client: whole
 * file identity plus one digest per header section, in `header.sections` order.
 */
export interface DolSnapshotDigests {
  readonly sha256: string;
  readonly bytes: number;
  readonly sectionSha256: readonly string[];
}
type Permissions = {
  readonly readable: boolean;
  readonly writable: boolean;
  readonly executable: boolean;
};
/** Permissions the DOL import must set: text r-x, data rw-, BSS rw- (see ReaGhidraPrepareDol.java). */
const TEXT_PERMISSIONS: Permissions = {
  readable: true,
  writable: false,
  executable: true,
};
const DATA_PERMISSIONS: Permissions = {
  readable: true,
  writable: true,
  executable: false,
};
type FileFacts = {
  readonly start: string;
  readonly end: string;
  readonly length: number;
  readonly file_offset: number | null;
  readonly sha256: string | null;
  readonly source_file_index: number | null;
  readonly initialized: boolean;
  readonly loaded: boolean;
  readonly overlay: boolean;
  readonly address_space: string;
  readonly readable?: boolean | undefined;
  readonly writable?: boolean | undefined;
  readonly executable?: boolean | undefined;
};
type BssFacts = Omit<FileFacts, "file_offset" | "sha256" | "source_file_index">;
const hex = (value: number): string => `0x${value.toString(16)}`;
const byStart = <
  T extends { readonly start: string; readonly address_space: string },
>(
  left: T,
  right: T,
): number =>
  left.address_space === right.address_space
    ? Number(
        nativeAddressCoordinateInputSchema.parse(left.start).offset -
          nativeAddressCoordinateInputSchema.parse(right.start).offset,
      )
    : left.address_space < right.address_space
      ? -1
      : 1;

/**
 * Verify the imported DOL against its header: every used section is one
 * initialized, loaded, non-overlay mapping at its load address with the exact
 * file bytes, BSS is only uninitialized gaps outside data sections, and the
 * header entry is an external entry point.
 */
export const attestGhidraDolLoadImage = (
  snapshot: DolSnapshotDigests,
  target: DolTarget,
  observations: NativeLoadImageObservation,
  languageOverride: GhidraLanguageOverride | undefined,
): Result<NativeLoadImage, string> => {
  if (snapshot.sha256 !== target.sha256)
    return err("Ghidra DOL snapshot digest does not match the admitted target");
  const header: DolHeader = target.dol;
  if (snapshot.sectionSha256.length !== header.sections.length)
    return err("Ghidra DOL snapshot section digests do not match the header");
  const language = ghidraDolLanguage(languageOverride);
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

  // Field order is fixed: checks compare serialized values.
  const fileFacts = (mapping: FileFacts) => ({
    start: mapping.start,
    end: mapping.end,
    length: mapping.length,
    file_offset: mapping.file_offset,
    sha256: mapping.sha256,
    source_file_index: mapping.source_file_index,
    initialized: mapping.initialized,
    loaded: mapping.loaded,
    overlay: mapping.overlay,
    address_space: mapping.address_space,
    readable: mapping.readable ?? null,
    writable: mapping.writable ?? null,
    executable: mapping.executable ?? null,
  });
  const bssFacts = (mapping: BssFacts) => ({
    start: mapping.start,
    end: mapping.end,
    length: mapping.length,
    initialized: mapping.initialized,
    loaded: mapping.loaded,
    overlay: mapping.overlay,
    address_space: mapping.address_space,
    readable: mapping.readable ?? null,
    writable: mapping.writable ?? null,
    executable: mapping.executable ?? null,
  });

  const expectedFileMappings = header.sections
    .map((section, index) => {
      const permissions =
        section.kind === "text" ? TEXT_PERMISSIONS : DATA_PERMISSIONS;
      return {
        start: hex(section.address),
        end: hex(section.address + section.size - 1),
        length: section.size,
        file_offset: section.fileOffset,
        sha256: snapshot.sectionSha256[index] ?? null,
        source_file_index: 0,
        initialized: true,
        loaded: true,
        overlay: false,
        address_space: observations.default_address_space,
        ...permissions,
      };
    })
    .sort(byStart);
  const observedFileMappings = observations.mappings
    .filter((mapping) => mapping.source_file_index !== null)
    .map((mapping) => fileFacts(mapping))
    .sort(byStart);

  const bssRange = {
    start: header.bss.address,
    end: header.bss.address + header.bss.size,
  };
  const inBss = (address: string): boolean => {
    const offset = nativeAddressCoordinateInputSchema.parse(address).offset;
    return offset >= BigInt(bssRange.start) && offset < BigInt(bssRange.end);
  };
  const expectedBss = header.bssGaps.map((gap) => ({
    start: hex(gap.address),
    end: hex(gap.address + gap.size - 1),
    length: gap.size,
    initialized: false,
    loaded: true,
    overlay: false,
    address_space: observations.default_address_space,
    ...DATA_PERMISSIONS,
  }));
  const observedBssBlocks = observations.mappings.filter(
    (mapping) =>
      mapping.source_file_index === null &&
      !mapping.initialized &&
      mapping.address_space === observations.default_address_space &&
      inBss(mapping.start),
  );
  const observedBss = observedBssBlocks
    .map((mapping) => bssFacts(mapping))
    .sort(byStart);
  // Permissions are attested only when measured; an older observation without them fails closed.
  const unmeasured = observations.mappings
    .filter(
      (mapping) =>
        (mapping.source_file_index !== null ||
          observedBssBlocks.includes(mapping)) &&
        (mapping.readable === undefined ||
          mapping.writable === undefined ||
          mapping.executable === undefined),
    )
    .map((mapping) => mapping.block);

  const source = observations.source_files[0];
  check("executable_format", "Raw Binary", observations.executable_format);
  check("language_id", language.languageId, observations.language_id);
  if (language.compilerSpecId !== undefined)
    check(
      "compiler_spec_id",
      language.compilerSpecId,
      observations.compiler_spec_id,
    );
  check("image_base", "0x0", observations.image_base);
  check("source_file_count", 1, observations.source_files.length);
  check("source_file_size", snapshot.bytes, source?.size ?? null);
  check("original_file_sha256", target.sha256, source?.original_sha256 ?? null);
  check("modified_file_sha256", target.sha256, source?.modified_sha256 ?? null);
  check("file_backed_mappings", expectedFileMappings, observedFileMappings);
  check("bss_mappings", expectedBss, observedBss);
  // One check per observed block, so a mismatch names the block that broke.
  for (const mapping of observations.mappings) {
    if (mapping.source_file_index !== null) {
      check(
        `block ${mapping.block} at ${mapping.start}`,
        expectedFileMappings.find(
          (expected) => expected.start === mapping.start,
        ) ?? null,
        fileFacts(mapping),
        mapping.file_offset,
        mapping.start,
      );
    } else if (observedBssBlocks.includes(mapping)) {
      check(
        `block ${mapping.block} at ${mapping.start}`,
        expectedBss.find((expected) => expected.start === mapping.start) ??
          null,
        bssFacts(mapping),
        null,
        mapping.start,
      );
    }
  }
  check(
    "initialized_unbacked_mappings",
    0,
    observations.mappings.filter(
      (mapping) => mapping.initialized && mapping.source_file_index === null,
    ).length,
  );
  check(
    "entry_point",
    hex(header.entryPoint),
    observations.entry_points.find(
      (entry) => entry === hex(header.entryPoint),
    ) ?? null,
  );
  if (unmeasured.length > 0)
    check("block_permissions_measured", [], unmeasured);
  check("relocation_records", [], observations.relocations);
  return ok(
    nativeLoadImageSchema.parse({
      status: checks.every((item) => item.matched) ? "verified" : "mismatch",
      format: "gamecube-dol",
      target_sha256: target.sha256,
      architecture: "powerpc",
      language_id: observations.language_id,
      compiler_spec_id: observations.compiler_spec_id,
      file_bytes: snapshot.bytes,
      entry: { address: hex(header.entryPoint) },
      sections: header.sections.map((section) => ({
        kind: section.kind,
        index: section.index,
        file_offset: hex(section.fileOffset),
        address: hex(section.address),
        size: hex(section.size),
      })),
      bss: { address: hex(header.bss.address), size: hex(header.bss.size) },
      observations,
      checks,
      limitations: [
        "GameCube DOL is a header interpretation explicitly selected by the caller; the format is not identified from file bytes.",
        "Admission covers cached MEM1 addresses 0x80000000..0x81800000 only; Wii MEM2 and uncached aliases are not supported by this lane.",
        "Verification covers original/modified FileBytes identity, every used text and data section at its load address with exact file-byte digests, BSS as uninitialized gaps outside data sections, and the header entry. Each block is checked for address space, initialized/loaded/overlay state and read/write/execute permissions (text r-x, data and BSS rw-). Mapping ends are inclusive.",
        "The 256-byte header and any bytes between sections are not mapped and are not verified. Language-defined uninitialized blocks outside BSS are preserved as observations and not attested.",
        "A mismatching digest identifies its source range, not the first differing byte. No runtime, boot, or hardware state is modeled.",
      ],
    }),
  );
};
