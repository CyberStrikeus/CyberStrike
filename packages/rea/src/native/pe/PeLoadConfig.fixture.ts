import { loadConfigFieldLayout } from "../../domain/native/peLoadConfig.js";

/** Authored fixture directory sizes through GuardMemcpyFunctionPointer. */
const LOAD_CONFIG_KNOWN_STRUCT_BYTES = { 32: 192, 64: 320 } as const;

/** File and RVA layout shared by the synthetic PE32 and PE32+ images. */
export const PE_LOAD_CONFIG_FIXTURE = {
  dataRva: 0x1000,
  dataFile: 0x600,
  dataBytes: 0x1000,
  textRva: 0x2000,
  textFile: 0x1600,
  textBytes: 0x200,
  tlsRva: 0x1000,
  loadConfigRva: 0x1040,
  callbackArrayRva: 0x1200,
  indexRva: 0x1300,
  cookieRva: 0x1310,
  sehTableRva: 0x1320,
  cfTableRva: 0x1330,
  iatTableRva: 0x1340,
  longjmpTableRva: 0x1350,
  ehTableRva: 0x1360,
  rawDataRva: 0x1400,
  rawDataSize: 0x80,
  cfCheckRva: 0x2040,
  cfDispatchRva: 0x2050,
  xfgRva: 0x2060,
  outsideRva: 0x9000,
  zeroFillRva: 0x2200,
  callbackRvas: [0x2000, 0x2010, 0x9000],
  chpe: 0x33333333,
  dynamicReloc: 0x22222222,
  dynamicRelocOffset: 0x40,
  dynamicRelocSection: 1,
  guardFlags: 0x500,
  sehCount: 2,
  ignoredSeh: 0x44444444,
  cfCount: 3,
  iatCount: 1,
  longjmpCount: 0,
  ehCount: 1,
  zeroFill: 0x20,
  characteristics: 4 << 20,
} as const;

const FILE_BYTES =
  PE_LOAD_CONFIG_FIXTURE.textFile + PE_LOAD_CONFIG_FIXTURE.textBytes;

export type PeLoadConfigFixtureMalformed =
  | "tls-unmapped"
  | "tls-truncated"
  | "tls-half"
  | "load-config-oversize"
  | "load-config-truncated"
  | "load-config-half"
  | "raw-data-inverted"
  | "callback-unterminated"
  | "ambiguous-section";

export interface PeLoadConfigFixtureOptions {
  readonly bits?: 32 | 64;
  readonly tls?: boolean;
  readonly loadConfig?: boolean;
  /** Declared IMAGE_LOAD_CONFIG_DIRECTORY.Size. Defaults to the known struct. */
  readonly loadConfigSize?: number;
  /** Data-directory size. Defaults to Size; x86 images may declare less. */
  readonly loadConfigDirectorySize?: number;
  readonly callbacks?: "present" | "empty" | "absent";
  /** In-section callbacks when `callbacks` is present. Defaults to the rich trio. */
  readonly callbackCount?: number;
  readonly zeroFillCallback?: boolean;
  readonly securityCookie?: "mapped" | "zero";
  readonly directoryCount?: number;
  readonly malformed?: PeLoadConfigFixtureMalformed;
}

const imageBaseFor = (bits: 32 | 64): bigint =>
  bits === 64 ? 0x180000000n : 0x10000000n;

/** Synthetic PE32/PE32+ image with a TLS directory and a sized load config. */
export const peLoadConfigImage = (
  options: PeLoadConfigFixtureOptions = {},
): Buffer => {
  const bits = options.bits ?? 64;
  const wide = bits === 64;
  const layout = PE_LOAD_CONFIG_FIXTURE;
  const bytes = Buffer.alloc(FILE_BYTES);
  const base = imageBaseFor(bits);
  const pointerWidth = wide ? 8 : 4;
  const directoriesAt = wide ? 112 : 96;
  const directoryCount = options.directoryCount ?? 16;
  const optionalSize = directoriesAt + 16 * 8;
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 60);
  bytes.write("PE\0\0", 128, "ascii");
  bytes.writeUInt16LE(wide ? 0x8664 : 0x14c, 132);
  bytes.writeUInt16LE(2, 134);
  bytes.writeUInt16LE(optionalSize, 148);
  const optional = 152;
  bytes.writeUInt16LE(wide ? 0x20b : 0x10b, optional);
  if (wide) bytes.writeBigUInt64LE(base, optional + 24);
  else bytes.writeUInt32LE(Number(base), optional + 28);
  bytes.writeUInt32LE(0x1000, optional + 32);
  bytes.writeUInt32LE(0x200, optional + 36);
  bytes.writeUInt32LE(layout.dataFile, optional + 60);
  bytes.writeUInt32LE(directoryCount, optional + directoriesAt - 4);
  const section = optional + optionalSize;
  const textVirtual = options.zeroFillCallback ? 0x400 : layout.textBytes;
  writeSection(bytes, section, ".data", {
    virtualSize: layout.dataBytes,
    virtualAddress: layout.dataRva,
    rawSize: layout.dataBytes,
    rawOffset: layout.dataFile,
    characteristics: 0xc0000040,
  });
  writeSection(bytes, section + 40, ".text", {
    virtualSize: textVirtual,
    virtualAddress:
      options.malformed === "ambiguous-section"
        ? layout.dataRva
        : layout.textRva,
    rawSize: layout.textBytes,
    rawOffset: layout.textFile,
    characteristics: 0x60000020,
  });

  const at = (rva: number): number => rva - layout.dataRva + layout.dataFile;
  const writeVa = (fileOffset: number, va: bigint): void => {
    if (wide) bytes.writeBigUInt64LE(va, fileOffset);
    else bytes.writeUInt32LE(Number(va), fileOffset);
  };
  const vaOf = (rva: number): bigint => base + BigInt(rva);

  if (options.tls !== false) {
    const tlsSize = options.malformed === "tls-truncated" ? 8 : wide ? 40 : 24;
    const tlsRva =
      options.malformed === "tls-unmapped" ? 0xffff0000 : layout.tlsRva;
    const tlsDirectorySize = tlsSize;
    const tlsDirectoryRva = options.malformed === "tls-half" ? 0 : tlsRva;
    if (
      options.malformed !== "tls-unmapped" &&
      options.malformed !== "tls-half"
    ) {
      const tlsAt = at(layout.tlsRva);
      const rawStart =
        options.malformed === "raw-data-inverted"
          ? layout.rawDataRva + layout.rawDataSize
          : layout.rawDataRva;
      const rawEnd =
        options.malformed === "raw-data-inverted"
          ? layout.rawDataRva
          : layout.rawDataRva + layout.rawDataSize;
      writeVa(tlsAt, vaOf(rawStart));
      writeVa(tlsAt + pointerWidth, vaOf(rawEnd));
      writeVa(tlsAt + pointerWidth * 2, vaOf(layout.indexRva));
      const callbacks = options.callbacks ?? "present";
      let callbackVa = 0n;
      if (options.malformed === "callback-unterminated") {
        const slotRva = layout.textRva + layout.textBytes - pointerWidth;
        callbackVa = vaOf(slotRva);
        writeVa(
          layout.textFile + layout.textBytes - pointerWidth,
          vaOf(layout.textRva),
        );
      } else if (callbacks === "present" || options.zeroFillCallback === true) {
        const targets =
          options.zeroFillCallback === true
            ? [layout.zeroFillRva]
            : options.callbackCount === undefined
              ? [...layout.callbackRvas]
              : Array.from(
                  { length: options.callbackCount },
                  () => layout.textRva,
                );
        callbackVa = vaOf(layout.callbackArrayRva);
        targets.forEach((rva, index) => {
          writeVa(
            at(layout.callbackArrayRva) + index * pointerWidth,
            vaOf(rva),
          );
        });
      } else if (callbacks === "empty") {
        callbackVa = vaOf(layout.callbackArrayRva);
      }
      writeVa(tlsAt + pointerWidth * 3, callbackVa);
      bytes.writeUInt32LE(layout.zeroFill, tlsAt + pointerWidth * 4);
      bytes.writeUInt32LE(layout.characteristics, tlsAt + pointerWidth * 4 + 4);
      bytes[layout.textFile] = 0xc3;
      bytes[layout.textFile + 0x10] = 0xc3;
    }
    writeDirectory(
      bytes,
      optional + directoriesAt,
      9,
      tlsDirectoryRva,
      options.malformed === "tls-unmapped" ? 40 : tlsDirectorySize,
    );
  }

  writeLoadConfig(bytes, options, {
    bits,
    base,
    directories: optional + directoriesAt,
  });
  return bytes;
};

const writeSection = (
  bytes: Buffer,
  offset: number,
  name: string,
  section: {
    readonly virtualSize: number;
    readonly virtualAddress: number;
    readonly rawSize: number;
    readonly rawOffset: number;
    readonly characteristics: number;
  },
): void => {
  bytes.write(name, offset, "ascii");
  bytes.writeUInt32LE(section.virtualSize, offset + 8);
  bytes.writeUInt32LE(section.virtualAddress, offset + 12);
  bytes.writeUInt32LE(section.rawSize, offset + 16);
  bytes.writeUInt32LE(section.rawOffset, offset + 20);
  bytes.writeUInt32LE(section.characteristics, offset + 36);
};

const writeDirectory = (
  bytes: Buffer,
  directories: number,
  index: number,
  rva: number,
  size: number,
): void => {
  bytes.writeUInt32LE(rva, directories + index * 8);
  bytes.writeUInt32LE(size, directories + index * 8 + 4);
};

const writeLoadConfig = (
  bytes: Buffer,
  options: PeLoadConfigFixtureOptions,
  {
    bits,
    base,
    directories,
  }: { bits: 32 | 64; base: bigint; directories: number },
): void => {
  const wide = bits === 64;
  const layout = PE_LOAD_CONFIG_FIXTURE;
  const at = (rva: number): number => rva - layout.dataRva + layout.dataFile;
  const vaOf = (rva: number): bigint => base + BigInt(rva);
  if (options.loadConfig !== false) {
    const known = LOAD_CONFIG_KNOWN_STRUCT_BYTES[bits];
    const declaredSize =
      options.malformed === "load-config-oversize"
        ? 0x10000
        : (options.loadConfigSize ?? known);
    const directorySize =
      options.malformed === "load-config-oversize"
        ? 16
        : options.malformed === "load-config-truncated"
          ? 2
          : options.malformed === "load-config-half"
            ? 0
            : (options.loadConfigDirectorySize ?? declaredSize);
    const directoryRva = layout.loadConfigRva;
    if (directorySize >= 4 && options.malformed !== "load-config-half") {
      const configAt = at(layout.loadConfigRva);
      bytes.writeUInt32LE(declaredSize, configAt);
      const writeField = (
        name: Parameters<typeof loadConfigFieldLayout>[1],
        value: bigint,
      ): void => {
        const field = loadConfigFieldLayout(bits, name);
        const written = Math.max(directorySize, Math.min(declaredSize, known));
        if (field.offset + field.width > written) return;
        const atField = configAt + field.offset;
        if (field.width === 8) bytes.writeBigUInt64LE(value, atField);
        else if (field.width === 4) bytes.writeUInt32LE(Number(value), atField);
        else bytes.writeUInt16LE(Number(value), atField);
      };
      const cookie =
        options.securityCookie === "zero" ? 0n : vaOf(layout.cookieRva);
      writeField("security_cookie", cookie);
      writeField("se_handler_table", vaOf(layout.sehTableRva));
      writeField("se_handler_count", BigInt(layout.sehCount));
      if (wide) {
        writeField("se_handler_table", BigInt(layout.ignoredSeh));
        writeField("se_handler_count", 7n);
      }
      writeField("guard_cf_check_function_pointer", vaOf(layout.cfCheckRva));
      writeField(
        "guard_cf_dispatch_function_pointer",
        vaOf(layout.cfDispatchRva),
      );
      writeField("guard_cf_function_table", vaOf(layout.cfTableRva));
      writeField("guard_cf_function_count", BigInt(layout.cfCount));
      writeField("guard_flags", BigInt(layout.guardFlags));
      writeField(
        "guard_address_taken_iat_entry_table",
        vaOf(layout.iatTableRva),
      );
      writeField(
        "guard_address_taken_iat_entry_count",
        BigInt(layout.iatCount),
      );
      writeField("guard_long_jump_target_table", vaOf(layout.longjmpTableRva));
      writeField("guard_long_jump_target_count", BigInt(layout.longjmpCount));
      writeField("dynamic_value_reloc_table", BigInt(layout.dynamicReloc));
      writeField("chpe_metadata_pointer", BigInt(layout.chpe));
      writeField(
        "dynamic_value_reloc_table_offset",
        BigInt(layout.dynamicRelocOffset),
      );
      writeField(
        "dynamic_value_reloc_table_section",
        BigInt(layout.dynamicRelocSection),
      );
      writeField("guard_eh_continuation_table", vaOf(layout.ehTableRva));
      writeField("guard_eh_continuation_count", BigInt(layout.ehCount));
      writeField("guard_xfg_check_function_pointer", vaOf(layout.xfgRva));
    }
    writeDirectory(bytes, directories, 10, directoryRva, directorySize);
  }
};

/**
 * PE32+ image with `sectionCount` sections and `callbackCount` TLS callbacks.
 * `.data` holds the TLS directory and callback array; every other section is
 * virtual-only, and every callback targets the last one.
 */
export const peManySectionsImage = (
  sectionCount: number,
  callbackCount: number,
): Buffer => {
  const optional = 152;
  const optionalSize = 112 + 16 * 8;
  const table = optional + optionalSize;
  const headers = Math.ceil((table + sectionCount * 40) / 0x200) * 0x200;
  // Sections start past the header mapping so it cannot overlap `.data`.
  const dataRva = Math.ceil(headers / 0x1000) * 0x1000;
  const dataBytes =
    Math.ceil(((callbackCount + 1) * 8 + 0x100) / 0x200) * 0x200;
  const virtualRva = dataRva + Math.ceil(dataBytes / 0x1000) * 0x1000;
  const base = 0x180000000n;
  const bytes = Buffer.alloc(headers + dataBytes);
  bytes.write("MZ", 0, "ascii");
  bytes.writeUInt32LE(128, 60);
  bytes.write("PE\0\0", 128, "ascii");
  bytes.writeUInt16LE(0x8664, 132);
  bytes.writeUInt16LE(sectionCount, 134);
  bytes.writeUInt16LE(optionalSize, 148);
  bytes.writeUInt16LE(0x20b, optional);
  bytes.writeBigUInt64LE(base, optional + 24);
  bytes.writeUInt32LE(0x1000, optional + 32);
  bytes.writeUInt32LE(0x200, optional + 36);
  bytes.writeUInt32LE(headers, optional + 60);
  bytes.writeUInt32LE(16, optional + 108);
  writeSection(bytes, table, ".data", {
    virtualSize: dataBytes,
    virtualAddress: dataRva,
    rawSize: dataBytes,
    rawOffset: headers,
    characteristics: 0xc0000040,
  });
  for (let index = 1; index < sectionCount; index++)
    writeSection(bytes, table + index * 40, ".v", {
      virtualSize: 0x1000,
      virtualAddress: virtualRva + (index - 1) * 0x1000,
      rawSize: 0,
      rawOffset: 0,
      characteristics: 0x60000020,
    });
  const target = base + BigInt(virtualRva + (sectionCount - 2) * 0x1000);
  const callbacksRva = dataRva + 0x100;
  bytes.writeBigUInt64LE(base + BigInt(callbacksRva), headers + 24);
  for (let index = 0; index < callbackCount; index++)
    bytes.writeBigUInt64LE(target, headers + 0x100 + index * 8);
  writeDirectory(bytes, optional + 112, 9, dataRva, 40);
  return bytes;
};
