import type { MipsGnuAttributes } from "../domain/binaryTargetTypes.js";
import { err, ok, type Result } from "../domain/result.js";

/** Bound the section read before its declared size can drive allocation. */
export const MIPS_GNU_ATTRIBUTES_MAX_BYTES = 4096;

const FORMAT_VERSION = 0x41;
const TAG_FILE = 1;
const TAG_GNU_MIPS_ABI_FP = 4;
const TAG_GNU_MIPS_ABI_MSA = 8;

/**
 * Read only GNU file-scope MIPS ABI attributes REA understands. Unknown
 * vendors, scopes and tags fail closed; their declarations are not skipped.
 */
export const parseMipsGnuAttributes = (
  bytes: Buffer,
  littleEndian: boolean,
): Result<MipsGnuAttributes, string> => {
  if (bytes.length === 0 || bytes[0] !== FORMAT_VERSION)
    return err("unsupported MIPS GNU attribute section format version");

  const readU32 = (offset: number): number =>
    littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset);
  const readUleb = (
    offset: number,
    end: number,
  ): { readonly value: number; readonly next: number } | undefined => {
    let value = 0;
    for (let index = 0; index < 5 && offset + index < end; index += 1) {
      const byte = bytes[offset + index]!;
      value += (byte & 0x7f) * 2 ** (7 * index);
      if ((byte & 0x80) === 0)
        return value <= 0xffffffff
          ? { value, next: offset + index + 1 }
          : undefined;
    }
    return undefined;
  };

  let fpAbi: number | null = null;
  let msa: number | null = null;
  let vendorSeen = false;
  let position = 1;
  while (position < bytes.length) {
    if (bytes.length - position < 4)
      return err("truncated MIPS GNU attribute subsection length");
    const length = readU32(position);
    if (length < 4 || length > bytes.length - position)
      return err(
        "MIPS GNU attribute subsection length does not fit the section",
      );
    const end = position + length;
    const vendorEnd = bytes.indexOf(0, position + 4);
    if (vendorEnd < 0 || vendorEnd >= end)
      return err("unterminated MIPS GNU attribute vendor name");
    if (bytes.toString("latin1", position + 4, vendorEnd) !== "gnu")
      return err(
        "MIPS ELF declares non-GNU vendor attributes that REA does not inspect",
      );
    if (vendorSeen)
      return err("duplicate MIPS GNU attribute vendor subsections");
    vendorSeen = true;

    let cursor = vendorEnd + 1;
    while (cursor < end) {
      const scopeStart = cursor;
      const scope = readUleb(cursor, end);
      if (scope === undefined)
        return err("malformed MIPS GNU attribute scope tag");
      if (scope.value !== TAG_FILE)
        return err(
          "MIPS GNU attributes scoped to sections or symbols are not inspected by REA",
        );
      if (end - scope.next < 4)
        return err("truncated MIPS GNU attribute scope length");
      const scopeLength = readU32(scope.next);
      if (
        scopeLength < scope.next + 4 - scopeStart ||
        scopeLength > end - scopeStart
      )
        return err(
          "MIPS GNU attribute scope length does not fit its subsection",
        );
      const scopeEnd = scopeStart + scopeLength;
      cursor = scope.next + 4;
      while (cursor < scopeEnd) {
        const tag = readUleb(cursor, scopeEnd);
        if (tag === undefined) return err("malformed MIPS GNU attribute tag");
        if (
          tag.value !== TAG_GNU_MIPS_ABI_FP &&
          tag.value !== TAG_GNU_MIPS_ABI_MSA
        )
          return err(
            `MIPS ELF declares GNU attribute tag ${tag.value}, which REA does not inspect`,
          );
        const value = readUleb(tag.next, scopeEnd);
        if (value === undefined)
          return err("malformed MIPS GNU attribute value");
        if (tag.value === TAG_GNU_MIPS_ABI_FP) {
          if (fpAbi !== null)
            return err("duplicate MIPS GNU floating-point ABI attributes");
          fpAbi = value.value;
        } else {
          if (msa !== null) return err("duplicate MIPS GNU MSA ABI attributes");
          msa = value.value;
        }
        cursor = value.next;
      }
      cursor = scopeEnd;
    }
    position = end;
  }
  return ok({ fpAbi, msa });
};
