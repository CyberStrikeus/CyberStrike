import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { ArtifactReaderFailure } from "../artifacts/ArtifactReader.js";
import {
  MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
  type ErlangBeam,
  type InspectErlangBeamInput,
} from "../domain/erlang/beam.js";

/** The producing parser names its count allowance independently of diagnostic text. */
export class BeamCapacityFailure extends ArtifactReaderFailure {
  constructor(
    readonly resource: "atoms" | "chunks" | "table-rows",
    readonly maximum: number,
    message: string,
  ) {
    super("limit", message, { boundary: "capacity" });
    this.name = "BeamCapacityFailure";
  }
}

const fail = (message: string): never => {
  throw new ArtifactReaderFailure("format", message);
};

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const LIMITATIONS = [
  "This workflow does not execute BEAM bytecode, inflate LitT literals, or decode Attr/CInf external-term payloads.",
  "Atom names are structural table entries; they do not authenticate the originating compiler or module checksum.",
] as const;

const requireRange = (bytes: Buffer, offset: number, length: number): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > bytes.length - length
  )
    fail(
      `BEAM range ${String(offset)} + ${String(length)} leaves the artifact.`,
    );
};

const u32 = (bytes: Buffer, offset: number): number => {
  requireRange(bytes, offset, 4);
  return bytes.readUInt32BE(offset);
};

const chunkName = (bytes: Buffer, offset: number): string => {
  requireRange(bytes, offset, 4);
  return bytes.subarray(offset, offset + 4).toString("latin1");
};

const atomAt = (
  atoms: readonly { index: number; name: string }[] | null,
  index: number,
): string | null => {
  if (atoms === null || index < 1) return null;
  return atoms[index - 1]?.name ?? null;
};

/** Reads an atom length: one byte, or OTP 28+ compact `u` tag when compact. */
const atomLength = (
  payload: Buffer,
  at: number,
  compact: boolean,
): [length: number, next: number] => {
  if (at >= payload.length) fail("BEAM atom table is truncated.");
  const first = payload[at]!;
  if (!compact) return [first, at + 1];
  const decoded = compactUnsigned(payload, at);
  if (decoded.value > BigInt(payload.length - decoded.next))
    fail("BEAM atom table is truncated.");
  return [Number(decoded.value), decoded.next];
};

/** Decode OTP's compact unsigned `u` tag without allocating from its value. */
const compactUnsigned = (
  payload: Buffer,
  at: number,
): { value: bigint; next: number } => {
  let cursor = at;
  let value: bigint;
  for (;;) {
    if (cursor >= payload.length) fail("BEAM atom table is truncated.");
    const first = payload[cursor]!;
    if ((first & 0x07) !== 0) fail("BEAM atom length is not a u tag.");
    if ((first & 0x08) === 0) {
      value = BigInt(first >> 4);
      cursor += 1;
      break;
    }
    if ((first & 0x10) === 0) {
      if (cursor + 1 >= payload.length) fail("BEAM atom table is truncated.");
      value = BigInt(((first >> 5) << 8) | payload[cursor + 1]!);
      cursor += 2;
      break;
    }
    const byteCountCode = first >> 5;
    cursor += 1;
    // OTP's size-of-size form always produces at least a 9-byte integer.
    // unpack_varint rejects any value wider than SWord, even with leading
    // zeroes, so no unsigned atom length can be represented by this form.
    if (byteCountCode === 7) fail("BEAM atom length encoding overflows.");
    value = readCompactUnsignedBytes(payload, cursor, byteCountCode + 2);
    cursor += byteCountCode + 2;
    break;
  }
  return { value, next: cursor };
};

const readCompactUnsignedBytes = (
  payload: Buffer,
  at: number,
  byteCount: number,
): bigint => {
  if (byteCount > payload.length - at) fail("BEAM atom table is truncated.");
  // OTP's unpack_varint only accepts values that fit a signed machine word.
  // For REA's supported 64-bit runtime target, that is at most eight bytes.
  const maxValue = 9_223_372_036_854_775_807n;
  let value = 0n;
  for (let index = 0; index < byteCount; index += 1) {
    const byte = BigInt(payload[at + index]!);
    if (value > (maxValue - byte) >> 8n)
      fail("BEAM atom length encoding overflows.");
    value = (value << 8n) | byte;
  }
  return value;
};

const parseAtoms = (
  payload: Buffer,
  maxAtoms: number,
  format: "Atom" | "AtU8",
): ErlangBeam["atoms"] => {
  if (payload.length < 4) fail("BEAM atom table is truncated.");
  // Only AtU8 supports OTP 28+'s negated count and compact name lengths.
  // Historical Atom uses an unsigned count and single-byte lengths.
  const encoding = format === "AtU8" ? "utf8" : "latin1";
  const declared =
    format === "AtU8" ? payload.readInt32BE(0) : payload.readUInt32BE(0);
  const compact = format === "AtU8" && declared < 0;
  const count = compact ? -declared : declared;
  // Every entry needs at least one length byte, regardless of the layout.
  // Reject an impossible table before treating its count as a budget refusal.
  if (count > payload.length - 4) fail("BEAM atom table is truncated.");
  if (count > maxAtoms)
    throw new BeamCapacityFailure(
      "atoms",
      maxAtoms,
      `BEAM atom table exceeds the ${String(maxAtoms)}-atom budget.`,
    );
  const atoms: NonNullable<ErlangBeam["atoms"]> = [];
  let at = 4;
  for (let index = 1; index <= count; index += 1) {
    const [length, next] = atomLength(payload, at, compact);
    at = next;
    requireRange(payload, at, length);
    const nameBytes = payload.subarray(at, at + length);
    if (encoding === "utf8" && !isUtf8(nameBytes))
      fail("BEAM atom name is not valid UTF-8.");
    atoms.push({
      index,
      name: nameBytes.toString(encoding),
    });
    at += length;
  }
  if (at > payload.length) fail("BEAM atom table is truncated.");
  return atoms;
};

const parseRows = (
  payload: Buffer,
  width: number,
  label: string,
): number[][] => {
  if (payload.length < 4) fail(`BEAM ${label} table is truncated.`);
  const count = u32(payload, 0);
  const need = 4 + count * width * 4;
  if (payload.length < need) fail(`BEAM ${label} table is truncated.`);
  const rows: number[][] = [];
  for (let index = 0; index < count; index += 1) {
    const row: number[] = [];
    const start = 4 + index * width * 4;
    for (let field = 0; field < width; field += 1)
      row.push(u32(payload, start + field * 4));
    rows.push(row);
  }
  return rows;
};

const parseCode = (
  payload: Buffer,
  chunkOffset: number,
): NonNullable<ErlangBeam["code"]> => {
  if (payload.length < 20) fail("BEAM Code chunk is truncated.");
  const infoSize = u32(payload, 0);
  if (infoSize < 16 || infoSize > payload.length - 4)
    fail("BEAM Code header size is invalid.");
  const instructionsOffset = 4 + infoSize;
  return {
    instruction_set: u32(payload, 4),
    opcode_max: u32(payload, 8),
    labels: u32(payload, 12),
    functions: u32(payload, 16),
    extra_header_bytes: infoSize - 16,
    instructions: {
      offset: chunkOffset + 8 + instructionsOffset,
      bytes: payload.length - instructionsOffset,
    },
  };
};

/** Decode one FOR1/BEAM IFF container into bounded chunk and table facts. */
export const parseErlangBeam = (
  bytes: Buffer,
  artifact: ErlangBeam["artifact"],
  input: InspectErlangBeamInput,
): ErlangBeam => {
  requireRange(bytes, 0, 12);
  if (bytes.subarray(0, 4).toString("latin1") !== "FOR1")
    fail("Expected a FOR1 IFF container.");
  const formSize = u32(bytes, 4);
  if (formSize < 4) fail("BEAM form size is shorter than the BEAM tag.");
  requireRange(bytes, 8, formSize);
  if (bytes.subarray(8, 12).toString("latin1") !== "BEAM")
    fail("Expected a BEAM form type.");
  const formEnd = 8 + formSize;
  const chunks: ErlangBeam["chunks"] = [];
  const payloads = new Map<string, { payload: Buffer; offset: number }>();
  let at = 12;
  while (at < formEnd) {
    if (formEnd - at < 8) fail("BEAM chunk header is truncated.");
    if (chunks.length >= input.max_chunks)
      throw new BeamCapacityFailure(
        "chunks",
        input.max_chunks,
        `BEAM form exceeds the ${String(input.max_chunks)}-chunk budget.`,
      );
    const name = chunkName(bytes, at);
    const size = u32(bytes, at + 4);
    const payloadOffset = at + 8;
    requireRange(bytes, payloadOffset, size);
    const padded = payloadOffset + size + ((4 - (size % 4)) % 4);
    if (padded > formEnd) fail("BEAM chunk padding exceeds the form.");
    const payload = bytes.subarray(payloadOffset, payloadOffset + size);
    chunks.push({
      index: chunks.length,
      name,
      location: { offset: at, bytes: padded - at },
      payload: {
        location: { offset: payloadOffset, bytes: size },
        bytes: size,
        sha256: sha256(payload),
      },
    });
    // OTP's loader replaces the selected payload on each matching chunk.
    // Keep every occurrence above; decode the last occurrence of each name.
    payloads.set(name, { payload, offset: at });
    at = padded;
  }
  const utf8AtomChunk = payloads.get("AtU8");
  const legacyAtomChunk = payloads.get("Atom");
  // Historical OTP selects Atom when AtU8 has no payload. Without a legacy
  // table, a present empty AtU8 still fails its required count header.
  const useUtf8Atoms =
    utf8AtomChunk !== undefined &&
    (utf8AtomChunk.payload.length > 0 || legacyAtomChunk === undefined);
  const atomChunk = useUtf8Atoms ? utf8AtomChunk : legacyAtomChunk;
  const atomFormat =
    atomChunk === undefined ? null : useUtf8Atoms ? "AtU8" : "Atom";
  const atomEncoding =
    atomFormat === null ? null : atomFormat === "AtU8" ? "utf8" : "latin1";
  const atoms =
    atomChunk === undefined || atomFormat === null
      ? null
      : parseAtoms(atomChunk.payload, input.max_atoms, atomFormat);
  const declaredRows = (name: string): number => {
    const payload = payloads.get(name)?.payload;
    return payload !== undefined && payload.length >= 4 ? u32(payload, 0) : 0;
  };
  if (
    declaredRows("ExpT") + declaredRows("ImpT") + declaredRows("FunT") >
    MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS
  )
    throw new BeamCapacityFailure(
      "table-rows",
      MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
      `BEAM tables exceed the ${String(
        MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
      )}-row budget.`,
    );
  const exports =
    payloads.get("ExpT") === undefined
      ? null
      : parseRows(payloads.get("ExpT")!.payload, 3, "export").map((row) => ({
          function_index: row[0]!,
          function: atomAt(atoms, row[0]!),
          arity: row[1]!,
          label: row[2]!,
        }));
  const imports =
    payloads.get("ImpT") === undefined
      ? null
      : parseRows(payloads.get("ImpT")!.payload, 3, "import").map((row) => ({
          module_index: row[0]!,
          module: atomAt(atoms, row[0]!),
          function_index: row[1]!,
          function: atomAt(atoms, row[1]!),
          arity: row[2]!,
        }));
  const lambdaChunk = payloads.get("FunT");
  // OTP skips the optional lambda parser for a zero-byte selected chunk.
  // A four-byte zero count remains a decoded, explicitly empty table.
  const lambdas =
    lambdaChunk === undefined || lambdaChunk.payload.length === 0
      ? null
      : parseRows(lambdaChunk.payload, 6, "lambda").map((row) => ({
          function_index: row[0]!,
          function: atomAt(atoms, row[0]!),
          arity: row[1]!,
          label: row[2]!,
          index: row[3]!,
          free_vars: row[4]!,
          old_unique: row[5]!,
        }));
  const codeChunk = payloads.get("Code");
  const code =
    codeChunk === undefined
      ? null
      : parseCode(codeChunk.payload, codeChunk.offset);
  return {
    artifact,
    form: { location: { offset: 0, bytes: formEnd }, size: formSize },
    chunks,
    atoms,
    atom_encoding: atomEncoding,
    exports,
    imports,
    lambdas,
    code,
    module: atoms?.[0]?.name ?? null,
    coverage: {
      status: "complete",
      examined_chunks: chunks.length,
      atoms: atoms?.length ?? 0,
    },
    limitations: [...LIMITATIONS],
  };
};
