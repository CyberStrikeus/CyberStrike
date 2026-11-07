import { CaptureFormatError } from "./CaptureFormatError.js";

/** Preserve ordered HTTP fields and the stored body; never dechunk, decompress or fetch. */
export const decodeSazHttp = (bytes: Buffer, request: boolean) => {
  const crlfSplit = bytes.indexOf("\r\n\r\n");
  // Once a CRLF separator is found, only an earlier LF separator can win.
  // Avoid searching an otherwise unrelated large body a second time.
  const lfSplit = bytes
    .subarray(0, crlfSplit < 0 ? bytes.length : crlfSplit)
    .indexOf("\n\n");
  // The first separator ends the headers. Later separators belong to the
  // stored body, which may use different line endings or contain binary data.
  const split =
    crlfSplit >= 0 && (lfSplit < 0 || crlfSplit < lfSplit) ? crlfSplit : -1;
  const boundary = split < 0 ? lfSplit : split;
  if (boundary < 0)
    throw new CaptureFormatError(
      "format",
      "SAZ HTTP message has no header/body separator.",
    );
  const lines = bytes
    .subarray(0, boundary)
    .toString("latin1")
    .split(split < 0 ? "\n" : "\r\n");
  const first = lines.shift() ?? "";
  const fields = request
    ? /^(\S+) +(\S+) +(HTTP\/\d+(?:\.\d+)?)$/.exec(first)
    : /^(HTTP\/\d+(?:\.\d+)?) +(\d{3})(?: (.*))?$/.exec(first);
  if (fields === null)
    throw new CaptureFormatError("format", "SAZ HTTP start line is malformed.");
  const headers: { name: string; value: string }[] = [];
  for (const line of lines) {
    if (/^[ \t]/.test(line)) {
      const previous = headers.at(-1);
      if (previous === undefined)
        throw new CaptureFormatError(
          "format",
          "SAZ HTTP header continuation has no field.",
        );
      previous.value += `${split < 0 ? "\n" : "\r\n"}${line}`;
      continue;
    }
    const colon = line.indexOf(":");
    // HTTP/2 pseudo-headers use the second colon as the delimiter.
    const delimiter = colon === 0 ? line.indexOf(":", 1) : colon;
    if (delimiter < 1)
      throw new CaptureFormatError("format", "SAZ HTTP header is malformed.");
    const name = line.slice(0, delimiter);
    if (!/^:?[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name))
      throw new CaptureFormatError(
        "format",
        "SAZ HTTP header name is malformed.",
      );
    headers.push({ name, value: line.slice(delimiter + 1) });
  }
  const start = request
    ? {
        method: fields[1] ?? "",
        url: fields[2] ?? "",
        http_version: fields[3] ?? "",
      }
    : {
        http_version: fields[1] ?? "",
        status: fields[2] ?? "",
        reason: fields[3] ?? "",
      };
  return {
    ...start,
    headers,
    body: bytes.subarray(boundary + (split < 0 ? 2 : 4)),
  };
};
