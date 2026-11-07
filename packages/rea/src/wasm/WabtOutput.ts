import { WabtAdmissionError } from "./WabtAdmissionError.js";

/** WABT prints names with %.*s, so an embedded NUL ends their display. */
const wabtDisplayedName = (name: string | undefined): string | undefined =>
  name?.split("\0", 1)[0];

/** Frame WABT's raw custom names using the ordered names from its escaped WAT output. */
export const parseWabtOutput = (
  text: string,
  artifactBytes: number,
  customSectionNames: readonly string[],
  debugModuleNames: readonly string[] = [],
  artifact?: Uint8Array,
) => {
  const preamble =
    "\nmodule.wasm:\tfile format wasm 0x1\n" +
    debugModuleNames
      .map((name) => `module name: <${wabtDisplayedName(name)}>\n`)
      .join("");
  const prefix = `${preamble}\nSections:\n\n`;
  if (!text.startsWith(prefix))
    throw new WabtAdmissionError("unsupported_section_header");
  let offset = prefix.length;
  let customIndex = 0;
  const sections = [];
  const invalidNameEnds: number[] = [];
  while (!text.startsWith("\nSection Details:\n", offset)) {
    const match =
      /^[ \t]*(\w+) start=0x([\da-f]+) end=0x([\da-f]+) \(size=0x([\da-f]+)\) /u.exec(
        text.slice(offset),
      );
    if (match === null)
      throw new WabtAdmissionError("unrecognized_section_row");
    offset += match[0].length;
    let description: string;
    if (match[1] === "Custom" && !text.startsWith('"', offset)) {
      // WABT leaves this field blank when the binary custom name is invalid
      // UTF-8. Confirm the bytes rather than inventing a name from its output.
      const start = Number.parseInt(match[2] ?? "", 16);
      const end = Number.parseInt(match[3] ?? "", 16);
      const invalidEnd = invalidCustomNameEnd(artifact, start, end);
      if (invalidEnd === undefined)
        throw new WabtAdmissionError("blank_custom_name");
      invalidNameEnds.push(invalidEnd);
      description = "";
      // WABT does not terminate a blank-name row when another section follows.
      if (
        text.startsWith("\n", offset) &&
        !text.startsWith("\nSection Details:\n", offset)
      )
        offset += 1;
    } else if (match[1] === "Custom") {
      const name = wabtDisplayedName(customSectionNames[customIndex++]);
      if (name === undefined || !text.startsWith(`"${name}"\n`, offset))
        throw new WabtAdmissionError("custom_header_mismatch");
      description = `"${name}"`;
      offset += description.length + 1;
    } else {
      const end = text.indexOf("\n", offset);
      if (end < 0) throw new WabtAdmissionError("incomplete_section_row");
      description = text.slice(offset, end).trim();
      offset = end + 1;
    }
    const section = {
      kind: match[1] ?? "",
      start: Number.parseInt(match[2] ?? "", 16),
      end: Number.parseInt(match[3] ?? "", 16),
      bytes: Number.parseInt(match[4] ?? "", 16),
      description,
    };
    const sectionHeaderBytes = section.start - (sections.at(-1)?.end ?? 8);
    if (
      section.end > artifactBytes ||
      section.end - section.start !== section.bytes ||
      sectionHeaderBytes < 2 ||
      sectionHeaderBytes > 6
    )
      throw new WabtAdmissionError("section_ranges");
    sections.push(section);
  }
  if (customIndex !== customSectionNames.length)
    throw new WabtAdmissionError("custom_inventory_mismatch");
  if ((sections.at(-1)?.end ?? 8) !== artifactBytes)
    throw new WabtAdmissionError("section_coverage");
  const separator = offset + 1;
  return {
    sections,
    headers: text.slice(0, separator),
    details: `${preamble.slice(1)}\n${text.slice(separator)}`,
    invalidNameEnds,
  };
};

/** Return the end of a bounded invalid UTF-8 name, or undefined if unproved. */
const invalidCustomNameEnd = (
  bytes: Uint8Array | undefined,
  start: number,
  end: number,
): number | undefined => {
  if (bytes === undefined || end > bytes.length || start >= end)
    return undefined;
  let length = 0;
  let position = start;
  for (let shift = 0; shift <= 28; shift += 7) {
    const byte = bytes[position++];
    if (byte === undefined || position > end || (shift === 28 && byte > 15))
      return undefined;
    length += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) !== 0) continue;
    const nameEnd = position + length;
    if (nameEnd > end) return undefined;
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(
        bytes.subarray(position, nameEnd),
      );
      return undefined;
    } catch {
      return nameEnd;
    }
  }
  return undefined;
};
