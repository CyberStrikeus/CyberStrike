import type { FileHandle } from "node:fs/promises";
import { hashReadable } from "../ArtifactHash.js";
import { readArtifactFileChunks } from "../readArtifactFileChunks.js";
import { readPyInstallerBytes } from "./PyInstallerBytes.js";

import { err, ok, type Result } from "../../domain/result.js";
import { readMarshalSubset, type MarshalValue } from "./MarshalSubset.js";
import {
  pyInstallerFailure,
  type PyInstallerFailure,
} from "./PyInstallerFailure.js";
import { pythonVersionForMagic } from "./PythonBytecode.js";

const PYZ_MAGIC = Buffer.from("PYZ\0");
const PYZ_HEADER_BYTES = 12;
const PYZ_ENTRY_ROLES = ["module", "package", "data", "namespace"] as const;

/** One PYZ table entry. Type codes follow the archive's module, package, data, and namespace values. */
export interface PyzEntry {
  readonly index: number;
  readonly name: string;
  readonly typeCode: number;
  readonly offset: number;
  readonly length: number;
  /** PYZ compresses every nonempty payload, independently of its logical module type. */
  readonly compressionFlag: 0 | 1;
  readonly role: (typeof PYZ_ENTRY_ROLES)[number];
}

export type PyzArchive =
  | {
      readonly kind: "entries";
      readonly pythonMagic: Buffer;
      readonly pythonVersion: string;
      readonly sha256: string;
      readonly entries: readonly PyzEntry[];
    }
  | {
      readonly kind: "opaque";
      readonly pythonMagic: Buffer;
      readonly pythonVersion: string | undefined;
      readonly sha256: string;
      readonly limitation: string;
    };

/** Bound the transient marshal table allocation independently of image expansion. */
export const MAX_PYZ_TABLE_BYTES = 16 * 1024 * 1024;

interface PyzHeaderFacts {
  readonly signatureMatches: boolean;
  readonly pythonMagic: Buffer;
  readonly pythonVersion: string | undefined;
  readonly tocOffset: number;
  /** Null means the declaration lies outside this image, not an empty table. */
  readonly tableBytes: number | null;
}

/** Called only after the exact fixed-header read has succeeded. */
const readPyzHeaderFacts = (header: Buffer, size: number): PyzHeaderFacts => {
  const pythonMagic = Buffer.from(header.subarray(4, 8));
  const tocOffset = header.readUInt32BE(8);
  return {
    signatureMatches: header.subarray(0, 4).equals(PYZ_MAGIC),
    pythonMagic,
    pythonVersion: pythonVersionForMagic(pythonMagic),
    tocOffset,
    tableBytes:
      tocOffset >= PYZ_HEADER_BYTES && tocOffset <= size
        ? size - tocOffset
        : null,
  };
};

/** Parse only the header and table in memory; hash the complete file range in chunks. */
export const readPyzArchive = async (
  handle: FileHandle,
  start: number,
  size: number,
  signal?: AbortSignal,
): Promise<Result<PyzArchive, PyInstallerFailure>> => {
  if (size < PYZ_HEADER_BYTES)
    return err(
      pyInstallerFailure("format", "PYZ archive magic does not match"),
    );
  const headerRead = await readPyInstallerBytes(handle, {
    position: start,
    length: PYZ_HEADER_BYTES,
    label: "PYZ header",
    signal,
  });
  if (!headerRead.ok) return headerRead;
  const header = readPyzHeaderFacts(headerRead.value, size);
  const tableSize =
    header.pythonVersion === undefined ? 0 : (header.tableBytes ?? 0);
  if (tableSize > MAX_PYZ_TABLE_BYTES)
    return err(
      pyInstallerFailure(
        "limit",
        "PYZ table exceeds the 16 MiB in-memory table budget",
      ),
    );
  const read = await readPyInstallerBytes(handle, {
    position: start + header.tocOffset,
    length: tableSize,
    label: "PYZ table",
    signal,
  });
  if (!read.ok) return read;
  const table = read.value;
  const digest = await hashReadable(
    readArtifactFileChunks(handle, {
      start,
      end: start + size - 1,
      ...(signal === undefined ? {} : { signal }),
    }),
    signal,
  );
  if (digest.bytes !== size)
    return err(
      pyInstallerFailure("format", "PYZ image extends outside the file"),
    );
  return parsePyzParts(header, table, digest.sha256);
};

const parsePyzParts = (
  header: PyzHeaderFacts,
  table: Buffer,
  sha256: string,
): Result<PyzArchive, PyInstallerFailure> => {
  if (!header.signatureMatches)
    return err(
      pyInstallerFailure("format", "PYZ archive magic does not match"),
    );
  const { pythonMagic, pythonVersion, tocOffset } = header;
  if (pythonVersion === undefined)
    return ok({
      kind: "opaque",
      pythonMagic,
      pythonVersion,
      sha256,
      limitation: `PYZ Python magic ${pythonMagic.toString("hex")} is not in the supported set; the member was left opaque.`,
    });
  if (header.tableBytes === null)
    return err(
      pyInstallerFailure(
        "format",
        "PYZ table of contents is outside the archive",
      ),
    );
  const marshalled = readMarshalSubset(table);
  if (!marshalled.ok) {
    if (marshalled.error.reason !== "format") return marshalled;
    return ok({
      kind: "opaque",
      pythonMagic,
      pythonVersion,
      sha256,
      limitation: `PYZ table of contents could not be parsed (${marshalled.error.message}); the member was left opaque.`,
    });
  }
  const entries = pyzEntries(marshalled.value, tocOffset, table.length);
  if (!entries.ok)
    return entries.error.reason === "format"
      ? ok({
          kind: "opaque",
          pythonMagic,
          pythonVersion,
          sha256,
          limitation: `${entries.error.message}; the member was left opaque.`,
        })
      : entries;
  return ok({
    kind: "entries",
    pythonMagic,
    pythonVersion,
    sha256,
    entries: entries.value,
  });
};

/**
 * Marshal back-references let one stored row appear many times, so a small
 * table can name far more bytes than it holds. Each genuine entry stores its
 * own name inline, so the expanded names can never exceed the table itself.
 */
const pyzEntries = (
  value: MarshalValue,
  payloadEnd: number,
  tableBytes: number,
): Result<readonly PyzEntry[], PyInstallerFailure> => {
  if (!Array.isArray(value))
    return err(
      pyInstallerFailure("format", "PYZ table of contents is not a list"),
    );
  const entries: PyzEntry[] = [];
  let nameBytes = 0;
  for (const item of value) {
    const entry = onePyzEntry(item, payloadEnd, entries.length);
    if (!entry.ok) return entry;
    nameBytes += Buffer.byteLength(entry.value.name, "utf8");
    if (nameBytes > tableBytes)
      return err(
        pyInstallerFailure(
          "limit",
          `PYZ table entry names expand past the ${String(tableBytes)}-byte table that stores them`,
        ),
      );
    entries.push(entry.value);
  }
  return ok(entries);
};

const onePyzEntry = (
  item: MarshalValue,
  payloadEnd: number,
  index: number,
): Result<PyzEntry, PyInstallerFailure> => {
  if (!Array.isArray(item) || item.length !== 2)
    return err(
      pyInstallerFailure(
        "format",
        "PYZ table entry is not a name and position pair",
      ),
    );
  const [name, position] = item;
  if (
    typeof name !== "string" ||
    !Array.isArray(position) ||
    position.length !== 3
  )
    return err(
      pyInstallerFailure(
        "format",
        "PYZ table entry is not a name, type, offset, and length",
      ),
    );
  const [typeCode, offset, length] = position;
  if (
    !Number.isSafeInteger(typeCode) ||
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length)
  )
    return err(
      pyInstallerFailure(
        "format",
        "PYZ table entry positions are not integers",
      ),
    );
  const role = PYZ_ENTRY_ROLES[typeCode];
  if (role === undefined)
    return err(
      pyInstallerFailure(
        "format",
        `PYZ table entry type ${String(typeCode)} is not a known module, package, data, or namespace code`,
      ),
    );
  if (role !== "namespace" && length === 0)
    return err(
      pyInstallerFailure(
        "format",
        `PYZ entry at table index ${String(index)} has no compressed bytes`,
      ),
    );
  if (
    length < 0 ||
    offset < 0 ||
    offset > payloadEnd ||
    length > payloadEnd - offset ||
    (length > 0 && offset < PYZ_HEADER_BYTES)
  )
    return err(
      pyInstallerFailure(
        "integrity",
        `PYZ entry at table index ${String(index)} extends outside the archive payload region`,
      ),
    );
  return ok({
    index,
    name,
    typeCode,
    offset,
    length,
    compressionFlag: length === 0 ? 0 : 1,
    role,
  });
};
