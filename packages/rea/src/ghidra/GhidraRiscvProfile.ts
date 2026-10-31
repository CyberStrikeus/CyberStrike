import type {
  BinaryTarget,
  RiscvElfMetadata,
  RiscvIsaDeclaration,
} from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";
import {
  riscvAbiName,
  riscvFloatAbi,
  type RiscvFloatAbi,
} from "../domain/riscvIsaDeclaration.js";
import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";

/** Calling-convention policy ids an analysis profile can commit. */
export const GHIDRA_RISCV_CALLING_CONVENTION_IDS = [
  "ilp32-prototype-v1",
] as const;
export type GhidraRiscvCallingConvention =
  (typeof GHIDRA_RISCV_CALLING_CONVENTION_IDS)[number];

/**
 * The ABI and prototype of each policy REA applies after analysis.
 * `ReaGhidraRiscvCallingConvention.java` derives each prototype from the
 * pinned language's default `riscv32-fp.cspec` model, which is ilp32d;
 * docs/ghidra-riscv.md states the rules of each ABI.
 */
export const GHIDRA_RISCV_CALLING_CONVENTIONS: Readonly<
  Record<
    GhidraRiscvCallingConvention,
    { readonly abi: string; readonly prototype: string }
  >
> = {
  "ilp32-prototype-v1": { abi: "ilp32", prototype: "__rea_ilp32" },
};

/** One admitted ELF class and declared float ABI. */
export interface GhidraRiscvLane {
  readonly elfClass: 32 | 64;
  readonly floatAbi: RiscvFloatAbi;
  /** Absent: Ghidra's stock double-float model applies unchanged. */
  readonly callingConvention?: GhidraRiscvCallingConvention;
}

/** Every class and float ABI pair the Ghidra lane admits; others are refused. */
export const GHIDRA_RISCV_LANES: readonly GhidraRiscvLane[] = [
  { elfClass: 64, floatAbi: "double" },
  { elfClass: 32, floatAbi: "double" },
  { elfClass: 32, floatAbi: "soft", callingConvention: "ilp32-prototype-v1" },
];

/** Lane ids are built from their fields, so a new ABI or load model adds a value. */
export const ghidraRiscvSupportLane = (lane: GhidraRiscvLane): string =>
  `elf${lane.elfClass}-exec-le-${lane.floatAbi}-float-generic-v1`;

/**
 * Extensions Ghidra 12.1.4's generic RV32 language implements with p-code, by
 * the names `Tag_RISCV_arch` records. Lanes with a calling-convention policy
 * admit an image only when it declares an RV32I base and only these.
 */
export const GHIDRA_RISCV32_DECODED_EXTENSIONS: ReadonlySet<string> = new Set([
  "m",
  "a",
  "f",
  "d",
  "c",
  "zicsr",
  "zifencei",
  "zmmul",
  "zaamo",
  "zalrsc",
  "zca",
  "zcf",
  "zcd",
]);

/** Outcome the post-analysis script records for the bridge handshake. */
export interface GhidraRiscvCallingConventionReport {
  readonly policy: GhidraRiscvCallingConvention;
  readonly functions: number;
  readonly definitions: number;
}

const EF_RISCV_RVC = 0x0001;
const EF_RISCV_FLOAT_ABI = 0x0006;
const EF_RISCV_RVE = 0x0008;
const EF_RISCV_TSO = 0x0010;

const ET_REL = 1;
const ET_EXEC = 2;
const ET_DYN = 3;

/**
 * Bits this lane reads. Anything else in `e_flags` — reserved today or defined by
 * a newer psABI — is refused rather than assumed compatible.
 */
const EF_RISCV_DECLARED_BITS = EF_RISCV_RVC | EF_RISCV_FLOAT_ABI;

/** The lane a class and declared float ABI select, if the table admits one. */
const ghidraRiscvLane = (
  metadata: RiscvElfMetadata,
): GhidraRiscvLane | undefined => {
  const floatAbi = riscvFloatAbi(metadata.flags);
  return GHIDRA_RISCV_LANES.find(
    (lane) => lane.elfClass === metadata.elfClass && lane.floatAbi === floatAbi,
  );
};

/** Name what a refused float ABI lacks, from the table admission reads. */
const ghidraRiscvFloatAbiRefusal = (metadata: RiscvElfMetadata): string => {
  const floatAbi = riscvFloatAbi(metadata.flags);
  const name = riscvAbiName(metadata.elfClass, floatAbi);
  const admitted = GHIDRA_RISCV_LANES.filter(
    (lane) => lane.elfClass === metadata.elfClass,
  ).map((lane) => `${lane.floatAbi}-float`);
  return `This Ghidra RISC-V lane admits ELF${metadata.elfClass} images that declare the ${admitted.join(
    " or ",
  )} ABI; the ${floatAbi}-float ABI${
    name === null ? "" : ` (${name})`
  } declared by e_flags has no verified calling-convention policy.`;
};

/** Lanes with a calling-convention policy admit declared, decoded RV32I only. */
const ghidraRiscvIsaRefusal = (
  isa: RiscvIsaDeclaration | undefined,
): string | null => {
  if (isa === undefined)
    return "This RISC-V lane requires the image's .riscv.attributes ISA declaration, which was not inspected.";
  if (isa.status === "absent")
    return "This RISC-V lane requires a Tag_RISCV_arch declaration in .riscv.attributes; the image declares none, so its extensions are unknown.";
  if (isa.status === "unavailable")
    return `This RISC-V lane requires a readable Tag_RISCV_arch declaration: ${isa.reason}.`;
  if (isa.xlen !== 32 || isa.base !== "i")
    return `Tag_RISCV_arch declares ${isa.arch}; this lane requires the RV32I base.`;
  const outside = isa.extensions.filter(
    (extension) => !GHIDRA_RISCV32_DECODED_EXTENSIONS.has(extension),
  );
  return outside.length === 0
    ? null
    : `Tag_RISCV_arch declares extensions outside the set this lane decodes: ${outside.join(
        ", ",
      )}. Ghidra 12.1.4's generic RV32 language implements only ${[
        ...GHIDRA_RISCV32_DECODED_EXTENSIONS,
      ].join(", ")} with p-code; see docs/ghidra-riscv.md.`;
};

/**
 * Keep family recognition separate from the deliberately bounded Ghidra lane.
 *
 * Ghidra 12.1.4 selects `RISCV:LE:32:AndeStar_v5` for an ordinary RV32 ELF: its
 * `riscv.opinion` pins `variant="default"` for the 64-bit constraint and leaves
 * the 32-bit one with the comment that the loader "must choose between 'default'
 * and 'AndeStar' variants". The lane therefore pins the language instead of
 * accepting the header-based guess.
 */
export const ghidraRiscvUnsupportedReason = (
  target: BinaryTarget,
): string | null => {
  if (target.kind !== "executable" || target.architecture !== "riscv")
    return null;
  const metadata = target.riscv;
  if (target.format !== "elf")
    return "RISC-V analysis requires ELF header metadata; a family name alone does not select an ISA or ABI.";
  if (metadata.byteOrder !== "little")
    return "This Ghidra RISC-V lane supports little-endian images only; Ghidra 12.1.4 ships no big-endian RISC-V language.";
  if (metadata.elfClass !== 32 && metadata.elfClass !== 64)
    return "This Ghidra RISC-V lane requires ELF32 or ELF64; the class decides which generic language is pinned.";
  if ((metadata.flags & EF_RISCV_RVE) !== 0)
    return "EF_RISCV_RVE declares the embedded 16-register ABI (x0-x15), which needs its own processor specification and compiler verification.";
  if ((metadata.flags & EF_RISCV_TSO) !== 0)
    return "EF_RISCV_TSO declares the total-store-order memory model; this lane verifies the baseline model only.";
  if (metadata.type !== ET_EXEC)
    return `This Ghidra RISC-V lane supports fixed-address ET_EXEC only; ${
      metadata.type === ET_REL
        ? "relocatable"
        : metadata.type === ET_DYN
          ? "shared and position-independent"
          : `e_type ${metadata.type}`
    } images need separate load verification. ET_EXEC alone does not establish static linkage, which this lane does not inspect.`;
  const lane = ghidraRiscvLane(metadata);
  if (lane === undefined) return ghidraRiscvFloatAbiRefusal(metadata);
  const unsupportedFlags = (metadata.flags & ~EF_RISCV_DECLARED_BITS) >>> 0;
  if (unsupportedFlags !== 0)
    return `RISC-V e_flags declares bits outside the verified lane (0x${unsupportedFlags.toString(16)}); reserved or newer declarations are not treated as compatible with this profile.`;
  return lane.callingConvention === undefined
    ? null
    : ghidraRiscvIsaRefusal(metadata.isa);
};

/** The calling-convention policy an admitted target's lane applies, if any. */
export const ghidraRiscvCallingConvention = (
  target: BinaryTarget,
): GhidraRiscvCallingConvention | undefined =>
  target.kind === "executable" &&
  target.architecture === "riscv" &&
  ghidraRiscvUnsupportedReason(target) === null
    ? ghidraRiscvLane(target.riscv)?.callingConvention
    : undefined;

/** Pin a language only for declarations admitted by the same lane boundary. */
export const ghidraRiscvLanguageOverride = (
  target: BinaryTarget,
): GhidraLanguageOverride | undefined =>
  target.kind === "executable" &&
  target.architecture === "riscv" &&
  ghidraRiscvUnsupportedReason(target) === null
    ? {
        languageId: `RISCV:LE:${target.riscv.elfClass}:default`,
        compilerSpecId: "gcc",
      }
    : undefined;

/**
 * Commit source ELF interpretation without confusing target ISA with host CPU.
 * Lanes with a calling-convention policy also commit the declarations that
 * admitted them; double-float profiles keep their original parameters.
 */
export const ghidraRiscvProfileParameters = (
  target: BinaryTarget,
): Readonly<Record<string, JsonValue>> => {
  if (
    target.kind !== "executable" ||
    target.architecture !== "riscv" ||
    target.riscv === undefined
  )
    return {};
  const floatAbi = riscvFloatAbi(target.riscv.flags);
  const convention = ghidraRiscvCallingConvention(target);
  const isa = target.riscv.isa;
  return {
    riscv_elf: {
      elf_class: target.riscv.elfClass,
      byte_order: target.riscv.byteOrder,
      type: target.riscv.type,
      flags: target.riscv.flags,
      float_abi_double: floatAbi === "double",
      rvc_declared: (target.riscv.flags & EF_RISCV_RVC) !== 0,
      rve_declared: (target.riscv.flags & EF_RISCV_RVE) !== 0,
      tso_declared: (target.riscv.flags & EF_RISCV_TSO) !== 0,
      ...(convention === undefined || isa?.status !== "declared"
        ? {}
        : { float_abi: floatAbi, arch: isa.arch }),
    },
    ...(convention === undefined
      ? {}
      : { riscv_calling_convention: convention }),
    riscv_support_lane: ghidraRiscvSupportLane({
      elfClass: target.riscv.elfClass,
      floatAbi,
    }),
  };
};

/** The pinned language is an analysis convention, not proof of the producer. */
export const ghidraRiscvLimitations = (
  target: BinaryTarget,
): readonly string[] => {
  if (target.kind !== "executable" || target.architecture !== "riscv")
    return [];
  const convention = ghidraRiscvCallingConvention(target);
  const floatAbi = riscvFloatAbi(target.riscv.flags);
  const isa = target.riscv.isa;
  return [
    `RISC-V ELF: REA pins Ghidra's generic \`RISCV:LE:${target.riscv.elfClass}:default\` language with the \`gcc\` compiler specification instead of accepting the loader's header-based choice, which selects \`RISCV:LE:32:AndeStar_v5\` for ordinary RV32 images on Ghidra 12.1.4.`,
    convention === undefined
      ? "The pinned generic language models the double-float ABI declared by `e_flags`; the declaration is recorded as an ELF fact and is not evidence of the original compiler or of verified instruction semantics."
      : `The ELF header declares the ${floatAbi}-float ABI (${
          GHIDRA_RISCV_CALLING_CONVENTIONS[convention].abi
        }); the pinned language's compiler specification models ilp32d, so REA applies its \`${
          GHIDRA_RISCV_CALLING_CONVENTIONS[convention].prototype
        }\` prototype instead. The declaration is recorded as an ELF fact and is not evidence of the original compiler.`,
    ...(convention !== undefined && isa?.status === "declared"
      ? [
          `\`.riscv.attributes\` declares \`${isa.arch}\`. Every declared extension is in the set this lane decodes; the declaration does not prove that every instruction belongs to it.`,
        ]
      : []),
    "Admission reads `e_type` only: a fixed-address ET_EXEC declaration does not establish static linkage, and program headers (`PT_INTERP`, dynamic dependencies) are not inspected by this lane.",
  ];
};

/** Fail closed unless the bridge applied exactly the committed policy. */
export const ghidraRiscvCallingConventionFailure = (
  expected: GhidraRiscvCallingConvention | undefined,
  report: GhidraRiscvCallingConventionReport | undefined,
): string | undefined =>
  expected === report?.policy
    ? undefined
    : expected === undefined
      ? "The Ghidra session reported a RISC-V calling-convention policy that the profile did not commit."
      : `The Ghidra session did not report the committed RISC-V calling-convention policy ${expected}.`;

/** State the prototype REA applies, and its outcome once the bridge reports it. */
export const ghidraRiscvCallingConventionLimitations = (
  expected: GhidraRiscvCallingConvention | undefined,
  report?: GhidraRiscvCallingConventionReport,
): readonly string[] => {
  if (expected === undefined) return [];
  const { abi, prototype } = GHIDRA_RISCV_CALLING_CONVENTIONS[expected];
  return [
    `RISC-V ${abi}: Ghidra's generic RV32 compiler specification models ilp32d. After analysis REA installs a program-specific \`${prototype}\` prototype, derived from the default prototype by policy ${expected} (docs/ghidra-riscv.md), and assigns it with dynamic storage to every function, external function and function definition. Thunks follow their targets.`,
    ...(report === undefined
      ? []
      : [
          `RISC-V calling-convention outcome: ${report.functions} functions and ${report.definitions} function definitions use ${prototype}.`,
        ]),
    "Ghidra recovers a variadic call's arguments from the registers the caller writes, not from their types: a padding register can appear as an argument, and arguments after an unwritten register are omitted.",
  ];
};
