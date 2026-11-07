import type { Evidence } from "../../domain/evidence.js";
import { jsonByteLength, jsonParts } from "../../domain/jsonSerialization.js";

/** An Evidence file's bytes as `--format json` writes the Evidence to a file: compact JSON and a newline. */
export const evidenceFileBytes = (
  evidence: Evidence,
  admit?: (bytes: number) => void,
): Buffer => {
  // Measured first, so the document is written into one exactly sized buffer.
  const size = jsonByteLength(evidence) + 1;
  admit?.(size);
  const bytes = Buffer.allocUnsafe(size);
  let offset = 0;
  for (const part of jsonParts(evidence)) offset += bytes.write(part, offset);
  if (offset !== bytes.length - 1)
    throw new Error("Evidence serialized to a different length than measured");
  bytes[offset] = 0x0a;
  return bytes;
};
