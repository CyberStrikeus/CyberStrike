import { createHash } from "node:crypto";

import {
  readUniversalMachoImage,
  readUniversalMachoSlice,
} from "../../domain/apple/machoImageSelection.js";
import {
  MACHO_CPU_TYPES,
  type MachoSliceArchitecture,
  type MachoTargetSelection,
} from "../../domain/apple/machoTargetSelection.js";
import { AnalysisInputError } from "../../domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../domain/result.js";

const cpuName = (cpuType: number, cpuSubtype: number): string => {
  const name = Object.entries(MACHO_CPU_TYPES).find(
    ([, type]) => type === cpuType,
  )?.[0];
  const subtype = `0x${cpuSubtype.toString(16)}`;
  return name === undefined
    ? `cpu type 0x${cpuType.toString(16)} subtype ${subtype}`
    : `${name} (subtype ${subtype})`;
};

/** The one thin image an inspector reads, and where it lies in the selected file. */
export interface SelectedNativeImage {
  readonly bytes: Buffer;
  /** File offset of `bytes`; add it to image-relative offsets to locate them in the file. */
  readonly fileOffset: number;
  /** Selected universal slice identity; null when the file is not a universal Mach-O. */
  readonly selection: MachoTargetSelection | null;
}

/** Why no image could be selected; `architecture` issues are the caller's to correct. */
export interface MachoSliceSelectionIssue {
  readonly kind: "architecture" | "malformed";
  readonly message: string;
}

/**
 * Select the thin image to inspect without lipo. A universal Mach-O needs the
 * caller's architecture and yields exactly one validated slice; any other file
 * is returned whole and rejects an architecture rather than ignoring it.
 */
export const selectNativeImage = (
  bytes: Buffer,
  architecture: MachoSliceArchitecture | undefined,
): Result<SelectedNativeImage, MachoSliceSelectionIssue> => {
  const container = readUniversalMachoImage(bytes);
  if (!container.ok) return container;
  const fat = container.value;
  if (fat === null)
    return architecture === undefined
      ? ok({ bytes, fileOffset: 0, selection: null })
      : err({
          kind: "architecture",
          message: `architecture ${architecture} was selected, but the file is not a universal Mach-O; omit architecture.`,
        });
  const available = fat.slices
    .map(({ cpuType, cpuSubtype }) => cpuName(cpuType, cpuSubtype))
    .join(", ");
  if (architecture === undefined)
    return err({
      kind: "architecture",
      message: `Universal Mach-O holds ${available}; select one architecture.`,
    });
  const matches = fat.slices.filter(
    ({ cpuType }) => cpuType === MACHO_CPU_TYPES[architecture],
  );
  const [slice] = matches;
  if (slice === undefined || matches.length > 1)
    return err({
      kind: "architecture",
      message:
        slice === undefined
          ? `Universal Mach-O holds ${available}, not ${architecture}.`
          : `Universal Mach-O holds several ${architecture} slices (${available}); no slice was selected.`,
    });
  const selected = readUniversalMachoSlice(bytes, fat, slice);
  if (!selected.ok) return selected;
  return ok({
    bytes: selected.value,
    fileOffset: slice.offset,
    selection: {
      kind: "macho-selected-image-v1",
      container: "fat",
      offset: slice.offset,
      byte_length: slice.size,
      cpu_type: slice.cpuType,
      cpu_subtype: slice.cpuSubtype,
      container_table_sha256: createHash("sha256")
        .update(bytes.subarray(0, fat.tableEnd))
        .digest("hex"),
    },
  });
};

/**
 * Select the image for one inspection, or fail with the input to correct:
 * `architecture` for a missing or mismatched selection, `path` for a malformed
 * universal container.
 */
export const requireSelectedNativeImage = (
  operation: string,
  path: string,
  bytes: Buffer,
  architecture: MachoSliceArchitecture | undefined,
): SelectedNativeImage => {
  const selected = selectNativeImage(bytes, architecture);
  if (selected.ok) return selected.value;
  const { kind, message } = selected.error;
  throw new AnalysisInputError(operation, undefined, [
    kind === "architecture"
      ? { path: ["architecture"], reason: "invalid_value", message }
      : {
          path: ["path"],
          reason: "invalid_format",
          message: `Selected artifact ${path}: ${message}`,
        },
  ]);
};
