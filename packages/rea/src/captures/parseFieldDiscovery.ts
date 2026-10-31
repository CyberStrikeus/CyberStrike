import type {
  InspectPacketFieldsInput,
  PacketFieldRecord,
} from "../domain/captures/packetFields.js";
import { literalSubstringPredicate } from "../domain/analysisSearch.js";

export class FieldDiscoveryBudgetError extends Error {}
export const FIELD_RECORD_BUDGET = 8 * 1024 * 1024;

/** TShark -G fields: P/name/abbreviation or F/name/abbreviation/type/parent/base/mask/blurb. */
export const parseFieldDiscovery = (
  text: string,
  input: InspectPacketFieldsInput,
) => {
  const copy = (value: string) =>
    Buffer.from(value, "utf16le").toString("utf16le");
  const matches = literalSubstringPredicate(input.query, false);
  const records: PacketFieldRecord[] = [];
  let examined = 0,
    matching = 0,
    sourceLine = 0,
    budget = 0;
  // Walk the bounded text once; allocate record objects only for the requested page.
  for (let start = 0; start < text.length;) {
    const end = text.indexOf("\n", start);
    let line = text.slice(start, end < 0 ? text.length : end);
    start = end < 0 ? text.length : end + 1;
    sourceLine++;
    if (line.endsWith("\r")) line = line.slice(0, -1);
    const columns = line.split("\t", 9);
    const [tag, name, abbreviation] = columns;
    if (
      !(
        (tag === "P" && columns.length === 3) ||
        (tag === "F" && columns.length === 8)
      ) ||
      name === undefined ||
      abbreviation === undefined ||
      abbreviation === ""
    )
      throw new Error(
        `Malformed TShark field glossary record at line ${sourceLine}`,
      );
    if ((input.kind === "protocols") !== (tag === "P")) continue;
    examined++;
    if (
      input.protocol !== null &&
      (tag === "P" ? abbreviation : columns[4]) !== input.protocol
    )
      continue;
    if (
      ![name, abbreviation, ...(tag === "F" ? [columns[7] ?? ""] : [])].some(
        matches,
      )
    )
      continue;
    matching++;
    if (
      matching <= input.offset ||
      records.length >= (input.limit ?? Number.MAX_SAFE_INTEGER)
    )
      continue;
    // Six bytes per source byte covers worst-case JSON escaping, plus record bookkeeping.
    budget += Buffer.byteLength(line, "utf8") * 6 + 512;
    if (budget > FIELD_RECORD_BUDGET)
      throw new FieldDiscoveryBudgetError(
        "Selected glossary records exceed the 8 MiB representation budget; narrow the query or page size",
      );
    // Detach retained fields from the much larger producer string.
    records.push({
      source_line: sourceLine,
      kind: tag === "P" ? "protocol" : "field",
      name: copy(name),
      abbreviation: copy(abbreviation),
      field_type: tag === "F" ? copy(columns[3] ?? "") : null,
      parent_protocol: tag === "F" ? copy(columns[4] ?? "") : null,
      display_base: tag === "F" ? copy(columns[5] ?? "") : null,
      bitmask: tag === "F" ? copy(columns[6] ?? "") : null,
      description: tag === "F" ? copy(columns[7] ?? "") : null,
    });
  }
  if (sourceLine === 0)
    throw new Error("TShark returned an empty field glossary");
  return {
    records,
    output_window: {
      examined,
      matching,
      returned: records.length,
      has_more: Math.max(0, matching - input.offset) > records.length,
    },
  };
};
