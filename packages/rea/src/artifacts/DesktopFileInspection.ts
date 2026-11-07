import { observeMzWindowsHeader } from "../domain/dosMz.js";
import { readPeCoffHeader } from "../domain/peCoffHeader.js";
import {
  hasGodotPckHeader,
  readGodotPckHeaderFacts,
} from "../domain/godotPckFormat.js";
import { observeEmbeddedGodotPck } from "./GodotPckLocation.js";
import type { FileHandle } from "node:fs/promises";
import { createHash } from "node:crypto";
import { setImmediate } from "node:timers/promises";
import type { DesktopFile, DesktopFact } from "../domain/desktopApplication.js";
import { jsonValueByteLength } from "../domain/jsonValueByteLength.js";
import { jsonStringByteLength } from "../domain/jsonStringByteLength.js";
import { DESKTOP_PROBES_PER_FACT } from "../domain/desktopApplicationProjection.js";
import { observeIl2cppMetadataHeaderPrefix } from "../domain/il2cpp/il2cppMetadataHeaderPrefix.js";
import {
  parsePeRecordFacts,
  peRvaToFileOffset,
} from "../domain/binaryTarget.js";
import { readManagedMetadataLayout } from "../dotnet/ManagedMetadataLayout.js";
import { readManagedCliHeaderPrefix } from "../domain/managed/managedCliHeaderPrefix.js";
import { readAssemblyReferenceName } from "../dotnet/ManagedMetadataInventoryRows.js";
import { ManagedReaderFailure } from "../dotnet/ManagedReaderFailure.js";
import { ArtifactReaderFailure } from "./ArtifactReader.js";
import { abortIfNeeded } from "./ArtifactHash.js";
import { hasMachoMagic } from "../domain/apple/machoContainer.js";
import {
  hasUnityFsHeader,
  readUnityFsHeaderFacts,
} from "../domain/unityfsFormat.js";

export interface DesktopReadBudget {
  bytes: number;
  readonly maximum: number;
  retainedBytes: number;
  readonly maximumRetainedBytes: number;
}

/**
 * A retained string's larger representation: two-byte heap code units, or its
 * escaped UTF-8 JSON (up to six bytes for a control character).
 */
export const retainedTextBytes = (text: string): number =>
  Math.max(2 * text.length, jsonStringByteLength(text));

/** One retained fact besides its value and probes: kind, offset and keys. */
export const RETAINED_FACT_BYTES = 512;
/** One retained read range: offset, length and SHA-256. */
const RETAINED_RANGE_BYTES = 256;
/** One next probe besides its local_path: IDs, operation and rationale. */
const RETAINED_PROBE_BYTES = 512;
/** Charge the next probes that one fact can make repeat a row's local_path. */
export const retainedFactReferenceBytes = (localPath: string): number =>
  DESKTOP_PROBES_PER_FACT *
  (RETAINED_PROBE_BYTES + retainedTextBytes(localPath));

const retainedFactsLimit = () =>
  new ArtifactReaderFailure(
    "limit",
    "Directory facts reached the retained metadata budget",
    { boundary: "memory" },
  );

/** A resource refusal is separate from malformed format declarations. */
class DesktopProbeLimit extends ArtifactReaderFailure {
  constructor() {
    super("limit", "Directory probe byte budget exhausted", {
      boundary: "capacity",
    });
  }
}

/** Inspect selected ranges on an already admitted descriptor; never hash payloads. */
export const inspectDesktopFile = async (
  file: FileHandle,
  row: DesktopFile,
  budget: DesktopReadBudget,
  signal?: AbortSignal,
  unityManagedDirectory: string | null = null,
): Promise<void> => {
  const size = row.bytes;
  if (size === null)
    throw new ArtifactReaderFailure(
      "limit",
      "File extent exceeds exact host offsets",
      { boundary: "file-size" },
    );
  const read = async (offset: number, bytes: number): Promise<Buffer> => {
    abortIfNeeded(signal);
    if (
      !Number.isSafeInteger(offset) ||
      offset < 0 ||
      !Number.isSafeInteger(bytes) ||
      bytes < 0 ||
      offset > size ||
      bytes > size - offset
    )
      throw new ArtifactReaderFailure(
        "format",
        "Declared byte range lies outside the file",
      );
    if (bytes > budget.maximum - budget.bytes) throw new DesktopProbeLimit();
    // Reserve the retained range before reading its bytes.
    if (
      RETAINED_RANGE_BYTES >
      budget.maximumRetainedBytes - budget.retainedBytes
    )
      throw retainedFactsLimit();
    budget.retainedBytes += RETAINED_RANGE_BYTES;
    const result = Buffer.alloc(bytes);
    let consumed = 0;
    while (consumed < bytes) {
      abortIfNeeded(signal);
      const part = await file.read(
        result,
        consumed,
        bytes - consumed,
        offset + consumed,
      );
      budget.bytes += part.bytesRead;
      if (part.bytesRead === 0)
        throw new ArtifactReaderFailure(
          "integrity",
          "File ended before its observed extent",
        );
      consumed += part.bytesRead;
    }
    abortIfNeeded(signal);
    row.ranges.push({
      offset,
      bytes,
      sha256: createHash("sha256").update(result).digest("hex"),
    });
    return result;
  };
  const fact = (observation: DesktopFact) => {
    const remaining = budget.maximumRetainedBytes - budget.retainedBytes;
    const fixed =
      RETAINED_FACT_BYTES + retainedFactReferenceBytes(row.local_path);
    const reservation =
      fixed +
      jsonValueByteLength(observation.value, (remaining - fixed) / 12) * 12;
    if (reservation > remaining) throw retainedFactsLimit();
    budget.retainedBytes += reservation;
    row.facts.push(observation);
  };
  const prefix = await read(0, Math.min(size, 64));
  const metadataPrefix = observeIl2cppMetadataHeaderPrefix(prefix);
  if (metadataPrefix.kind === "il2cpp")
    fact({
      kind: "il2cpp-metadata-header",
      offset: 0,
      value: {
        magic: "0xfab11baf",
        raw_version: metadataPrefix.rawVersion,
      },
    });
  if (prefix.length >= 20 && hasGodotPckHeader(prefix)) {
    const pckHeader = readGodotPckHeaderFacts(prefix);
    fact({
      kind: "godot-pck-header",
      offset: 0,
      value: {
        pack_version: pckHeader.formatVersion,
        engine_version: [
          pckHeader.engineMajor,
          pckHeader.engineMinor,
          pckHeader.enginePatch,
        ],
        placement: "standalone",
      },
    });
  }
  if (prefix.length >= 20 && hasUnityFsHeader(prefix)) {
    const unityfsHeader = readUnityFsHeaderFacts(prefix);
    if (unityfsHeader !== undefined)
      fact({
        kind: "unityfs-header",
        offset: 0,
        value: {
          format_version: unityfsHeader.formatVersion,
          engine_version: unityfsHeader.engineVersion,
          flags: unityfsHeader.flags,
          declared_size:
            unityfsHeader.declaredSize <= BigInt(Number.MAX_SAFE_INTEGER)
              ? Number(unityfsHeader.declaredSize)
              : null,
        },
      });
  }
  if (
    prefix.length >= 16 &&
    prefix.toString("latin1", 0, 4) === "FORM" &&
    prefix.toString("latin1", 8, 12) === "GEN8"
  ) {
    const containerBytes = prefix.readUInt32LE(4);
    const chunkBytes = prefix.readUInt32LE(12);
    if (
      containerBytes >= 8 &&
      containerBytes <= size - 8 &&
      chunkBytes <= containerBytes - 8
    )
      fact({
        kind: "gamemaker-form-header",
        offset: 0,
        value: {
          container: "FORM",
          first_chunk: "GEN8",
        },
      });
  }
  if (
    prefix.length >= 16 &&
    prefix.toString("latin1", 0, 16) === "-==--==--==--==-"
  )
    fact({
      kind: "unreal-container-convention",
      offset: 0,
      value: { format: "IoStore TOC" },
    });
  const native =
    prefix.length >= 4 &&
    (prefix.subarray(0, 4).equals(Buffer.from([0x7f, 0x45, 0x4c, 0x46])) ||
      hasMachoMagic(prefix));
  if (native)
    fact({
      kind: "native-image-header",
      offset: 0,
      value: {
        format: prefix[0] === 0x7f ? "elf" : "mach-o",
        signature: prefix.subarray(0, 4).toString("hex"),
      },
    });
  const observe = async (operation: () => Promise<void>) => {
    try {
      await operation();
    } catch (cause: unknown) {
      if (
        !(cause instanceof ArtifactReaderFailure) ||
        (cause.reason !== "format" && cause.reason !== "limit")
      )
        throw cause;
      if (!row.issues.includes(cause.message)) row.issues.push(cause.message);
    }
  };
  if (prefix.length === 64 && prefix.readUInt16LE(0) === 0x5a4d)
    await observe(() =>
      inspectPeFile(
        prefix,
        size,
        row,
        read,
        fact,
        unityManagedDirectory,
        signal,
      ),
    );
  if (
    (native || (prefix.length >= 2 && prefix.readUInt16LE(0) === 0x5a4d)) &&
    size >= 12
  )
    await observe(() => inspectPckTrailer(size, read, fact));
};

type DesktopByteRead = (offset: number, bytes: number) => Promise<Buffer>;
type RecordDesktopFact = (observation: DesktopFact) => void;

const inspectPeFile = async (
  prefix: Buffer,
  size: number,
  row: DesktopFile,
  read: DesktopByteRead,
  fact: RecordDesktopFact,
  unityManagedDirectory: string | null,
  signal?: AbortSignal,
): Promise<void> => {
  const observed = observeMzWindowsHeader(prefix, size);
  if (observed.state === "candidate") {
    row.issues.push("MZ Windows new-header candidate is unresolved");
    return;
  }
  if (observed.state !== "signature-needed" && observed.state !== "declared")
    return;
  const peOffset = observed.offset;
  // The MZ pointer requests signature evidence, not a PE/COFF extent. Preserve
  // short NE/LE/LX signatures and let the COFF owner diagnose truncated PE.
  const coff = await read(peOffset, Math.min(24, size - peOffset));
  const confirmed = observeMzWindowsHeader(prefix, size, {
    offset: peOffset,
    bytes: coff,
  });
  if (confirmed.state === "candidate")
    row.issues.push("MZ Windows new-header candidate is unresolved");
  if (confirmed.state !== "declared" || confirmed.signature !== "PE") return;
  const header = readPeCoffHeader(coff.subarray(4));
  if (!header.ok) {
    row.issues.push(header.error.message);
    return;
  }
  const optionalSize = header.value.optionalHeaderSize;
  if (optionalSize > 4096)
    throw new ArtifactReaderFailure(
      "format",
      "PE optional header exceeds the supported format bound",
    );
  const optional = await read(peOffset + 24, optionalSize);
  const parsed = parsePeRecordFacts(Buffer.concat([coff, optional]), undefined);
  if (!parsed.ok) {
    row.issues.push(parsed.error);
    return;
  }
  if (parsed.value.metadata.format !== "pe") return;
  fact({
    kind: "native-image-header",
    offset: peOffset,
    value: { format: "pe", machine: header.value.machine },
  });
  if (!parsed.value.metadata.managed) return;
  const cliDirectory = parsed.value.optionalHeader.dataDirectories[14];
  if (cliDirectory === undefined) return;
  const { address: cliRva, size: cliSize } = cliDirectory;
  fact({
    kind: "pe-cli-directory",
    offset: peOffset + 24 + cliDirectory.offset,
    value: { rva: cliRva, bytes: cliSize },
  });
  if (unityManagedDirectory === null) return;
  const sectionCount = header.value.sectionCount;
  const sections = await read(peOffset + 24 + optionalSize, sectionCount * 40);
  const mapped = (rva: number, bytes: number) =>
    peRvaToFileOffset(
      rva,
      sections,
      sectionCount,
      parsed.value.optionalHeader.sizeOfHeaders,
      bytes,
    );
  const cliOffset = mapped(cliRva, 16);
  if (cliOffset === undefined || cliSize < 72)
    throw new ArtifactReaderFailure(
      "format",
      "CLI metadata directory cannot be mapped",
    );
  const cli = readManagedCliHeaderPrefix(await read(cliOffset, 16));
  if (!cli.ok || cli.value.headerSize < 72)
    throw new ArtifactReaderFailure(
      "format",
      "CLI header declares a truncated runtime header",
    );
  const metadataBytes = cli.value.metadata.size;
  const metadataOffset = mapped(cli.value.metadata.rva, metadataBytes);
  if (metadataOffset === undefined)
    throw new ArtifactReaderFailure(
      "format",
      "CLI metadata range cannot be mapped",
    );
  const bytes = await read(metadataOffset, metadataBytes);
  try {
    const layout = readManagedMetadataLayout(bytes, 0, bytes.length);
    const refs = layout.table(35);
    for (let index = 1; index <= (refs?.rowCount ?? 0); index++) {
      // Yield between bounded batches so metadata names cannot monopolize MCP.
      if ((index - 1) % 256 === 0) {
        await setImmediate();
        abortIfNeeded(signal);
      }
      const reference = readAssemblyReferenceName(
        bytes,
        layout,
        index,
        layout.strings.size,
      );
      if (
        reference.name !== "UnityEngine" &&
        !reference.name.startsWith("UnityEngine.")
      )
        continue;
      fact({
        kind: "unity-assembly-reference",
        offset: metadataOffset + reference.row_offset,
        value: {
          name: reference.name,
          token: reference.token,
          managed_directory: unityManagedDirectory,
        },
      });
      return;
    }
  } catch (cause: unknown) {
    if (!(cause instanceof ManagedReaderFailure)) throw cause;
    throw new ArtifactReaderFailure(
      cause.issue.code === "resource-limit" ? "limit" : "format",
      cause.message,
      {
        cause,
        ...(cause.issue.code === "resource-limit"
          ? { boundary: "memory" as const }
          : {}),
      },
    );
  }
};

const inspectPckTrailer = async (
  size: number,
  read: DesktopByteRead,
  fact: RecordDesktopFact,
): Promise<void> => {
  const observation = await observeEmbeddedGodotPck(size, 20, read);
  if (observation.state === "invalid-extent")
    throw new ArtifactReaderFailure(
      "format",
      "Embedded PCK trailer declares an invalid pack extent",
    );
  if (observation.state === "header-mismatch")
    throw new ArtifactReaderFailure(
      "format",
      "Embedded PCK trailer does not locate a pack header",
    );
  if (observation.state === "located") {
    const offset = observation.start;
    const header = readGodotPckHeaderFacts(observation.header);
    fact({
      kind: "godot-pck-header",
      offset,
      value: {
        pack_version: header.formatVersion,
        engine_version: [
          header.engineMajor,
          header.engineMinor,
          header.enginePatch,
        ],
        placement: "embedded-trailer",
      },
    });
  }
};
