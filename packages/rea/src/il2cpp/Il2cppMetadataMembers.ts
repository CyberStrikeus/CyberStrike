import type { Il2cppMetadata } from "../domain/il2cpp/il2cppMetadata.js";
import {
  checkRange,
  checkedSectionCount,
  readIndex,
  Il2cppMetadataFormatFailure,
} from "./Il2cppMetadataFormat.js";
import type { MetadataTables } from "./Il2cppMetadataFile.js";

type Members = Pick<
  Il2cppMetadata,
  "fields" | "properties" | "events" | "parameters" | "string_literals"
>;
export interface MetadataOwnerRange {
  readonly start: number;
  readonly count: number;
}
export interface MetadataMemberOwners {
  readonly fields: readonly MetadataOwnerRange[];
  readonly properties: readonly MetadataOwnerRange[];
  readonly events: readonly MetadataOwnerRange[];
  readonly parameters: readonly MetadataOwnerRange[];
}

/** Own member record widths and validate all counts before any row allocation. */
export const readIl2cppMemberTables = ({
  widths,
  indexing,
  section,
}: Pick<MetadataTables, "widths" | "indexing" | "section">) => {
  const recordBytes = {
    fields: 8 + widths.type,
    properties: 20,
    events: 20 + widths.type,
    parameters: 8 + widths.type,
    stringLiterals: indexing === "counted" ? 4 : 8,
  };
  const literalRecords = checkedSectionCount(
    section("stringLiterals"),
    recordBytes.stringLiterals,
  );
  return {
    recordBytes,
    literalRecords,
    counts: {
      fields: checkedSectionCount(section("fields"), recordBytes.fields),
      properties: checkedSectionCount(
        section("properties"),
        recordBytes.properties,
      ),
      events: checkedSectionCount(section("events"), recordBytes.events),
      parameters: checkedSectionCount(
        section("parameters"),
        recordBytes.parameters,
      ),
      string_literals:
        indexing === "counted"
          ? Math.max(literalRecords - 1, 0)
          : literalRecords,
    },
  };
};

/** Owners come from already parsed type/method facts, never a second raw-table interpretation. */
function* claim(
  ranges: readonly MetadataOwnerRange[],
  total: number,
  label: string,
): Generator<void, Int32Array> {
  const owners = new Int32Array(total).fill(-1);
  let work = 0;
  for (const [owner, range] of ranges.entries()) {
    if (++work % 256 === 0) yield;
    checkRange(
      `${label} range of owner ${owner}`,
      range.start,
      range.count,
      total,
    );
    for (let row = range.start; row < range.start + range.count; row++) {
      if (++work % 256 === 0) yield;
      if (owners[row] !== -1)
        throw new Il2cppMetadataFormatFailure(
          "declaring-type-mismatch",
          `${label} ${row} is claimed by owners ${owners[row]} and ${owner}`,
        );
      owners[row] = owner;
    }
  }
  return owners;
}

function* readNamed<
  T extends { name: string } & Record<string, string | number>,
>(
  tables: MetadataTables,
  name: "fields" | "properties" | "events" | "parameters",
  ranges: readonly MetadataOwnerRange[],
  makeRow: (name: string, owner: number) => T,
): Generator<void, T[]> {
  const section = tables.section(name),
    total = tables.members.counts[name];
  const owners = yield* claim(ranges, total, name),
    rows: T[] = [];
  for (let index = 0; index < total; index++) {
    if (index % 256 === 0) yield;
    const row = makeRow(
      tables.readString(
        tables.bytes.readInt32LE(
          section.offset + index * tables.members.recordBytes[name],
        ),
        `${name} ${index} name`,
      ),
      owners[index]!,
    );
    if (
      tables.linkFacts !== undefined &&
      (name === "fields" || name === "parameters")
    ) {
      const column =
        name === "fields"
          ? tables.linkFacts.fieldTypes
          : tables.linkFacts.parameterTypes;
      column[index] = readIndex(
        tables.bytes,
        section.offset +
          index * tables.members.recordBytes[name] +
          (name === "fields" ? 4 : 8),
        tables.widths.type,
      );
    }
    tables.onRow?.(row);
    rows.push(row);
  }
  return rows;
}

function* readStringLiterals(
  tables: MetadataTables,
): Generator<void, Members["string_literals"]> {
  const { bytes, section, indexing, members } = tables;
  const literals = section("stringLiterals"),
    data = section("stringLiteralData");
  const decoder = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
  // Repeated spans reuse their decoded text for this immutable file snapshot.
  const decoded = new Map<string, Members["string_literals"][number]>();
  const rows: Members["string_literals"] = [];
  if (indexing === "counted" && members.literalRecords === 1) {
    const sentinel = bytes.readInt32LE(literals.offset);
    if (sentinel < 0 || sentinel > data.size)
      throw new Il2cppMetadataFormatFailure(
        "index-out-of-range",
        `empty string literal sentinel ${sentinel} is outside the ${data.size}-byte literal data`,
      );
  }
  for (let index = 0; index < members.counts.string_literals; index++) {
    if (index % 256 === 0) yield;
    const at = literals.offset + index * members.recordBytes.stringLiterals;
    const start = bytes.readInt32LE(at + (indexing === "counted" ? 0 : 4));
    const length =
      indexing === "counted"
        ? bytes.readInt32LE(at + 4) - start
        : bytes.readUInt32LE(at);
    if (start < 0 || length < 0 || start + length > data.size)
      throw new Il2cppMetadataFormatFailure(
        "index-out-of-range",
        `string literal ${index} [${start}, ${start + length}) is outside the ${data.size}-byte literal data`,
      );
    const key = `${start}:${length}`;
    let literal = decoded.get(key);
    if (literal === undefined) {
      // Strict UTF-8 round trips preserve at least these bytes; base64 is larger.
      // Refuse impossible output before allocating either representation.
      tables.beforeText?.(length);
      const value = bytes.subarray(
        data.offset + start,
        data.offset + start + length,
      );
      try {
        literal = { value: decoder.decode(value), value_base64: null };
      } catch {
        tables.beforeText?.(4 * Math.ceil(length / 3));
        literal = { value: null, value_base64: value.toString("base64") };
      }
      decoded.set(key, literal);
    }
    tables.onRow?.(literal);
    rows.push({ ...literal });
  }
  return rows;
}

/** Decode each fact directly into its final row shape, yielding through ownership and content. */
export function* readIl2cppMembers(
  tables: MetadataTables,
  owners: MetadataMemberOwners,
): Generator<void, Members> {
  const member = (name: string, declaring_type: number) => ({
    name,
    declaring_type,
  });
  const fields = yield* readNamed(tables, "fields", owners.fields, member);
  const properties = yield* readNamed(
    tables,
    "properties",
    owners.properties,
    member,
  );
  const events = yield* readNamed(tables, "events", owners.events, member);
  const parameters = yield* readNamed(
    tables,
    "parameters",
    owners.parameters,
    (name, method) => ({ name, method }),
  );
  return {
    fields,
    properties,
    events,
    parameters,
    string_literals: yield* readStringLiterals(tables),
  };
}
