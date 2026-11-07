import type { InspectSignalDecodersInput } from "../domain/signals/signalDecoders.js";
import { literalSubstringPredicate } from "../domain/analysisSearch.js";

export class DecoderDiscoveryBudgetError extends Error {}

const copyText = (value: string): string =>
  Buffer.from(value, "utf16le").toString("utf16le");

/** Parse only the 0.7.2 catalog grammar; help remains literal producer text. */
export const parseDecoderDiscovery = (
  text: string,
  input: InspectSignalDecodersInput,
) => {
  // Bound record-object expansion before splitting the already byte-bounded output.
  // 65,536 records leaves an 8 MiB budget at 128 bytes of bookkeeping per record.
  let separators = 0;
  for (const character of text)
    if (character === "\n" && ++separators >= 65536)
      throw new DecoderDiscoveryBudgetError(
        "Decoder discovery exceeds the 65,536-line representation budget",
      );
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") lines.pop();
  const matches = literalSubstringPredicate(input.query, false);
  const decoders: { id: string; name: string }[] = [];
  const help: { line_number: number; text: string }[] = [];
  if (input.decoder === null) {
    const start = lines.indexOf("Supported protocol decoders:");
    if (start < 0) throw new Error("sigrok decoder catalog heading is missing");
    const seen = new Set<string>();
    for (const line of lines.slice(start + 1)) {
      if (line === "") continue;
      const match = /^ {2}([a-zA-Z0-9_+-]+) +(.+)$/u.exec(line);
      if (
        match?.[1] === undefined ||
        match[2] === undefined ||
        seen.has(match[1])
      )
        throw new Error("Malformed or duplicate sigrok decoder catalog record");
      seen.add(match[1]);
      decoders.push({ id: match[1], name: match[2] });
    }
    if (decoders.length === 0)
      throw new Error("sigrok returned an empty decoder catalog");
  } else {
    if (lines[0] !== `ID: ${input.decoder}`)
      throw new Error("Decoder help does not identify the selected decoder");
    lines.forEach((line, i) => help.push({ line_number: i + 1, text: line }));
  }
  const catalog = input.decoder === null;
  const matching = catalog
    ? decoders.filter(({ id, name }) => matches(id) || matches(name))
    : help.filter(({ text: line }) => matches(line));
  const start = Math.min(input.offset, matching.length);
  const count = Math.min(
    input.limit ?? matching.length,
    matching.length - start,
  );
  // Keep retained pages independent of the complete producer-output allocation.
  const page = matching
    .slice(start, start + count)
    .map((record) =>
      "id" in record
        ? { id: copyText(record.id), name: copyText(record.name) }
        : { line_number: record.line_number, text: copyText(record.text) },
    );
  return {
    decoders: catalog ? page : [],
    help_lines: catalog ? [] : page,
    output_window: {
      unit: catalog ? "decoders" : "help-lines",
      examined: catalog ? decoders.length : help.length,
      matching: matching.length,
      returned: page.length,
      has_more: start + count < matching.length,
    },
  };
};
