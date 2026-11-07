/** A bounded BER value tree shared by binary format owners. */
export interface Asn1BerNode {
  readonly tag: number;
  readonly constructed: boolean;
  readonly lengthForm: "definite" | "indefinite";
  readonly start: number;
  readonly contentStart: number;
  readonly contentEnd: number;
  readonly end: number;
  readonly content: Buffer;
  readonly children: readonly Asn1BerNode[];
}

export class Asn1BerFailure extends Error {
  constructor(
    message: string,
    readonly kind: "malformed" | "budget-exceeded" = "malformed",
    readonly limit: number | null = null,
  ) {
    super(message);
    this.name = "Asn1BerFailure";
  }
}

interface Budget {
  remaining: number;
}

const fail = (
  message: string,
  kind: Asn1BerFailure["kind"] = "malformed",
  limit: number | null = null,
): never => {
  throw new Asn1BerFailure(message, kind, limit);
};

/**
 * Reads one BER TLV and its constructed children. A reader shares its node
 * budget across separately encoded nested values, such as X.509 extnValue.
 */
export class Asn1BerReader {
  readonly #budget: Budget;

  constructor(
    readonly bytes: Buffer,
    readonly maxNodes: number,
    readonly maxDepth = 32,
  ) {
    this.#budget = { remaining: maxNodes };
  }

  read(offset = 0, end = this.bytes.length, depth = 0): Asn1BerNode {
    if (depth > this.maxDepth)
      return fail(`ASN.1 nesting exceeds ${String(this.maxDepth)} levels.`);
    if (this.#budget.remaining <= 0)
      return fail(
        `ASN.1 value count exceeds the ${String(this.maxNodes)}-node budget.`,
        "budget-exceeded",
        this.maxNodes,
      );
    this.#budget.remaining -= 1;
    if (offset >= end || offset + 2 > end)
      return fail("Truncated ASN.1 tag or length.");
    const tag = this.bytes[offset];
    if (tag === undefined) return fail("Truncated ASN.1 tag.");
    if ((tag & 0x1f) === 0x1f)
      return fail(
        `High-tag-number form at byte ${String(offset)} is unsupported.`,
      );
    if (tag === 0)
      return fail(
        "Unexpected end-of-contents marker outside an indefinite value.",
      );
    const constructed = (tag & 0x20) !== 0;
    let cursor = offset + 1;
    const lengthByte = this.bytes[cursor];
    if (lengthByte === undefined) return fail("Truncated ASN.1 length.");
    cursor += 1;
    let length = 0;
    const indefinite = lengthByte === 0x80;
    if (indefinite) {
      if (!constructed)
        return fail("Primitive ASN.1 values cannot use indefinite length.");
    } else if ((lengthByte & 0x80) === 0) length = lengthByte;
    else {
      const width = lengthByte & 0x7f;
      if (width > 4) return fail("Unsupported ASN.1 long-form length width.");
      if (cursor + width > end) return fail("Truncated ASN.1 long length.");
      length = 0;
      for (let index = 0; index < width; index += 1) {
        const byte = this.bytes[cursor];
        if (byte === undefined) return fail("Truncated ASN.1 length.");
        // Bitwise shifts sign-extend a four-octet length with bit 31 set.
        length = length * 256 + byte;
        cursor += 1;
      }
    }
    const contentStart = cursor;
    const children: Asn1BerNode[] = [];
    let contentEnd = cursor;
    let encodedEnd = cursor;
    if (indefinite) {
      let at = cursor;
      let terminated = false;
      while (at < end) {
        if (at + 1 < end && this.bytes[at] === 0 && this.bytes[at + 1] === 0) {
          contentEnd = at;
          encodedEnd = at + 2;
          terminated = true;
          break;
        }
        const child = this.read(at, end, depth + 1);
        children.push(child);
        at = child.end;
      }
      if (!terminated)
        return fail("Indefinite ASN.1 value has no end-of-contents marker.");
    } else {
      contentEnd = cursor + length;
      if (contentEnd > end) return fail("ASN.1 value exceeds its parent.");
      encodedEnd = contentEnd;
    }
    if (constructed && !indefinite) {
      let at = cursor;
      while (at < contentEnd) {
        const child = this.read(at, contentEnd, depth + 1);
        children.push(child);
        at = child.end;
      }
    }
    return {
      tag,
      constructed,
      lengthForm: indefinite ? "indefinite" : "definite",
      start: offset,
      contentStart,
      contentEnd,
      end: encodedEnd,
      content: this.bytes.subarray(contentStart, contentEnd),
      children,
    };
  }
}
