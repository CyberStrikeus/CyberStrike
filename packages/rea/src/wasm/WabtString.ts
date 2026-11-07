import { WabtAdmissionError } from "./WabtAdmissionError.js";

/** Locate a WAT string's exclusive end without decoding or copying its payload. */
export const watStringEnd = (form: string, start: number): number => {
  for (
    let end = form.indexOf('"', start);
    end !== -1;
    end = form.indexOf('"', end + 1)
  ) {
    let escapes = end;
    while (escapes > start && form[escapes - 1] === "\\") escapes--;
    if ((end - escapes) % 2 === 0) return end + 1;
  }
  throw new WabtAdmissionError("incomplete_string");
};

/** Decode a producer WAT string only where its bytes are interpreted. */
export const watString = (form: string, start: number) => {
  const end = watStringEnd(form, start);
  const name = form.slice(start, end - 1);
  // Escapes shrink; literal UTF-8 has the same byte extent as its source.
  const bytes = Buffer.alloc(Buffer.byteLength(name, "utf8"));
  let length = 0;
  for (let index = 0; index < name.length;) {
    if (name[index] !== "\\") {
      const next = name.indexOf("\\", index);
      const end = next < 0 ? name.length : next;
      length += bytes.write(name.slice(index, end), length, "utf8");
      index = end;
      continue;
    }
    const hex = name.slice(index + 1, index + 3);
    if (/^[\da-f]{2}$/iu.test(hex)) {
      bytes[length++] = Number.parseInt(hex, 16);
      index += 3;
    } else {
      const escape = name[index + 1];
      const value =
        escape === "t"
          ? 9
          : escape === "n"
            ? 10
            : escape === "r"
              ? 13
              : escape === '"'
                ? 34
                : escape === "\\"
                  ? 92
                  : undefined;
      if (value === undefined)
        throw new WabtAdmissionError("unsupported_escape");
      bytes[length++] = value;
      index += 2;
    }
  }
  return { bytes: bytes.subarray(0, length), end };
};
