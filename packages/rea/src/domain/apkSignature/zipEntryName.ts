/**
 * ZIP entry names as apksig reads them: `new String(raw, UTF_8)`, compared as
 * Java strings. Java replaces malformed UTF-8 with U+FFFD like WHATWG's
 * TextDecoder (one replacement per maximal subpart) except for encoded
 * surrogates: Java replaces `ED A0..BF` with its continuation byte (or ending
 * the name) as one unit, where WHATWG replaces `ED` and each following byte
 * separately. Checked against OpenJDK 25's `String(byte[], UTF_8)`.
 *
 * A name's canonical bytes are the UTF-8 encoding of that decoded string; a
 * well-formed name is its own canonical form. Hashing and comparison walk the
 * stored bytes in place, one unit at a time; only decoding a malformed name
 * for display builds its canonical bytes.
 */

// Java keeps a leading U+FEFF, so the decoder must not strip a BOM.
const NAME_DECODER = new TextDecoder("utf-8", {
  fatal: false,
  ignoreBOM: true,
});

/** U+FFFD encoded as UTF-8. */
const REPLACEMENT = [0xef, 0xbf, 0xbd] as const;

const isContinuation = (b: number): boolean => (b & 0xc0) === 0x80;

/** A continuation, C0/C1 or F5..FF byte where a sequence starts: replaced alone. */
const isLoneInvalid = (b: number): boolean =>
  b >= 0x80 && (b < 0xc2 || b > 0xf4);

/**
 * The byte length of the unit at `i`: positive for a well-formed sequence,
 * negative for the bytes Java replaces with one U+FFFD (as JDK
 * `String.decodeUTF8_UTF16` advances).
 */
const nextUnit = (bytes: Uint8Array, i: number, stop: number): number => {
  const b1 = bytes[i] ?? 0;
  if (b1 < 0x80) return 1;
  if (isLoneInvalid(b1)) return -1;
  const remaining = stop - i;
  const b2 = remaining > 1 ? (bytes[i + 1] ?? 0) : 0;
  const b3 = remaining > 2 ? (bytes[i + 2] ?? 0) : 0;
  if (b1 >= 0xc2 && b1 <= 0xdf)
    return remaining > 1 && isContinuation(b2) ? 2 : -1;
  if ((b1 & 0xf0) === 0xe0) {
    const badSecond =
      (b1 === 0xe0 && (b2 & 0xe0) === 0x80) || !isContinuation(b2);
    if (remaining > 2) {
      if (badSecond) return -1;
      if (!isContinuation(b3)) return -2;
      // An encoded surrogate decodes, then is replaced as a whole.
      return b1 === 0xed && b2 >= 0xa0 ? -3 : 3;
    }
    // Truncated at the end: a bad second byte alone, else the whole tail.
    return remaining === 2 && badSecond ? -1 : -remaining;
  }
  if (b1 >= 0xf0 && b1 <= 0xf7) {
    if (remaining === 1) return -1;
    const badSecond =
      b1 > 0xf4 ||
      (b1 === 0xf0 && (b2 < 0x90 || b2 > 0xbf)) ||
      (b1 === 0xf4 && (b2 & 0xf0) !== 0x80) ||
      !isContinuation(b2);
    if (badSecond) return -1;
    if (remaining > 3) {
      if (!isContinuation(b3)) return -2;
      return isContinuation(bytes[i + 3] ?? 0) ? 4 : -3;
    }
    // Truncated at the end: up to a bad third byte, else the whole tail.
    return remaining === 3 && !isContinuation(b3) ? -2 : -remaining;
  }
  return -1;
};

/** True when the stored name is well-formed UTF-8 (its own canonical form). */
export const isCanonicalZipName = (
  bytes: Uint8Array,
  start: number,
  stop: number,
): boolean => {
  for (let i = start; i < stop;) {
    const unit = nextUnit(bytes, i, stop);
    if (unit < 0) return false;
    i += unit;
  }
  return true;
};

const FNV_OFFSET = 0x811c9dc5;
const FNV_PRIME = 0x01000193;

/** 32-bit FNV-1a over a name's canonical bytes, read in place. */
export const canonicalNameHash = (
  bytes: Uint8Array,
  start: number,
  stop: number,
  canonical: boolean,
): number => {
  let hash = FNV_OFFSET;
  if (canonical) {
    for (let k = start; k < stop; k += 1)
      hash = Math.imul(hash ^ (bytes[k] ?? 0), FNV_PRIME);
    return hash;
  }
  for (let i = start; i < stop;) {
    const unit = nextUnit(bytes, i, stop);
    if (unit > 0)
      for (let k = i; k < i + unit; k += 1)
        hash = Math.imul(hash ^ (bytes[k] ?? 0), FNV_PRIME);
    else {
      hash = Math.imul(hash ^ 0xef, FNV_PRIME);
      hash = Math.imul(hash ^ 0xbf, FNV_PRIME);
      hash = Math.imul(hash ^ 0xbd, FNV_PRIME);
    }
    i += Math.abs(unit);
  }
  return hash;
};

/** A stored name: its bytes within a buffer. */
export interface StoredZipName {
  readonly bytes: Uint8Array;
  readonly start: number;
  readonly stop: number;
}

/** Canonical byte `k` of the unit at `i` (U+FFFD for a replaced one), or -1 past it. */
const unitByte = (
  bytes: Uint8Array,
  i: number,
  unit: number,
  k: number,
): number => {
  if (unit < 0) return REPLACEMENT[k] ?? -1;
  return k < unit ? (bytes[i + k] ?? 0) : -1;
};

/**
 * Byte order of two stored names' canonical forms, compared one unit at a
 * time in place: work is linear in the stored bytes and nothing is copied.
 * UTF-8 sequences are prefix-free, so two units differ within their bytes or
 * not at all.
 */
export const compareCanonicalNames = (
  a: StoredZipName,
  b: StoredZipName,
): number => {
  let i = a.start;
  let j = b.start;
  while (i < a.stop && j < b.stop) {
    const x = a.bytes[i] ?? 0;
    const y = b.bytes[j] ?? 0;
    // Equal ASCII, or two bytes each replaced alone: the same canonical bytes.
    if ((x === y && x < 0x80) || (isLoneInvalid(x) && isLoneInvalid(y))) {
      i += 1;
      j += 1;
      continue;
    }
    const u = nextUnit(a.bytes, i, a.stop);
    const v = nextUnit(b.bytes, j, b.stop);
    if (u > 0 || v > 0)
      for (let k = 0; k < 4; k += 1) {
        const p = unitByte(a.bytes, i, u, k);
        const q = unitByte(b.bytes, j, v, k);
        if (p !== q) return p - q;
        if (p < 0) break;
      }
    i += Math.abs(u);
    j += Math.abs(v);
  }
  return (i < a.stop ? 1 : 0) - (j < b.stop ? 1 : 0);
};

/** The name as apksig's `new String(raw, UTF_8)` decodes it. */
export const decodeZipName = (raw: Uint8Array): string => {
  if (isCanonicalZipName(raw, 0, raw.length)) return NAME_DECODER.decode(raw);
  // Re-encode the replacements once, then decode the well-formed result.
  let length = 0;
  for (let i = 0; i < raw.length;) {
    const unit = nextUnit(raw, i, raw.length);
    length += unit > 0 ? unit : REPLACEMENT.length;
    i += Math.abs(unit);
  }
  const canonical = new Uint8Array(length);
  let at = 0;
  for (let i = 0; i < raw.length;) {
    const unit = nextUnit(raw, i, raw.length);
    if (unit > 0) canonical.set(raw.subarray(i, i + unit), at);
    else canonical.set(REPLACEMENT, at);
    at += unit > 0 ? unit : REPLACEMENT.length;
    i += Math.abs(unit);
  }
  return NAME_DECODER.decode(canonical);
};

const whole = (bytes: Uint8Array): StoredZipName => ({
  bytes,
  start: 0,
  stop: bytes.length,
});

/** The two stored names decode to the same Java string, as apksig compares them. */
export const sameZipName = (a: Uint8Array, b: Uint8Array): boolean =>
  compareCanonicalNames(whole(a), whole(b)) === 0;
