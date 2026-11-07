import { createHash } from "node:crypto";

import { ArtifactReaderFailure } from "../../artifacts/ArtifactReader.js";
import { elfObjectTypeName } from "../../domain/native/elfNotes.js";
import {
  KERNEL_MODULE_VERSION_ENTRY_BYTES,
  MAX_KERNEL_MODULE_KEY_BYTES,
  MAX_KERNEL_MODULE_RAW_BYTES,
  MAX_KERNEL_MODULE_SECTION_NAME_BYTES,
  MAX_KERNEL_MODULE_VALUE_BYTES,
  MODULE_SIGNATURE_INFO_BYTES,
  MODULE_SIGNATURE_MAGIC,
  MODULE_SIGNATURE_PKCS7_ID_TYPE,
  type KernelModule,
  type InspectKernelModuleInput,
} from "../../domain/native/kernelModule.js";
import type {
  ImageSection,
  BinaryContainer,
} from "../metadata/BinaryContainer.js";
import { readElfImage } from "../metadata/ElfImage.js";

type ElfSection = Extract<ImageSection, { format: "elf" }>;
type Report = KernelModule;
type Limitations = string[];

const MAGIC = Buffer.from(MODULE_SIGNATURE_MAGIC, "latin1");
const GZIP = Buffer.from([0x1f, 0x8b]);
const XZ = Buffer.from([0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]);
const ZSTD = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

const sha256 = (bytes: Buffer): string =>
  createHash("sha256").update(bytes).digest("hex");

const exceeds = (examined: number, maxEntries: number): void => {
  if (examined > maxEntries)
    throw new ArtifactReaderFailure(
      "limit",
      `Kernel module entries exceed the ${String(maxEntries)}-entry budget.`,
      { boundary: "capacity" },
    );
};

const fits = (offset: bigint, size: bigint, fileLength: number): boolean =>
  offset >= 0n &&
  size >= 0n &&
  offset <= BigInt(fileLength) &&
  size <= BigInt(fileLength) - offset;

const locationOf = (
  section: ElfSection,
): { offset: number; bytes: number } | null => {
  if (
    !fits(
      section.declared_range.offset,
      section.declared_range.size,
      Number.MAX_SAFE_INTEGER,
    )
  )
    return null;
  return {
    offset: Number(section.declared_range.offset),
    bytes: Number(section.declared_range.size),
  };
};

const inFile = (section: ElfSection, fileLength: number): boolean =>
  fits(section.declared_range.offset, section.declared_range.size, fileLength);

const rawHex = (bytes: Buffer): string | null =>
  bytes.length > MAX_KERNEL_MODULE_RAW_BYTES ? null : bytes.toString("hex");

const compressionCodec = (bytes: Buffer): Report["compression"] => {
  if (bytes.subarray(0, GZIP.length).equals(GZIP))
    return { codec: "gzip", status: "unsupported" };
  if (bytes.length >= XZ.length && bytes.subarray(0, XZ.length).equals(XZ))
    return { codec: "xz", status: "unsupported" };
  if (
    bytes.length >= ZSTD.length &&
    bytes.subarray(0, ZSTD.length).equals(ZSTD)
  )
    return { codec: "zstd", status: "unsupported" };
  return null;
};

const baseLimitations = (): Limitations => [
  "This workflow does not execute the module, resolve imported symbols, or validate an appended signature.",
  "struct module in .gnu.linkonce.this_module is kernel-version specific and is not decoded.",
  "__ksymtab entry layout is kernel-version specific and is not decoded.",
  "Only classic __versions records are decoded. Their absence does not establish the absence of CONFIG_EXTENDED_MODVERSIONS metadata in __version_ext_names and __version_ext_crcs.",
  "Metadata strings use a byte-preserving Latin1 projection; their original text encoding is unobserved.",
];

const headerFacts = (
  image: Extract<BinaryContainer, { format: "elf" }>,
): Pick<Report, "format" | "byte_order" | "machine" | "type" | "type_name"> => {
  const { type } = image.elf;
  return {
    format: image.bits === 64 ? "elf64" : "elf32",
    byte_order: image.byte_order,
    machine: image.elf.machine,
    type,
    type_name: elfObjectTypeName(type),
  };
};

const unsupportedCompression = (
  artifact: Report["artifact"],
  compression: NonNullable<Report["compression"]>,
): Report => ({
  artifact,
  format: null,
  byte_order: null,
  machine: null,
  type: null,
  type_name: null,
  applicability: "unsupported",
  compression,
  next_probe: {
    operation: "external_decompression",
    rationale: `Decompress this ${compression.codec} container with an external ${compression.codec} utility into a separate file, then call inspect_kernel_module on the decompressed file. REA does not decode ${compression.codec} containers.`,
  },
  modinfo: null,
  versions: null,
  this_module: null,
  ksymtab: null,
  init_text: null,
  exit_text: null,
  signature: null,
  coverage: { status: "unsupported", examined_entries: 0 },
  limitations: [
    ...baseLimitations(),
    "gzip, xz, and zstd kernel-module containers are not decoded. The existing ELF section decoder does not cover these whole-file codecs.",
    "A compressed container is not proof the payload is a kernel module.",
  ],
});

const notApplicable = (
  artifact: Report["artifact"],
  facts: ReturnType<typeof headerFacts>,
): Report => ({
  artifact,
  ...facts,
  applicability: "not_applicable",
  compression: null,
  next_probe: null,
  modinfo: null,
  versions: null,
  this_module: null,
  ksymtab: null,
  init_text: null,
  exit_text: null,
  signature: null,
  coverage: { status: "not_applicable", examined_entries: 0 },
  limitations: [
    ...baseLimitations(),
    "Kernel module metadata is defined for ET_REL objects. This ELF type is not applicable, so .modinfo, __versions, and the signature trailer were not examined.",
  ],
});

interface SectionUse {
  readonly namesComplete: boolean;
  readonly limitations: Limitations;
}

const sectionsNamed = (
  sections: readonly ElfSection[],
  name: string,
): readonly ElfSection[] => sections.filter((section) => section.name === name);

const parseModinfo = (
  bytes: Buffer,
  section: ElfSection | undefined,
  use: SectionUse,
  examined: { count: number },
  maxEntries: number,
): Report["modinfo"] => {
  if (section === undefined)
    return {
      status: use.namesComplete ? "absent" : "unknown",
      location: null,
      sha256: null,
      entries: [],
      reason: null,
    };
  const location = locationOf(section);
  if (section.type === 8 || location === null || !inFile(section, bytes.length))
    return {
      status: "malformed",
      location: null,
      sha256: null,
      entries: [],
      reason: "modinfo_section_not_file_backed",
    };
  const stored = bytes.subarray(
    location.offset,
    location.offset + location.bytes,
  );
  if (section.compressed)
    return {
      status: "unsupported",
      location,
      sha256: sha256(stored),
      entries: [],
      reason: "modinfo_section_compressed",
    };
  const entries: NonNullable<Report["modinfo"]>["entries"] = [];
  let at = 0;
  while (at < stored.length) {
    if (stored[at] === 0) {
      at += 1;
      continue;
    }
    const end = stored.indexOf(0, at);
    const terminated = end >= 0;
    const stop = terminated ? end : stored.length;
    const record = stored.subarray(at, stop);
    const raw = stored.subarray(at, terminated ? end + 1 : stored.length);
    examined.count += 1;
    exceeds(examined.count, maxEntries);
    const separator = record.indexOf(0x3d);
    let key: string | null = null;
    let value: string | null = null;
    let reason: NonNullable<Report["modinfo"]>["entries"][number]["reason"] =
      terminated ? null : "unterminated_modinfo_entry";
    if (separator < 0) reason ??= "modinfo_missing_separator";
    else {
      const keyBytes = record.subarray(0, separator);
      const valueBytes = record.subarray(separator + 1);
      if (keyBytes.length === 0) reason ??= "modinfo_empty_key";
      if (
        keyBytes.length > MAX_KERNEL_MODULE_KEY_BYTES ||
        valueBytes.length > MAX_KERNEL_MODULE_VALUE_BYTES
      )
        reason ??= "modinfo_field_exceeds_limit";
      if (keyBytes.length > 0 && keyBytes.length <= MAX_KERNEL_MODULE_KEY_BYTES)
        key = keyBytes.toString("latin1");
      if (valueBytes.length <= MAX_KERNEL_MODULE_VALUE_BYTES)
        value = valueBytes.toString("latin1");
    }
    entries.push({
      index: entries.length,
      location: {
        offset: location.offset + at,
        bytes: raw.length,
      },
      key,
      value,
      raw_sha256: sha256(raw),
      raw_hex: rawHex(raw),
      status: reason === null ? "observed" : "malformed",
      reason,
    });
    if (!terminated) break;
    at = end + 1;
  }
  return {
    status: "present",
    location,
    sha256: sha256(stored),
    entries,
    reason: null,
  };
};

const parseVersions = (
  bytes: Buffer,
  section: ElfSection | undefined,
  bits: 32 | 64,
  little: boolean,
  use: SectionUse,
  examined: { count: number },
  maxEntries: number,
): Report["versions"] => {
  const layout =
    bits === 64 ? "elf64_unsigned_long_name56" : "elf32_unsigned_long_name60";
  const entryBytes = KERNEL_MODULE_VERSION_ENTRY_BYTES;
  if (section === undefined)
    return {
      status: use.namesComplete ? "absent" : "unknown",
      layout,
      entry_bytes: entryBytes,
      location: null,
      sha256: null,
      entries: [],
      reason: null,
    };
  const location = locationOf(section);
  if (section.type === 8 || location === null || !inFile(section, bytes.length))
    return {
      status: "malformed",
      layout,
      entry_bytes: entryBytes,
      location: null,
      sha256: null,
      entries: [],
      reason: "versions_section_not_file_backed",
    };
  const stored = bytes.subarray(
    location.offset,
    location.offset + location.bytes,
  );
  if (section.compressed)
    return {
      status: "unsupported",
      layout,
      entry_bytes: entryBytes,
      location,
      sha256: sha256(stored),
      entries: [],
      reason: "versions_section_compressed",
    };
  if (stored.length % entryBytes !== 0)
    return {
      status: "malformed",
      layout,
      entry_bytes: entryBytes,
      location,
      sha256: sha256(stored),
      entries: [],
      reason: "versions_size_not_multiple",
    };
  const nameBytes = bits === 64 ? 56 : 60;
  const crcBytes = bits === 64 ? 8 : 4;
  const count = stored.length / entryBytes;
  exceeds(examined.count + count, maxEntries);
  const entries: NonNullable<Report["versions"]>["entries"] = [];
  for (let index = 0; index < count; index += 1) {
    const start = index * entryBytes;
    const record = stored.subarray(start, start + entryBytes);
    const crc =
      bits === 64
        ? little
          ? record.readBigUInt64LE(0)
          : record.readBigUInt64BE(0)
        : BigInt(little ? record.readUInt32LE(0) : record.readUInt32BE(0));
    const nameField = record.subarray(crcBytes, crcBytes + nameBytes);
    const end = nameField.indexOf(0);
    entries.push({
      index,
      location: { offset: location.offset + start, bytes: entryBytes },
      crc_hex: crc.toString(16).padStart(crcBytes * 2, "0"),
      name: end < 0 ? null : nameField.subarray(0, end).toString("latin1"),
      status: end < 0 ? "malformed" : "observed",
      reason: end < 0 ? "version_name_unterminated" : null,
    });
  }
  examined.count += count;
  return {
    status: "present",
    layout,
    entry_bytes: entryBytes,
    location,
    sha256: sha256(stored),
    entries,
    reason: null,
  };
};

const presence = (
  section: ElfSection | undefined,
  namesComplete: boolean,
  fileLength: number,
): {
  readonly status: "present" | "absent" | "unknown" | "unsupported";
  readonly location: { offset: number; bytes: number } | null;
} => {
  if (section === undefined)
    return { status: namesComplete ? "absent" : "unknown", location: null };
  if (section.type === 8 || !inFile(section, fileLength))
    return { status: "present", location: null };
  const location = locationOf(section);
  if (section.compressed) return { status: "unsupported", location };
  return { status: "present", location };
};

const sized = (
  bytes: Buffer,
  section: ElfSection | undefined,
  namesComplete: boolean,
  limitations: Limitations,
  label: string,
): Report["init_text"] => {
  if (section === undefined)
    return {
      status: namesComplete ? "absent" : "unknown",
      location: null,
      bytes: null,
      compressed: null,
    };
  if (!inFile(section, bytes.length) || section.type === 8) {
    limitations.push(
      `${label} is declared but not file-backed, so its size is unknown.`,
    );
    return {
      status: "present",
      location: null,
      bytes: null,
      compressed: null,
    };
  }
  const location = locationOf(section);
  if (section.compressed)
    limitations.push(
      `${label} is stored compressed. The reported size is the file-backed storage size; the decoded size is unknown.`,
    );
  return {
    status: "present",
    location,
    bytes: location?.bytes ?? null,
    compressed: section.compressed,
  };
};

const parseSignature = (bytes: Buffer): Report["signature"] => {
  if (
    bytes.length < MAGIC.length ||
    !bytes.subarray(bytes.length - MAGIC.length).equals(MAGIC)
  )
    return {
      status: "absent",
      magic: null,
      info: null,
      pkcs7: null,
      reason: null,
    };
  const magic = {
    offset: bytes.length - MAGIC.length,
    bytes: MAGIC.length,
  };
  if (magic.offset < MODULE_SIGNATURE_INFO_BYTES)
    return {
      status: "malformed",
      magic,
      info: null,
      pkcs7: null,
      reason: "signature_trailer_truncated",
    };
  const infoOffset = magic.offset - MODULE_SIGNATURE_INFO_BYTES;
  const info = {
    location: { offset: infoOffset, bytes: MODULE_SIGNATURE_INFO_BYTES },
    algo: bytes[infoOffset] ?? 0,
    hash: bytes[infoOffset + 1] ?? 0,
    id_type: bytes[infoOffset + 2] ?? 0,
    signer_len: bytes[infoOffset + 3] ?? 0,
    key_id_len: bytes[infoOffset + 4] ?? 0,
    pad: [
      bytes[infoOffset + 5] ?? 0,
      bytes[infoOffset + 6] ?? 0,
      bytes[infoOffset + 7] ?? 0,
    ] as [number, number, number],
    sig_len: bytes.readUInt32BE(infoOffset + 8),
  };
  if (info.sig_len >= infoOffset)
    return {
      status: "malformed",
      magic,
      info,
      pkcs7: null,
      reason: "signature_length_inconsistent",
    };
  if (info.id_type !== MODULE_SIGNATURE_PKCS7_ID_TYPE)
    return {
      status: "unsupported",
      magic,
      info,
      pkcs7: null,
      reason: "signature_id_type_not_pkcs7",
    };
  const parametersNonzero =
    info.algo !== 0 ||
    info.hash !== 0 ||
    info.signer_len !== 0 ||
    info.key_id_len !== 0 ||
    info.pad.some((value) => value !== 0);
  if (parametersNonzero)
    return {
      status: "malformed",
      magic,
      info,
      pkcs7: null,
      reason: "signature_parameters_nonzero",
    };
  const pkcs7 = bytes.subarray(infoOffset - info.sig_len, infoOffset);
  return {
    status: "present",
    magic,
    info,
    pkcs7: {
      location: { offset: infoOffset - info.sig_len, bytes: info.sig_len },
      sha256: sha256(pkcs7),
    },
    reason: null,
  };
};

const signatureLimitation = (signature: Report["signature"]): string => {
  if (signature?.status === "absent")
    return "No '~Module signature appended~' trailer was present. That is not proof the module is unsigned in another container.";
  if (signature?.status === "present")
    return "PKCS#7 bytes are identified by the module_signature trailer and hashed. Certificate chain, signer, and digest coverage are unobserved.";
  return "The appended signature trailer was not accepted as an unvalidated PKCS#7 range.";
};

/** Decode kernel-module metadata from one in-memory ET_REL image. */
export const parseKernelModule = (
  bytes: Buffer,
  artifact: Report["artifact"],
  input: InspectKernelModuleInput,
): Report => {
  const compression = compressionCodec(bytes);
  if (compression !== null)
    return unsupportedCompression(artifact, compression);
  const image = readElfImage(bytes);
  const facts = headerFacts(image);
  if (facts.type !== 1) return notApplicable(artifact, facts);
  const sections = image.sections.filter(
    (section): section is ElfSection => section.format === "elf",
  );
  const namesComplete =
    image.section_names_limitation === undefined &&
    sections.every((section) => section.name !== null);
  const limitations = baseLimitations();
  if (image.section_names_limitation !== undefined)
    limitations.push(image.section_names_limitation);
  const use = { namesComplete, limitations };
  const examined = { count: 0 };
  const noteDuplicates = (name: string, found: readonly ElfSection[]): void => {
    if (found.length > 1)
      limitations.push(
        `Multiple ${name} sections are declared; the first is examined.`,
      );
  };
  const modinfoSections = sectionsNamed(sections, ".modinfo");
  const versionSections = sectionsNamed(sections, "__versions");
  const moduleSections = sectionsNamed(sections, ".gnu.linkonce.this_module");
  noteDuplicates(".modinfo", modinfoSections);
  noteDuplicates("__versions", versionSections);
  noteDuplicates(".gnu.linkonce.this_module", moduleSections);
  const modinfo = parseModinfo(
    bytes,
    modinfoSections[0],
    use,
    examined,
    input.max_entries,
  );
  const versions = parseVersions(
    bytes,
    versionSections[0],
    image.bits,
    image.byte_order === "little",
    use,
    examined,
    input.max_entries,
  );
  const modulePresence = presence(
    moduleSections[0],
    namesComplete,
    bytes.length,
  );
  const ksymtabNamed = sections.filter(
    (section) => section.name?.startsWith("__ksymtab") === true,
  );
  const ksymtabSections = ksymtabNamed.filter(
    (section) => section.type !== 8 && inFile(section, bytes.length),
  );
  const unbacked = ksymtabNamed.length - ksymtabSections.length;
  if (unbacked > 0)
    limitations.push(
      `${String(unbacked)} __ksymtab* section(s) are declared but not file-backed, so their ranges are unknown.`,
    );
  const ksymtab = ksymtabSections.flatMap((section) => {
    const location = locationOf(section);
    if (section.name === null || location === null) return [];
    const fitsName =
      section.name.length <= MAX_KERNEL_MODULE_SECTION_NAME_BYTES;
    return [
      {
        name: fitsName ? section.name : null,
        location,
        compressed: section.compressed,
        reason: fitsName ? null : ("ksymtab_name_exceeds_limit" as const),
      },
    ];
  });
  // Each listed section repeats its name, so the list shares the entry budget.
  examined.count += ksymtab.length;
  exceeds(examined.count, input.max_entries);
  if (!namesComplete)
    limitations.push(
      "Section names are incomplete, so a missing .modinfo, __versions, this_module, __ksymtab, .init.text, or .exit.text section is unknown rather than absent.",
    );
  const signature = parseSignature(bytes);
  if (modinfo?.status === "absent")
    limitations.push("No .modinfo section was declared.");
  if (versions?.status === "absent")
    limitations.push("No __versions section was declared.");
  limitations.push(signatureLimitation(signature));
  return {
    artifact,
    ...facts,
    applicability: "applicable",
    compression: null,
    next_probe: null,
    modinfo,
    versions,
    this_module: {
      status: modulePresence.status,
      location: modulePresence.location,
      layout: "unknown",
    },
    ksymtab: {
      status: namesComplete ? "observed" : "unknown",
      sections: ksymtab,
    },
    init_text: sized(
      bytes,
      sectionsNamed(sections, ".init.text")[0],
      namesComplete,
      limitations,
      ".init.text",
    ),
    exit_text: sized(
      bytes,
      sectionsNamed(sections, ".exit.text")[0],
      namesComplete,
      limitations,
      ".exit.text",
    ),
    signature,
    coverage: { status: "complete", examined_entries: examined.count },
    limitations,
  };
};
