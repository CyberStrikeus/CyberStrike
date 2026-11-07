import type { GoModule, GoModuleMetadata } from "../domain/go/goBinary.js";

const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const escapes = new Map([
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["n", 10],
  ["r", 13],
  ["t", 9],
  ["v", 11],
  ["\\", 92],
  ['"', 34],
]);

const quoted = (input: string): { value: string; end: number } | null => {
  if (input.startsWith("`")) {
    const end = input.indexOf("`", 1);
    return end < 0
      ? null
      : { value: input.slice(1, end).replace(/\r/g, ""), end: end + 1 };
  }
  if (!input.startsWith('"')) return null;
  const output = Buffer.alloc(input.length * 3);
  let length = 0;
  for (let index = 1; index < input.length;) {
    const character = input[index];
    if (character === '"') {
      try {
        return {
          value: utf8.decode(output.subarray(0, length)),
          end: index + 1,
        };
      } catch {
        return null;
      }
    }
    if (character === "\n") return null;
    if (character !== "\\") {
      const point = input.codePointAt(index);
      if (point === undefined) return null;
      length += output.write(String.fromCodePoint(point), length, "utf8");
      index += point > 0xffff ? 2 : 1;
      continue;
    }
    const escaped = input[index + 1];
    if (escaped === undefined) return null;
    const simple = escapes.get(escaped);
    if (simple !== undefined) {
      output[length++] = simple;
      index += 2;
      continue;
    }
    const digits =
      escaped === "x" ? 2 : escaped === "u" ? 4 : escaped === "U" ? 8 : 0;
    if (digits > 0) {
      const encoded = input.slice(index + 2, index + 2 + digits);
      if (encoded.length !== digits || !/^[a-f\d]+$/i.test(encoded))
        return null;
      const point = Number.parseInt(encoded, 16);
      if (escaped === "x") output[length++] = point;
      else {
        if (point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff))
          return null;
        length += output.write(String.fromCodePoint(point), length, "utf8");
      }
      index += 2 + digits;
      continue;
    }
    const octal = input.slice(index + 1, index + 4);
    if (!/^[0-7]{3}$/.test(octal)) return null;
    const byte = Number.parseInt(octal, 8);
    if (byte > 255) return null;
    output[length++] = byte;
    index += 4;
  }
  return null;
};

const setting = (input: string): { key: string; value: string } | null => {
  let key: string;
  let rawValue: string;
  if (input.startsWith('"') || input.startsWith("`")) {
    const decoded = quoted(input);
    if (decoded === null || input[decoded.end] !== "=") return null;
    key = decoded.value;
    rawValue = input.slice(decoded.end + 1);
  } else {
    const separator = input.indexOf("=");
    if (separator < 1) return null;
    key = input.slice(0, separator);
    if (/[= \t\r\n"`]/.test(key)) return null;
    rawValue = input.slice(separator + 1);
  }
  if (rawValue.startsWith('"') || rawValue.startsWith("`")) {
    const decoded = quoted(rawValue);
    return decoded !== null && decoded.end === rawValue.length
      ? { key, value: decoded.value }
      : null;
  }
  return /[ \t\r\n"`]/.test(rawValue) ? null : { key, value: rawValue };
};

const moduleLine = (fields: string[]): GoModule | null => {
  const [path, version] = fields;
  if (
    (fields.length !== 2 && fields.length !== 3) ||
    path === undefined ||
    version === undefined
  )
    return null;
  return { path, version, sum: fields[2] ?? null, replacement: null };
};

interface ModuleSourceLine {
  readonly line: string | Buffer;
  readonly terminated: boolean;
}

function* moduleSourceLines(source: Buffer): Generator<ModuleSourceLine> {
  let start = 0;
  while (start < source.length) {
    const newline = source.indexOf(10, start);
    const end = newline < 0 ? source.length : newline;
    let line: string | Buffer;
    const bytes = source.subarray(start, end);
    try {
      line = utf8.decode(bytes);
    } catch {
      line = bytes;
    }
    yield { line, terminated: newline >= 0 };
    if (newline < 0) return;
    start = newline + 1;
  }
}

const modulePrefixes = ["mod\t", "dep\t", "=>\t"].map((prefix) =>
  Buffer.from(prefix),
);

/** Decode an unframed Go module body while retaining non-UTF-8 line bytes exactly. */
export const parseGoModuleBytes = (source: Buffer): GoModuleMetadata => {
  let path: string | null = null;
  let main: GoModule | null = null;
  const dependencies: GoModule[] = [];
  const settings: { key: string; value: string }[] = [];
  const unparsed_lines: string[] = [];
  const unparsed_line_bytes_base64: string[] = [];
  let last: GoModule | null = null;
  for (const { line, terminated } of moduleSourceLines(source)) {
    if (typeof line !== "string") {
      unparsed_line_bytes_base64.push(line.toString("base64"));
      if (
        modulePrefixes.some((prefix) =>
          line.subarray(0, prefix.length).equals(prefix),
        )
      )
        last = null;
      continue;
    }
    if (line === "") continue;
    if (!terminated) {
      unparsed_lines.push(line);
      continue;
    }
    if (line.startsWith("path\t") && path === null) {
      path = line.slice(5);
      continue;
    }
    if (line.startsWith("mod\t") || line.startsWith("dep\t")) {
      const value = moduleLine(line.slice(4).split("\t"));
      last = null;
      if (value !== null && (!line.startsWith("mod\t") || main === null)) {
        if (line.startsWith("mod\t")) main = value;
        else dependencies.push(value);
        last = value;
        continue;
      }
    } else if (line.startsWith("=>\t")) {
      const fields = line.slice(3).split("\t");
      const value = moduleLine(fields);
      if (fields.length === 3 && value !== null && last !== null) {
        last.replacement = {
          path: value.path,
          version: value.version,
          sum: value.sum,
        };
        last = null;
        continue;
      }
      last = null;
    } else if (line.startsWith("build\t")) {
      const value = setting(line.slice(6));
      if (value !== null) {
        settings.push(value);
        continue;
      }
    }
    unparsed_lines.push(line);
  }
  return {
    path,
    main,
    dependencies,
    settings,
    unparsed_lines,
    unparsed_line_bytes_base64,
    complete: unparsed_lines.length + unparsed_line_bytes_base64.length === 0,
  };
};
