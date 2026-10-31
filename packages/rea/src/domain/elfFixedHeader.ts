import type {
  BinaryArchitecture,
  RawOnlyArchitecture,
} from "./binaryTargetTypes.js";
import { err, ok, type Result } from "./result.js";

/** CPU families an ELF e_machine can name; arm64_32 is a Mach-O-only CPU type. */
type ElfArchitecture = Exclude<
  BinaryArchitecture,
  RawOnlyArchitecture | "arm64_32"
>;

/** Fixed declarations after common ELF framing, before consumer admission. */
export interface ElfHeaderFacts {
  readonly elfClass: 32 | 64;
  readonly byteOrder: "little" | "big";
  readonly headerSize: number;
  readonly machine: number;
  readonly type: number;
  readonly flags: number;
  readonly osAbi: number;
  readonly version: number;
  readonly abiVersion: number;
}

export interface ElfFixedHeader extends Omit<
  ElfHeaderFacts,
  "version" | "abiVersion"
> {
  readonly architecture: ElfArchitecture | null;
}

/**
 * Decode common ELF framing and fixed fields; version and declared-size admission belong to consumers.
 *
 * `bytes` may be a bounded prefix. `totalBytes` is the containing file size;
 * common framing requires a complete fixed header in both. The declared
 * headerSize is retained without requiring or admitting that entire extent.
 */
export const readElfHeaderFacts = (
  bytes: Buffer,
  totalBytes = bytes.length,
): Result<ElfHeaderFacts, string> => {
  if (bytes.length >= 4 && bytes.toString("hex", 0, 4) !== "7f454c46")
    return err("not an ELF image");
  if (bytes.length < 16) return err("ELF identification is truncated");
  const classByte = bytes[4];
  if (classByte !== 1 && classByte !== 2) return err("unsupported ELF class");
  const dataByte = bytes[5];
  if (dataByte !== 1 && dataByte !== 2)
    return err("unsupported ELF endianness");
  if (bytes[6] !== 1) return err("unsupported ELF identification version");

  const elfClass = classByte === 1 ? 32 : 64;
  const minimumSize = elfClass === 32 ? 52 : 64;
  if (
    !Number.isSafeInteger(totalBytes) ||
    totalBytes < bytes.length ||
    totalBytes < minimumSize ||
    bytes.length < minimumSize
  )
    return err(
      `truncated ELF header: an ELF${elfClass} header needs ${minimumSize} bytes; the file has ${totalBytes}`,
    );
  const littleEndian = dataByte === 1;
  const readU16 = (offset: number): number =>
    littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset);
  const readU32 = (offset: number): number =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const machine = readU16(18);
  const headerSize = readU16(elfClass === 32 ? 40 : 52);
  return ok({
    elfClass,
    byteOrder: littleEndian ? "little" : "big",
    headerSize,
    machine,
    type: readU16(16),
    flags: readU32(elfClass === 32 ? 36 : 48),
    osAbi: bytes[7]!,
    version: readU32(20),
    abiVersion: bytes[8]!,
  });
};

/** Admit the ELF version and declared header extent for general analysis. */
export const readElfFixedHeader = (
  bytes: Buffer,
  totalBytes = bytes.length,
): Result<ElfFixedHeader, string> => {
  const parsed = readElfHeaderFacts(bytes, totalBytes);
  if (!parsed.ok) return parsed;
  const facts = parsed.value;
  // NVIDIA CUBIN uses ELFOSABI_CUDA and a vendor ABI version in e_version.
  if (facts.version !== 1 && !(facts.machine === 190 && facts.osAbi === 0x33))
    return err("unsupported ELF header version");
  const minimumSize = facts.elfClass === 32 ? 52 : 64;
  if (facts.headerSize < minimumSize || facts.headerSize > totalBytes)
    return err("invalid ELF header size");
  return ok({
    elfClass: facts.elfClass,
    byteOrder: facts.byteOrder,
    headerSize: facts.headerSize,
    machine: facts.machine,
    type: facts.type,
    flags: facts.flags,
    osAbi: facts.osAbi,
    architecture: elfArchitecture(facts.machine) ?? null,
  });
};

export const elfArchitecture = (
  machine: number,
): ElfArchitecture | undefined => {
  switch (machine) {
    case 3:
      return "x86";
    case 62:
      return "x86_64";
    case 8: // EM_MIPS: ISA, ABI and byte order remain separate ELF facts.
      return "mips";
    case 20: // EM_PPC; byte order and processor variant remain ELF declarations.
      return "powerpc";
    case 40:
      return "arm";
    case 164: // EM_HEXAGON: Qualcomm Hexagon DSP (QDSP6).
      return "hexagon";
    case 183:
      return "arm64";
    case 243: // EM_RISCV: XLEN, byte order and e_flags remain separate ELF facts.
      return "riscv";
  }
  return undefined;
};
