import type {
  PyInstallerMetadata,
  PyInstallerEntryMetadata,
} from "../../domain/artifactFormatMetadata.js";
import {
  isCArchivePythonModule,
  type CArchiveEntry,
  type PyInstallerCookie,
} from "./CArchiveLayout.js";
import type { PyzArchive, PyzEntry } from "./PyzArchive.js";

const cookiePythonVersion = (value: number) =>
  value >= 100
    ? { major: Math.floor(value / 100), minor: value % 100 }
    : value >= 20
      ? { major: Math.floor(value / 10), minor: value % 10 }
      : undefined;

export const cookieMetadata = (
  cookie: PyInstallerCookie,
  entries: readonly CArchiveEntry[],
  encryptionMarker: boolean,
): PyInstallerMetadata => {
  const version = cookiePythonVersion(cookie.pythonVersion);
  return {
    kind: "pyinstaller",
    layout_version: cookie.layout,
    archive_start: cookie.archiveStart,
    archive_size: cookie.packageLength,
    cookie_offset: cookie.cookieOffset,
    toc_offset: cookie.tocOffset,
    toc_size: cookie.tocLength,
    entry_count: entries.length,
    runtime_option_count: entries.filter(
      (entry) => entry.role === "runtime-option",
    ).length,
    external_dependency_count: entries.filter(
      (entry) => entry.role === "dependency",
    ).length,
    python_version_raw: cookie.pythonVersion,
    python_major: version?.major ?? null,
    python_minor: version?.minor ?? null,
    python_library: cookie.pythonLibrary,
    encryption_marker_present: encryptionMarker,
  };
};

/** A sibling PYZ header is usable for scripts only when every image and the cookie agree. */
export const scriptPythonMagic = (
  cookie: PyInstallerCookie,
  archives: Iterable<PyzArchive>,
): Buffer | undefined => {
  const version = cookiePythonVersion(cookie.pythonVersion);
  if (version === undefined) return undefined;
  let selected: Buffer | undefined;
  for (const archive of archives) {
    const magic = archive.pythonMagic;
    if (
      archive.pythonVersion !==
        `${String(version.major)}.${String(version.minor)}` ||
      (selected !== undefined && !selected.equals(magic))
    )
      return undefined;
    selected = magic;
  }
  return selected;
};

const entryMetadata = (
  source: Pick<
    PyInstallerEntryMetadata,
    | "container"
    | "container_name"
    | "index"
    | "source_name"
    | "type_code"
    | "relative_offset"
    | "compression_flag"
  >,
  bytecode: boolean,
  header: Buffer | undefined,
): PyInstallerEntryMetadata => ({
  kind: "pyinstaller-entry",
  ...source,
  bytecode_header: bytecode
    ? header === undefined
      ? "unknown"
      : "derived"
    : "not-bytecode",
  bytecode_magic: header?.subarray(0, 4).toString("hex") ?? null,
  pyz_status: "not-pyz",
  directory_record_offset: null,
  directory_record_size: null,
  pyz_sha256: null,
  pyz_python_magic: null,
  pyz_python_version: null,
  pyz_entry_count: null,
  encryption_source: null,
});

export const cArchiveEntryMetadata = (
  entry: CArchiveEntry,
  header?: Buffer,
  archive?: PyzArchive,
  encryptionMarker = false,
): PyInstallerEntryMetadata => ({
  ...entryMetadata(
    {
      container: "carchive",
      container_name: null,
      index: entry.index,
      source_name: entry.name,
      type_code: entry.typeCode,
      relative_offset: entry.offset,
      compression_flag: entry.compressionFlag,
    },
    entry.role === "script" || isCArchivePythonModule(entry),
    header,
  ),
  ...(entry.role === "dependency" ? dependencyMetadata(entry.name) : {}),
  pyz_status:
    archive?.kind === "entries"
      ? "decoded"
      : archive === undefined
        ? "not-pyz"
        : "opaque",
  directory_record_offset: entry.tocRecordOffset,
  directory_record_size: entry.tocRecordLength,
  pyz_sha256: archive?.sha256 ?? null,
  pyz_python_magic: archive?.pythonMagic.toString("hex") ?? null,
  pyz_python_version: archive?.pythonVersion ?? null,
  pyz_entry_count: archive?.kind === "entries" ? archive.entries.length : null,
  encryption_source:
    archive !== undefined && encryptionMarker ? "carchive-marker" : null,
});

/** The bootloader splits at the first colon; neither part is a local read grant. */
const dependencyMetadata = (
  source: string,
): Pick<
  PyInstallerEntryMetadata,
  "dependency_status" | "dependency_archive" | "dependency_member"
> => {
  const colon = source.indexOf(":");
  const valid = colon > 0 && colon < source.length - 1;
  return {
    dependency_status: valid ? "unresolved" : "invalid-reference",
    dependency_archive: valid ? source.slice(0, colon) : null,
    dependency_member: valid ? source.slice(colon + 1) : null,
  };
};

/** Legacy writers encrypt nonempty namespace payloads as well as module payloads. */
export const pyzEntryEncrypted = (
  entry: PyzEntry,
  encryptionMarker: boolean,
): boolean => encryptionMarker && entry.length > 0;

export const pyzEntryMetadata = (
  container: CArchiveEntry,
  entry: PyzEntry,
  header: Buffer | undefined,
  encryptionMarker: boolean,
): PyInstallerEntryMetadata => ({
  ...entryMetadata(
    {
      container: "pyz",
      container_name: container.name,
      index: entry.index,
      source_name: entry.name,
      type_code: entry.typeCode,
      relative_offset: entry.offset,
      compression_flag: entry.compressionFlag,
    },
    entry.role === "module" || entry.role === "package",
    header,
  ),
  encryption_source: pyzEntryEncrypted(entry, encryptionMarker)
    ? "carchive-marker"
    : null,
});
