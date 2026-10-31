import type { DolHeader } from "./gamecubeDol.js";
import type { ZipPackageFormat } from "./zipPackageFormat.js";

/** Provider-neutral CPU families detected from headers or explicitly selected raw loads. */
export const BINARY_ARCHITECTURES = [
  "x86",
  "x86_64",
  "arm",
  "arm64",
  "arm64_32",
  "mips",
  "6502",
  "riscv",
  "powerpc",
  "m68k",
  "hexagon",
] as const;
export type BinaryArchitecture = (typeof BINARY_ARCHITECTURES)[number];

/**
 * Families admitted only by explicit raw-binary selection. Header detection
 * never yields them, so detected targets and Evidence subjects exclude them.
 */
export const RAW_ONLY_ARCHITECTURES = [
  "6502",
  "m68k",
] as const satisfies readonly BinaryArchitecture[];
export type RawOnlyArchitecture = (typeof RAW_ONLY_ARCHITECTURES)[number];

/**
 * ELF header facts for a family whose ISA and ABI are not established by the
 * family name alone. Consumers admit a lane from these declarations rather than
 * re-reading the header.
 */
export interface ElfFamilyMetadata {
  readonly elfClass: 32 | 64;
  readonly byteOrder: "little" | "big";
  readonly type: number;
  readonly flags: number;
}

/** Referenced CodeView debug symbols from a PE debug directory. */
export interface PeCodeViewRecord {
  readonly pdbPath: string;
  readonly pdbFileName: string;
  readonly guid: string | null;
  readonly age: number;
}

/** Families whose parsed target variant carries `ElfFamilyMetadata`. */
export const ELF_METADATA_ARCHITECTURES = [
  "mips",
  "riscv",
  "powerpc",
] as const satisfies readonly BinaryArchitecture[];
export type ElfMetadataArchitecture =
  (typeof ELF_METADATA_ARCHITECTURES)[number];

/** Families whose ISA and ABI need a separate ELF declaration to be admitted. */
export const isElfMetadataArchitecture = (
  architecture: BinaryArchitecture,
): architecture is ElfMetadataArchitecture =>
  (ELF_METADATA_ARCHITECTURES as readonly string[]).includes(architecture);

/** Recognized family with no ELF metadata member; the header alone is the fact. */
export type HeaderArchitecture = Exclude<
  BinaryArchitecture,
  ElfMetadataArchitecture | RawOnlyArchitecture | "hexagon" | "arm64_32"
>;

/** Raw ELF facts; family recognition does not establish ISA or ABI support. */
export interface MipsElfMetadata extends ElfFamilyMetadata {
  /** Undefined until inspected; null means no ABI record was observed. */
  readonly abiFlags?: MipsAbiFlags | null;
  /** Undefined until inspected; null means no GNU attribute section was observed. */
  readonly gnuAttributes?: MipsGnuAttributes | null;
  /** Unavailable declaration sources; missing records there remain unknown. */
  readonly limitations?: readonly string[];
  /** Complete dynamic REL declarations, or the reason they could not be inspected. */
  readonly sharedLoad?:
    | {
        readonly status: "complete";
        readonly relocationCount: number;
        readonly relocationTypes: readonly number[];
        readonly symbolRelativeCount: number;
      }
    | { readonly status: "unavailable"; readonly reason: string };
}

/** Raw ELF facts; family recognition does not establish ISA or ABI support. */
export interface RiscvElfMetadata extends ElfFamilyMetadata {
  /** Undefined until `.riscv.attributes` is inspected. */
  readonly isa?: RiscvIsaDeclaration;
}

/** The ISA an image declares in `.riscv.attributes`; not proof of every instruction. */
export type RiscvIsaDeclaration =
  | {
      readonly status: "declared";
      /** `Tag_RISCV_arch` exactly as declared. */
      readonly arch: string;
      readonly xlen: 32 | 64;
      readonly base: "i" | "e";
      /** Extension names in declaration order, without versions. */
      readonly extensions: readonly string[];
    }
  /** Every section header was examined and none declares `Tag_RISCV_arch`. */
  | { readonly status: "absent" }
  | {
      readonly status: "unavailable";
      readonly reason: string;
      /** The declared string, when one was read but not understood. */
      readonly arch?: string;
    };

/** Declared fields of the 24-byte MIPS ABI flags record, not inferred semantics. */
export interface MipsAbiFlags {
  readonly version: number;
  readonly isaLevel: number;
  readonly isaRevision: number;
  readonly gprSize: number;
  readonly cpr1Size: number;
  readonly cpr2Size: number;
  readonly fpAbi: number;
  readonly isaExtension: number;
  readonly ases: number;
  readonly flags1: number;
  readonly flags2: number;
}

/** File-scope GNU object attributes parsed from `SHT_GNU_ATTRIBUTES`. */
export interface MipsGnuAttributes {
  /** Tag_GNU_MIPS_ABI_FP; null means this file did not declare the tag. */
  readonly fpAbi: number | null;
  /** Tag_GNU_MIPS_ABI_MSA vector-argument ABI; null means undeclared. */
  readonly msa: number | null;
}

/** Byte range of the selected slice inside its universal Mach-O container. */
export interface UniversalMachOSlice {
  readonly offset: number;
  readonly size: number;
}

/** FAT-table identity; CPU family alone cannot identify a universal slice. */
export interface UniversalMachOSliceIdentity extends UniversalMachOSlice {
  readonly cpuType: number;
  readonly cpuSubtype: number;
}

interface BinaryTargetIdentity {
  readonly path: string;
  readonly sourcePath?: string;
  /** Selected artifact spelling determines name-based format hints and external companions. */
  readonly artifactSelectedPath?: string;
  /** Info.plist of the app bundle the target was resolved from. */
  readonly bundleInfoPlist?: string;
  readonly sha256: string;
}

type NonExecutableMetadata = {
  readonly architecture?: never;
  readonly availableArchitectures?: never;
  readonly executableRole?: never;
  readonly managed?: never;
};

type ExecutableTarget = BinaryTargetIdentity & {
  readonly kind: "executable";
  readonly architecture: HeaderArchitecture;
  readonly availableArchitectures: readonly HeaderArchitecture[];
};

/**
 * Canonical local target identity and provider-neutral file classification.
 * Each variant carries only metadata established for that exact file kind.
 */
export type BinaryTarget =
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "elf";
      readonly architecture: "mips";
      readonly availableArchitectures: readonly "mips"[];
      readonly mips: MipsElfMetadata;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "elf";
      readonly architecture: "riscv";
      readonly availableArchitectures: readonly "riscv"[];
      readonly riscv: RiscvElfMetadata;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "elf";
      readonly architecture: "powerpc";
      readonly availableArchitectures: readonly "powerpc"[];
      /** Family identity does not select a processor variant. */
      readonly powerpc: ElfFamilyMetadata;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "elf";
      readonly architecture: "hexagon";
      readonly availableArchitectures: readonly "hexagon"[];
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "mach-o";
      readonly architecture: "arm64_32";
      readonly availableArchitectures: readonly "arm64_32"[];
      readonly universalSlice?: never;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (ExecutableTarget & {
      readonly format: "mach-o" | "elf" | "dos-mz" | "dos-com";
      readonly universalSlice?: never;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (ExecutableTarget & {
      readonly format: "mach-o-universal";
      /** Selected slice range a provider must analyze instead of the container. */
      readonly universalSlice: UniversalMachOSlice;
      /** Exact validated FAT declarations, when supplied by target admission. */
      readonly universalSlices?: readonly UniversalMachOSliceIdentity[];
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "raw-binary";
      readonly architecture: HeaderArchitecture | RawOnlyArchitecture;
      readonly availableArchitectures: readonly (
        | HeaderArchitecture
        | RawOnlyArchitecture
      )[];
      readonly entryPoint: string;
      readonly entryPointSource: string;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (BinaryTargetIdentity & {
      readonly kind: "executable";
      readonly format: "gamecube-dol";
      /** Fixed by the DOL selection; the header does not carry a CPU family. */
      readonly architecture: "powerpc";
      readonly availableArchitectures: readonly ["powerpc"];
      readonly byteOrder: "big";
      readonly bits: 32;
      /** Canonical hex entry taken from the DOL header. */
      readonly entryPoint: string;
      readonly entryPointSource: "dol-header";
      /** Validated header: used sections, BSS, and BSS-overlapping data slots. */
      readonly dol: DolHeader;
      readonly executableRole?: never;
      readonly managed?: never;
    })
  | (ExecutableTarget & {
      readonly format: "pe";
      /** Original COFF machine; undefined means this header fact is unavailable. */
      readonly peMachine?: number;
      /** Provider-neutral PE image role observed from COFF characteristics. */
      readonly executableRole:
        | "application"
        | "shared-library"
        | "non-executable";
      /** Whether the PE declares a non-empty CLI header data-directory entry. */
      readonly managed: boolean;
      /** Referenced CodeView debug symbols from the PE debug directory, if present. */
      readonly codeView?: PeCodeViewRecord;
    })
  | (BinaryTargetIdentity &
      NonExecutableMetadata & {
        readonly kind: "database";
        readonly format: "analysis-database";
      })
  | (BinaryTargetIdentity &
      NonExecutableMetadata & {
        readonly kind: "archive";
        readonly format:
          | ZipPackageFormat
          | "asar"
          | "ines"
          | "godot-pck"
          | "unityfs"
          | "uimage"
          | "dmg"
          | "pkg"
          | "intel-hex"
          | "srec"
          | "esp-image"
          | "uf2"
          | "dfuse"
          | "fit";
      })
  | (BinaryTargetIdentity &
      NonExecutableMetadata & {
        readonly kind: "archive";
        readonly format: "esp-flash-image";
        /** How the dump is read; null inputs take their defaults. */
        readonly espFlash: EspFlashTargetSelection;
      })
  | (BinaryTargetIdentity &
      NonExecutableMetadata & {
        readonly kind: "artifact";
        readonly format: "plist" | "javascript" | "source-map";
      });

/** Caller inputs that select how an ESP flash dump is read. */
export interface EspFlashTargetSelection {
  /** The caller selected the format, so the table scan runs without a bootloader. */
  readonly selected: boolean;
  /** Flash address of the dump's first byte. */
  readonly flashOffset: number | null;
  /** Flash address of the partition table. */
  readonly partitionTableOffset: number | null;
}

/** Whether an executable target contains a thin or universal Mach-O image. */
export const isMachOFormat = (
  format: unknown,
): format is "mach-o" | "mach-o-universal" =>
  format === "mach-o" || format === "mach-o-universal";

/** Result-affecting artifact selection; canonical packed identity remains target.path. */
export const artifactTargetSelectedPath = (target: BinaryTarget): string =>
  target.kind === "archive" || target.kind === "artifact"
    ? (target.artifactSelectedPath ?? target.sourcePath ?? target.path)
    : (target.sourcePath ?? target.path);
