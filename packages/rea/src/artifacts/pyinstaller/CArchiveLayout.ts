import type { FileHandle } from "node:fs/promises";
import { readPyInstallerBytes } from "./PyInstallerBytes.js";

import { err, ok, type Result } from "../../domain/result.js";
import {
  pyInstallerFailure,
  type PyInstallerFailure,
} from "./PyInstallerFailure.js";

/** Magic at the start of a CArchive cookie. */
export const PYINSTALLER_COOKIE_MAGIC = Buffer.from("MEI\x0c\x0b\x0a\x0b\x0e");

/** PyInstaller 2.1+ cookie size, including the 64-byte library name. */
export const PYINSTALLER_COOKIE_V21_BYTES = 88;

/** PyInstaller 2.0 cookie size, without the library name. */
export const PYINSTALLER_COOKIE_V20_BYTES = 24;

/**
 * How far before EOF the cookie may sit. macOS code signatures are appended
 * after the cookie, and a large binary's signature hashes are larger than the
 * bootloader's own 8 KiB scan chunk, so detection uses one bounded tail.
 */
export const PYINSTALLER_COOKIE_SEARCH_BYTES = 16 * 1024 * 1024;

const MAX_TOC_BYTES = 32 * 1024 * 1024;
const MAX_TOC_ENTRIES = 100_000;
const TOC_HEADER_BYTES = 18;

/** Observed CArchive cookie. Offsets are relative to the archive start. */
export interface PyInstallerCookie {
  readonly layout: "2.0" | "2.1";
  readonly archiveStart: number;
  readonly packageLength: number;
  readonly tocOffset: number;
  readonly tocLength: number;
  readonly pythonVersion: number;
  readonly pythonLibrary: string | null;
  readonly cookieOffset: number;
}

type CArchiveEntryRole =
  | "script"
  | "module"
  | "package"
  | "runtime-option"
  | "dependency"
  | "symlink"
  | "binary"
  | "pyz"
  | "other";

const CARCHIVE_ENTRY_ROLES: ReadonlyMap<string, CArchiveEntryRole> = new Map([
  ["s", "script"],
  ["m", "module"],
  ["M", "package"],
  ["o", "runtime-option"],
  ["d", "dependency"],
  ["n", "symlink"],
  ["b", "binary"],
  ["z", "pyz"],
]);

/** One CArchive table entry, retaining its source code separately from the parsed role. */
export interface CArchiveEntry {
  readonly index: number;
  readonly tocRecordOffset: number;
  readonly tocRecordLength: number;
  readonly name: string;
  readonly typeCode: string;
  readonly role: CArchiveEntryRole;
  readonly offset: number;
  readonly compressedSize: number;
  readonly uncompressedSize: number;
  readonly compressionFlag: 0 | 1;
}

/** Role-defined declarations never own local payload bytes. */
export const isCArchiveDeclaration = (entry: CArchiveEntry): boolean =>
  entry.role === "runtime-option" || entry.role === "dependency";

/** Importable Python modules and packages share headerless-code and marker semantics. */
export const isCArchivePythonModule = (entry: CArchiveEntry): boolean =>
  entry.role === "module" || entry.role === "package";

/** Completed search facts; a rejected magic copy does not establish an archive. */
export type PyInstallerCookieObservation =
  | { readonly state: "absent" }
  | {
      readonly state: "rejected-candidates";
      readonly failure: PyInstallerFailure;
    }
  | { readonly state: "located"; readonly cookie: PyInstallerCookie };

/** Search the bounded tail completely; acquisition failures are not negative observations. */
export const observePyInstallerCookie = async (
  handle: FileHandle,
  fileSize: number,
  signal?: AbortSignal,
): Promise<Result<PyInstallerCookieObservation, PyInstallerFailure>> => {
  if (
    !Number.isSafeInteger(fileSize) ||
    fileSize < PYINSTALLER_COOKIE_V20_BYTES
  )
    return ok({ state: "absent" });
  const tailSize = Math.min(fileSize, PYINSTALLER_COOKIE_SEARCH_BYTES);
  const read = await readPyInstallerBytes(handle, {
    position: fileSize - tailSize,
    length: tailSize,
    label: "CArchive tail",
    signal,
  });
  if (!read.ok) return read;
  const observed = read.value;
  let failure: PyInstallerFailure | undefined;
  let from = observed.length;
  while (from >= PYINSTALLER_COOKIE_MAGIC.length) {
    const relative = observed
      .subarray(0, from)
      .lastIndexOf(PYINSTALLER_COOKIE_MAGIC);
    if (relative < 0) break;
    const cookieOffset = fileSize - tailSize + relative;
    const parsed = parseCookieAt(observed, relative, cookieOffset, fileSize);
    if (parsed.ok) return ok({ state: "located", cookie: parsed.value });
    failure = parsed.error;
    from = relative;
  }
  return ok(
    failure === undefined
      ? { state: "absent" }
      : { state: "rejected-candidates", failure },
  );
};

/** Read and parse the TOC that a validated cookie names. */
export const readCArchiveToc = async (
  handle: FileHandle,
  cookie: PyInstallerCookie,
  signal?: AbortSignal,
): Promise<Result<readonly CArchiveEntry[], PyInstallerFailure>> => {
  if (cookie.tocLength > MAX_TOC_BYTES)
    return err(
      pyInstallerFailure(
        "limit",
        "CArchive table of contents exceeds its bound",
      ),
    );
  const position = cookie.archiveStart + cookie.tocOffset;
  const read = await readPyInstallerBytes(handle, {
    position,
    length: cookie.tocLength,
    label: "CArchive table of contents",
    signal,
  });
  if (!read.ok) return read;
  const parsed = parseCArchiveToc(read.value);
  if (!parsed.ok) return parsed;
  const valid = validateCArchiveMembers(parsed.value, cookie.tocOffset);
  return valid.ok ? parsed : valid;
};

/** Parse TOC bytes. Each entry is a big-endian header plus a NUL-padded name. */
export const parseCArchiveToc = (
  bytes: Buffer,
): Result<readonly CArchiveEntry[], PyInstallerFailure> => {
  const entries: CArchiveEntry[] = [];
  let offset = 0;
  const malformedEntry = (message: string): Result<never, PyInstallerFailure> =>
    err(
      pyInstallerFailure(
        "format",
        `CArchive table index ${String(entries.length)} at TOC offset ${String(offset)}: ${message}`,
      ),
    );
  while (offset < bytes.length) {
    if (entries.length >= MAX_TOC_ENTRIES)
      return err(
        pyInstallerFailure(
          "limit",
          "CArchive table of contents exceeds its entry bound",
        ),
      );
    if (offset + TOC_HEADER_BYTES > bytes.length)
      return malformedEntry("CArchive table of contents entry is truncated");
    const entryLength = bytes.readUInt32BE(offset);
    if (entryLength < TOC_HEADER_BYTES || offset + entryLength > bytes.length)
      return malformedEntry(
        "CArchive table of contents entry extends outside the table",
      );
    const nameBytes = bytes.subarray(
      offset + TOC_HEADER_BYTES,
      offset + entryLength,
    );
    const name = tocName(nameBytes);
    if (!name.ok) return malformedEntry(name.error.message);
    const compressionFlag = bytes[offset + 16] ?? 0;
    if (compressionFlag !== 0 && compressionFlag !== 1)
      return malformedEntry(
        `CArchive compression flag ${String(compressionFlag)} is not stored or zlib`,
      );
    const typeCode = bytes[offset + 17] ?? 0;
    if (typeCode < 0x20 || typeCode > 0x7e)
      return malformedEntry("CArchive type code is not a printable character");
    const sourceTypeCode = String.fromCharCode(typeCode);
    entries.push({
      index: entries.length,
      tocRecordOffset: offset,
      tocRecordLength: entryLength,
      name: name.value,
      typeCode: sourceTypeCode,
      // Other printable codes keep generic-file behavior; compression is independent.
      role: CARCHIVE_ENTRY_ROLES.get(sourceTypeCode) ?? "other",
      offset: bytes.readUInt32BE(offset + 4),
      compressedSize: bytes.readUInt32BE(offset + 8),
      uncompressedSize: bytes.readUInt32BE(offset + 12),
      compressionFlag,
    });
    offset += entryLength;
  }
  return ok(entries);
};

const parseCookieAt = (
  tail: Buffer,
  relative: number,
  cookieOffset: number,
  fileSize: number,
): Result<PyInstallerCookie, PyInstallerFailure> => {
  const modern = parseCookie(tail, relative, cookieOffset, fileSize, "2.1");
  if (modern.ok) return modern;
  const legacy = parseCookie(tail, relative, cookieOffset, fileSize, "2.0");
  return legacy.ok ? legacy : modern;
};

const parseCookie = (
  tail: Buffer,
  relative: number,
  cookieOffset: number,
  fileSize: number,
  layout: "2.0" | "2.1",
): Result<PyInstallerCookie, PyInstallerFailure> => {
  const cookieBytes =
    layout === "2.1"
      ? PYINSTALLER_COOKIE_V21_BYTES
      : PYINSTALLER_COOKIE_V20_BYTES;
  if (relative + cookieBytes > tail.length)
    return err(
      pyInstallerFailure(
        "format",
        "CArchive cookie extends past the end of the file",
      ),
    );
  const view = tail.subarray(relative, relative + cookieBytes);
  const packageLength = view.readUInt32BE(8);
  const tocOffset = view.readUInt32BE(12);
  const tocLength = view.readUInt32BE(16);
  const pythonVersion = view.readUInt32BE(20);
  if (
    !safeSum(tocOffset, tocLength, cookieBytes) ||
    packageLength !== tocOffset + tocLength + cookieBytes
  )
    return err(
      pyInstallerFailure(
        "format",
        "CArchive cookie does not describe a table of contents inside the package",
      ),
    );
  const archiveStart = cookieOffset + cookieBytes - packageLength;
  if (archiveStart < 0 || archiveStart + packageLength > fileSize)
    return err(
      pyInstallerFailure("format", "CArchive cookie range is outside the file"),
    );
  const library =
    layout === "2.1" ? libraryName(view.subarray(24, 88)) : ok(null);
  if (!library.ok) return library;
  return ok({
    layout,
    archiveStart,
    packageLength,
    tocOffset,
    tocLength,
    pythonVersion,
    pythonLibrary: library.value,
    cookieOffset,
  });
};

const libraryName = (
  bytes: Buffer,
): Result<string | null, PyInstallerFailure> => {
  const end = bytes.indexOf(0);
  const text = end < 0 ? bytes : bytes.subarray(0, end);
  if (end >= 0 && bytes.subarray(end).some((byte) => byte !== 0))
    return err(
      pyInstallerFailure(
        "format",
        "CArchive Python library name is not NUL-padded",
      ),
    );
  if (text.length === 0) return ok(null);
  try {
    return ok(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(text),
    );
  } catch {
    return err(
      pyInstallerFailure(
        "format",
        "CArchive Python library name is not valid UTF-8",
      ),
    );
  }
};

const tocName = (bytes: Buffer): Result<string, PyInstallerFailure> => {
  const end = bytes.indexOf(0);
  const text = end < 0 ? bytes : bytes.subarray(0, end);
  if (text.length === 0)
    return err(pyInstallerFailure("format", "CArchive entry name is empty"));
  try {
    return ok(
      new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(text),
    );
  } catch {
    return err(
      pyInstallerFailure("format", "CArchive entry name is not valid UTF-8"),
    );
  }
};

const safeSum = (left: number, middle: number, right: number): boolean =>
  Number.isSafeInteger(left) &&
  Number.isSafeInteger(middle) &&
  Number.isSafeInteger(right) &&
  left >= 0 &&
  middle >= 0 &&
  right >= 0 &&
  left + middle + right <= Number.MAX_SAFE_INTEGER;

/** Source directory semantics are validated once before any consumer projects paths. */
const validateCArchiveMembers = (
  entries: readonly CArchiveEntry[],
  tocOffset: number,
): Result<null, PyInstallerFailure> => {
  for (const entry of entries) {
    if (isCArchiveDeclaration(entry)) {
      if (
        entry.compressedSize !== 0 ||
        entry.uncompressedSize !== 0 ||
        entry.compressionFlag !== 0
      )
        return err(
          pyInstallerFailure(
            "integrity",
            `CArchive declaration at table index ${String(entry.index)} has local payload or compression`,
          ),
        );
    }
    if (
      entry.compressionFlag === 0 &&
      entry.compressedSize !== entry.uncompressedSize
    )
      return err(
        pyInstallerFailure(
          "integrity",
          `Stored CArchive member size disagrees with its table entry at table index ${String(entry.index)}`,
        ),
      );
    if (entry.offset > tocOffset)
      return err(
        pyInstallerFailure(
          "format",
          `CArchive member offset is outside the archive at table index ${String(entry.index)}`,
        ),
      );
  }
  const ranges = entries
    .filter((entry) => entry.compressedSize > 0)
    .map((entry) => ({
      index: entry.index,
      start: entry.offset,
      end: entry.offset + entry.compressedSize,
    }))
    .sort((left, right) => left.start - right.start);
  let occupied = 0;
  for (const range of ranges) {
    if (
      !Number.isSafeInteger(range.end) ||
      range.end > tocOffset ||
      range.start < occupied
    )
      return err(
        pyInstallerFailure(
          "integrity",
          `CArchive member extends outside the archive or overlaps another member at table index ${String(range.index)}`,
        ),
      );
    occupied = range.end;
  }
  return ok(null);
};
