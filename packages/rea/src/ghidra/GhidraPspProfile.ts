import type { BinaryTarget } from "../domain/binaryTargetTypes.js";
import {
  ghidraMipsGnuAttributesUnsupportedReason,
  ghidraMipsIncompleteDeclarationsReason,
  ghidraMipsUnsupportedReason,
} from "./GhidraMipsProfile.js";
import { ghidraPowerPcUnsupportedReason } from "./GhidraPowerPcProfile.js";
import { ghidraRiscvUnsupportedReason } from "./GhidraRiscvProfile.js";

/** Allegrex's ELF machine declaration, not a filename or inferred instruction. */
export const isGhidraPspTarget = (target: BinaryTarget): boolean =>
  target.kind === "executable" &&
  target.format === "elf" &&
  target.architecture === "mips" &&
  target.mips !== undefined &&
  (target.mips.flags & 0x00ff0000) === 0x00a20000;

/** PSP has its own verified interpretation; generic MIPS rules remain unchanged. */
export const ghidraProcessorUnsupportedReason = (
  target: BinaryTarget,
): string | null => {
  // DOL admission establishes its processor from the caller-selected format; the ELF PowerPC gate does not apply.
  if (target.kind === "executable" && target.format === "gamecube-dol")
    return null;
  if (target.kind === "executable" && target.architecture === "powerpc")
    return ghidraPowerPcUnsupportedReason(target);
  if (target.kind === "executable" && target.architecture === "riscv")
    return ghidraRiscvUnsupportedReason(target);
  if (
    target.kind !== "executable" ||
    target.architecture !== "mips" ||
    !isGhidraPspTarget(target)
  )
    return ghidraMipsUnsupportedReason(target);
  const metadata = target.mips;
  if (metadata === undefined) return "PSP analysis requires ELF metadata.";
  const gnuAttributesReason =
    ghidraMipsGnuAttributesUnsupportedReason(metadata);
  if (gnuAttributesReason !== null) return gnuAttributesReason;
  const incomplete = ghidraMipsIncompleteDeclarationsReason(metadata);
  if (incomplete !== null) return incomplete;
  if (metadata.elfClass !== 32 || metadata.byteOrder !== "little")
    return "The PSP Allegrex profile requires little-endian ELF32.";
  if (metadata.type !== 2)
    return "The PSP Allegrex profile supports static ET_EXEC only; PRX, shared and relocatable images require separate verification.";
  // PSPSDK emits MIPS-II / Allegrex / EABI32 with NOREORDER. Do not accept
  // unknown producer flags or treat this as proof of instruction semantics.
  if (metadata.flags !== 0x10a23001)
    return "The PSP Allegrex profile requires the verified PSPSDK ELF declaration 0x10a23001; other ISA/ABI/ASE flags are not inferred.";
  const abi = metadata.abiFlags;
  if (abi === undefined || abi === null)
    return "The PSP Allegrex profile requires an inspected separate MIPS ABI flags record; missing declarations are not inferred.";
  // PSPDEV v20261001: GNU readelf 2.44 and the 24-byte record agree on
  // MIPS II, 32-bit registers, single-precision hard float and flags1=1.
  // This is a bounded producer declaration, not a claim about VFPU semantics.
  if (
    abi.version !== 0 ||
    abi.isaLevel !== 2 ||
    abi.isaRevision !== 0 ||
    abi.gprSize !== 1 ||
    abi.cpr1Size !== 1 ||
    abi.cpr2Size !== 0 ||
    abi.fpAbi !== 2 ||
    abi.isaExtension !== 0 ||
    abi.ases !== 0 ||
    abi.flags1 !== 1 ||
    abi.flags2 !== 0
  )
    return "The separate MIPS ABI flags record does not match the verified PSP MIPS-II/32-bit/single-float declaration; other versions, register modes and extension flags require separate verification.";
  return null;
};

/** Propagated with every PSP observation, including successful decompilation. */
export const GHIDRA_PSP_LIMITATIONS = [
  "PSP/Allegrex analysis uses the caller-installed ghidra-allegrex extension. ELF declarations and selected instruction checks are not proof of runtime semantics.",
  "ghidra-allegrex does not model VFPU prefix effects completely in decompiled output. Verify vector behavior independently; pseudocode is not an execution oracle.",
  "This PSP profile covers static ELF32 ET_EXEC only. PRX relocations, PBP/ISO containers, live overlays and PSP emulation are outside this verified lane.",
] as const;
