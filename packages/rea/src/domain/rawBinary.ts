import { z } from "zod";

import type {
  BinaryArchitecture,
  HeaderArchitecture,
  RawOnlyArchitecture,
} from "./binaryTargetTypes.js";
import type { ExecutableFormatHint } from "./dosCom.js";
import { err, ok, type Result } from "./result.js";

/** Caller-visible CPU families admitted for headerless raw binaries. */
export const BINARY_ARCHITECTURES = [
  "x86",
  "x86_64",
  "arm",
  "arm64",
  "6502",
  "m68k",
] as const satisfies readonly BinaryArchitecture[];

/** Provider-neutral CPU family for a caller-supplied raw-binary load. */
export const binaryArchitectureSchema = z.enum(BINARY_ARCHITECTURES);

const RAW_BINARY_ENTRY_POINT = /^0x[0-9A-Fa-f]{1,16}$/u;

/** Hexadecimal load and entry address; file offset 0 is mapped here. */
export const rawBinaryEntryPointSchema = z
  .string()
  .regex(RAW_BINARY_ENTRY_POINT, {
    message: "entry_point must be a hexadecimal address of the form 0x…",
  });

/** Canonicalized caller-supplied raw-binary entry with the original spelling. */
export interface CanonicalRawBinaryEntry {
  readonly source: string;
  readonly canonical: string;
  readonly value: bigint;
}

/** Parse a caller-supplied hex entry while preserving the source spelling. */
export const parseRawBinaryEntryPoint = (
  value: string,
): Result<CanonicalRawBinaryEntry, string> => {
  if (!RAW_BINARY_ENTRY_POINT.test(value))
    return err("entry_point must be a hexadecimal address of the form 0x…");
  const parsed = BigInt(value);
  return ok({
    source: value,
    canonical: `0x${parsed.toString(16)}`,
    value: parsed,
  });
};

/** Reject empty or non-integral file extents for a headerless image. */
export const validateRawBinaryLength = (
  length: number,
): Result<null, string> =>
  Number.isSafeInteger(length) && length >= 1
    ? ok(null)
    : err("raw-binary requires at least one file byte");

/** Admitted headerless load identity used by target resolution and profiles. */
export interface RawBinaryAdmission {
  readonly architecture: HeaderArchitecture | RawOnlyArchitecture;
  readonly entryPoint: string;
  readonly entryPointSource: string;
}

/** Why a headerless load was refused, with its owning classification. */
export interface RawBinaryAdmissionRejection {
  readonly reason: string;
  /**
   * `load_selection_rejected` names a caller-input selection problem;
   * `file_format_rejected` names a refusal caused by the target file itself.
   */
  readonly constraint: "load_selection_rejected" | "file_format_rejected";
}

const addressWidth = (architecture: BinaryArchitecture): bigint =>
  architecture === "6502"
    ? 0xffffn
    : architecture === "x86" ||
        architecture === "arm" ||
        architecture === "m68k"
      ? 0xffffffffn
      : 0xffffffffffffffffn;

/** Validate architecture, entry, and that the mapped image fits the CPU width. */
export const admitRawBinary = (input: {
  readonly architecture: unknown;
  readonly entryPoint: unknown;
  readonly fileBytes: number;
}): Result<RawBinaryAdmission, RawBinaryAdmissionRejection> => {
  const architecture = binaryArchitectureSchema.safeParse(input.architecture);
  if (!architecture.success)
    return err({
      reason:
        "raw-binary format requires architecture (x86, x86_64, arm, arm64, 6502, or m68k)",
      constraint: "load_selection_rejected",
    });
  if (typeof input.entryPoint !== "string")
    return err({
      reason:
        "raw-binary format requires entry_point as a hexadecimal address of the form 0x…",
      constraint: "load_selection_rejected",
    });
  const entry = parseRawBinaryEntryPoint(input.entryPoint);
  if (!entry.ok)
    return err({
      reason: entry.error,
      constraint: "load_selection_rejected",
    });
  if (
    (architecture.data === "arm" || architecture.data === "arm64") &&
    entry.value.value % 4n !== 0n
  )
    return err({
      reason: `raw-binary ${architecture.data} entry_point ${entry.value.canonical} must be 4-byte aligned`,
      constraint: "load_selection_rejected",
    });
  // 68000-family instruction words are fetched from even addresses.
  if (architecture.data === "m68k" && entry.value.value % 2n !== 0n)
    return err({
      reason: `raw-binary m68k entry_point ${entry.value.canonical} must be 2-byte aligned`,
      constraint: "load_selection_rejected",
    });
  const length = validateRawBinaryLength(input.fileBytes);
  if (!length.ok)
    return err({
      reason: length.error,
      constraint: "file_format_rejected",
    });
  const last = entry.value.value + BigInt(input.fileBytes) - 1n;
  const max = addressWidth(architecture.data);
  if (entry.value.value > max || last > max)
    return err({
      reason: `raw-binary mapping from ${entry.value.canonical} must fit in the ${architecture.data} address width`,
      constraint: "load_selection_rejected",
    });
  return ok({
    architecture: architecture.data,
    entryPoint: entry.value.canonical,
    entryPointSource: entry.value.source,
  });
};

/** Describe the format/architecture/entry pairing without performing I/O. */
export const rawBinarySelectionError = (input: {
  readonly format?: ExecutableFormatHint;
  readonly architecture?: unknown;
  readonly entryPoint?: unknown;
}): string | undefined => {
  const hasArchitecture = input.architecture !== undefined;
  const hasEntry = input.entryPoint !== undefined;
  if (input.format === "gamecube-dol") {
    // The DOL header fixes architecture; entry_point is checked against it at admission.
    return hasArchitecture
      ? "format=gamecube-dol takes its architecture from the DOL header; omit architecture"
      : undefined;
  }
  if (input.format === "raw-binary") {
    if (!hasArchitecture || !hasEntry)
      return "format=raw-binary requires architecture and entry_point";
    return undefined;
  }
  if (hasArchitecture || hasEntry)
    return "architecture and entry_point apply only with format=raw-binary";
  return undefined;
};
