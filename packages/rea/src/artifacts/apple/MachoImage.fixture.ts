/** Little-endian Mach-O images and FAT containers built field by field for tests. */

export const LC = {
  LOAD_DYLIB: 0xc,
  ID_DYLIB: 0xd,
  LOAD_WEAK_DYLIB: 0x80000018,
  REEXPORT_DYLIB: 0x8000001f,
  LAZY_LOAD_DYLIB: 0x20,
  LOAD_UPWARD_DYLIB: 0x80000023,
  RPATH: 0x8000001c,
  DYLD_ENVIRONMENT: 0x27,
  CODE_SIGNATURE: 0x1d,
  BUILD_VERSION: 0x32,
  VERSION_MIN_MACOSX: 0x24,
  VERSION_MIN_IPHONEOS: 0x25,
  VERSION_MIN_TVOS: 0x2f,
  VERSION_MIN_WATCHOS: 0x30,
} as const;

export const CPU = {
  i386: { type: 7, subtype: 3 },
  arm64: { type: 0x0100000c, subtype: 0 },
  arm64e: { type: 0x0100000c, subtype: 0x80000002 },
  arm64eX1: { type: 0x0100000c, subtype: 0x8000000c },
  x86_64: { type: 0x01000007, subtype: 3 },
} as const;

export const FILE_TYPE = { execute: 2, dylib: 6, bundle: 8 } as const;

const encoder = new TextEncoder();

/** One load command with a NUL-terminated string at `nameOffset`, padded to 8 bytes. */
const commandWithString = (
  command: number,
  fields: readonly number[],
  text: string,
): Uint8Array => {
  const nameOffset = 8 + fields.length * 4 + 4;
  const name = encoder.encode(text);
  const size = Math.ceil((nameOffset + name.length + 1) / 8) * 8;
  const bytes = new Uint8Array(size);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, command, true);
  view.setUint32(4, size, true);
  view.setUint32(8, nameOffset, true);
  fields.forEach((value, index) => view.setUint32(12 + index * 4, value, true));
  bytes.set(name, nameOffset);
  return bytes;
};

/** Classic `dylib_command`: timestamp, current and compatibility versions. */
export const dylibCommand = (
  command: number,
  name: string,
  versions: { readonly current?: number; readonly compatibility?: number } = {},
): Uint8Array =>
  commandWithString(
    command,
    [2, versions.current ?? 0x10000, versions.compatibility ?? 0x10000],
    name,
  );

/** `dylib_use_command`: marker, versions and `DYLIB_USE_*` flags. */
export const dylibUseCommand = (
  command: number,
  name: string,
  flags: number,
): Uint8Array =>
  commandWithString(command, [0x1a741800, 0x10000, 0x10000, flags], name);

export const rpathCommand = (path: string): Uint8Array =>
  commandWithString(LC.RPATH, [], path);

export const dyldEnvironmentCommand = (value: string): Uint8Array =>
  commandWithString(LC.DYLD_ENVIRONMENT, [], value);

export const codeSignatureCommand = (): Uint8Array => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LC.CODE_SIGNATURE, true);
  view.setUint32(4, 16, true);
  return bytes;
};

/** `build_version_command` carrying the producer's raw platform number. */
export const buildVersionCommand = (platform: number): Uint8Array => {
  const bytes = new Uint8Array(24);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, LC.BUILD_VERSION, true);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, platform, true);
  return bytes;
};

/** `version_min_command` carrying `LC_VERSION_MIN_*` semantics. */
export const versionMinCommand = (command: number): Uint8Array => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, command, true);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, 0x00090000, true);
  return bytes;
};

/** A 64-bit (or 32-bit) little-endian Mach-O image made of the given commands. */
export const machoImage = (options: {
  readonly cpu?: { readonly type: number; readonly subtype: number };
  readonly fileType?: number;
  readonly commands?: readonly Uint8Array[];
  readonly wide?: boolean;
}): Uint8Array => {
  const wide = options.wide ?? true;
  const commands = options.commands ?? [];
  const headerSize = wide ? 32 : 28;
  const commandBytes = commands.reduce((total, item) => total + item.length, 0);
  const bytes = new Uint8Array(headerSize + commandBytes + 16);
  const view = new DataView(bytes.buffer);
  const cpu = options.cpu ?? CPU.arm64;
  view.setUint32(0, wide ? 0xfeedfacf : 0xfeedface, true);
  view.setUint32(4, cpu.type, true);
  view.setUint32(8, cpu.subtype, true);
  view.setUint32(12, options.fileType ?? FILE_TYPE.execute, true);
  view.setUint32(16, commands.length, true);
  view.setUint32(20, commandBytes, true);
  let offset = headerSize;
  for (const command of commands) {
    bytes.set(command, offset);
    offset += command.length;
  }
  return bytes;
};

/**
 * Little-endian `LC_LAZY_LOAD_DYLIB_INFO` (0x3a) payload.
 * The 24-byte header is load-path offset, flag image offset, flags,
 * pointer format, chain-start image offset, symbol count, and the
 * symbol-offset array offset. Strings are NUL-terminated and the payload
 * is padded to 8 bytes, matching a one-symbol `@rpath/libl.dylib` payload
 * of 56 bytes.
 */
export const lazyLoadDylibInfoPayload = (options: {
  readonly path: string;
  readonly symbols?: readonly string[];
  readonly flags?: number;
  readonly flagImageOffset?: number;
  readonly chainStartImageOffset?: number;
}): Uint8Array => {
  const symbols = options.symbols ?? [];
  const headerSize = 24;
  const pathBytes = encoder.encode(options.path);
  const symbolBytes = symbols.map((symbol) => encoder.encode(symbol));
  const symbolArrayOffset = headerSize;
  const pathOffset = symbolArrayOffset + symbols.length * 4;
  let cursor = pathOffset + pathBytes.length + 1;
  const symbolOffsets = symbolBytes.map((bytes) => {
    const offset = cursor;
    cursor += bytes.length + 1;
    return offset;
  });
  const payload = new Uint8Array(Math.ceil(cursor / 8) * 8);
  const view = new DataView(payload.buffer);
  view.setUint32(0, pathOffset, true);
  view.setUint32(4, options.flagImageOffset ?? 0, true);
  view.setUint16(8, options.flags ?? 0, true);
  view.setUint32(12, options.chainStartImageOffset ?? 0, true);
  view.setUint32(16, symbols.length, true);
  view.setUint32(20, symbolArrayOffset, true);
  symbolOffsets.forEach((offset, index) =>
    view.setUint32(symbolArrayOffset + index * 4, offset, true),
  );
  payload.set(pathBytes, pathOffset);
  symbolBytes.forEach((bytes, index) => {
    const offset = symbolOffsets[index];
    if (offset !== undefined) payload.set(bytes, offset);
  });
  return payload;
};

/**
 * Place one `LC_LAZY_LOAD_DYLIB_INFO` command among the other commands and
 * append its payload after the image. `dataoff` is relative to this slice.
 */
/** `LC_SEGMENT` or `LC_SEGMENT_64` with a name and VM range, and no sections. */
export const segmentCommand = (options: {
  readonly name: string;
  readonly vmaddr: bigint;
  readonly vmsize: bigint;
  readonly wide?: boolean;
}): Uint8Array => {
  const wide = options.wide ?? true;
  const bytes = new Uint8Array(wide ? 72 : 56);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, wide ? 0x19 : 0x1, true);
  view.setUint32(4, bytes.length, true);
  bytes.set(encoder.encode(options.name).subarray(0, 16), 8);
  if (wide) {
    view.setBigUint64(24, options.vmaddr, true);
    view.setBigUint64(32, options.vmsize, true);
  } else {
    view.setUint32(24, Number(options.vmaddr), true);
    view.setUint32(28, Number(options.vmsize), true);
  }
  return bytes;
};

/** 16-byte `LC_LAZY_LOAD_DYLIB_INFO` pointing at a slice-relative payload. */
export const lazyLoadDylibInfoCommand = (
  dataOffset: number,
  dataSize: number,
): Uint8Array => {
  const bytes = new Uint8Array(16);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, 0x3a, true);
  view.setUint32(4, bytes.length, true);
  view.setUint32(8, dataOffset, true);
  view.setUint32(12, dataSize, true);
  return bytes;
};

export const machoImageWithLazyLoadDylibInfo = (options: {
  readonly path: string;
  readonly symbols?: readonly string[];
  readonly flags?: number;
  readonly flagImageOffset?: number;
  readonly chainStartImageOffset?: number;
  readonly cpu?: { readonly type: number; readonly subtype: number };
  readonly fileType?: number;
  readonly wide?: boolean;
  readonly commandsBefore?: readonly Uint8Array[];
  readonly commandsAfter?: readonly Uint8Array[];
}): Uint8Array => {
  const payload = lazyLoadDylibInfoPayload(options);
  const command = new Uint8Array(16);
  const commandView = new DataView(command.buffer);
  commandView.setUint32(0, 0x3a, true);
  commandView.setUint32(4, command.length, true);
  const wide = options.wide ?? true;
  const commandsBefore = options.commandsBefore ?? [];
  const image = machoImage({
    ...(options.cpu === undefined ? {} : { cpu: options.cpu }),
    ...(options.fileType === undefined ? {} : { fileType: options.fileType }),
    wide,
    commands: [...commandsBefore, command, ...(options.commandsAfter ?? [])],
  });
  const out = new Uint8Array(image.length + payload.length);
  out.set(image);
  out.set(payload, image.length);
  const headerSize = wide ? 32 : 28;
  const commandAt =
    headerSize + commandsBefore.reduce((total, item) => total + item.length, 0);
  const view = new DataView(out.buffer);
  view.setUint32(commandAt + 8, image.length, true);
  view.setUint32(commandAt + 12, payload.length, true);
  return out;
};

/** Thin Mach-O with one unknown command, for width and command-size regressions. */
export const machoImageWithUnknownCommand = (
  wide: boolean,
  commandSize: number,
): Uint8Array => {
  const command = new Uint8Array(commandSize);
  const view = new DataView(command.buffer);
  view.setUint32(0, 0x7f000001, true);
  view.setUint32(4, commandSize, true);
  return machoImage({
    cpu: wide ? CPU.arm64 : CPU.i386,
    wide,
    commands: [command],
  });
};

/**
 * A FAT container whose slices start on 4 KiB boundaries. Headers are
 * big-endian unless `littleEndian` selects the swapped FAT_CIGAM magics.
 */
export const fatImage = (
  slices: readonly {
    readonly cpu: { readonly type: number; readonly subtype: number };
    readonly bytes: Uint8Array;
  }[],
  wide = false,
  littleEndian = false,
): Uint8Array => {
  const entrySize = wide ? 32 : 20;
  const offsets: number[] = [];
  let end = 4096;
  for (const slice of slices) {
    offsets.push(end);
    end += Math.ceil(slice.bytes.length / 4096) * 4096;
  }
  const bytes = new Uint8Array(end);
  const view = new DataView(bytes.buffer);
  view.setUint32(0, wide ? 0xcafebabf : 0xcafebabe, littleEndian);
  view.setUint32(4, slices.length, littleEndian);
  slices.forEach((slice, index) => {
    const base = 8 + index * entrySize;
    const offset = offsets[index] ?? 0;
    view.setUint32(base, slice.cpu.type, littleEndian);
    view.setUint32(base + 4, slice.cpu.subtype, littleEndian);
    if (wide) {
      view.setBigUint64(base + 8, BigInt(offset), littleEndian);
      view.setBigUint64(base + 16, BigInt(slice.bytes.length), littleEndian);
      view.setUint32(base + 24, 12, littleEndian);
    } else {
      view.setUint32(base + 8, offset, littleEndian);
      view.setUint32(base + 12, slice.bytes.length, littleEndian);
      view.setUint32(base + 16, 12, littleEndian);
    }
    bytes.set(slice.bytes, offset);
  });
  return bytes;
};

/** A minimal BSD ar archive containing one inert member for container tests. */
export const arArchive = (memberName = "fixture.o"): Uint8Array => {
  const name = `${memberName}/`.slice(0, 16).padEnd(16, " ");
  const header = [
    name,
    "0           ",
    "0     ",
    "0     ",
    "100644  ",
    "1         ",
    "`\n",
  ].join("");
  const bytes = new Uint8Array(8 + 60 + 2);
  bytes.set(encoder.encode("!<arch>\n"), 0);
  bytes.set(encoder.encode(header), 8);
  bytes[68] = 0x78;
  return bytes;
};

/** In-memory `ReadAt` over one buffer. */
export const readerOf =
  (bytes: Uint8Array) =>
  (offset: number, length: number): Promise<Uint8Array> =>
    Promise.resolve(bytes.subarray(offset, offset + length));
