import type { FileHandle } from "node:fs/promises";
import { copyArtifactEntry, type ArtifactEntry } from "../ArtifactReader.js";
import {
  isCArchiveDeclaration,
  isCArchivePythonModule,
  type CArchiveEntry,
} from "./CArchiveLayout.js";
import type { PyzArchive, PyzEntry } from "./PyzArchive.js";
import {
  RECONSTRUCTED_PYTHON_HEADER_LIMITATION,
  reconstructedPycHeader,
  type CArchiveBytecodeHeader,
} from "./PythonBytecode.js";
import {
  cArchiveEntryMetadata,
  pyzEntryMetadata,
  pyzEntryEncrypted,
} from "./PyInstallerMetadata.js";
import type { PyInstallerEntryMetadata } from "../../domain/artifactFormatMetadata.js";

const CRYPTO_KEY_NAME = "pyimod00_crypto_key";

export type CarrierPathDialect = "posix" | "windows" | "unknown";

/** Parsed facts and the descriptor identity used to locate a retained image. */
export interface PyzImage {
  readonly archive: PyzArchive;
  readonly handle: FileHandle;
  readonly start: number;
}

/** Stable entry descriptions and bounded read plans; expanded member bytes are never retained. */
export interface PyInstallerMember {
  readonly entry: ArtifactEntry;
  readonly read:
    | {
        readonly kind: "carchive";
        readonly archiveStart: number;
        readonly source: CArchiveEntry;
        readonly header: Buffer | undefined;
      }
    | {
        readonly kind: "pyz";
        readonly handle: FileHandle;
        readonly offset: number;
        readonly length: number;
        readonly compressed: boolean;
        readonly uncompressedSize: number | undefined;
        readonly header: Buffer | undefined;
      }
    | undefined;
}

/** The producer's key is an importable, nonempty Python module, not a data filename. */
export const hasEncryptionMarker = (
  entries: readonly CArchiveEntry[],
): boolean =>
  entries.some(
    (entry) =>
      entry.name === CRYPTO_KEY_NAME &&
      isCArchivePythonModule(entry) &&
      entry.uncompressedSize > 0,
  );

export const projectStoredMember = (
  entry: CArchiveEntry,
  archiveStart: number,
  bytecode: CArchiveBytecodeHeader,
  pathDialect: CarrierPathDialect,
): PyInstallerMember => {
  if (isCArchiveDeclaration(entry))
    return {
      entry: projectEntry({
        path: `__pyinstaller__/${entry.role === "runtime-option" ? "runtime-options" : "dependencies"}/${String(entry.index)}`,
        kind: "metadata",
        declaredSize: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        byteOffset: null,
        limitations:
          entry.role === "dependency"
            ? [
                "Multipackage dependency bytes belong to another executable and remain unresolved.",
              ]
            : [],
        adapterKey: `carchive:${String(entry.index)}:${entry.name}`,
        formatMetadata: cArchiveEntryMetadata(entry),
      }),
      read: undefined,
    };
  const { header } = bytecode;
  const path = canonicalMemberPath(entry.name, pathDialect);
  const symlink = entry.role === "symlink";
  const limitations: string[] = [];
  if (symlink) limitations.push("PyInstaller symlink target was not read.");
  if (header !== undefined)
    limitations.push(RECONSTRUCTED_PYTHON_HEADER_LIMITATION);
  if (bytecode.limitation !== undefined) limitations.push(bytecode.limitation);
  const declaredSize = entry.uncompressedSize;
  return {
    entry: projectEntry({
      path,
      kind: symlink ? "symlink" : "file",
      declaredSize,
      compressedSize: entry.compressedSize,
      executable: entry.role === "binary",
      byteOffset: sourceByteOffset(entry, archiveStart),
      limitations,
      adapterKey: `carchive:${String(entry.index)}:${entry.name}`,
      formatMetadata: cArchiveEntryMetadata(entry, header),
    }),
    read: {
      kind: "carchive",
      archiveStart,
      source: entry,
      header,
    },
  };
};

export const projectPyzContainer = (
  entry: CArchiveEntry,
  archiveStart: number,
  image: PyzImage,
  encrypted: boolean,
  pathDialect: CarrierPathDialect,
): PyInstallerMember => {
  const { archive } = image;
  const path = canonicalMemberPath(entry.name, pathDialect);
  const byteOffset = sourceByteOffset(entry, archiveStart);
  const limitations: string[] = [];
  if (archive.kind === "opaque")
    return {
      entry: projectEntry({
        path,
        declaredSize: entry.uncompressedSize,
        compressedSize: entry.compressedSize,
        byteOffset,
        // Legacy encryption applies to inner payloads, never the PYZ image.
        encrypted: false,
        limitations: [
          ...limitations,
          archive.limitation,
          ...(encrypted
            ? ["PYZ entries are encrypted and were not decoded."]
            : []),
        ],
        adapterKey: `carchive:${String(entry.index)}:${entry.name}`,
        formatMetadata: cArchiveEntryMetadata(
          entry,
          undefined,
          archive,
          encrypted,
        ),
      }),
      read:
        entry.compressionFlag === 1
          ? {
              kind: "pyz",
              handle: image.handle,
              offset: image.start,
              length: entry.uncompressedSize,
              compressed: false,
              uncompressedSize: entry.uncompressedSize,
              header: undefined,
            }
          : {
              kind: "carchive",
              archiveStart,
              source: entry,
              header: undefined,
            },
    };
  return {
    entry: projectEntry({
      path,
      kind: "directory",
      declaredSize: entry.uncompressedSize,
      compressedSize: entry.compressedSize,
      byteOffset,
      limitations: [
        ...limitations,
        `PyInstaller PYZ sha256 ${archive.sha256}.`,
        ...(encrypted
          ? ["PYZ entries are encrypted and were not decoded."]
          : []),
      ],
      adapterKey: `carchive:${String(entry.index)}:${entry.name}`,
      formatMetadata: cArchiveEntryMetadata(
        entry,
        undefined,
        archive,
        encrypted,
      ),
    }),
    read: undefined,
  };
};

export const projectPyzMember = (
  container: CArchiveEntry,
  item: PyzEntry,
  encryptionMarker: boolean,
  pythonMagic: Buffer | undefined,
  pathDialect: CarrierPathDialect,
  range:
    | {
        readonly handle: FileHandle;
        readonly offset: number;
        readonly length: number;
      }
    | undefined,
): PyInstallerMember => {
  const path = pyzMemberPath(
    canonicalMemberPath(container.name, pathDialect),
    item,
    pathDialect,
  );
  const encrypted = pyzEntryEncrypted(item, encryptionMarker);
  if (item.role === "namespace")
    return {
      entry: projectEntry({
        path,
        kind: "metadata",
        declaredSize: 0,
        compressedSize: item.length,
        encrypted,
        byteOffset: null,
        limitations: [
          "Namespace package has no importable bytecode; its declared payload is not materialized.",
          ...(encrypted
            ? [
                "PYZ namespace payload is declared encrypted and is not materialized.",
              ]
            : []),
        ],
        adapterKey: `pyz:${String(container.index)}:${String(item.index)}:${path}`,
        formatMetadata: pyzEntryMetadata(
          container,
          item,
          undefined,
          encryptionMarker,
        ),
      }),
      read: undefined,
    };
  const header =
    !encrypted &&
    pythonMagic !== undefined &&
    (item.role === "module" || item.role === "package")
      ? reconstructedPycHeader(pythonMagic)
      : undefined;
  const limitations: string[] = [];
  if (encrypted)
    limitations.push("PYZ entry is encrypted and was not decoded.");
  if (header !== undefined)
    limitations.push(RECONSTRUCTED_PYTHON_HEADER_LIMITATION);
  limitations.push(
    "PYZ tables declare compressed lengths; the uncompressed size is unknown until decoding.",
  );
  return {
    entry: projectEntry({
      path: path,
      declaredSize: null,
      compressedSize: item.length,
      byteOffset: null,
      encrypted,
      limitations,
      adapterKey: `pyz:${String(container.index)}:${String(item.index)}:${path}`,
      formatMetadata: pyzEntryMetadata(
        container,
        item,
        header,
        encryptionMarker,
      ),
    }),
    read:
      range === undefined
        ? undefined
        : {
            kind: "pyz",
            ...range,
            compressed: true,
            uncompressedSize: undefined,
            header,
          },
  };
};

/**
 * CArchive and PYZ data names use the carrier's path dialect. The logical path is
 * canonical; the stored spelling is kept when that conversion changes it.
 * `source_location` is an offset plus declared size, so a compressed member
 * publishes a file span only when that size is the physical extent. Otherwise
 * the span stays unknown, as ZIP does for compressed entries.
 */
const canonicalMemberPath = (
  storedName: string,
  pathDialect: CarrierPathDialect,
): string =>
  pathDialect === "windows" ? storedName.replaceAll("\\", "/") : storedName;

const sourceByteOffset = (
  entry: CArchiveEntry,
  archiveStart: number,
): number | null =>
  entry.compressionFlag === 0 ? archiveStart + entry.offset : null;

const pyzMemberPath = (
  container: string,
  item: PyzEntry,
  pathDialect: CarrierPathDialect,
): string => {
  if (item.role === "data")
    return `${container}/${canonicalMemberPath(item.name, pathDialect)}`;
  const dotted = item.name.replaceAll(".", "/");
  if (item.role === "namespace") return `${container}/${dotted}`;
  if (item.role === "package") return `${container}/${dotted}/__init__.pyc`;
  return `${container}/${dotted}.pyc`;
};

const projectEntry = (input: {
  readonly path: string;
  readonly declaredSize: number | null;
  readonly compressedSize: number;
  readonly byteOffset: number | null;
  readonly limitations: readonly string[];
  readonly adapterKey: string;
  readonly formatMetadata: PyInstallerEntryMetadata;
  readonly executable?: boolean;
  readonly encrypted?: boolean;
  readonly kind?: "file" | "directory" | "symlink" | "metadata";
}): ArtifactEntry => ({
  path: input.path,
  sourcePath: input.formatMetadata.source_name,
  kind: input.kind ?? "file",
  declaredSize: input.declaredSize,
  compressedSize: input.compressedSize,
  executable: input.executable === true,
  encrypted: input.encrypted === true,
  byteOffset: input.byteOffset,
  declaredIntegrity: null,
  unpacked: false,
  limitations: input.limitations,
  adapterKey: input.adapterKey,
  formatMetadata: input.formatMetadata,
});

/** Stable entry stored for a later open(). */
export const sealMember = (member: PyInstallerMember): PyInstallerMember => ({
  ...member,
  entry: copyArtifactEntry(member.entry),
});
