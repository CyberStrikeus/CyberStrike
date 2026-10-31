import type { RawBinaryAdmission } from "../domain/rawBinary.js";

/** Bound Ghidra language for a caller-supplied raw-binary architecture. */
export interface GhidraRawBinaryLanguage {
  readonly languageId: string;
  readonly compilerSpecId: "default" | "gcc";
  readonly defaultAddressSpace: "ram" | "RAM";
}

/**
 * Map caller-visible CPU families to generic Ghidra languages with a
 * supported generic compiler specification. These are analysis conventions,
 * not evidence of the target's original compiler. Each family has one fixed
 * byte order: m68k is big-endian and the others are little-endian. Big-endian
 * ARM, Thumb-only, Cortex-M, and other processor variants are out of scope.
 */
export const ghidraRawBinaryLanguage = (
  architecture: RawBinaryAdmission["architecture"],
): GhidraRawBinaryLanguage => {
  switch (architecture) {
    case "6502":
      return {
        languageId: "6502:LE:16:default",
        compilerSpecId: "default",
        defaultAddressSpace: "RAM",
      };
    case "m68k":
      // Ghidra's default 68000 language decodes the 68040 superset; no
      // MC68000-only variant is declared in the 68000 processor module.
      return {
        languageId: "68000:BE:32:default",
        compilerSpecId: "default",
        defaultAddressSpace: "ram",
      };
    case "x86":
      return {
        languageId: "x86:LE:32:default",
        compilerSpecId: "gcc",
        defaultAddressSpace: "ram",
      };
    case "x86_64":
      return {
        languageId: "x86:LE:64:default",
        compilerSpecId: "gcc",
        defaultAddressSpace: "ram",
      };
    case "arm":
      return {
        languageId: "ARM:LE:32:v7",
        compilerSpecId: "default",
        defaultAddressSpace: "ram",
      };
    case "arm64":
      return {
        languageId: "AARCH64:LE:64:v8A",
        compilerSpecId: "default",
        defaultAddressSpace: "ram",
      };
  }
};
