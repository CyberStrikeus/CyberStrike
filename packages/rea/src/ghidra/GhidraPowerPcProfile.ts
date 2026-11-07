import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";

/**
 * Generic 32-bit big-endian PowerPC. Ghidra's ELF loader selects the e500
 * (Book-E/SPE) variant for a plain EM_PPC header, so the lane binds this
 * language instead of accepting the loader's choice.
 */
export const GHIDRA_POWERPC_LANGUAGE: GhidraLanguageOverride = {
  languageId: "PowerPC:BE:32:default",
  compilerSpecId: "default",
};

/** Keep family recognition separate from the deliberately bounded Ghidra lane. */
export const ghidraPowerPcUnsupportedReason = (
  target: BinaryTarget,
): string | null => {
  if (target.kind !== "executable" || target.architecture !== "powerpc")
    return null;
  const missingMetadata =
    "PowerPC analysis requires ELF header metadata; a family name alone does not select a processor variant.";
  if (target.format !== "elf") return missingMetadata;
  const metadata = target.powerpc;
  if (metadata === undefined) return missingMetadata;
  if (metadata.elfClass !== 32)
    return "This Ghidra PowerPC lane supports ELF32 only; PPC64 remains unsupported.";
  if (metadata.byteOrder !== "big")
    return "This Ghidra PowerPC lane supports big-endian ELF32 only; little-endian PowerPC needs separate verification.";
  if (metadata.type !== 2)
    return "This Ghidra PowerPC lane supports ET_EXEC only; relocatable objects and shared images need separate load verification.";
  // EF_PPC_EMB (0x80000000) marks embedded variants; other bits only declare
  // relocation conventions that do not change instruction decoding.
  if ((metadata.flags & 0x80000000) !== 0)
    return "EF_PPC_EMB declares an embedded PowerPC variant that needs a separately supported processor profile.";
  return null;
};

/**
 * The language the lane imports with, unless REA_GHIDRA_LANGUAGE_ID already
 * selected one through the committed profile.
 */
export const ghidraPowerPcLanguage = (
  target: BinaryTarget,
): GhidraLanguageOverride | undefined =>
  target.kind === "executable" && target.architecture === "powerpc"
    ? GHIDRA_POWERPC_LANGUAGE
    : undefined;

/** Commit source ELF interpretation without confusing target ISA with host CPU. */
export const ghidraPowerPcProfileParameters = (
  target: BinaryTarget,
): Readonly<Record<string, JsonValue>> => {
  if (
    target.kind !== "executable" ||
    target.architecture !== "powerpc" ||
    target.format !== "elf" ||
    target.powerpc === undefined
  )
    return {};
  return {
    powerpc_elf: {
      elf_class: target.powerpc.elfClass,
      byte_order: target.powerpc.byteOrder,
      type: target.powerpc.type,
      flags: target.powerpc.flags,
    },
    powerpc_support_lane: "elf32-be-exec-generic-v1",
  };
};
