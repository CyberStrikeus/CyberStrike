import type { DecompileDirectoryInput } from "../../contracts/decompileDirectory.js";
import { addressCoordinate } from "../../domain/native/addressCoordinate.js";
import { nativeAddressCoordinateInputSchema } from "../../domain/native/nativeAddress.js";
import { err, ok, type Result } from "../../domain/result.js";
import { compareUnicodeCodePoints } from "../../domain/unicodeCodePointOrder.js";
import type { AnalysisError } from "../../domain/analysisErrorBase.js";
import { decompileInputError } from "./inputError.js";

export interface SelectedProcedure {
  readonly address: string;
  readonly name: string | null;
}

interface AddressBound {
  readonly space: string | null;
  readonly offset: bigint;
}

export interface DecompileBounds {
  readonly start: AddressBound | null;
  readonly end: AddressBound | null;
}

/** Reject address bounds that cannot be compared inside one address space. */
export const validateDecompileBounds = (
  input: DecompileDirectoryInput,
): Result<DecompileBounds, AnalysisError> => {
  const start = parseBound(input.address_start, "address_start");
  if (!start.ok) return start;
  const end = parseBound(input.address_end, "address_end");
  if (!end.ok) return end;
  if (
    start.value !== null &&
    end.value !== null &&
    start.value.space !== end.value.space
  )
    return err(
      decompileInputError(
        "address_end",
        "Address bounds must use the same address space.",
      ),
    );
  if (
    start.value !== null &&
    end.value !== null &&
    end.value.offset < start.value.offset
  )
    return err(
      decompileInputError(
        "address_end",
        "Address end is before address start.",
      ),
    );
  return ok({ start: start.value, end: end.value });
};

export interface ProcedureSelection {
  readonly procedures: readonly SelectedProcedure[];
  readonly excluded: number;
  readonly collapsedDuplicates: boolean;
}

/** Filter and stably order unique inventory rows. Duplicate addresses collapse. */
export const selectProcedures = (
  rows: readonly SelectedProcedure[],
  input: DecompileDirectoryInput,
  bounds: DecompileBounds,
): ProcedureSelection => {
  const seen = new Set<string>();
  const selected = new Map<string, SelectedProcedure>();
  let collapsedDuplicates = false;
  for (const row of rows) {
    if (seen.has(row.address)) collapsedDuplicates = true;
    seen.add(row.address);
    // Every observed label participates in caller filtering before one output
    // is chosen for the address. An earlier non-match cannot hide an alias.
    if (!selected.has(row.address) && matches(row, input, bounds))
      selected.set(row.address, row);
  }
  const procedures = [...selected.values()].sort(compareProcedures);
  return {
    procedures,
    excluded: seen.size - procedures.length,
    collapsedDuplicates,
  };
};

const parseBound = (
  value: string | undefined,
  path: "address_start" | "address_end",
): Result<AddressBound | null, AnalysisError> => {
  if (value === undefined) return ok(null);
  const coordinate = nativeAddressCoordinateInputSchema.safeParse(value);
  return !coordinate.success
    ? err(
        decompileInputError(
          path,
          "Address bounds must be 0xoffset or space:0xoffset.",
        ),
      )
    : ok(coordinate.data);
};

const matches = (
  procedure: SelectedProcedure,
  input: DecompileDirectoryInput,
  bounds: DecompileBounds,
): boolean =>
  matchesName(procedure.name, input.name) &&
  matchesNamespace(procedure.name, input.namespace) &&
  matchesAddress(procedure.address, bounds);

const matchesName = (
  name: string | null,
  filter: string | undefined,
): boolean => filter === undefined || (name !== null && name.includes(filter));

const matchesNamespace = (
  name: string | null,
  filter: string | undefined,
): boolean =>
  filter === undefined || (name !== null && name.startsWith(filter));

const matchesAddress = (address: string, bounds: DecompileBounds): boolean => {
  if (bounds.start === null && bounds.end === null) return true;
  const coordinate = addressCoordinate(address);
  if (coordinate === null) return false;
  if (
    bounds.start !== null &&
    (coordinate.space !== bounds.start.space ||
      coordinate.offset < bounds.start.offset)
  )
    return false;
  return (
    bounds.end === null ||
    (coordinate.space === bounds.end.space &&
      coordinate.offset <= bounds.end.offset)
  );
};

const compareProcedures = (
  left: SelectedProcedure,
  right: SelectedProcedure,
): number => {
  const byAddress = compareProcedureAddresses(left.address, right.address);
  if (byAddress !== 0) return byAddress;
  const byName = compareUnicodeCodePoints(left.name ?? "", right.name ?? "");
  return byName === 0
    ? compareUnicodeCodePoints(left.address, right.address)
    : byName;
};

/** Numeric order within an address space; unparsed addresses sort last. */
export const compareProcedureAddresses = (
  left: string,
  right: string,
): number => {
  const a = addressCoordinate(left);
  const b = addressCoordinate(right);
  if (a === null || b === null) {
    if (a === null && b === null) return compareUnicodeCodePoints(left, right);
    return a === null ? 1 : -1;
  }
  const space = compareUnicodeCodePoints(a.space ?? "", b.space ?? "");
  if (space !== 0) return space;
  if (a.offset < b.offset) return -1;
  if (a.offset > b.offset) return 1;
  return 0;
};
