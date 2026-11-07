import {
  nesContainerFormat,
  parseInesLayout,
} from "../../domain/inesContainer.js";
import type { GodotPckAdmission } from "../GodotPckLocation.js";
import type { PyInstallerAdmission } from "../pyinstaller/PyInstallerAdmission.js";
import type {
  ArtifactReaderAdmission,
  ArtifactFormatAdmission,
} from "../ArtifactReaderAdmission.js";
import {
  locateEspFlashLayout,
  type EspFlashSelection,
} from "../../domain/firmware/espFlashLocation.js";
import { assertArtifactSelectedSource } from "../ArtifactSelectedSource.js";
import { artifactNameForClassification } from "../../domain/artifactNameSelection.js";
import type { AsarHeaderAdmission } from "../../config/asarHeaderAdmission.js";
import {
  ArtifactEmbeddedFormatProbes,
  type ArtifactEmbeddedFormatProbeFacts,
} from "../ArtifactEmbeddedFormatProbes.js";
import {
  assertStableRegularFileIdentity,
  RegularFileChangedError,
  sameRegularFileState,
} from "../../filesystem/RegularFile.js";
import type { FileHandle } from "node:fs/promises";
import type { Stats } from "node:fs";
import type { StableRegularFileDescriptor } from "../../filesystem/RegularFile.js";
import type { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";

import { decodeNodeSeaBlob } from "../nodeSea/NodeSeaBlob.js";
import { readNodeSeaBlob } from "../nodeSea/NodeSeaLocation.js";
import { classifyArtifactContent } from "./ArtifactGraphConstruction.js";
import { abortIfNeeded } from "../ArtifactHash.js";
import { claimsExecutableHeader } from "../../domain/binaryTarget.js";
import { createArtifactClassificationProbe } from "../ArtifactClassificationProbe.js";
import type { ArtifactOccurrence } from "../../domain/artifactGraph.js";
import {
  hasZipSignature,
  locateTrailingZipArchive,
  zipRootPackageFormat,
} from "../../domain/zipPackageFormat.js";
import { artifactFormatDescriptor } from "../artifactFormats.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import type { HashResult } from "../ArtifactHash.js";
import {
  hashStableRootArtifactHandle,
  openRootArtifact,
  releaseRootArtifact,
} from "./hashStableRootArtifact.js";
import type { ArtifactInventoryOptions } from "./types.js";
import { readMachoHeaderPrefixFacts } from "../../domain/apple/machoContainer.js";
import { hasDiskImageSignature } from "../../domain/apple/diskImageFormat.js";
import {
  DFUSE_SUFFIX_BYTES,
  hasDfuSePrefix,
} from "../../domain/firmware/dfuse.js";
import {
  observeMzWindowsHeader,
  type MzWindowsHeaderSignatureEvidence,
} from "../../domain/dosMz.js";
import type { ArtifactClassificationEvidence } from "../ArtifactClassificationProbe.js";

interface RootClassification {
  readonly format: ArtifactOccurrence["artifact_format"];
  readonly digest: HashResult | null;
}

type RootInventoryClassification = RootClassification & {
  readonly rootSource: RootInventorySource | undefined;
  readonly readerAdmission: ArtifactReaderAdmission | undefined;
};

/** The admitted descriptor and the single owner that can confirm its close. */
export interface RootInventorySource extends StableRegularFileDescriptor {
  readonly owner: OwnedFileHandle;
}

/** Classify a root and retain its admitted source and format facts for child inventory. */
export const classifyAndHashRootForInventory = async (
  path: string,
  directory: boolean,
  expectedMetadata: Stats,
  options: Pick<
    ArtifactInventoryOptions,
    | "resourceScope"
    | "signal"
    | "asarHeaderAdmission"
    | "selectedPath"
    | "expectedRootSha256"
    | "espFlashSelection"
  >,
  probeFacts?: ArtifactEmbeddedFormatProbeFacts,
): Promise<RootInventoryClassification> => {
  if (directory && probeFacts !== undefined) {
    abortIfNeeded(options.signal);
    throw new ArtifactReaderFailure(
      "integrity",
      `Root artifact changed before inventory: ${path}`,
    );
  }
  if (directory && options.expectedRootSha256 !== undefined)
    throw new ArtifactReaderFailure(
      "integrity",
      `Artifact root changed after target admission: expected an admitted file at ${path}, observed a directory`,
      {
        userMessage:
          "The opened file was replaced by a directory. Select the intended artifact and reopen it before retrying.",
      },
    );
  if (directory)
    return {
      format: "directory",
      digest: null,
      rootSource: undefined,
      readerAdmission: undefined,
    };
  if (options.expectedRootSha256 !== undefined)
    await assertArtifactSelectedSource(path, options.selectedPath);
  const source = await openRootArtifact(
    path,
    options.resourceScope,
    options.signal,
  );
  const { handle, initial } = source;
  let outcome:
    | {
        readonly kind: "completed";
        readonly value: RootInventoryClassification;
      }
    | { readonly kind: "failed"; readonly cause: unknown };
  try {
    if (!sameRegularFileState(expectedMetadata, initial))
      throw new ArtifactReaderFailure(
        "integrity",
        `Root artifact changed before inventory: ${path}`,
      );
    // Prior probe state can prove replacement without interpreting any bytes.
    const probes = new ArtifactEmbeddedFormatProbes(
      path,
      source,
      options.signal,
      probeFacts,
    );
    const admittedDigest =
      options.expectedRootSha256 === undefined
        ? undefined
        : await hashStableRootArtifactHandle(
            path,
            handle,
            initial,
            options.signal,
          );
    if (admittedDigest !== undefined)
      assertAdmittedRootDigest(
        path,
        options.expectedRootSha256,
        admittedDigest.sha256,
      );
    const classified = await classifyRootFormat(
      path,
      source,
      probes,
      options.signal,
      options.asarHeaderAdmission,
      options.selectedPath,
      options.espFlashSelection,
    );
    const format =
      typeof classified === "string" ? classified : classified.kind;
    const digest =
      admittedDigest ??
      (await hashStableRootArtifactHandle(
        path,
        handle,
        initial,
        options.signal,
      ));
    const retainSource =
      artifactFormatDescriptor(format)?.retainClassifiedSource === true;
    outcome = {
      kind: "completed",
      value: {
        format,
        digest,
        rootSource: retainSource ? source : undefined,
        readerAdmission:
          typeof classified !== "string"
            ? classified
            : retainSource
              ? source
              : undefined,
      },
    };
  } catch (cause: unknown) {
    outcome = { kind: "failed", cause };
  }
  if (outcome.kind === "failed" || outcome.value.rootSource === undefined) {
    await releaseRootArtifact(
      path,
      source.owner,
      options.resourceScope,
      outcome.kind === "completed"
        ? { kind: "completed", digest: outcome.value.digest }
        : outcome,
      options.signal,
    );
  }
  if (outcome.kind === "failed") throw outcome.cause;
  return outcome.value;
};

const classifyRootFormat = async (
  path: string,
  source: RootInventorySource,
  embeddedProbes: ArtifactEmbeddedFormatProbes,
  signal?: AbortSignal,
  asarHeaderAdmission?: AsarHeaderAdmission,
  selectedPath?: string,
  espFlashSelection?: EspFlashSelection,
): Promise<ArtifactOccurrence["artifact_format"] | ArtifactFormatAdmission> => {
  const { handle } = source;
  const probe = createArtifactClassificationProbe(asarHeaderAdmission);
  const chunk = Buffer.alloc(64 * 1024);
  while (probe.length < probe.limit) {
    abortIfNeeded(signal);
    const read = await handle.read(
      chunk,
      0,
      Math.min(chunk.length, probe.limit - probe.length),
      probe.length,
    );
    abortIfNeeded(signal);
    if (read.bytesRead === 0) break;
    probe.write(chunk.subarray(0, read.bytesRead));
  }
  const archiveBytes = (await handle.stat()).size;
  const evidence = probe.finish(archiveBytes);
  abortIfNeeded(signal);
  try {
    await assertStableRegularFileIdentity(handle, path, source.initial, {
      symlinks: "reject",
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause: unknown) {
    abortIfNeeded(signal);
    if (cause instanceof RegularFileChangedError)
      throw new ArtifactReaderFailure(
        "integrity",
        `Root artifact changed during classification: ${path}`,
        { cause: cause.cause ?? cause },
      );
    throw cause;
  }
  // Fill each range: a short result is end of file, not a partial host read.
  const read = async (position: number, length: number): Promise<Buffer> => {
    const bytes = Buffer.alloc(length);
    let filled = 0;
    while (filled < length) {
      abortIfNeeded(signal);
      const observed = await handle.read(
        bytes,
        filled,
        length - filled,
        position + filled,
      );
      abortIfNeeded(signal);
      if (observed.bytesRead === 0) break;
      filled += observed.bytesRead;
    }
    return bytes.subarray(0, filled);
  };
  const locateFlash = (selection: EspFlashSelection, explicit: boolean) =>
    locateEspFlashLayout(archiveBytes, read, selection, {
      explicit,
      ...(signal === undefined ? {} : { signal }),
    });
  // The caller's format selection decides before any other signature.
  if (espFlashSelection !== undefined) {
    const selected = await locateFlash(espFlashSelection, true);
    if (!selected.ok)
      throw new ArtifactReaderFailure(
        "unavailable",
        `ESP flash image layout is not recognized: ${selected.error}`,
      );
    return { kind: "esp-flash-image", source, location: selected.value };
  }
  if (nesContainerFormat(evidence.prefix) !== undefined) {
    const parsed = parseInesLayout(evidence.prefix, archiveBytes);
    if (!parsed.ok) throw new ArtifactReaderFailure("format", parsed.error);
    return "ines";
  }
  const classificationPath = artifactNameForClassification(
    selectedPath ?? path,
    path,
  );
  const lower = classificationPath.toLowerCase();
  if (hasZipSignature(evidence.prefix)) return zipRootPackageFormat(lower);
  if (
    lower.endsWith(".pkg") &&
    evidence.prefix.subarray(0, 4).equals(Buffer.from("xar!"))
  )
    return "pkg";
  if (
    lower.endsWith(".dmg") &&
    (await hasDiskImageSignature(archiveBytes, read))
  )
    return "dmg";
  const pck = await embeddedProbes.godotPck(evidence.prefix);
  if (pck !== undefined) return { kind: "godot-pck", source, location: pck };
  // A C3 or S3 dump begins with its bootloader, so the layout is located
  // before the bytes are read as one ESP image.
  const flash = await locateFlash({}, false);
  if (flash.ok)
    return { kind: "esp-flash-image", source, location: flash.value };
  const fatEvidence = await readRootFatSliceHeaders(handle, evidence, signal);
  const mzWindowsHeaderSignature = await readRootMzWindowsHeaderSignature(
    handle,
    fatEvidence,
    archiveBytes,
    signal,
  );
  // The probe stops at its bounded prefix, so a DfuSe trailer is read from
  // the file's own end unless the probe already observed every byte.
  const suffix =
    fatEvidence.suffix === undefined &&
    archiveBytes >= DFUSE_SUFFIX_BYTES &&
    hasDfuSePrefix(evidence.prefix)
      ? await read(archiveBytes - DFUSE_SUFFIX_BYTES, DFUSE_SUFFIX_BYTES)
      : fatEvidence.suffix;
  const classificationEvidence = {
    ...fatEvidence,
    ...(suffix === undefined ? {} : { suffix }),
    ...(mzWindowsHeaderSignature === undefined
      ? {}
      : { mzWindowsHeaderSignature }),
  };
  const format = classifyArtifactContent(
    classificationPath,
    classificationEvidence,
    archiveBytes,
  ).format;
  // Only bytes no other format claims may lead a located ZIP, so an
  // executable with an appended archive keeps its executable classification.
  if (
    (format === "file" || format === "unknown") &&
    !claimsExecutableHeader(evidence.prefix, archiveBytes) &&
    (await locateTrailingZipArchive(archiveBytes, read)) !== undefined
  )
    return zipRootPackageFormat(lower);
  if (["elf", "pe", "mach-o", "mach-o-universal"].includes(format)) {
    const sea = await embeddedProbes.nodeSea();
    abortIfNeeded(signal);
    if (sea !== undefined) {
      const decoded = await decodeNodeSeaBlob(
        await readNodeSeaBlob(handle, sea, archiveBytes, signal),
        signal,
      );
      return { kind: "node-sea", source, location: sea, decoded };
    }
    const bun = await embeddedProbes.bunStandalone();
    if (bun.status === "present")
      return { kind: "bun-standalone", source, probe: bun };
    const packaged = await embeddedProbes.pyInstaller();
    abortIfNeeded(signal);
    if (format !== "mach-o-universal") {
      const headerOffset = await embeddedProbes.dotnetBundle();
      if (headerOffset !== undefined)
        return { kind: "dotnet-bundle", source, headerOffset };
    }
    // A valid cookie also proves enough bytes for a thin Mach-O identity;
    // PE and universal Mach-O classification already require stronger proof.
    if (packaged !== undefined)
      return {
        kind: "pyinstaller",
        source,
        cookie: packaged,
        carrierPathDialect: format === "pe" ? "windows" : "posix",
      };
  }
  return format;
};

/** Read exact FAT header windows missed by the bounded prefix probe. */
const readRootFatSliceHeaders = async (
  handle: FileHandle,
  evidence: ArtifactClassificationEvidence,
  signal?: AbortSignal,
): Promise<ArtifactClassificationEvidence> => {
  const existing = evidence.fatSliceHeaders;
  if (existing === undefined) return evidence;
  const { header } = existing;
  const sliceHeadersByOffset = new Map(existing.sliceHeadersByOffset);
  for (let index = 0; index < header.slices.length; index += 1) {
    const slice = header.slices[index];
    const observed =
      slice === undefined ? undefined : sliceHeadersByOffset.get(slice.offset);
    if (
      slice === undefined ||
      header.rangeIssues[index] !== null ||
      slice.size < 4 ||
      (observed !== undefined && observed.magic !== null)
    )
      continue;
    const headerLength = Math.min(12, slice.size);
    const thinHeader = Buffer.alloc(headerLength);
    let bytesRead = 0;
    while (bytesRead < thinHeader.length) {
      abortIfNeeded(signal);
      const read = await handle.read(
        thinHeader,
        bytesRead,
        thinHeader.length - bytesRead,
        slice.offset + bytesRead,
      );
      abortIfNeeded(signal);
      if (read.bytesRead === 0) break;
      bytesRead += read.bytesRead;
    }
    sliceHeadersByOffset.set(
      slice.offset,
      readMachoHeaderPrefixFacts(thinHeader.subarray(0, bytesRead)),
    );
  }
  return { ...evidence, fatSliceHeaders: { header, sliceHeadersByOffset } };
};

/** Read only the missing signature bytes requested by the bounded MZ parser. */
const readRootMzWindowsHeaderSignature = async (
  handle: FileHandle,
  evidence: ArtifactClassificationEvidence,
  fileSize: number,
  signal?: AbortSignal,
): Promise<MzWindowsHeaderSignatureEvidence | undefined> => {
  const observation = observeMzWindowsHeader(evidence.prefix, fileSize);
  if (observation.state !== "signature-needed")
    return evidence.mzWindowsHeaderSignature;
  const { offset } = observation;
  if (!Number.isSafeInteger(offset) || offset < 0 || offset >= fileSize)
    return evidence.mzWindowsHeaderSignature;

  const window = Buffer.alloc(4);
  const existing =
    evidence.mzWindowsHeaderSignature?.offset === offset
      ? evidence.mzWindowsHeaderSignature.bytes
      : undefined;
  const inline =
    offset < evidence.prefix.length
      ? evidence.prefix.subarray(
          offset,
          Math.min(offset + 4, evidence.prefix.length),
        )
      : undefined;
  const known =
    existing !== undefined &&
    (inline === undefined || existing.length > inline.length)
      ? existing
      : inline;
  known?.copy(window);
  let available = known?.length ?? 0;
  const requiredLength = (): number =>
    available >= 2 && window[0] === 0x50 && window[1] === 0x45 ? 4 : 2;
  while (available < requiredLength() && offset + available < fileSize) {
    abortIfNeeded(signal);
    const length = Math.min(
      requiredLength() - available,
      fileSize - offset - available,
    );
    const chunk = Buffer.alloc(length);
    const read = await handle.read(chunk, 0, length, offset + available);
    abortIfNeeded(signal);
    if (read.bytesRead === 0) break;
    chunk.copy(window, available, 0, read.bytesRead);
    available += read.bytesRead;
  }
  if (available === 0) return undefined;
  return { offset, bytes: window.subarray(0, available) };
};

/** Compare physically completed bytes before interpreting an admitted file root. */
export const assertAdmittedRootDigest = (
  path: string,
  expected: string | undefined,
  observed: string,
): void => {
  if (expected !== undefined && observed !== expected)
    throw new ArtifactReaderFailure(
      "integrity",
      `Artifact root changed after target admission at ${path}: expected ${expected}, observed ${observed}`,
      {
        userMessage:
          "The artifact changed after it was opened. Reopen the selected artifact, then retry.",
      },
    );
};
