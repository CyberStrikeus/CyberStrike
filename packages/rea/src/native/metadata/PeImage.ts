import { readPeCoffHeader } from "../../domain/peCoffHeader.js";
import { readPeOptionalHeader } from "../../domain/peMachine.js";
import { readPeSectionHeader } from "../../domain/peSectionHeader.js";
import {
  mzWindowsHeaderLayoutLimitation,
  parseMzHeaderEvidence,
} from "../../domain/dosMz.js";
import {
  declaredFileRange,
  BinaryFormatFailure,
  BinaryReader,
  type BinaryContainer,
  type FileMapping,
  type ImageSection,
  type ZeroFillMapping,
} from "./BinaryContainer.js";

const peHeaderOffset = (reader: BinaryReader): number => {
  const evidence = parseMzHeaderEvidence(reader.bytes);
  if (!evidence.declarations.ok)
    throw new BinaryFormatFailure("malformed", evidence.declarations.error);
  const { windowsHeader } = evidence;
  if (windowsHeader.state === "candidate")
    throw new BinaryFormatFailure(
      "unsupported",
      "MZ Windows new-header candidate is unresolved",
    );
  if (windowsHeader.state !== "declared") {
    const dos = evidence.dos;
    if (!dos.ok) throw new BinaryFormatFailure("malformed", dos.error);
    throw new BinaryFormatFailure(
      "unsupported",
      "DOS MZ images are outside the supported ELF, PE and thin Mach-O formats",
    );
  }
  const { offset: pe } = windowsHeader;
  const limitation = mzWindowsHeaderLayoutLimitation(windowsHeader);
  if (limitation !== undefined)
    throw new BinaryFormatFailure("unsupported", limitation);
  if (["NE", "LE", "LX"].includes(windowsHeader.signature))
    throw new BinaryFormatFailure(
      "unsupported",
      `${windowsHeader.signature} images are outside the supported ELF, PE and thin Mach-O formats`,
    );
  if (windowsHeader.signature !== "PE")
    throw new BinaryFormatFailure(
      "malformed",
      "PE signature is invalid or overlaps the DOS header",
    );
  reader.range(pe, 24, "PE signature and COFF header");
  return pe;
};

/** Declared PE fields retained by their parsing owner for format consumers. */
export type PeImageSection = Extract<
  ImageSection,
  { readonly format: "pe" }
> & {
  readonly raw_offset: number;
};

export type PeImage = BinaryContainer & {
  readonly format: "pe";
  readonly image_base: bigint;
  readonly pe_machine: number;
  readonly pe_section_alignment: number;
  readonly pe_file_alignment: number;
  readonly pe_header_mapping: FileMapping;
  readonly pe_data_directories: NonNullable<
    BinaryContainer["pe_data_directories"]
  >;
  readonly sections: readonly PeImageSection[];
};

/** Read PE32/PE32+ native image mappings and section facts. */
export const readPeImage = (bytes: Buffer): PeImage => {
  const reader = new BinaryReader(bytes, true);
  const pe = peHeaderOffset(reader);
  const optional = pe + 24;
  const coff = readPeCoffHeader(bytes.subarray(pe + 4, pe + 24));
  if (!coff.ok)
    throw new BinaryFormatFailure(coff.error.kind, coff.error.message);
  const {
    machine,
    sectionCount: count,
    optionalHeaderSize: optionalSize,
  } = coff.value;
  const facts = readPeOptionalHeader(
    reader.range(optional, optionalSize, "PE optional header"),
    machine,
  );
  if (!facts.ok)
    throw new BinaryFormatFailure(facts.error.kind, facts.error.message);
  const {
    bits,
    dataDirectories,
    sizeOfHeaders,
    imageBase,
    sectionAlignment,
    fileAlignment,
  } = facts.value;
  const headerMapping: FileMapping = {
    address: imageBase,
    offset: 0,
    size: Math.min(sizeOfHeaders, bytes.length),
  };
  const start = reader.table(
    BigInt(optional + optionalSize),
    count,
    40,
    "PE sections",
  );
  const mappings: FileMapping[] = [];
  const executableMappings: FileMapping[] = [];
  const zeroFills: ZeroFillMapping[] = [];
  const sections: PeImageSection[] = [];
  for (let index = 0; index < count; index++) {
    const entry = start + index * 40;
    const section = readPeSectionHeader(
      reader.range(entry, 40, "PE section header"),
    );
    if (!section.ok)
      throw new BinaryFormatFailure(section.error.kind, section.error.message);
    const {
      name: sectionName,
      virtual_size: virtualSize,
      virtual_address: virtualAddress,
      raw_size: size,
      offset,
      characteristics,
      size: contentSize,
    } = section.value;
    sections.push(
      peImageSection({
        reader,
        name: sectionName,
        size: contentSize,
        offset,
        characteristics,
        virtualAddress,
        virtualSize,
        rawSize: size,
        fileAlignment,
      }),
    );
    const address = imageBase + BigInt(virtualAddress);
    if (address + BigInt(Math.max(size, virtualSize)) > 1n << BigInt(bits))
      throw new BinaryFormatFailure(
        "malformed",
        "PE section virtual address overflows its address width",
      );
    const mapping = {
      ...(size === 0
        ? { offset: 0, size: 0 }
        : reader.fileRange(BigInt(offset), BigInt(size), "PE section")),
      address,
    };
    if (size !== 0) {
      mappings.push(mapping);
      if ((characteristics & 0x20000000) !== 0)
        executableMappings.push({ ...mapping, size: contentSize });
    }
    if (virtualSize > size)
      zeroFills.push({
        address: address + BigInt(size),
        size: BigInt(virtualSize - size),
      });
  }
  const architecture = facts.value.machine?.architecture;
  return {
    format: "pe",
    image_base: imageBase,
    pe_machine: machine,
    pe_section_alignment: sectionAlignment,
    pe_file_alignment: fileAlignment,
    pe_data_directories: dataDirectories,
    pe_header_mapping: headerMapping,
    architecture:
      architecture === "x86"
        ? "386"
        : architecture === "x86_64"
          ? "amd64"
          : (architecture ?? `pe-machine-${machine}`),
    bits,
    byte_order: "little",
    mappings,
    executable_mappings: executableMappings,
    zero_fills: zeroFills,
    sections,
  };
};

const peImageSection = ({
  reader,
  name,
  size,
  offset,
  characteristics,
  virtualAddress,
  virtualSize,
  rawSize,
  fileAlignment,
}: {
  readonly reader: BinaryReader;
  readonly name: string;
  readonly size: number;
  readonly offset: number;
  readonly characteristics: number;
  readonly virtualAddress: number;
  readonly virtualSize: number;
  readonly rawSize: number;
  readonly fileAlignment: number;
}): PeImageSection => {
  const range = declaredFileRange(
    reader.bytes.length,
    BigInt(offset),
    BigInt(size),
  );
  const readOnly =
    range.file_backed &&
    (characteristics & 0x40000000) !== 0 &&
    (characteristics & 0x80000000) === 0 &&
    (characteristics & 0x20000000) === 0 &&
    (characteristics & 0x40) !== 0;
  return {
    format: "pe",
    name,
    virtual_address: virtualAddress,
    virtual_size: virtualSize,
    raw_size: rawSize,
    raw_offset: offset,
    file_alignment: fileAlignment,
    characteristics,
    ...range,
    read_only: readOnly,
    compressed: false,
  };
};
