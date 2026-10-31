import { createHash } from "node:crypto";
import type {
  PeImportDll,
  PeImportFunction,
  PeImports,
} from "../../domain/native/peImports.js";
import { PEFILE_ORDINAL_NAMES } from "./pefileOrdinalNames.js";

/** IMAGE_IMPORT_DESCRIPTOR size. */
export const IMPORT_DESCRIPTOR_BYTES = 20;

/** pefile 2024.8.26 parsing constants that change which rows its import hash sees. */
const PEFILE_MAX_NAME_BYTES = 0x200;
export const PEFILE_MAX_IMPORT_SYMBOLS = 0x2000;
const PEFILE_MAX_REPEATED_ADDRESSES = 15;
const PEFILE_MAX_ADDRESS_SPREAD = 128n * 1024n * 1024n;
const PEFILE_DLL_NAME = /^[A-Za-z0-9!#$%&'()\-@^_`{}~+,.;=[\]:\\/]+$/u;
const PEFILE_FUNCTION_NAME = /^[A-Za-z0-9._?@$()<>]+$/u;

const stripImportExtension = (name: string): string => {
  const lower = name.toLowerCase();
  for (const extension of [".dll", ".sys", ".ocx"]) {
    if (lower.endsWith(extension)) return lower.slice(0, -extension.length);
  }
  return lower;
};

/** pefile `ordlookup.ordLookup(dll, ordinal, make_name=True)`. */
const pefileOrdinalName = (dll: string, ordinal: number): string => {
  const key = dll.toLowerCase();
  // Own keys only: "constructor" and "__proto__" are valid DLL names.
  const names = Object.hasOwn(PEFILE_ORDINAL_NAMES, key)
    ? PEFILE_ORDINAL_NAMES[key]
    : undefined;
  return names?.get(ordinal) ?? `ord${String(ordinal)}`;
};

const withheld = (reason: string): PeImports["imphash"] => ({
  algorithm: "pefile",
  md5: null,
  reason,
});

/**
 * Why pefile would read a different row sequence from this complete
 * descriptor than the one reported, or null when both agree. Mirrors
 * `PE.get_import_table` and `PE.parse_imports` bounds and validity rules.
 */
const pefileTableDivergence = (
  dll: PeImportDll,
  bits: 32 | 64,
  directoryRva: number,
  fileBytes: number,
): string | null => {
  const label = `Standard import descriptor ${String(dll.index)}`;
  if (dll.name === null)
    return `${label} DLL name is unreadable; pefile's name selection cannot be matched.`;
  if (dll.name.length >= PEFILE_MAX_NAME_BYTES)
    return `${label} DLL name reaches pefile's 512-byte read limit; pefile can hash a truncated name or replace an invalid prefix with *invalid*.`;
  if (!PEFILE_DLL_NAME.test(dll.name))
    return `${label} DLL name contains characters pefile replaces with *invalid*.`;
  if (dll.functions.length === 0)
    return `${label} lists no functions; pefile then falls back to the import address table or drops the descriptor.`;
  const width = bits / 8;
  const firstThunk = dll.first_thunk_rva;
  const originalFirstThunk = dll.original_first_thunk_rva;
  const tableRva = originalFirstThunk === 0 ? firstThunk : originalFirstThunk;
  const next = directoryRva + (dll.index + 1) * IMPORT_DESCRIPTOR_BYTES;
  const maxLength =
    next > originalFirstThunk || next > firstThunk
      ? Math.max(next - originalFirstThunk, next - firstThunk)
      : fileBytes - dll.location.offset;
  const named: bigint[] = [];
  for (const [index, row] of dll.functions.entries()) {
    if (index * width >= maxLength)
      return `${label} lookup table runs past pefile's descriptor-relative bound.`;
    const thunk = BigInt(`0x${row.thunk_hex}`);
    const divergence = rowDivergence(
      row,
      thunk,
      BigInt(tableRva),
      BigInt(tableRva + index * width),
    );
    if (divergence !== null) return `${label} ${divergence}`;
    if (row.ordinal === null) named.push(thunk);
  }
  const addresses = addressDivergence(named);
  return addresses === null ? null : `${label} ${addresses}`;
};

/** One lookup entry pefile would drop, truncate at or discard its table for. */
const rowDivergence = (
  row: PeImportFunction,
  thunk: bigint,
  tableRva: bigint,
  entryRva: bigint,
): string | null => {
  if (thunk >= tableRva && thunk <= entryRva)
    return "has a thunk that points into its own lookup table; pefile truncates there.";
  if (row.ordinal !== null) {
    // Pinned pefile 2024.8.26 masks only 31 bits for both widths. In PE32+
    // it ignores reserved bits 31–62; retain that compatibility behavior and
    // the source thunk, without asserting that a loader accepts those bits.
    if ((thunk & 0x7fffffffn) > 0xffffn)
      return "has an ordinal thunk whose low 31-bit payload exceeds 16 bits; pefile discards the table.";
    return row.ordinal === 0 ? "imports ordinal 0, which pefile omits." : null;
  }
  if (row.name === null)
    return "has an unreadable function name; pefile's name selection cannot be matched.";
  if (row.name.length >= PEFILE_MAX_NAME_BYTES)
    return "has a function name reaching pefile's 512-byte read limit; pefile can hash a truncated name or omit an invalid prefix.";
  return !PEFILE_FUNCTION_NAME.test(row.name)
    ? "has a function name with characters pefile treats as invalid and omits."
    : null;
};

/** pefile's repeated-address and address-spread table rejection heuristics. */
const addressDivergence = (named: readonly bigint[]): string | null => {
  const sets = { low: new Set<bigint>(), high: new Set<bigint>() };
  let repeated = 0;
  for (const thunk of named) {
    const set = thunk >= 1n << 32n ? sets.high : sets.low;
    if (set.has(thunk)) repeated += 1;
    set.add(thunk);
  }
  if (repeated >= PEFILE_MAX_REPEATED_ADDRESSES)
    return `repeats hint/name addresses ${String(repeated)} times; pefile discards such tables.`;
  for (const set of [sets.low, sets.high]) {
    if (set.size === 0) continue;
    const values = [...set];
    const low = values.reduce((left, right) => (right < left ? right : left));
    const high = values.reduce((left, right) => (right > left ? right : left));
    if (high - low > PEFILE_MAX_ADDRESS_SPREAD)
      return "hint/name addresses spread beyond 128 MiB; pefile discards such tables.";
  }
  return null;
};

/** Parser facts pefile's row selection depends on beyond the reported rows. */
export interface PefileImphashFacts {
  readonly mappingCompatibility: boolean;
  /** Issues recorded while reading the standard import table. */
  readonly standardIssues: number;
  /** First descriptor pefile's import symbol cap truncates, if any. */
  readonly truncatedDescriptor: number | null;
  readonly bits: 32 | 64;
  readonly directoryRva: number;
  readonly fileBytes: number;
}

/**
 * pefile `PE.get_imphash()` over a complete standard import table, or an
 * explicit reason when the reported rows are not the sequence pefile hashes.
 */
export const pefileImphash = (
  imports: readonly PeImportDll[],
  {
    standardIssues,
    mappingCompatibility,
    truncatedDescriptor,
    bits,
    directoryRva,
    fileBytes,
  }: PefileImphashFacts,
): PeImports["imphash"] => {
  if (standardIssues > 0)
    return withheld(
      `The standard import table is incomplete (${String(standardIssues)} issue(s)); a hash of the retained rows would not be this image's import hash.`,
    );
  if (imports.length === 0)
    return withheld("IMAGE_DIRECTORY_ENTRY_IMPORT is absent or empty.");
  if (truncatedDescriptor !== null)
    return withheld(
      `Standard import descriptor ${String(truncatedDescriptor)} lies past pefile's ${String(PEFILE_MAX_IMPORT_SYMBOLS)}-thunk import symbol cap, so pefile hashes only a prefix of the table.`,
    );
  if (!mappingCompatibility)
    return withheld(
      "Byte mapping compatibility with pefile is not established for the standard import table or its names.",
    );
  const parts: string[] = [];
  for (const dll of imports) {
    const divergence = pefileTableDivergence(
      dll,
      bits,
      directoryRva,
      fileBytes,
    );
    if (divergence !== null) return withheld(divergence);
    const dllName = dll.name as string;
    const library = stripImportExtension(dllName);
    for (const imported of dll.functions) {
      const functionName =
        imported.name ?? pefileOrdinalName(dllName, imported.ordinal as number);
      parts.push(`${library}.${functionName.toLowerCase()}`);
    }
  }
  return {
    algorithm: "pefile",
    md5: createHash("md5").update(parts.join(","), "utf8").digest("hex"),
    reason: null,
  };
};
