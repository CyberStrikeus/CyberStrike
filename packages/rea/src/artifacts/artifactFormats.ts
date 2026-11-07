import type { AsarHeaderAdmission } from "../config/asarHeaderAdmission.js";
import {
  ARTIFACT_FORMAT_IDS,
  type ArtifactFormatId,
} from "../domain/artifactGraph.js";
import type { EspFlashSelection } from "../domain/firmware/espFlashLocation.js";
import { ESP_IMAGE_LIMITATIONS } from "../domain/firmware/espImageFacts.js";
import {
  ZIP_PACKAGE_FORMATS,
  type ZipPackageFormat,
} from "../domain/zipPackageFormat.js";
import {
  ArtifactReaderFailure,
  type ArtifactReader,
} from "./ArtifactReader.js";
import type { ArtifactReaderAdmission } from "./ArtifactReaderAdmission.js";
import { AsarArtifactReader } from "./AsarArtifactReader.js";
import type { BunStandaloneAdmission } from "./bun/BunStandaloneAdmission.js";
import { BunStandaloneArtifactReader } from "./BunStandaloneArtifactReader.js";
import { DfuSeArtifactReader } from "./DfuSeArtifactReader.js";
import { DirectoryArtifactReader } from "./DirectoryArtifactReader.js";
import type { DotnetBundleAdmission } from "./dotnet/DotnetBundleAdmission.js";
import { DotnetBundleArtifactReader } from "./DotnetBundleArtifactReader.js";
import {
  EspFlashImageArtifactReader,
  type EspFlashAdmission,
} from "./EspFlashImageArtifactReader.js";
import { EspImageArtifactReader } from "./EspImageArtifactReader.js";
import { FitArtifactReader } from "./FitArtifactReader.js";
import type { GodotPckAdmission } from "./GodotPckLocation.js";
import { GodotPckArtifactReader } from "./GodotPckArtifactReader.js";
import { InesArtifactReader, INES_LIMITATION } from "./InesArtifactReader.js";
import { HexRecordArtifactReader } from "./HexRecordArtifactReader.js";
import { MachOSliceArtifactReader } from "./MachOSliceArtifactReader.js";
import { NativeDmgArtifactReader } from "./NativeDmgArtifactReader.js";
import type { NodeSeaAdmission } from "./nodeSea/NodeSeaAdmission.js";
import { NodeSeaArtifactReader } from "./NodeSeaArtifactReader.js";
import type { PyInstallerAdmission } from "./pyinstaller/PyInstallerAdmission.js";
import { PyInstallerArtifactReader } from "./PyInstallerArtifactReader.js";
import { Uf2ArtifactReader } from "./Uf2ArtifactReader.js";
import { UImageArtifactReader } from "./UImageArtifactReader.js";
import { UnityFsArtifactReader } from "./UnityFsArtifactReader.js";
import { ZipArtifactReader } from "./ZipArtifactReader.js";

/** How inventory describes a format when no reader was constructed. */
export type AbsentInventory = "platform" | "universal" | "unavailable" | "root";

export interface ArtifactReaderConstruction {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly unreadableDirectories: "fail" | "omit";
  readonly admission?: ArtifactReaderAdmission | undefined;
  readonly asarHeaderAdmission?: AsarHeaderAdmission | undefined;
  /** Caller inputs for an explicitly selected ESP flash image. */
  readonly espFlashSelection?: EspFlashSelection | undefined;
  /** Caller-selected root spelling; only ASAR companion lookup consumes this. */
  readonly selectedPath?: string | undefined;
}

export interface FormatDescriptor {
  readonly id: ArtifactFormatId;
  /** Every ZIP package family shares this row of capabilities. */
  readonly zipFamily: boolean;
  /** Root occurrence kind is container, including directories and zip packages. */
  readonly occurrenceContainer: boolean;
  /** Path-role classification treats the format as a container of its own. */
  readonly roleContainer: boolean;
  /** Classification keeps the admitted source for a later reader. */
  readonly retainClassifiedSource: boolean;
  /** Extraction can open this format without an embedded-pack probe. */
  readonly extractable: boolean;
  /** Reader construction is refused off macOS. */
  readonly requiresDarwin: boolean;
  readonly absentInventory: AbsentInventory;
  /** Extra limitation when a reader was constructed. */
  readonly readerLimitation?: string;
  /** Absent for formats with no entry reader, including `unknown`. */
  readonly createReader?:
    | ((path: string, options: ArtifactReaderConstruction) => ArtifactReader)
    | undefined;
}

const sourceOf = (options: ArtifactReaderConstruction) => {
  const admission = options.admission;
  return admission !== undefined && "kind" in admission
    ? admission.source
    : admission;
};

function admittedAs(
  kind: "dotnet-bundle",
  options: ArtifactReaderConstruction,
): DotnetBundleAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: "bun-standalone",
  options: ArtifactReaderConstruction,
): BunStandaloneAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: "godot-pck",
  options: ArtifactReaderConstruction,
): GodotPckAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: "pyinstaller",
  options: ArtifactReaderConstruction,
): PyInstallerAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: "node-sea",
  options: ArtifactReaderConstruction,
): NodeSeaAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: "esp-flash-image",
  options: ArtifactReaderConstruction,
): EspFlashAdmission | ReturnType<typeof sourceOf>;
function admittedAs(
  kind: string,
  options: ArtifactReaderConstruction,
): ArtifactReaderAdmission | ReturnType<typeof sourceOf> {
  const admission = options.admission;
  return admission !== undefined &&
    "kind" in admission &&
    admission.kind === kind
    ? admission
    : sourceOf(options);
}

/** One capability row for every ZIP-backed package family. */
export const ZIP_FAMILY_CAPABILITIES = {
  zipFamily: true,
  occurrenceContainer: true,
  roleContainer: false,
  retainClassifiedSource: true,
  extractable: true,
  requiresDarwin: false,
  absentInventory: "unavailable",
} as const satisfies Omit<FormatDescriptor, "id" | "createReader">;

type FormatCapabilities = Omit<FormatDescriptor, "id" | "createReader">;
type ReaderFn = (
  path: string,
  options: ArtifactReaderConstruction,
) => ArtifactReader;

const withReader = <Id extends ArtifactFormatId>(
  id: Id,
  capabilities: FormatCapabilities,
  createReader: ReaderFn,
) => ({ id, ...capabilities, createReader });

const withoutReader = <Id extends ArtifactFormatId>(
  id: Id,
  capabilities: FormatCapabilities,
) => ({ id, ...capabilities });

const zipDescriptor = (id: ZipPackageFormat) =>
  withReader(
    id,
    ZIP_FAMILY_CAPABILITIES,
    (path, options) =>
      new ZipArtifactReader(path, id, undefined, sourceOf(options)),
  );

function described<Id extends ArtifactFormatId>(
  id: Id,
  descriptor: FormatCapabilities & { readonly createReader: ReaderFn },
): ReturnType<typeof withReader<Id>>;
function described<Id extends ArtifactFormatId>(
  id: Id,
  descriptor: FormatCapabilities,
): ReturnType<typeof withoutReader<Id>>;
function described<Id extends ArtifactFormatId>(
  id: Id,
  descriptor: FormatCapabilities & { readonly createReader?: ReaderFn },
) {
  const { createReader, ...capabilities } = descriptor;
  return createReader === undefined
    ? withoutReader(id, capabilities)
    : withReader(id, capabilities, createReader);
}

const plain = {
  zipFamily: false,
  occurrenceContainer: false,
  roleContainer: false,
  retainClassifiedSource: false,
  extractable: false,
  requiresDarwin: false,
  absentInventory: "root",
} as const satisfies Omit<FormatDescriptor, "id" | "createReader">;

function container<Id extends ArtifactFormatId>(
  id: Id,
  descriptor: Partial<FormatCapabilities> & { readonly createReader: ReaderFn },
): ReturnType<typeof withReader<Id>>;
function container<Id extends ArtifactFormatId>(
  id: Id,
  descriptor?: Partial<FormatCapabilities>,
): ReturnType<typeof withoutReader<Id>>;
function container<Id extends ArtifactFormatId>(
  id: Id,
  descriptor: Partial<FormatCapabilities> & {
    readonly createReader?: ReaderFn;
  } = {},
) {
  const { createReader, ...rest } = descriptor;
  const capabilities = {
    ...plain,
    occurrenceContainer: true as const,
    ...rest,
  };
  return createReader === undefined
    ? withoutReader(id, capabilities)
    : withReader(id, capabilities, createReader);
}

const NON_ZIP_FORMATS = {
  "dotnet-bundle": container("dotnet-bundle", {
    retainClassifiedSource: true,
    absentInventory: "root",
    createReader: (path, options) =>
      new DotnetBundleArtifactReader(
        path,
        admittedAs("dotnet-bundle", options),
      ),
  }),
  "bun-standalone": container("bun-standalone", {
    retainClassifiedSource: true,
    absentInventory: "unavailable",
    createReader: (path, options) =>
      new BunStandaloneArtifactReader(
        path,
        admittedAs("bun-standalone", options),
      ),
  }),
  dmg: container("dmg", {
    requiresDarwin: true,
    absentInventory: "platform",
    createReader: (path, options) =>
      new NativeDmgArtifactReader(path, options.environment),
  }),
  pkg: container("pkg", { absentInventory: "platform" }),
  asar: container("asar", {
    extractable: true,
    absentInventory: "unavailable",
    createReader: (path, options) =>
      new AsarArtifactReader(path, {
        ...(options.asarHeaderAdmission === undefined
          ? {}
          : { headerAdmission: options.asarHeaderAdmission }),
        ...(options.selectedPath === undefined
          ? {}
          : { selectedPath: options.selectedPath }),
      }),
  }),
  ines: container("ines", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation: INES_LIMITATION,
    createReader: (path, options) => {
      const source = sourceOf(options);
      if (source === undefined)
        throw new ArtifactReaderFailure(
          "integrity",
          "iNES inventory requires its admitted source descriptor",
        );
      return new InesArtifactReader(path, source);
    },
  }),
  "godot-pck": container("godot-pck", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "PCK inventory establishes packaged bytes and metadata; scenes, binary resources, GDScript bytecode and runtime signal behavior were not decoded.",
    createReader: (path, options) =>
      new GodotPckArtifactReader(path, admittedAs("godot-pck", options)),
  }),
  unityfs: container("unityfs", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "UnityFS inventory establishes packaged bytes and metadata; serialized objects, textures, meshes and runtime asset behavior were not decoded. LZMA-compressed members are unsupported.",
    createReader: (path, options) =>
      new UnityFsArtifactReader(path, sourceOf(options)),
  }),
  uimage: container("uimage", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "uImage inventory establishes the 64-byte legacy header facts and stored payload bytes. Compressed payloads are not decompressed, and the image is not executed.",
    createReader: (path, options) =>
      new UImageArtifactReader(path, sourceOf(options)),
  }),
  "javascript-bundle": described("javascript-bundle", plain),
  "source-map": described("source-map", plain),
  "mach-o-universal": described("mach-o-universal", {
    ...plain,
    retainClassifiedSource: true,
    extractable: true,
    requiresDarwin: true,
    absentInventory: "universal",
    createReader: (path, options) =>
      new MachOSliceArtifactReader(
        path,
        options.environment,
        undefined,
        sourceOf(options),
      ),
  }),
  "mach-o": described("mach-o", plain),
  elf: described("elf", plain),
  pe: described("pe", plain),
  "dos-mz": described("dos-mz", plain),
  "dos-com": described("dos-com", plain),
  "raw-binary": described("raw-binary", plain),
  "gamecube-dol": described("gamecube-dol", plain),
  hopper: described("hopper", plain),
  "analysis-database": described("analysis-database", plain),
  plist: described("plist", plain),
  entitlements: described("entitlements", plain),
  directory: container("directory", {
    absentInventory: "unavailable",
    createReader: (path, options) =>
      new DirectoryArtifactReader(path, options.unreadableDirectories),
  }),
  file: described("file", plain),
  pyinstaller: container("pyinstaller", {
    retainClassifiedSource: true,
    createReader: (path, options) =>
      new PyInstallerArtifactReader(path, admittedAs("pyinstaller", options)),
  }),
  "node-sea": container("node-sea", {
    retainClassifiedSource: true,
    absentInventory: "unavailable",
    readerLimitation:
      "Node SEA inventory establishes the injected blob, flags, fuse sentinel, main script, optional code cache, snapshot, and assets. V8 snapshots and code cache are not deserialized, and the application is not executed.",
    createReader: (path, options) =>
      new NodeSeaArtifactReader(path, admittedAs("node-sea", options)),
  }),
  "intel-hex": container("intel-hex", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "Intel HEX/S-record inventory decodes data records into address-contiguous regions. It does not establish CPU, byte order, memory map, or that a declared start address is executable; gaps are unwritten, not zero.",
    createReader: (path, options) =>
      new HexRecordArtifactReader(path, "intel-hex", sourceOf(options)),
  }),
  srec: container("srec", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "Intel HEX/S-record inventory decodes data records into address-contiguous regions. It does not establish CPU, byte order, memory map, or that a declared start address is executable; gaps are unwritten, not zero.",
    createReader: (path, options) =>
      new HexRecordArtifactReader(path, "srec", sourceOf(options)),
  }),
  "esp-image": container("esp-image", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation: ESP_IMAGE_LIMITATIONS.inventoryScope,
    createReader: (path, options) =>
      new EspImageArtifactReader(path, sourceOf(options)),
  }),
  uf2: container("uf2", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "UF2 inventory decodes main-flash block payloads into address-contiguous regions per familyID. It does not establish CPU, byte order, memory map, or an entry point; a familyID names a target family, and gaps are unwritten, not zero.",
    createReader: (path, options) =>
      new Uf2ArtifactReader(path, sourceOf(options)),
  }),
  dfuse: container("dfuse", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "DfuSe inventory lists each target element as one region at its declared address. It does not establish CPU, byte order, memory map, or an entry point; an alternate setting selects a device memory, not an address space REA can interpret.",
    createReader: (path, options) =>
      new DfuSeArtifactReader(path, sourceOf(options)),
  }),
  "esp-flash-image": container("esp-flash-image", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "ESP flash layout inventory reads a dump's bootloader region, partition table and partitions and decodes the bootloader and app partitions as ESP images. The OTA selection is derived without app rollback or anti-rollback, and the running partition is unknown. Partitions, nvs_keys included, are extracted as ordinary data; nothing is decrypted.",
    createReader: (path, options) =>
      new EspFlashImageArtifactReader(
        path,
        admittedAs("esp-flash-image", options),
        options.espFlashSelection,
      ),
  }),
  fit: container("fit", {
    roleContainer: true,
    retainClassifiedSource: true,
    extractable: true,
    absentInventory: "unavailable",
    readerLimitation:
      "FIT inventory reports each /images node's stored bytes and its declared type, architecture, OS, compression, load and entry. Image data is not decompressed or decrypted, signatures are not verified, nothing is executed, and load and entry addresses are declarations.",
    createReader: (path, options) =>
      new FitArtifactReader(path, sourceOf(options)),
  }),
  unknown: described("unknown", plain),
} satisfies Record<
  Exclude<ArtifactFormatId, ZipPackageFormat>,
  FormatDescriptor
>;

const ZIP_FORMATS = Object.fromEntries(
  ZIP_PACKAGE_FORMATS.map((id) => [id, zipDescriptor(id)]),
) as {
  readonly [Id in ZipPackageFormat]: ReturnType<typeof zipDescriptor>;
};

/**
 * One descriptor per domain format id. `unknown` has no reader. ZIP package
 * families share {@link ZIP_FAMILY_CAPABILITIES}.
 */
const ARTIFACT_FORMAT_REGISTRY = {
  ...NON_ZIP_FORMATS,
  ...ZIP_FORMATS,
};

export const ARTIFACT_FORMATS: {
  readonly [Id in ArtifactFormatId]: (typeof ARTIFACT_FORMAT_REGISTRY)[Id];
} = ARTIFACT_FORMAT_REGISTRY;

const listedFormatIds: readonly ArtifactFormatId[] = ARTIFACT_FORMAT_IDS;

/** Descriptor for a recognized format id, when the value is one. */
export const artifactFormatDescriptor = (
  format: string,
): FormatDescriptor | undefined =>
  listedFormatIds.some((id) => id === format)
    ? ARTIFACT_FORMATS[format as ArtifactFormatId]
    : undefined;
