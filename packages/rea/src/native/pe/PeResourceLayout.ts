import {
  PE_RESOURCE_DIRECTORY_BYTES,
  PE_RESOURCE_ENTRY_BYTES,
  PE_RESOURCE_NAME_PREFIX_BYTES,
  readPeResourceDirectoryFacts,
  readPeResourceEntryFacts,
  readPeResourceNameFacts,
} from "./PeResourceTreeFacts.js";
import { observeMzWindowsHeader } from "../../domain/dosMz.js";
import { readPeCoffHeader } from "../../domain/peCoffHeader.js";
import { readPeSectionHeader } from "../../domain/peSectionHeader.js";
import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import {
  readPeOptionalHeaderStructure,
  type PeOptionalHeaderFailure,
} from "../../domain/peOptionalHeader.js";

const OPTIONAL_HEADER_FAILURES: Readonly<
  Record<PeOptionalHeaderFailure["reason"], string>
> = {
  "truncated-magic": "Truncated PE optional header.",
  "unsupported-magic": "Unsupported PE optional header magic.",
  "truncated-fixed-fields": "Truncated PE data directory count.",
  "truncated-directory-table":
    "PE directory count exceeds its optional header.",
};

export const peFailure = (message: string): never => {
  throw new ArtifactReaderFailure("format", message);
};

export const requirePeRange = (
  bytes: Buffer,
  offset: number,
  length: number,
): void => requirePeExtent(bytes.length, offset, length);

const requirePeExtent = (
  fileSize: number,
  offset: number,
  length: number,
): void => {
  if (
    !Number.isSafeInteger(offset) ||
    !Number.isSafeInteger(length) ||
    offset < 0 ||
    length < 0 ||
    offset > fileSize - length
  )
    peFailure(
      `PE range ${String(offset)} + ${String(length)} leaves the artifact.`,
    );
};

interface Section {
  readonly rva: number;
  readonly virtualSize: number;
  readonly offset: number;
  readonly size: number;
}

// RVA ownership follows the declared virtual extent. Raw size describes
// initialized file bytes and can include file-alignment padding; loaders may
// map page-rounded tails, but those bytes are outside the declared section.
const virtualExtent = (section: Section): number =>
  section.virtualSize === 0 ? section.size : section.virtualSize;

// Intersection normalized with those ownership rules: a section without
// virtual extent owns no byte and never conflicts, while an empty resource
// owns exactly its start point, so a positive-extent section starting there
// conflicts with header-backed ownership of the same RVA.
const intersectsResource = (
  section: Section,
  rva: number,
  size: number,
): boolean => {
  const extent = virtualExtent(section);
  return (
    extent > 0 &&
    section.rva < rva + Math.max(size, 1) &&
    rva < section.rva + extent
  );
};

/**
 * Shared PE header admission: signature, optional header, data directories,
 * and a section table that fits inside SizeOfHeaders. `bytes` may be a file
 * prefix that holds the header structures; file-space ranges are checked
 * against `fileSize`.
 */
export const readPeHeaders = (bytes: Buffer, fileSize = bytes.length) => {
  requirePeRange(bytes, 0, 64);
  if (bytes.readUInt16LE(0) !== 0x5a4d) peFailure("Expected an MZ PE image.");
  const observed = observeMzWindowsHeader(bytes, fileSize);
  if (observed.state === "candidate" || observed.state === "signature-needed")
    requirePeRange(bytes, observed.offset, 24);
  if (observed.state !== "declared" || observed.signature !== "PE")
    return peFailure(
      "MZ header does not declare a PE image in the inspected bytes.",
    );
  const pe = observed.offset;
  requirePeRange(bytes, pe, 24);
  const coff = readPeCoffHeader(bytes.subarray(pe + 4, pe + 24));
  if (!coff.ok) return peFailure(coff.error.message);
  const {
    sectionCount,
    optionalHeaderSize: optionalSize,
    machine,
  } = coff.value;
  const optionalHeaderOffset = pe + 24;
  requirePeRange(bytes, optionalHeaderOffset, optionalSize);
  if (optionalSize < 64) peFailure("Truncated PE optional header.");
  const parsed = readPeOptionalHeaderStructure(
    bytes.subarray(optionalHeaderOffset, optionalHeaderOffset + optionalSize),
  );
  if (!parsed.ok)
    return peFailure(OPTIONAL_HEADER_FAILURES[parsed.error.reason]);
  const {
    sizeOfHeaders: headerSize,
    format,
    directoryOffset,
    dataDirectories,
  } = parsed.value;
  const table = optionalHeaderOffset + optionalSize;
  requirePeRange(bytes, table, sectionCount * 40);
  if (headerSize < table + sectionCount * 40 || headerSize > fileSize)
    peFailure("Invalid PE SizeOfHeaders.");
  return {
    machine,
    format,
    sectionCount,
    optionalHeaderOffset,
    directoryOffset,
    dataDirectories,
    headerSize,
    table,
  };
};

/** Header admission and unambiguous file-backed RVA mapping, independent of section names. */
export const readPeResourceLayout = (
  bytes: Buffer,
  fileSize = bytes.length,
) => {
  const {
    machine,
    format,
    sectionCount,
    optionalHeaderOffset,
    directoryOffset,
    dataDirectories,
    headerSize,
    table,
  } = readPeHeaders(bytes, fileSize);
  const sections: Section[] = [];
  for (let index = 0; index < sectionCount; index++) {
    const at = table + index * 40;
    const parsed = readPeSectionHeader(bytes.subarray(at, at + 40));
    if (!parsed.ok) return peFailure(parsed.error.message);
    const row = parsed.value;
    const section = {
      rva: row.virtual_address,
      virtualSize: row.virtual_size,
      offset: row.offset,
      size: row.raw_size,
    };
    if (section.rva + virtualExtent(section) > 0x100000000)
      peFailure("PE section RVA range overflows.");
    if (section.size > 0) {
      requirePeExtent(fileSize, section.offset, section.size);
      if (section.offset < headerSize)
        peFailure("PE section raw bytes overlap headers.");
    }
    sections.push(section);
  }
  const backed = sections
    .filter(({ size }) => size > 0)
    .sort((left, right) => left.offset - right.offset);
  for (let index = 1; index < backed.length; index++) {
    const previous = backed[index - 1];
    const current = backed[index];
    if (
      previous !== undefined &&
      current !== undefined &&
      current.offset < previous.offset + previous.size
    )
      peFailure("PE sections have overlapping raw file ranges.");
  }
  const map = (rva: number, size: number): number => {
    if (rva + size > 0x100000000) peFailure("Resource RVA range overflows.");
    const containing = sections.filter(
      (section) =>
        rva >= section.rva && rva - section.rva < virtualExtent(section),
    );
    // An empty interval reads no bytes, so the Windows resource loader also
    // resolves it exactly at a section's virtual end. A section starting at
    // that RVA still owns it.
    const candidates =
      size === 0 && containing.length === 0
        ? sections.filter(
            (section) =>
              virtualExtent(section) > 0 &&
              rva - section.rva === virtualExtent(section),
          )
        : containing;
    if (rva < headerSize) {
      if (
        sections.some((section) => intersectsResource(section, rva, size)) ||
        size > headerSize - rva
      )
        peFailure("Ambiguous resource header RVA mapping.");
      requirePeExtent(fileSize, rva, size);
      return rva;
    }
    if (candidates.length !== 1)
      peFailure("Resource RVA has missing or overlapping section mappings.");
    const section = candidates[0];
    if (section === undefined) return peFailure("Missing resource section.");
    const within = rva - section.rva;
    if (size > virtualExtent(section) - within)
      peFailure("Resource range leaves its section's virtual size.");
    if (within > section.size || size > section.size - within)
      peFailure("Resource range is not entirely file-backed in one section.");
    // A second section with virtual extent inside the requested interval is
    // ambiguous too; a zero-extent section owns no byte there.
    if (
      sections.some(
        (other) => other !== section && intersectsResource(other, rva, size),
      )
    )
      peFailure("Resource interval intersects overlapping virtual sections.");
    const offset = section.offset + within;
    requirePeExtent(fileSize, offset, size);
    return offset;
  };
  const resource = dataDirectories[2];
  const directoryAt =
    optionalHeaderOffset + (resource?.offset ?? directoryOffset + 2 * 8);
  const rva = resource?.address ?? 0;
  const size = resource?.size ?? 0;
  if ((rva === 0) !== (size === 0))
    peFailure("Inconsistent PE resource directory RVA/size.");
  return {
    format,
    machine,
    directoryAt,
    rva,
    size,
    map,
  };
};

/**
 * Bounded admission probe: whether the root type directory holds a `typeId`
 * subdirectory naming `name`. Reads only the header prefix and the
 * directories on that path; an unadmitted layout or malformed tree reports
 * false so callers can leave full resource parsing to confirmed carriers.
 */
export const hasPeResourceName = async (
  headers: Buffer,
  fileSize: number,
  read: (offset: number, length: number) => Promise<Buffer | undefined>,
  typeId: number,
  name: string,
  maxEntries: number,
): Promise<boolean> => {
  let layout: ReturnType<typeof readPeResourceLayout>;
  let root: number;
  try {
    layout = readPeResourceLayout(headers, fileSize);
    if (layout.size < PE_RESOURCE_DIRECTORY_BYTES) return false;
    root = layout.map(layout.rva, layout.size);
  } catch (cause) {
    if (cause instanceof ArtifactReaderFailure && cause.reason === "format")
      return false;
    throw cause;
  }
  const { size } = layout;
  const relative = (at: number, length: number) =>
    at < 0 || at > size - length
      ? Promise.resolve(undefined)
      : read(root + at, length);
  let examined = 0;
  const directory = async (at: number): Promise<Buffer | undefined> => {
    const header = await relative(at, PE_RESOURCE_DIRECTORY_BYTES);
    if (header === undefined) return undefined;
    const { entryCount: entries } = readPeResourceDirectoryFacts(header);
    if (entries > maxEntries - examined) return undefined;
    examined += entries;
    return relative(
      at + PE_RESOURCE_DIRECTORY_BYTES,
      entries * PE_RESOURCE_ENTRY_BYTES,
    );
  };
  const types = await directory(0);
  if (types === undefined) return false;
  const expected = Buffer.from(name, "utf16le");
  for (let at = 0; at < types.length; at += PE_RESOURCE_ENTRY_BYTES) {
    const type = readPeResourceEntryFacts(
      types.subarray(at, at + PE_RESOURCE_ENTRY_BYTES),
    );
    if (type.identity.kind !== "id" || type.identity.id !== typeId) continue;
    if (type.target.kind !== "directory") continue;
    const names = await directory(type.target.offset);
    if (names === undefined) continue;
    for (
      let entry = 0;
      entry < names.length;
      entry += PE_RESOURCE_ENTRY_BYTES
    ) {
      const { identity } = readPeResourceEntryFacts(
        names.subarray(entry, entry + PE_RESOURCE_ENTRY_BYTES),
      );
      if (identity.kind !== "name") continue;
      const nameAt = identity.offset;
      const length = await relative(nameAt, PE_RESOURCE_NAME_PREFIX_BYTES);
      if (
        length === undefined ||
        readPeResourceNameFacts(length).utf16Units !== name.length
      )
        continue;
      const candidate = await relative(
        nameAt + PE_RESOURCE_NAME_PREFIX_BYTES,
        expected.length,
      );
      if (candidate?.equals(expected)) return true;
    }
  }
  return false;
};
