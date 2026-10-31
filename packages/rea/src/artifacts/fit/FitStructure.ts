import { createHash } from "node:crypto";
import { crc32 } from "node:zlib";

import { artifactExpansionBudgetBytes } from "../../domain/artifactExpansionBudget.js";
import type {
  FitImageMetadata,
  FitMetadata,
} from "../../domain/artifactFormatMetadata.js";
import {
  MAX_DEVICETREE_FILE_BYTES,
  type Devicetree,
} from "../../domain/firmware/devicetree.js";
import {
  DevicetreeLimitFailure,
  parseDevicetree,
} from "../../firmware/devicetree/DevicetreeParser.js";
import { BinaryFormatFailure } from "../../native/metadata/BinaryContainer.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";

// Fixed resource bounds; configurable ceilings are tracked in #6176.
export const FIT_MAX_IMAGES = 1024;
export const FIT_MAX_HASH_NODES_PER_IMAGE = 8;
export const FIT_MAX_CONFIGURATIONS = 1024;
/** Bounds configuration references and their limitations across the FIT. */
export const FIT_MAX_CONFIGURATION_REFERENCES = 16_384;

type FitNode = Devicetree["nodes"][number];
type FitProperty = FitNode["properties"][number];

export interface FitImageDeclaration {
  readonly index: number;
  readonly name: string;
  readonly start: number;
  readonly size: number;
  readonly metadata: FitImageMetadata;
  readonly limitations: string[];
  /** Supported algorithms with a value of the right length, in node order. */
  readonly hashes: { node: string; algo: string; value: Buffer }[];
}

export interface FitStructure {
  readonly metadata: FitMetadata;
  readonly images: FitImageDeclaration[];
  readonly limitations: string[];
}

interface FitLayout {
  readonly fdt: Buffer;
  readonly children: ReadonlyMap<string, readonly FitNode[]>;
  readonly totalsize: number;
  readonly fileSize: number;
}

/** Lenient decoding records malformed descriptive facts here instead of failing. */
interface FitFacts {
  readonly fdt: Buffer;
  readonly limitations: string[];
}
type FitFact<Value> = (facts: FitFacts, node: FitNode, name: string) => Value;

// U-Boot's hash value lengths; crc32 is stored as 4 bytes big-endian.
const DIGEST_BYTES = new Map([
  ["crc32", 4],
  ["md5", 16],
  ["sha1", 20],
  ["sha256", 32],
  ["sha384", 48],
  ["sha512", 64],
]);
const DATA_SOURCES = ["data", "data-offset", "data-position"] as const;
const CONFIGURATION_REFERENCES = [
  "kernel",
  "firmware",
  "fdt",
  "ramdisk",
  "loadables",
] as const;

const align4 = (value: number): number => Math.ceil(value / 4) * 4;
const formatFailure = (detail: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("format", `FIT is malformed: ${detail}`);
const capacityFailure = (message: string): ArtifactReaderFailure =>
  new ArtifactReaderFailure("limit", message, { boundary: "capacity" });
const nodeName = (node: FitNode): string =>
  node.path.slice(node.path.lastIndexOf("/") + 1);
const propertyOf = (node: FitNode, name: string): FitProperty | undefined =>
  node.properties.find((property) => property.name === name);
const valueOf = (fdt: Buffer, property: FitProperty): Buffer =>
  fdt.subarray(property.offset, property.offset + property.bytes);

// A property value is data: a leading U+FEFF is not a file encoding signature.
const utf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });
const nulCount = (raw: Buffer): number => {
  let count = 0;
  for (const byte of raw) if (byte === 0) count += 1;
  return count;
};

/**
 * NUL-terminated UTF-8 strings, or undefined when the value is malformed.
 * More than `maxStrings` strings is malformed, counted before splitting.
 */
const nulStrings = (
  fdt: Buffer,
  property: FitProperty | undefined,
  maxStrings = 1,
): string[] | undefined => {
  if (property === undefined) return undefined;
  const raw = valueOf(fdt, property);
  if (raw.at(-1) !== 0 || nulCount(raw) > maxStrings) return undefined;
  try {
    return utf8.decode(raw.subarray(0, -1)).split("\0");
  } catch {
    return undefined;
  }
};

/** Incremental digest of one verified FIT hash algorithm. */
export const createFitDigest = (
  algo: string,
): { update(chunk: Buffer): void; digest(): Buffer } | undefined => {
  if (!DIGEST_BYTES.has(algo)) return undefined;
  if (algo !== "crc32") {
    const hash = createHash(algo);
    return {
      update: (chunk) => {
        hash.update(chunk);
      },
      digest: () => hash.digest(),
    };
  }
  let value = 0;
  return {
    update: (chunk) => {
      value = crc32(chunk, value);
    },
    digest: () => Buffer.from(value.toString(16).padStart(8, "0"), "hex"),
  };
};

const fitString: FitFact<string | null> = (facts, node, name) => {
  const property = propertyOf(node, name);
  if (property === undefined) return null;
  const strings = nulStrings(facts.fdt, property);
  if (strings?.length === 1) return strings[0] ?? null;
  facts.limitations.push(
    `${node.path}: ${name} is not a NUL-terminated UTF-8 string`,
  );
  return null;
};

const fitStrings: FitFact<string[]> = (facts, node, name) => {
  const property = propertyOf(node, name);
  if (property === undefined) return [];
  // fitConfigurations bounds every reference list before decoding.
  const strings = nulStrings(
    facts.fdt,
    property,
    FIT_MAX_CONFIGURATION_REFERENCES,
  );
  if (strings !== undefined) return strings;
  facts.limitations.push(
    `${node.path}: ${name} is not a NUL-terminated UTF-8 string list`,
  );
  return [];
};

const fitU32: FitFact<number | null> = (facts, node, name) => {
  const property = propertyOf(node, name);
  if (property === undefined) return null;
  if (property.bytes === 4) return facts.fdt.readUInt32BE(property.offset);
  facts.limitations.push(`${node.path}: ${name} is not a single 32-bit cell`);
  return null;
};

/** Fold 32-bit big-endian cells by property length, as U-Boot does. */
const fitAddress: FitFact<string | null> = (facts, node, name) => {
  const property = propertyOf(node, name);
  if (property === undefined) return null;
  if (property.bytes !== 4 && property.bytes !== 8) {
    facts.limitations.push(
      `${node.path}: ${name} is not a 1- or 2-cell address`,
    );
    return null;
  }
  let value = 0n;
  for (let offset = 0; offset < property.bytes; offset += 4)
    value =
      (value << 32n) | BigInt(facts.fdt.readUInt32BE(property.offset + offset));
  return `0x${value.toString(16)}`;
};

/** Byte-locating cells fail closed: a guessed range would misattribute bytes. */
const strictCell = (
  fdt: Buffer,
  node: FitNode,
  property: FitProperty,
): number => {
  if (property.bytes !== 4)
    throw formatFailure(
      `${node.path}: ${property.name} is not a single 32-bit cell`,
    );
  return fdt.readUInt32BE(property.offset);
};

const imageRange = (
  layout: FitLayout,
  node: FitNode,
): Pick<FitImageDeclaration, "start" | "size"> &
  Pick<FitImageMetadata, "data_source" | "declared_offset"> => {
  const declared = DATA_SOURCES.flatMap((name) => {
    const property = propertyOf(node, name);
    return property === undefined ? [] : [{ name, property }];
  });
  const [source] = declared;
  if (source === undefined)
    throw formatFailure(
      `${node.path} has no data, data-offset or data-position`,
    );
  if (declared.length > 1)
    throw formatFailure(`${node.path} declares more than one data source`);
  if (source.name === "data")
    return {
      start: source.property.offset,
      size: source.property.bytes,
      data_source: "embedded",
      declared_offset: null,
    };
  const declaredOffset = strictCell(layout.fdt, node, source.property);
  const sizeProperty = propertyOf(node, "data-size");
  if (sizeProperty === undefined)
    throw formatFailure(`${node.path}: ${source.name} requires data-size`);
  const size = strictCell(layout.fdt, node, sizeProperty);
  // data-offset is relative to the 4-byte-aligned end of the devicetree;
  // data-position is an offset from the start of the FIT (fit + position).
  const start =
    source.name === "data-offset"
      ? align4(layout.totalsize) + declaredOffset
      : declaredOffset;
  if (start + size > layout.fileSize)
    throw formatFailure(
      `${node.path}: data at [${String(start)}, ${String(start + size)}) lies outside the ${String(layout.fileSize)}-byte file`,
    );
  return {
    start,
    size,
    data_source: source.name,
    declared_offset: declaredOffset,
  };
};

const imageHashes = (
  facts: FitFacts,
  image: FitNode,
  children: readonly FitNode[],
) => {
  const nodes = children.filter((child) => nodeName(child).startsWith("hash"));
  if (nodes.length > FIT_MAX_HASH_NODES_PER_IMAGE)
    throw capacityFailure(
      `FIT image ${nodeName(image)} declares ${String(nodes.length)} hash nodes, above the fixed ${String(FIT_MAX_HASH_NODES_PER_IMAGE)}-node allowance`,
    );
  const hashes: FitImageDeclaration["hashes"] = [];
  const algorithms: string[] = [];
  let unverified = 0;
  for (const node of nodes) {
    const name = nodeName(node);
    const algos = nulStrings(facts.fdt, propertyOf(node, "algo"));
    const algo = algos?.length === 1 ? algos[0] : undefined;
    const value = propertyOf(node, "value");
    const expected = algo === undefined ? undefined : DIGEST_BYTES.get(algo);
    if (algo !== undefined) algorithms.push(algo);
    if (algo === undefined || expected === undefined || value === undefined) {
      unverified += 1;
      facts.limitations.push(
        algo === undefined
          ? `${name} has no NUL-terminated UTF-8 algo; it is not verified`
          : expected === undefined
            ? `${name} algorithm "${algo}" is not verified`
            : `${name} has no value; it is not verified`,
      );
      continue;
    }
    if (value.bytes !== expected)
      throw new ArtifactReaderFailure(
        "integrity",
        `FIT image ${nodeName(image)} ${name} ${algo} value is ${String(value.bytes)} bytes; ${algo} values are ${String(expected)} bytes`,
      );
    // Copy the value so the devicetree buffer can be released.
    hashes.push({
      node: name,
      algo,
      value: Buffer.from(valueOf(facts.fdt, value)),
    });
  }
  return { hashes, algorithms, unverified };
};

/** Signature declarations remain visible even when their algorithm is unreadable. */
const signatureAlgorithms = (
  facts: FitFacts,
  children: readonly FitNode[],
): { algorithms: string[]; count: number; unreadable: number } => {
  const algorithms: string[] = [];
  let count = 0;
  let unreadable = 0;
  for (const child of children) {
    if (!nodeName(child).startsWith("signature")) continue;
    count += 1;
    const algo = fitString(facts, child, "algo");
    if (algo !== null) algorithms.push(algo);
    else {
      unreadable += 1;
      if (propertyOf(child, "algo") === undefined)
        facts.limitations.push(`${child.path}: signature algo is missing`);
    }
  }
  return { algorithms, count, unreadable };
};

const imageDeclaration = (
  layout: FitLayout,
  node: FitNode,
  index: number,
): FitImageDeclaration => {
  const facts: FitFacts = { fdt: layout.fdt, limitations: [] };
  const name = nodeName(node);
  const children = layout.children.get(node.path) ?? [];
  const range = imageRange(layout, node);
  const imageDataProperty = propertyOf(node, "image-data");
  const imageData = nulStrings(layout.fdt, imageDataProperty);
  if (imageDataProperty !== undefined && imageData?.length !== 1)
    throw formatFailure(`${node.path}: image-data is not one string`);
  const cipher = children.find((child) => nodeName(child) === "cipher");
  const unreadable = new Set<FitImageMetadata["unreadable_fields"][number]>();
  const field = <Value>(
    key: FitImageMetadata["unreadable_fields"][number],
    reader: FitFact<Value | null>,
    source = node,
    property: string = key,
  ): Value | null => {
    const value = reader(facts, source, property);
    if (value === null && propertyOf(source, property) !== undefined)
      unreadable.add(key);
    return value;
  };
  const metadata = {
    kind: "fit-image" as const,
    index,
    name,
    description: field("description", fitString),
    type: field("type", fitString),
    arch: field("arch", fitString),
    os: field("os", fitString),
    compression: field("compression", fitString),
    load: field("load", fitAddress),
    entry: field("entry", fitAddress),
    data_source: range.data_source,
    declared_offset: range.declared_offset,
    image_data: imageData?.[0] ?? null,
    cipher_present: cipher !== undefined,
    cipher_algo:
      cipher === undefined
        ? null
        : field("cipher_algo", fitString, cipher, "algo"),
  };
  const { hashes, algorithms, unverified } = imageHashes(facts, node, children);
  const signatures = signatureAlgorithms(facts, children);
  return {
    index,
    name,
    start: range.start,
    size: range.size,
    limitations: facts.limitations,
    hashes,
    metadata: {
      ...metadata,
      unreadable_fields: [...unreadable].sort(),
      hash_algorithms: algorithms,
      hashes_verified: hashes.length,
      hashes_unverified: unverified,
      signature_count: signatures.count,
      signatures_unreadable: signatures.unreadable,
      signature_algorithms: signatures.algorithms,
    },
  };
};

/** image-data must name an unchained image whose data properties agree. */
const assertImageDataLinks = (
  images: readonly FitImageDeclaration[],
  fdt: Buffer,
): void => {
  const byName = new Map(images.map((image) => [image.name, image]));
  for (const image of images) {
    const name = image.metadata.image_data;
    if (name === null) continue;
    const target = byName.get(name);
    const path = `/images/${image.name}`;
    if (target === undefined)
      throw formatFailure(`${path}: image-data names no image: ${name}`);
    if (target.metadata.image_data !== null)
      throw formatFailure(
        `${path}: image-data target /images/${name} has its own image-data`,
      );
    // Embedded copies occupy distinct properties but must contain equal bytes.
    if (
      (target.metadata.data_source === "embedded") !==
        (image.metadata.data_source === "embedded") ||
      target.size !== image.size ||
      (image.metadata.data_source === "embedded"
        ? !fdt
            .subarray(image.start, image.start + image.size)
            .equals(fdt.subarray(target.start, target.start + target.size))
        : target.start !== image.start)
    )
      throw formatFailure(
        `${path}: data does not match its image-data target /images/${name}`,
      );
  }
};

/** External ranges may not overlap the devicetree or each other, except linked shares. */
const assertDisjoint = (
  images: readonly FitImageDeclaration[],
  totalsize: number,
): void => {
  const owner = (image: FitImageDeclaration): string =>
    image.metadata.image_data ?? image.name;
  const ranges = images
    .filter(
      (image) => image.metadata.data_source !== "embedded" && image.size > 0,
    )
    .sort((a, b) => a.start - b.start || a.index - b.index);
  let previous: FitImageDeclaration | undefined;
  let end = totalsize;
  for (const image of ranges) {
    if (image.start < end) {
      if (
        previous !== undefined &&
        previous.start === image.start &&
        previous.size === image.size &&
        owner(previous) === owner(image)
      )
        continue;
      throw formatFailure(
        `image data overlaps: /images/${image.name} and ${previous === undefined ? "the FIT devicetree" : `/images/${previous.name}`}`,
      );
    }
    previous = image;
    end = image.start + image.size;
  }
};

const fitConfiguration = (
  layout: FitLayout,
  facts: FitFacts,
  node: FitNode,
  images: ReadonlySet<string>,
): FitMetadata["configurations"][number] => {
  const references = {
    kernel: fitStrings(facts, node, "kernel"),
    firmware: fitStrings(facts, node, "firmware"),
    fdt: fitStrings(facts, node, "fdt"),
    ramdisk: fitStrings(facts, node, "ramdisk"),
    loadables: fitStrings(facts, node, "loadables"),
  };
  let unresolved = 0;
  for (const values of Object.values(references))
    for (const reference of values) if (!images.has(reference)) unresolved += 1;
  if (unresolved > 0)
    facts.limitations.push(
      `${node.path}: ${String(unresolved)} image references do not name an /images node`,
    );
  const signatures = signatureAlgorithms(
    facts,
    layout.children.get(node.path) ?? [],
  );
  return {
    name: nodeName(node),
    description: fitString(facts, node, "description"),
    ...references,
    unresolved_reference_count: unresolved,
    signature_count: signatures.count,
    signatures_unreadable: signatures.unreadable,
    signature_algorithms: signatures.algorithms,
  };
};

const fitConfigurations = (
  layout: FitLayout,
  facts: FitFacts,
  node: FitNode | undefined,
  images: ReadonlySet<string>,
): Pick<FitMetadata, "default_configuration" | "configurations"> => {
  if (node === undefined)
    return { default_configuration: null, configurations: [] };
  const children = layout.children.get(node.path) ?? [];
  if (children.length > FIT_MAX_CONFIGURATIONS)
    throw capacityFailure(
      `FIT declares ${String(children.length)} configurations, above the fixed ${String(FIT_MAX_CONFIGURATIONS)}-configuration allowance`,
    );
  let references = 0;
  for (const child of children)
    for (const name of CONFIGURATION_REFERENCES) {
      const property = propertyOf(child, name);
      if (property !== undefined)
        references += nulCount(valueOf(layout.fdt, property));
    }
  if (references > FIT_MAX_CONFIGURATION_REFERENCES)
    throw capacityFailure(
      `FIT configurations declare ${String(references)} image references, above the fixed ${String(FIT_MAX_CONFIGURATION_REFERENCES)}-reference allowance`,
    );
  const configurations = children.map((child) =>
    fitConfiguration(layout, facts, child, images),
  );
  const defaultConfiguration = fitString(facts, node, "default");
  if (
    defaultConfiguration !== null &&
    !configurations.some((entry) => entry.name === defaultConfiguration)
  )
    facts.limitations.push(
      `${node.path}: default ${defaultConfiguration} names no configuration`,
    );
  return { default_configuration: defaultConfiguration, configurations };
};

const parseFit = (fdt: Buffer, path: string): Devicetree => {
  try {
    // The artifact field is only echoed back; the reader binds the carrier hash.
    return parseDevicetree(
      fdt,
      { path, sha256: "", bytes: fdt.length },
      {
        path,
        max_file_bytes: MAX_DEVICETREE_FILE_BYTES,
        max_nodes: 8192,
        max_properties: 32768,
        max_depth: 64,
      },
    );
  } catch (cause) {
    if (cause instanceof BinaryFormatFailure)
      throw formatFailure(cause.message);
    if (cause instanceof DevicetreeLimitFailure)
      throw new ArtifactReaderFailure(
        "limit",
        `FIT devicetree exceeds the fixed ${cause.limit} allowance`,
        {
          boundary: cause.limit === "decoded_bytes" ? "memory" : "capacity",
          cause,
        },
      );
    throw cause;
  }
};

/** Decode one complete FIT devicetree whose external data lies in a fileSize-byte file. */
export const readFitStructure = (
  fdt: Buffer,
  path: string,
  fileSize: number,
): FitStructure => {
  const tree = parseFit(fdt, path);
  const byPath = new Map(tree.nodes.map((node) => [node.path, node]));
  const children = new Map<string, FitNode[]>();
  for (const node of tree.nodes) {
    if (node.parent === null) continue;
    const siblings = children.get(node.parent);
    if (siblings === undefined) children.set(node.parent, [node]);
    else siblings.push(node);
  }
  const root = byPath.get("/");
  if (root === undefined || !byPath.has("/images"))
    throw formatFailure("/images node is missing");
  const { totalsize } = tree.header;
  const layout: FitLayout = { fdt, children, totalsize, fileSize };
  const imageNodes = children.get("/images") ?? [];
  if (imageNodes.length > FIT_MAX_IMAGES)
    throw capacityFailure(
      `FIT declares ${String(imageNodes.length)} images, above the fixed ${String(FIT_MAX_IMAGES)}-image allowance`,
    );
  const images = imageNodes.map((node, index) =>
    imageDeclaration(layout, node, index),
  );
  assertImageDataLinks(images, fdt);
  assertDisjoint(images, totalsize);
  const declared = images.reduce((sum, image) => sum + image.size, 0);
  const budget = artifactExpansionBudgetBytes(fileSize);
  if (declared > budget)
    throw new ArtifactReaderFailure(
      "limit",
      `FIT images declare ${String(declared)} bytes, exceeding this file's ${String(budget)}-byte expansion budget`,
      { boundary: "memory" },
    );
  const facts: FitFacts = { fdt, limitations: [] };
  return {
    images,
    limitations: facts.limitations,
    metadata: {
      kind: "fit",
      fdt_version: tree.header.version,
      fdt_totalsize: totalsize,
      external_data_base: align4(totalsize),
      description: fitString(facts, root, "description"),
      timestamp: fitU32(facts, root, "timestamp"),
      address_cells: fitU32(facts, root, "#address-cells"),
      ...fitConfigurations(
        layout,
        facts,
        byPath.get("/configurations"),
        new Set(images.map((image) => image.name)),
      ),
    },
  };
};
