import { parseDolHeader, type DolHeader } from "./gamecubeDol.js";
import { parseRawBinaryEntryPoint } from "./rawBinary.js";
import { err, ok, type Result } from "./result.js";

/** Architecture every admitted DOL establishes; callers cannot select another. */
export const GAMECUBE_DOL_ARCHITECTURE = "powerpc";

/** Admitted caller-selected DOL identity. Its entry comes from the header. */
export interface GamecubeDolAdmission {
  readonly architecture: typeof GAMECUBE_DOL_ARCHITECTURE;
  readonly entryPoint: string;
  readonly entryPointSource: "dol-header";
  readonly header: DolHeader;
}

/** Why a DOL selection was refused, with its owning classification. */
export interface GamecubeDolAdmissionRejection {
  readonly reason: string;
  readonly constraint: "load_selection_rejected" | "file_format_rejected";
}

/**
 * Validate a caller-selected DOL image. A caller `entry_point` is optional and
 * must equal the header entry; any other value is a selection conflict.
 */
export const admitGamecubeDol = (input: {
  /** Leading header bytes; the whole file is never required. */
  readonly bytes: Uint8Array;
  /** Whole-file length; defaults to `bytes.length` when the file is fully supplied. */
  readonly fileSize?: number;
  readonly entryPoint?: unknown;
}): Result<GamecubeDolAdmission, GamecubeDolAdmissionRejection> => {
  const parsed = parseDolHeader(
    input.bytes,
    input.fileSize ?? input.bytes.length,
  );
  if (!parsed.ok)
    return err({
      reason: `gamecube-dol header rejected: ${parsed.error}`,
      constraint: "file_format_rejected",
    });
  const header = parsed.value;
  const entryPoint = `0x${header.entryPoint.toString(16)}`;
  if (input.entryPoint !== undefined) {
    if (typeof input.entryPoint !== "string")
      return err({
        reason:
          "gamecube-dol entry_point must be a hexadecimal address of the form 0x…",
        constraint: "load_selection_rejected",
      });
    const requested = parseRawBinaryEntryPoint(input.entryPoint);
    if (!requested.ok)
      return err({
        reason: requested.error,
        constraint: "load_selection_rejected",
      });
    if (requested.value.value !== BigInt(header.entryPoint))
      return err({
        reason: `gamecube-dol entry_point ${requested.value.canonical} conflicts with the DOL header entry ${entryPoint}`,
        constraint: "load_selection_rejected",
      });
  }
  return ok({
    architecture: GAMECUBE_DOL_ARCHITECTURE,
    entryPoint,
    entryPointSource: "dol-header",
    header,
  });
};
