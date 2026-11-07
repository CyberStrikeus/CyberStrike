import { z } from "zod";

import type { AnalysisProfileCommitment } from "../analysisProfile.js";
import type { BinaryArchitecture } from "../binaryTargetTypes.js";

/** Provider-neutral observed identity of one Mach-O image selected from a source. */
export const machoTargetSelectionSchema = z
  .strictObject({
    kind: z.literal("macho-selected-image-v1"),
    container: z.enum(["thin", "fat"]),
    offset: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    byte_length: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
    cpu_type: z.number().int().nonnegative().max(0xffff_ffff),
    /** Keep the complete raw subtype, including capability bits. */
    cpu_subtype: z.number().int().nonnegative().max(0xffff_ffff),
    container_table_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
  })
  .superRefine((selection, context) => {
    if (
      (selection.container === "thin" &&
        (selection.offset !== 0 ||
          selection.container_table_sha256 !== null)) ||
      (selection.container === "fat" &&
        selection.container_table_sha256 === null)
    )
      context.addIssue({
        code: "custom",
        message: "Invalid Mach-O container identity",
      });
  });

export type MachoTargetSelection = z.infer<typeof machoTargetSelectionSchema>;

/** Read only the provider-neutral fact committed by an analysis profile. */
export const profileMachoTargetSelection = (
  profile: AnalysisProfileCommitment | undefined,
): MachoTargetSelection | undefined => {
  const raw = profile?.parameters.target_selection;
  if (raw === undefined) return undefined;
  const parsed = machoTargetSelectionSchema.safeParse(raw);
  return parsed.success ? parsed.data : undefined;
};

/** mach/machine.h CPU types of the families a Mach-O slice can be selected by. */
export const MACHO_CPU_TYPES = {
  x86: 7,
  x86_64: 0x01000007,
  arm: 12,
  arm64: 0x0100000c,
} as const satisfies Partial<Record<BinaryArchitecture, number>>;

/** Caller-selected CPU family of one universal Mach-O slice. */
export const machoSliceArchitectureSchema = z
  .enum(["x86", "x86_64", "arm", "arm64"])
  .describe(
    "CPU family of the slice to read from a universal (FAT) Mach-O. Required for universal files and rejected for every other image.",
  ) satisfies z.ZodType<keyof typeof MACHO_CPU_TYPES>;
export type MachoSliceArchitecture = z.infer<
  typeof machoSliceArchitectureSchema
>;

/** Confirm the selected header's CPU family agrees with the caller's request. */
export const machoTargetSelectionMatchesArchitecture = (
  selection: MachoTargetSelection,
  architecture: BinaryArchitecture,
): boolean => {
  const cpuTypes: Partial<Record<BinaryArchitecture, number>> = MACHO_CPU_TYPES;
  return cpuTypes[architecture] === selection.cpu_type;
};

/** Whether a file-offset range lies inside the selected image and its file. */
export const machoSelectionContainsRange = (
  selection: MachoTargetSelection,
  fileBytes: number,
  offset: number,
  bytes: number,
): boolean =>
  selection.offset + selection.byte_length <= fileBytes &&
  offset >= selection.offset &&
  bytes <= selection.offset + selection.byte_length - offset;

/** Confirm the parser-observed container agrees with the target's declared format. */
export const machoTargetSelectionMatchesFormat = (
  selection: MachoTargetSelection,
  format: "mach-o" | "mach-o-universal",
): boolean => selection.container === (format === "mach-o" ? "thin" : "fat");

/** Exact range and raw CPU identity equality; null is never treated as a match. */
export const sameMachoTargetSelection = (
  left: MachoTargetSelection | undefined,
  right: MachoTargetSelection | undefined,
): boolean =>
  left !== undefined &&
  right !== undefined &&
  left.container === right.container &&
  left.offset === right.offset &&
  left.byte_length === right.byte_length &&
  left.cpu_type === right.cpu_type &&
  left.cpu_subtype === right.cpu_subtype &&
  left.container_table_sha256 === right.container_table_sha256;

/** Evidence subject format of a metadata report that read an ELF, PE, thin Mach-O or universal slice. */
export const metadataReportSubjectFormat = (report: {
  readonly format: "elf" | "pe" | "macho";
  readonly selected_slice?: MachoTargetSelection;
}): "elf" | "pe" | "mach-o" | "mach-o-universal" =>
  report.format !== "macho"
    ? report.format
    : report.selected_slice === undefined
      ? "mach-o"
      : "mach-o-universal";

/**
 * Whether a metadata report's own container and CPU agree with the universal
 * slice it says it read: the report must be Mach-O and name the slice's CPU family.
 */
export const selectedSliceAgreesWithReport = (
  selection: MachoTargetSelection,
  format: "elf" | "pe" | "macho",
  architecture: BinaryArchitecture | undefined,
): boolean =>
  selection.container === "fat" &&
  format === "macho" &&
  architecture !== undefined &&
  machoTargetSelectionMatchesArchitecture(selection, architecture);
