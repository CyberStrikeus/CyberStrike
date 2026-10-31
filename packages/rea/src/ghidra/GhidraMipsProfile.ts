import { isDeepStrictEqual } from "node:util";
import type { GhidraLanguageOverride } from "../config/ghidraLanguageOverride.js";
import type {
  BinaryTarget,
  MipsElfMetadata,
} from "../domain/binaryTargetTypes.js";
import type { JsonValue } from "../domain/jsonValue.js";

const MIPS_FP_ABI_SOFT = 3;
const MIPS_ET_REL = 1;
const MIPS_ET_EXEC = 2;
const MIPS_ET_DYN = 3;
const MIPS16_HEADER_ASE = 0x04000000;
const MIPS_ARCH_1 = 0x00000000;
const MIPS_ARCH_32 = 0x50000000;
const MIPS_ARCH_32R2 = 0x70000000;

/** A distinct compressed shared-image shape; admission still checks every declaration. */
const isGhidraMips16SharedTarget = (target: BinaryTarget): boolean =>
  target.kind === "executable" &&
  target.architecture === "mips" &&
  target.mips.type === MIPS_ET_DYN &&
  (target.mips.flags & 0x0f000000) === MIPS16_HEADER_ASE;

/** Derive the verified MIPS32 import pin from this target's observed byte order. */
export const ghidraMipsLanguageOverride = (
  target: BinaryTarget,
): GhidraLanguageOverride | undefined =>
  (isGhidraMips16SharedTarget(target) || hasLegacyMipsHeaderShape(target)) &&
  ghidraMipsUnsupportedReason(target) === null &&
  target.architecture === "mips"
    ? {
        languageId: `MIPS:${target.mips.byteOrder === "little" ? "LE" : "BE"}:32:default`,
        compilerSpecId: "default",
      }
    : undefined;

/**
 * Recordless legacy ELF32 MIPS admission: the header declares no ABI field and
 * carries no ABI flags record, so o32 is an analysis assumption derived from
 * ELF32/ET_EXEC structure, never a declared fact. MIPS-I (`EF_MIPS_ARCH_1`),
 * MIPS32 and MIPS32r2 headers share this recordless shape. Ghidra's header
 * auto-selection picks a 64-bit language for exactly these files, so the lane
 * pins the 32-bit language instead.
 */
const hasLegacyMipsHeaderShape = (target: BinaryTarget): boolean => {
  if (
    target.kind !== "executable" ||
    target.architecture !== "mips" ||
    target.format !== "elf" ||
    target.mips === undefined
  )
    return false;
  const { flags, abiFlags, limitations } = target.mips;
  const arch = flags & 0xf0000000;
  return (
    // The lane and its verification cover executable firmware images only;
    // recordless relocatable objects stay outside the inferred-o32 assumption.
    target.mips.elfClass === 32 &&
    target.mips.type === MIPS_ET_EXEC &&
    (arch === MIPS_ARCH_1 ||
      arch === MIPS_ARCH_32 ||
      arch === MIPS_ARCH_32R2) &&
    (flags & 0x0000f000) === 0 &&
    (flags & 0x20) === 0 &&
    // EF_MIPS_ABI_ON32 (bit 0x40) declares the old n32 ABI; it is not an
    // unspecified-ABI header and must not inherit the o32 assumption.
    (flags & 0x40) === 0 &&
    (flags & 0x100) === 0 &&
    // Undefined means the record was not inspected; only an inspected
    // absence establishes the recordless legacy admission. An inspection
    // that could not examine every declaration source stays unknown.
    abiFlags === null &&
    (limitations === undefined || limitations.length === 0)
  );
};

/** Return a refusal for GNU ABI attributes this existing MIPS lane cannot model. */
/**
 * Every MIPS lane, including PSP, needs every ABI declaration source examined:
 * headers outside the captured file may hold declarations that would refuse it.
 */
export const ghidraMipsIncompleteDeclarationsReason = (
  metadata: MipsElfMetadata,
): string | null =>
  (metadata.limitations?.length ?? 0) > 0
    ? [
        "MIPS ABI declaration inspection is incomplete; unsupported attributes or conflicting declaration sources may remain unknown.",
        ...(metadata.limitations ?? []),
      ].join(" ")
    : null;

export const ghidraMipsGnuAttributesUnsupportedReason = (
  metadata: MipsElfMetadata,
): string | null => {
  const attributes = metadata.gnuAttributes;
  if (attributes === undefined)
    return "GNU MIPS ABI attribute inspection is unavailable; provider selection cannot treat it as absent.";
  if (attributes === null) return null;
  if (attributes.msa !== null && attributes.msa !== 0)
    return "The GNU MIPS MSA ABI attribute declares an unsupported or unknown vector argument ABI.";
  if (
    metadata.abiFlags === null &&
    attributes.fpAbi !== null &&
    attributes.fpAbi !== 0 &&
    attributes.fpAbi !== 1 &&
    attributes.fpAbi !== 5
  )
    return "Without a MIPS ABI flags record, the GNU floating-point ABI attribute must be absent, any, double-precision, or FPXX for the verified recordless lane.";
  return null;
};

/** Keep family recognition separate from the deliberately bounded Ghidra lane. */
export const ghidraMipsUnsupportedReason = (
  target: BinaryTarget,
): string | null => {
  if (target.kind !== "executable" || target.architecture !== "mips")
    return null;
  const metadata = target.mips;
  if (target.format !== "elf" || metadata === undefined)
    return "MIPS analysis requires ELF header metadata; a family name alone does not select an ISA or ABI.";
  const shared = isGhidraMips16SharedTarget(target);
  if (metadata.elfClass !== 32)
    return "This Ghidra MIPS lane supports ELF32 only; MIPS64 and n64 remain unsupported.";
  const gnuAttributesReason =
    ghidraMipsGnuAttributesUnsupportedReason(metadata);
  if (gnuAttributesReason !== null) return gnuAttributesReason;
  if (
    metadata.type !== MIPS_ET_EXEC &&
    metadata.type !== MIPS_ET_REL &&
    !shared
  )
    return "This Ghidra MIPS lane supports ET_EXEC and ET_REL only; shared images and PSP PRX need separate load verification.";
  if ((metadata.flags & 0x0f000000) !== 0 && !shared)
    return "MIPS16, microMIPS and other ASE encodings are outside this standard-instruction MIPS lane.";
  if ((metadata.flags & 0x00ff0000) !== 0)
    return "Machine-specific MIPS variants, including PSP Allegrex, need a separately supported processor profile.";
  const arch = metadata.flags & 0xf0000000;
  if (arch !== MIPS_ARCH_1 && arch !== MIPS_ARCH_32 && arch !== MIPS_ARCH_32R2)
    return "This Ghidra MIPS lane requires EF_MIPS_ARCH_32R2, or a recordless legacy EF_MIPS_ARCH_1 (MIPS-I) or EF_MIPS_ARCH_32 header; other ISA revisions need separate verification.";
  const recordlessShape =
    (metadata.flags & 0x0000f000) === 0 &&
    (metadata.flags & 0x20) === 0 &&
    metadata.abiFlags === null;
  if (recordlessShape) {
    if ((metadata.flags & 0x100) !== 0)
      return "EF_MIPS_32BITMODE declares code for a 64-bit processor in 32-bit mode; it is outside the recordless MIPS32 admission.";
    if ((metadata.flags & 0x40) !== 0)
      return "EF_MIPS_ABI_ON32 declares the n32 ABI; recordless headers carrying it are outside the recordless legacy admission.";
    if ((metadata.flags & 0x00000200) !== 0)
      return "EF_MIPS_FP64 requires separate verification of 64-bit floating-point register semantics in this Ghidra lane.";
    if ((metadata.flags & 0x00000400) !== 0)
      return "EF_MIPS_NAN2008 requires separate verification of NaN encoding semantics in this Ghidra lane.";
    if (hasLegacyMipsHeaderShape(target)) return null;
    // A recordless relocatable object is not an incomplete inspection; the
    // lane is scoped to executable firmware images by design.
    if (metadata.type !== MIPS_ET_EXEC)
      return "The recordless legacy admission covers ET_EXEC firmware images only; recordless relocatable objects need their own verified build, and the declared-ABI lane requires an ABI flags record.";
    // The inspection could not examine every ABI declaration source, so the
    // recordless admission is not established for this header.
    return [
      "This recordless legacy admission requires a complete ABI-record inspection; ABI declarations in unavailable headers remain unknown.",
      ...(metadata.limitations ?? []),
    ].join(" ");
  }
  if (
    (metadata.flags & 0x0000f000) !== 0x00001000 ||
    (metadata.flags & 0x20) !== 0
  )
    return "This Ghidra MIPS lane requires an explicit o32 ABI or a recordless legacy header with an unspecified ABI; n32, EABI and mixed declarations remain unsupported.";
  if (arch !== MIPS_ARCH_32R2)
    return "This Ghidra MIPS lane requires EF_MIPS_ARCH_32R2 for headers that declare an ABI; EF_MIPS_ARCH_1 (MIPS-I) and EF_MIPS_ARCH_32 headers are admitted only through the recordless legacy admission.";
  if ((metadata.flags & 0x00000200) !== 0)
    return "EF_MIPS_FP64 requires separate verification of 64-bit floating-point register semantics in this Ghidra lane.";
  if ((metadata.flags & 0x00000400) !== 0)
    return "EF_MIPS_NAN2008 requires separate verification of NaN encoding semantics in this Ghidra lane.";
  if (shared) {
    if ((metadata.flags & 0x40) !== 0)
      return "EF_MIPS_ABI_ON32 declares an unverified ABI for the MIPS16 shared-image lane.";
    const load = metadata.sharedLoad;
    if (load === undefined || load.status !== "complete")
      return `MIPS16 shared images require complete dynamic relocation inspection. ${load?.reason ?? "The source declarations have not been inspected."}`;
    if (load.relocationTypes.some((type) => type !== 0 && type !== 3))
      return "This MIPS16 shared-image lane verifies R_MIPS_NONE and R_MIPS_REL32 only; other dynamic relocation types require separate verification.";
    if (load.symbolRelativeCount !== 0)
      return "Symbol-bearing R_MIPS_REL32 is unsupported: Ghidra normalizes MIPS16 function addresses and can lose the source function-pointer mode tag. Symbol-index-zero REL32 is verified separately.";
  }
  const incomplete = ghidraMipsIncompleteDeclarationsReason(metadata);
  if (incomplete !== null) return incomplete;
  const abi = metadata.abiFlags;
  if (shared && abi === null && (metadata.limitations?.length ?? 0) === 0)
    return null; // Inspected absence leaves FP semantics unknown, never inferred.
  if (abi === undefined || abi === null)
    return [
      "This Ghidra MIPS lane requires an inspected ABI flags record; header flags alone do not establish the floating-point ABI.",
      ...(metadata.limitations ?? []),
    ].join(" ");
  if (abi.version !== 0)
    return "This Ghidra MIPS lane requires ABI flags version 0; newer record semantics are unsupported.";
  if (abi.isaLevel !== 32 || abi.isaRevision !== 2)
    return "MIPS ABI flags must agree with the declared MIPS32r2 ISA.";
  if (abi.gprSize !== 1 || abi.cpr2Size !== 0)
    return "This Ghidra MIPS lane requires 32-bit GPRs and no CPR2; other register modes need separate verification.";
  const hardFloat = abi.cpr1Size === 1 && (abi.fpAbi === 1 || abi.fpAbi === 5);
  const softFloat = abi.cpr1Size === 0 && abi.fpAbi === MIPS_FP_ABI_SOFT;
  if (!hardFloat && !softFloat)
    return "This Ghidra MIPS lane admits double-precision or FPXX ABI declarations with 32-bit CPR1, or soft-float without CPR1; single-float, FP64 and unspecified modes need separate verification.";
  if (abi.isaExtension !== 0 || abi.ases !== (shared ? 0x400 : 0))
    return "MIPS ABI flags declare an ISA extension or ASE outside this profile's verified instruction declarations.";
  // MIPS_AFL_FLAGS1_ODDSPREG (bit 0) is the GCC and LLVM default for MIPS32 o32
  // whatever the FP ABI; soft-float objects from both carry it. With no CPR1 it
  // selects nothing, so it is accepted for soft-float as well as hard-float.
  if ((abi.flags1 & ~1) !== 0 || abi.flags2 !== 0)
    return "MIPS ABI flags contain unsupported general flags.";
  return null;
};

/** A legacy lane is established only after every MIPS declaration is admitted. */
export const isLegacyMipsAdmission = (target: BinaryTarget): boolean =>
  hasLegacyMipsHeaderShape(target) &&
  ghidraMipsUnsupportedReason(target) === null;

const isMips1Header = (target: BinaryTarget): boolean =>
  target.architecture === "mips" &&
  target.mips !== undefined &&
  (target.mips.flags & 0xf0000000) === MIPS_ARCH_1;

/** Whether the target is admitted through the recordless MIPS-I legacy lane. */
export const isMips1LegacyAdmission = (target: BinaryTarget): boolean =>
  isMips1Header(target) && isLegacyMipsAdmission(target);

/**
 * MIPS-I predates MIPS32, but Ghidra ships a generic 32-bit MIPS language that
 * decodes later instructions too. The header establishes the declared ISA, not
 * that every decoded instruction belongs to the MIPS-I subset. Name the
 * committed language so a caller-selected variant is not reported as the pin.
 */
export const ghidraMips1Limitations = (
  target: BinaryTarget,
  importLanguage?: GhidraLanguageOverride,
  providerPinned = false,
): readonly string[] => {
  if (!isMips1LegacyAdmission(target)) return [];
  const consequence =
    "conformance to the MIPS-I subset is not established from the header alone.";
  if (providerPinned)
    return [
      `The ELF header declares the MIPS-I ISA. REA pins the generic 32-bit MIPS language, which also decodes later MIPS32 instructions; ${consequence}`,
    ];
  return [
    importLanguage === undefined
      ? `The ELF header declares the MIPS-I ISA. No import language is committed to the profile, so the decoder's MIPS-I conformance is not established from the header alone.`
      : `The ELF header declares the MIPS-I ISA. REA imports it with the caller-selected ${importLanguage.languageId} language, which may decode instructions outside the MIPS-I subset; ${consequence}`,
  ];
};

/** Soft-float prototype policy applied by ReaGhidraMipsSoftFloat.java after analysis. */
export const GHIDRA_MIPS_SOFT_FLOAT_STORAGE = "o32-soft-float-prototype-v1";

/** Whether the admitted target declares the soft-float o32 ABI. */
export const isGhidraMipsSoftFloatTarget = (target: BinaryTarget): boolean =>
  target.kind === "executable" &&
  target.architecture === "mips" &&
  target.mips?.abiFlags?.cpr1Size === 0 &&
  target.mips.abiFlags.fpAbi === MIPS_FP_ABI_SOFT;

/** Prototype outcome the post-analysis script records for the bridge handshake. */
export interface GhidraMipsSoftFloatReport {
  readonly policy: typeof GHIDRA_MIPS_SOFT_FLOAT_STORAGE;
  readonly functions: number;
  readonly definitions: number;
}

/** Fail closed unless soft-float storage ran exactly for soft-float targets. */
export const ghidraMipsSoftFloatFailure = (
  expected: boolean,
  report: GhidraMipsSoftFloatReport | undefined,
): string | undefined =>
  expected === (report !== undefined)
    ? undefined
    : expected
      ? "The Ghidra session did not report the committed MIPS soft-float prototype."
      : "The Ghidra session reported MIPS soft-float storage that the profile did not commit.";

/** Keep REA's soft-float prototype distinct from Ghidra's hard-float o32 model. */
export const ghidraMipsSoftFloatLimitations = (
  expected: boolean,
  report?: GhidraMipsSoftFloatReport,
): readonly string[] =>
  expected
    ? [
        "Soft-float o32: Ghidra's MIPS32 compiler specifications model hard-float o32 only. After analysis REA installs a program-specific `__rea_soft_float` prototype, derived from the default o32 model without its floating-point registers and rules, and assigns it to every function, external function and function-pointer definition whose declared types use float or double, so those values keep their types and use integer registers and stack slots.",
        ...(report === undefined
          ? []
          : [
              `Soft-float prototype outcome: ${report.functions} functions and ${report.definitions} function-pointer definitions use __rea_soft_float.`,
            ]),
      ]
    : [];

/** Ghidra-placed relocatable objects need coordinates and relocation caveats. */
export const ghidraMipsRelocatableLimitations = (
  target: BinaryTarget,
): readonly string[] =>
  target.kind === "executable" &&
  target.architecture === "mips" &&
  target.mips?.type === MIPS_ET_REL
    ? [
        "Relocatable MIPS ELF: Ghidra assigns each allocated section an analysis address and applies the object's relocations there. Returned addresses are analysis coordinates, not the addresses a kernel or linker would choose at load time.",
        "Undefined symbols (for example kernel exports used by a module) are placed in Ghidra's EXTERNAL block; their definitions are outside this artifact. inspect_native_load_image reports each relocation with Ghidra's status; HI16 entries report PARTIAL because Ghidra applies them together with their paired LO16.",
      ]
    : [];

/** Shared-image results are analysis observations, not dynamic-loader execution. */
export const ghidraMipsSharedLimitations = (
  target: BinaryTarget,
): readonly string[] =>
  isGhidraMips16SharedTarget(target) && target.architecture === "mips"
    ? [
        "MIPS16 shared ELF: the endian-matched generic MIPS32 language uses the provider's per-address ISA_MODE context. The program language variant is not the instruction's encoding mode.",
        "Shared-image addresses are Ghidra analysis coordinates, not runtime addresses. The source bytes remain unchanged; inspect_native_load_image retains original relocation bytes, loaded memory bytes and provider relocation status. External GOT bindings remain unverified without their defining images.",
        ...(target.mips.abiFlags === null
          ? [
              "No MIPS ABI flags record was found in the completely examined declaration tables. The header declares o32 but does not establish the floating-point ABI; the default compiler specification does not verify floating-point argument or return storage.",
            ]
          : []),
      ]
    : [];

/** Commit source ELF interpretation without confusing target ISA with host CPU. */
export const ghidraMipsProfileParameters = (
  target: BinaryTarget,
  languageOverride?: GhidraLanguageOverride,
): Readonly<Record<string, JsonValue>> => {
  if (
    target.kind !== "executable" ||
    target.architecture !== "mips" ||
    target.mips === undefined
  )
    return {};
  const abi = target.mips.abiFlags;
  // A deliberate caller-selected language wins over the legacy pin; the pin
  // exists because header auto-selection misselects a 64-bit language.
  const legacy = isLegacyMipsAdmission(target);
  const language = ghidraMipsLanguageOverride(target);
  const pinnedLanguage =
    legacy && languageOverride === undefined && language !== undefined
      ? {
          language_id: language.languageId,
          compiler_spec_id: language.compilerSpecId ?? "default",
          language_selection: "provider-pinned-v1",
        }
      : {};
  return {
    mips_elf: {
      elf_class: target.mips.elfClass,
      byte_order: target.mips.byteOrder,
      type: target.mips.type,
      flags: target.mips.flags,
      ...(target.mips.limitations === undefined
        ? {}
        : { abi_flags_limitations: [...target.mips.limitations] }),
      abi_flags:
        abi === undefined || abi === null
          ? null
          : {
              version: abi.version,
              isa_level: abi.isaLevel,
              isa_revision: abi.isaRevision,
              gpr_size: abi.gprSize,
              cpr1_size: abi.cpr1Size,
              cpr2_size: abi.cpr2Size,
              fp_abi: abi.fpAbi,
              isa_extension: abi.isaExtension,
              ases: abi.ases,
              flags1: abi.flags1,
              flags2: abi.flags2,
            },
      ...(target.mips.gnuAttributes === undefined
        ? {}
        : {
            gnu_attributes:
              target.mips.gnuAttributes === null
                ? null
                : {
                    fp_abi: target.mips.gnuAttributes.fpAbi,
                    msa: target.mips.gnuAttributes.msa,
                  },
          }),
      ...(target.mips.sharedLoad === undefined
        ? {}
        : {
            shared_load:
              target.mips.sharedLoad.status === "complete"
                ? {
                    status: "complete",
                    relocation_count: target.mips.sharedLoad.relocationCount,
                    relocation_types: [
                      ...target.mips.sharedLoad.relocationTypes,
                    ],
                    symbol_relative_count:
                      target.mips.sharedLoad.symbolRelativeCount,
                  }
                : {
                    status: "unavailable",
                    reason: target.mips.sharedLoad.reason,
                  },
          }),
    },
    ...(isGhidraMipsSoftFloatTarget(target)
      ? { mips_soft_float_storage: GHIDRA_MIPS_SOFT_FLOAT_STORAGE }
      : {}),
    instruction_context_evidence: "per-address-isa-mode-v1",
    mips_support_lane: legacy
      ? isMips1Header(target)
        ? "elf32-exec-mips1-legacy-pinned-v1"
        : "elf32-exec-arch32-legacy-pinned-v1"
      : isGhidraMips16SharedTarget(target)
        ? "elf32-dyn-o32-arch32r2-mips16-local-rel32-v1"
        : target.mips.type === MIPS_ET_REL
          ? "elf32-rel-o32-arch32r2-standard-v1"
          : "elf32-exec-o32-arch32r2-standard-v3",
    ...(legacy ? { mips_abi_basis: "inferred-o32-assumption-v1" } : {}),
    ...pinnedLanguage,
  };
};

/**
 * Bind a committed MIPS profile to the target being imported. The recordless
 * MIPS-I and MIPS32 lanes share one language pin, so the language checks alone
 * cannot detect a profile resolved for a different ISA revision. The profile
 * also carries header metadata used by shipped evidence and snapshots, so a
 * mismatch must be refused before startup rather than attributed to this target.
 */
export const ghidraMipsProfileMismatchReason = (
  target: BinaryTarget,
  parameters: Readonly<Record<string, unknown>>,
): string | null => {
  if (target.architecture !== "mips" || target.mips === undefined) return null;
  const expected = ghidraMipsProfileParameters(target);
  // PSP keeps its own loader and lane but still commits target-derived MIPS
  // metadata; bind that metadata without demanding the generic lane name.
  const pspLane = "psp-elf32-exec-eabi32-allegrex-v2";
  const committedLane = parameters.mips_support_lane;
  const expectedLane =
    committedLane === pspLane ? pspLane : expected.mips_support_lane;
  const expectedBasis =
    committedLane === pspLane ? undefined : expected.mips_abi_basis;
  if (
    expectedLane !== undefined &&
    (committedLane !== expectedLane ||
      parameters.mips_abi_basis !== expectedBasis)
  )
    return "The committed MIPS analysis lane was resolved for a different target; reopen the target to resolve a new profile.";
  if (
    expected.mips_elf !== undefined &&
    !isDeepStrictEqual(parameters.mips_elf, expected.mips_elf)
  )
    return "The committed MIPS ELF metadata does not match the current target; reopen the target to resolve a new profile.";
  return null;
};
