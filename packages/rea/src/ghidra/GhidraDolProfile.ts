import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { DolHeader } from "../domain/gamecubeDol.js";
import type { JsonValue } from "../domain/jsonValue.js";

/** Stock Ghidra language for the GameCube/Wii Broadway core, without the GameCubeLoader extension. */
export const GHIDRA_GAMECUBE_DOL_LANGUAGE: GhidraLanguageOverride = {
  languageId: "PowerPC:BE:32:default",
  compilerSpecId: "default",
};

const DOL_LANGUAGE_PREFIX = "PowerPC:BE:32:";

/**
 * A DOL import is always big-endian 32-bit PowerPC. A caller override may name
 * another variant of that family (for example Gekko_Broadway from the optional
 * extension) but never a different processor or endianness.
 */
export const ghidraDolLanguageUnsupportedReason = (
  override: GhidraLanguageOverride | undefined,
): string | null =>
  override === undefined || override.languageId.startsWith(DOL_LANGUAGE_PREFIX)
    ? null
    : `A GameCube DOL import requires a ${DOL_LANGUAGE_PREFIX}* language; ${override.languageId} is not a big-endian 32-bit PowerPC variant.`;

/**
 * The language a DOL import uses. An override without a compiler spec keeps the
 * language's own default spec, which is recorded as `language-default`.
 */
export const ghidraDolLanguage = (
  override: GhidraLanguageOverride | undefined,
): GhidraLanguageOverride => override ?? GHIDRA_GAMECUBE_DOL_LANGUAGE;

const hex = (value: number): string => `0x${value.toString(16)}`;

/**
 * Versioned map consumed by the Java pre-script. Counts establish completeness;
 * section and BSS-gap rows reproduce the domain owner's parsed load ranges.
 */
export const ghidraDolSectionFile = (header: DolHeader): string =>
  [
    `plan 2 ${String(header.sections.length)} ${String(header.bssGaps.length)}`,
    ...header.sections.map(
      (section) =>
        `section ${section.kind} ${section.index} ${hex(section.fileOffset)} ${hex(section.address)} ${hex(section.size)}`,
    ),
    ...header.bssGaps.map(
      (gap) => `bss-gap ${hex(gap.address)} ${hex(gap.size)}`,
    ),
    `entry ${hex(header.entryPoint)}`,
  ].join("\n") + "\n";

/** Profile parameters that commit the header interpretation to the analysis identity. */
export const ghidraDolProfileParameters = (
  header: DolHeader,
): Readonly<Record<string, JsonValue>> => ({
  dol_import: "binary-loader-sections-v2",
  dol_sections: header.sections.map((section) => ({
    kind: section.kind,
    index: section.index,
    file_offset: hex(section.fileOffset),
    address: hex(section.address),
    size: hex(section.size),
  })),
  dol_bss: { address: hex(header.bss.address), size: hex(header.bss.size) },
  dol_bss_overlaps: [...header.bssOverlaps],
});
