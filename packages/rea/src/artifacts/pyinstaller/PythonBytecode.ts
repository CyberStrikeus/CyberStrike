import { observePythonBytecodePrefix } from "../../domain/python/pythonBytecodeIdentity.js";

/** Final magics admitted for archive reconstruction, independently of standalone code-layout support. */
const RECONSTRUCTABLE_PYTHON_MAGICS: ReadonlySet<number> = new Set([
  3394, 3413, 3425, 3439, 3495, 3531, 3571, 3627,
]);

/** Limitation recorded when a member's digest covers a derived `.pyc` header. */
export const RECONSTRUCTED_PYTHON_HEADER_LIMITATION =
  "Python bytecode header was reconstructed from the archive Python magic; this digest covers the derived file.";

/** Resolve an archive-eligible magic without treating every known family as reconstructable. */
export const pythonVersionForMagic = (magic: Buffer): string | undefined => {
  if (magic.length !== 4) return undefined;
  const observed = observePythonBytecodePrefix(magic);
  return observed.state === "framed" &&
    RECONSTRUCTABLE_PYTHON_MAGICS.has(observed.magic)
    ? observed.identity?.pythonVersion
    : undefined;
};

/**
 * 16-byte `.pyc` header used since Python 3.7: magic, zero flags, zero
 * timestamp, and zero source size. The flags word selects the timestamp form.
 */
export const reconstructedPycHeader = (magic: Buffer): Buffer => {
  const header = Buffer.alloc(16);
  magic.copy(header, 0, 0, 4);
  return header;
};

/** TYPE_CODE with or without FLAG_REF; a pyc magic takes precedence. */
export const isHeaderlessPythonCode = (prefix: Buffer): boolean =>
  prefix.length === 4 &&
  observePythonBytecodePrefix(prefix).state !== "framed" &&
  (prefix[0] === 0x63 || prefix[0] === 0xe3);

export interface CArchiveBytecodeHeader {
  readonly header: Buffer | undefined;
  readonly limitation: string | undefined;
}
