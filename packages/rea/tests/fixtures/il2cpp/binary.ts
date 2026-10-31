/**
 * Synthetic thin arm64 Mach-O holding the IL2CPP registration tables for the
 * metadata fixture: image names, code-generation modules, their method
 * pointer arrays and the CodeRegistration module count and array pointer.
 */
export const FIXTURE_BINARY_BASE = 0x1_0000_0000n;

/** Method addresses by metadata method index; ToString has no body. */
export const FIXTURE_METHOD_ADDRESSES = [
  FIXTURE_BINARY_BASE + 0x200n,
  FIXTURE_BINARY_BASE + 0x210n,
  FIXTURE_BINARY_BASE + 0x220n,
  FIXTURE_BINARY_BASE + 0x230n,
  "no-body",
] as const;

export interface Il2cppBinaryFixtureOptions {
  /** methodPointerCount written for Assembly-CSharp.dll; 3 matches the metadata. */
  readonly firstModuleCount?: number;
  /** Exact module names, including names shared by different metadata images. */
  readonly imageNames?: readonly [string, string];
  /** Write a second record that also matches Assembly-CSharp.dll. */
  readonly duplicateModule?: boolean;
  /** Add an LC_DYLD_CHAINED_FIXUPS load command. */
  readonly chainedFixups?: boolean;
  /** Omit the CodeRegistration module count and array pointer. */
  readonly codeRegistration?: boolean;
  /** Write a second distinct CodeRegistration module count and array pair. */
  readonly duplicateCodeRegistration?: boolean;
  /** Write a RIP-relative `lea rax, [module array]`, as an inlined build loads it. */
  readonly codeReference?: boolean;
  /** Write `adrp x8, page; add x8, x8, #pageoff` at each file offset, loading the target offset. */
  readonly adrpAdd?: readonly (readonly [at: number, target: number])[];
  /** 4 KiB pages in the Mach-O image; extra pages are zero, past every table. */
  readonly pages?: number;
  /** Omit the MetadataRegistration type table. */
  readonly metadataRegistration?: boolean;
  /** Write a second distinct MetadataRegistration candidate. */
  readonly duplicateMetadataRegistration?: boolean;
  /** Byte written before each image name instead of NUL (MSVC pads with 0xFF). */
  readonly namePadding?: number;
  /** Text written directly before mscorlib.dll, making it the tail of a longer name. */
  readonly namePrefix?: string;
  /** Write generic method registration tables (see FIXTURE_GENERIC_INSTANCES). */
  readonly genericMethods?: GenericMethodFixtureOptions;
  /** Split the file into two adjacent segments at this file offset. */
  readonly splitSegmentAt?: number;
  /** TypeDefinitionIndex used by the fixture's generic instance. */
  readonly genericDefinitionTypeIndex?: number;
  /** Native type-table indices serialized in its generic argument vector. */
  readonly genericArgumentTypeIndices?: readonly number[];
}

export interface GenericMethodFixtureOptions {
  /** 16 writes the 27.1+ layout (genericAdjustorThunks); 12 the 27.0 layout. */
  readonly stride?: 12 | 16;
  /** Omit CodeRegistration's generic fields, leaving no layout to agree. */
  readonly codeRegistration?: boolean;
  /** methodIndex of row 0; 3 or more is past genericMethodPointersCount. */
  readonly firstPointerSlot?: number;
  /** methodDefinitionIndex of method spec 0. */
  readonly firstSpecMethod?: number;
  /** classIndexIndex of method spec 0; 2 or more is past genericInstsCount. */
  readonly firstSpecClass?: number;
  /** methodIndexIndex of method spec 0; -1 (none) by default. */
  readonly firstSpecMethodInstance?: number;
  /** Point row 2 at method spec 0 as well. */
  readonly duplicateSpec?: boolean;
  /** Pointer written in slot 0 instead of a code address. */
  readonly firstSlot?: bigint;
  /** Write genericMethodTableCount 0, as a build without generic instances. */
  readonly emptyTable?: boolean;
  /** Place genericMethodPointers at the last 16 bytes, leaving slot 2 unmapped. */
  readonly unmappedLastSlot?: boolean;
  /** Raw methodSpecs pointer written instead of the spec table address. */
  readonly methodSpecs?: bigint;
  /** Raw genericMethodPointers pointer written instead of the slot array. */
  readonly genericMethodPointers?: bigint;
}

/**
 * Generic instances the fixture's genericMethodTable resolves to, by row:
 * a class instance of System.Größe, a method instance on a nested type whose
 * code is folded with metadata method 0, and a row without code. Row
 * position is the genericMethodTable index.
 */
const code = (offset: bigint) => ({
  state: "code" as const,
  address: `0x${(FIXTURE_BINARY_BASE + offset).toString(16)}`,
  rva: `0x${offset.toString(16)}`,
});
export const FIXTURE_GENERIC_INSTANCES = [
  {
    method_spec: 0,
    method: 3,
    name: "System.Größe<int>$$.ctor",
    ...code(0x240n),
  },
  {
    method_spec: 1,
    method: 2,
    name: "Game.Player.Slot$$Add<Größe<int>, int>",
    ...code(0x200n),
  },
  {
    method_spec: 2,
    method: 4,
    name: "System.Größe$$ToString<int>",
    state: "no-body" as const,
    address: null,
    rva: null,
  },
];

/** Every fixture method returns type 0, an array of a generic instance. */
export const FIXTURE_RETURN_TYPE_NAME = "System.Größe<int>[]";

const SIZE = 0x1000;
const METADATA_REGISTRATION = 0x800;
const TYPE_POINTERS = 0x900;
const TYPE_RECORDS = 0x980;
const GENERIC_CLASS = 0xa00;
const GENERIC_INSTANCE = 0xa40;
const GENERIC_ARGUMENTS = 0xa60;
const STRINGS = 0x100;
const POINTERS = 0x300;
const MODULES = 0x400;
const MODULE_ARRAY = 0x500;
const REGISTRATION = 0x600;
const DUPLICATE = 0x700;
const GENERIC_INST_POINTERS = 0xb00;
const GENERIC_INST_RECORDS = 0xb20;
const GENERIC_INST_ARGUMENTS = 0xb60;
const METHOD_SPECS = 0xb80;
const GENERIC_METHOD_TABLE = 0xbc0;
const GENERIC_METHOD_POINTERS = 0xd00;

const imageSize = (options: Il2cppBinaryFixtureOptions) =>
  SIZE * (options.pages ?? 1);

export const createIl2cppBinaryFixture = (
  options: Il2cppBinaryFixtureOptions = {},
): Buffer => {
  const size = imageSize(options);
  const bytes = Buffer.alloc(size);
  const address = (offset: number) => FIXTURE_BINARY_BASE + BigInt(offset);
  const chained = options.chainedFixups === true;
  const split = options.splitSegmentAt;
  // LC_SEGMENT_64 records, read-execute; a split gives two adjacent ones.
  const segments: readonly [name: string, start: number, end: number][] =
    split === undefined
      ? [["__TEXT", 0, size]]
      : [
          ["__TEXT", 0, split],
          ["__DATA", split, size],
        ];
  const commands = segments.length + (chained ? 1 : 0);
  // Mach-O 64-bit header: arm64 dylib with its load commands.
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(6, 12);
  bytes.writeUInt32LE(commands, 16);
  bytes.writeUInt32LE(segments.length * 72 + (chained ? 16 : 0), 20);
  segments.forEach(([name, start, end], index) => {
    const at = 32 + index * 72;
    bytes.writeUInt32LE(0x19, at);
    bytes.writeUInt32LE(72, at + 4);
    bytes.write(name, at + 8, "latin1");
    bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(start), at + 24);
    bytes.writeBigUInt64LE(BigInt(end - start), at + 32);
    bytes.writeBigUInt64LE(BigInt(start), at + 40);
    bytes.writeBigUInt64LE(BigInt(end - start), at + 48);
    bytes.writeUInt32LE(5, at + 56);
    bytes.writeUInt32LE(5, at + 60);
  });
  if (chained) {
    // linkedit_data_command pointing at an empty range.
    const at = 32 + segments.length * 72;
    bytes.writeUInt32LE(0x80000034, at);
    bytes.writeUInt32LE(16, at + 4);
  }
  const names = options.imageNames ?? ["Assembly-CSharp.dll", "mscorlib.dll"];
  const nameAt: number[] = [];
  let cursor = STRINGS;
  for (const name of names) {
    bytes[cursor++] = options.namePadding ?? 0;
    if (name === "mscorlib.dll" && options.namePrefix !== undefined)
      cursor += bytes.write(options.namePrefix, cursor, "utf8");
    nameAt.push(cursor);
    cursor += bytes.write(`${name}\0`, cursor, "utf8");
  }
  // Slots are indexed by token row id - 1 (see FIXTURE_METHOD_TOKENS).
  const tables = [
    [0x210n, 0x200n, 0x220n],
    [0x230n, null],
  ];
  const tableAt: number[] = [];
  let pointer = POINTERS;
  for (const table of tables) {
    tableAt.push(pointer);
    for (const slot of table) {
      bytes.writeBigUInt64LE(
        slot === null ? 0n : FIXTURE_BINARY_BASE + slot,
        pointer,
      );
      pointer += 8;
    }
  }
  const writeModule = (at: number, image: number, count: number) => {
    bytes.writeBigUInt64LE(address(nameAt[image]!), at);
    bytes.writeUInt32LE(count, at + 8);
    bytes.writeBigUInt64LE(address(tableAt[image]!), at + 16);
  };
  writeModule(MODULES, 0, options.firstModuleCount ?? 3);
  writeModule(MODULES + 0x40, 1, 2);
  if (options.duplicateModule === true) writeModule(DUPLICATE, 0, 3);
  bytes.writeBigUInt64LE(address(MODULES), MODULE_ARRAY);
  bytes.writeBigUInt64LE(address(MODULES + 0x40), MODULE_ARRAY + 8);
  if (options.codeReference === true) {
    // lea rax, [rip + disp32]; disp is relative to the next instruction.
    const at = 0xc00;
    bytes.set([0x48, 0x8d, 0x05], at);
    bytes.writeInt32LE(MODULE_ARRAY - (at + 7), at + 3);
  }
  for (const [at, target] of options.adrpAdd ?? []) {
    const pc = address(at),
      to = address(target);
    const pages = Number(((to >> 12n) - (pc >> 12n)) & 0x1fffffn);
    // ADRP x8: immlo in bits 29-30, immhi in bits 5-23.
    bytes.writeUInt32LE(
      (0x90000008 | ((pages & 3) << 29) | ((pages >> 2) << 5)) >>> 0,
      at,
    );
    // ADD x8, x8, #pageoff (64-bit, unshifted imm12).
    bytes.writeUInt32LE(
      (0x91000108 | (Number(to & 0xfffn) << 10)) >>> 0,
      at + 4,
    );
  }
  if (options.codeRegistration !== false) {
    bytes.writeBigUInt64LE(2n, REGISTRATION);
    bytes.writeBigUInt64LE(address(MODULE_ARRAY), REGISTRATION + 8);
    if (options.duplicateCodeRegistration === true) {
      bytes.writeBigUInt64LE(2n, REGISTRATION + 0x80);
      bytes.writeBigUInt64LE(address(MODULE_ARRAY), REGISTRATION + 0x88);
    }
  }
  // Il2CppType records: 8-byte data, then attrs:16 and type:8 bits.
  const types: readonly [kind: number, data: bigint][] = [
    [0x1d, address(TYPE_RECORDS + 16)],
    [0x15, address(GENERIC_CLASS)],
    [0x12, BigInt(options.genericDefinitionTypeIndex ?? 3)],
    [0x08, 0n],
  ];
  types.forEach(([kind, data], index) => {
    const at = TYPE_RECORDS + index * 16;
    bytes.writeBigUInt64LE(data, at);
    bytes.writeUInt32LE(kind << 16, at + 8);
    bytes.writeBigUInt64LE(address(at), TYPE_POINTERS + index * 8);
  });
  // Version 29+ Il2CppGenericClass: definition type, then class_inst.
  bytes.writeBigUInt64LE(address(TYPE_RECORDS + 32), GENERIC_CLASS);
  bytes.writeBigUInt64LE(address(GENERIC_INSTANCE), GENERIC_CLASS + 8);
  const genericArguments = options.genericArgumentTypeIndices ?? [3];
  bytes.writeUInt32LE(genericArguments.length, GENERIC_INSTANCE);
  bytes.writeBigUInt64LE(address(GENERIC_ARGUMENTS), GENERIC_INSTANCE + 8);
  genericArguments.forEach((typeIndex, index) =>
    bytes.writeBigUInt64LE(
      address(TYPE_RECORDS + typeIndex * 16),
      GENERIC_ARGUMENTS + index * 8,
    ),
  );
  if (options.metadataRegistration !== false) {
    // typesCount and types, then fieldOffsets and typeDefinitionsSizes,
    // whose counts equal the 4 metadata type definitions.
    const word = (slot: number, value: bigint) =>
      bytes.writeBigUInt64LE(value, METADATA_REGISTRATION + slot * 8);
    word(6, BigInt(types.length));
    word(7, address(TYPE_POINTERS));
    word(10, 4n);
    word(11, address(TYPE_POINTERS));
    word(12, 4n);
    word(13, address(TYPE_POINTERS));
    if (options.duplicateMetadataRegistration === true) {
      const duplicate = METADATA_REGISTRATION + 0x80;
      bytes.writeBigUInt64LE(BigInt(types.length), duplicate + 6 * 8);
      bytes.writeBigUInt64LE(address(TYPE_POINTERS), duplicate + 7 * 8);
      bytes.writeBigUInt64LE(4n, duplicate + 10 * 8);
      bytes.writeBigUInt64LE(address(TYPE_POINTERS), duplicate + 11 * 8);
      bytes.writeBigUInt64LE(4n, duplicate + 12 * 8);
      bytes.writeBigUInt64LE(address(TYPE_POINTERS), duplicate + 13 * 8);
    }
  }
  if (options.genericMethods !== undefined)
    writeGenericMethods(bytes, address, options.genericMethods);
  return bytes;
};

const writeGenericMethods = (
  bytes: Buffer,
  address: (offset: number) => bigint,
  options: GenericMethodFixtureOptions,
) => {
  const stride = options.stride ?? 16;
  // Il2CppGenericInst records: <int> and <Größe<int>, int>.
  const intType = address(TYPE_RECORDS + 48);
  const instanceType = address(TYPE_RECORDS + 16);
  const instances = [[intType], [instanceType, intType]];
  let argument = GENERIC_INST_ARGUMENTS;
  instances.forEach((args, index) => {
    const record = GENERIC_INST_RECORDS + index * 16;
    bytes.writeBigUInt64LE(address(record), GENERIC_INST_POINTERS + index * 8);
    bytes.writeBigUInt64LE(BigInt(args.length), record);
    bytes.writeBigUInt64LE(address(argument), record + 8);
    for (const type of args) {
      bytes.writeBigUInt64LE(type, argument);
      argument += 8;
    }
  });
  // Il2CppMethodSpec: methodDefinitionIndex, classIndexIndex, methodIndexIndex.
  const specs = [
    [
      options.firstSpecMethod ?? 3,
      options.firstSpecClass ?? 0,
      options.firstSpecMethodInstance ?? -1,
    ],
    [2, -1, 1],
    [4, -1, 0],
  ];
  specs.forEach((spec, index) =>
    spec.forEach((value, field) =>
      bytes.writeInt32LE(value, METHOD_SPECS + index * 12 + field * 4),
    ),
  );
  // genericMethodIndex, methodIndex, invokerIndex (and adjustorThunk).
  const rows = [
    [0, options.firstPointerSlot ?? 0, 0],
    [1, 1, 3],
    [options.duplicateSpec === true ? 0 : 2, 2, -1],
  ];
  rows.forEach((row, index) =>
    row.forEach((value, field) =>
      bytes.writeInt32LE(
        value,
        GENERIC_METHOD_TABLE + index * stride + field * 4,
      ),
    ),
  );
  const slots = [options.firstSlot ?? address(0x240), address(0x200), 0n];
  const pointers =
    options.unmappedLastSlot === true ? SIZE - 16 : GENERIC_METHOD_POINTERS;
  slots.forEach((slot, index) => {
    if (pointers + index * 8 < SIZE)
      bytes.writeBigUInt64LE(slot, pointers + index * 8);
  });
  const metadataWord = (slot: number, value: bigint) =>
    bytes.writeBigUInt64LE(value, METADATA_REGISTRATION + slot * 8);
  metadataWord(2, BigInt(instances.length));
  metadataWord(3, address(GENERIC_INST_POINTERS));
  metadataWord(4, options.emptyTable === true ? 0n : BigInt(rows.length));
  metadataWord(5, address(GENERIC_METHOD_TABLE));
  metadataWord(8, BigInt(specs.length));
  metadataWord(9, options.methodSpecs ?? address(METHOD_SPECS));
  if (options.codeRegistration === false) return;
  // CodeRegistration ends at codeGenModulesCount (REGISTRATION): 104 bytes
  // before it in the 27.1+ layout, 96 in the 27.0 layout.
  const start = REGISTRATION - (stride === 16 ? 104 : 96);
  const codeWord = (offset: number, value: bigint) =>
    bytes.writeBigUInt64LE(value, start + offset);
  // A build without generic instances records no pointers and a null array,
  // which leaves every candidate layout readable.
  const empty = options.emptyTable === true;
  codeWord(16, empty ? 0n : BigInt(slots.length));
  codeWord(
    24,
    empty ? 0n : (options.genericMethodPointers ?? address(pointers)),
  );
  // invokerPointersCount follows genericAdjustorThunks when rows carry one.
  codeWord(stride === 16 ? 40 : 32, 4n);
};

/** Add one classic dyld bind at the selected slot, retaining its stored word. */
export const createIl2cppDyldBindFixture = (
  raw: bigint,
  slotOffset = POINTERS,
): Buffer => {
  const bytes = Buffer.from(createIl2cppBinaryFixture());
  const command = 104;
  const streamOffset = 0xf00;
  const offsetBytes: number[] = [];
  let remaining = slotOffset;
  do {
    const byte = remaining & 0x7f;
    remaining >>>= 7;
    offsetBytes.push(byte | (remaining === 0 ? 0 : 0x80));
  } while (remaining !== 0);
  const stream = Buffer.concat([
    Buffer.from([0x3e, 0x40]),
    Buffer.from("_FixtureMethod\0", "utf8"),
    Buffer.from([0x51, 0x70, ...offsetBytes, 0x90, 0x00]),
  ]);
  bytes.writeUInt32LE(2, 16);
  bytes.writeUInt32LE(120, 20);
  bytes.writeUInt32LE(0x80000022, command);
  bytes.writeUInt32LE(48, command + 4);
  bytes.writeUInt32LE(streamOffset, command + 16);
  bytes.writeUInt32LE(stream.length, command + 20);
  stream.copy(bytes, streamOffset);
  // A classic pointer bind names writable loader storage.
  bytes.writeUInt32LE(7, 88);
  bytes.writeUInt32LE(7, 92);
  bytes.writeBigUInt64LE(raw, slotOffset);
  return bytes;
};

/** Complete registration whose final zero words may occupy declared zero-fill. */
export const createIl2cppRegistrationTailFixture = (
  tailBytes: 0 | 8 | 16,
  zeroFilled = true,
): Buffer => {
  const source = createIl2cppBinaryFixture();
  source.copy(
    source,
    SIZE - 128,
    METADATA_REGISTRATION,
    METADATA_REGISTRATION + 128,
  );
  source.fill(0, METADATA_REGISTRATION, METADATA_REGISTRATION + 128);
  const bytes = source.subarray(0, SIZE - tailBytes);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  if (!zeroFilled) bytes.writeBigUInt64LE(BigInt(bytes.length), 64);
  return bytes;
};

/** Wrap thin Mach-O slices in a 32-bit universal header, page aligned. */
export const createUniversalFixture = (
  slices: readonly { readonly cpu: number; readonly bytes: Buffer }[],
): Buffer => {
  const align = 0x1000;
  const header = Buffer.alloc(align);
  header.writeUInt32BE(0xcafebabe, 0);
  header.writeUInt32BE(slices.length, 4);
  const parts: Buffer[] = [header];
  let offset = align;
  slices.forEach((slice, index) => {
    const at = 8 + index * 20;
    header.writeUInt32BE(slice.cpu, at);
    header.writeUInt32BE(0, at + 4);
    header.writeUInt32BE(offset, at + 8);
    header.writeUInt32BE(slice.bytes.length, at + 12);
    header.writeUInt32BE(12, at + 16);
    const padded = Buffer.alloc(Math.ceil(slice.bytes.length / align) * align);
    slice.bytes.copy(padded);
    parts.push(padded);
    offset += padded.length;
  });
  return Buffer.concat(parts);
};

/** PE section with a method array ending across its file/zero-fill boundary. */
export const createSplitPointerPeFixture = (zeroTail = true): Buffer => {
  const payload = createIl2cppBinaryFixture();
  payload.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0xff8n, 0x450);
  payload.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x230n, 0xff8);
  const header = Buffer.alloc(0x200);
  header.writeUInt16LE(0x5a4d);
  header.writeUInt32LE(0x40, 60);
  header.writeUInt32LE(0x4550, 0x40);
  header.writeUInt16LE(0x8664, 0x44);
  header.writeUInt16LE(1, 0x46);
  header.writeUInt16LE(240, 0x54);
  const optional = 0x58;
  header.writeUInt16LE(0x20b, optional);
  header.writeBigUInt64LE(FIXTURE_BINARY_BASE, optional + 24);
  header.writeUInt32LE(0x1000, optional + 32);
  header.writeUInt32LE(0x200, optional + 36);
  header.writeUInt32LE(0x2000, optional + 56);
  header.writeUInt32LE(0x200, optional + 60);
  const section = optional + 240;
  header.write(".text", section);
  header.writeUInt32LE(zeroTail ? 0x1008 : 0x1000, section + 8);
  header.writeUInt32LE(0x1000, section + 16);
  header.writeUInt32LE(0x200, section + 20);
  header.writeUInt32LE(0x60000020, section + 36);
  return Buffer.concat([header, payload]);
};

/** Android ELF relocation tables appended after the fixture image. */
export interface ElfFixtureOptions {
  /** e_machine; 183 is AArch64. */
  readonly machine?: number;
  /** Add DT_ANDROID_RELA, the packed APS2 encoding. */
  readonly androidPacked?: boolean;
  /** Omit PT_DYNAMIC. */
  readonly dynamic?: boolean;
  /** Give every relocation a symbol index, so none is RELATIVE-only. */
  readonly symbolRelocations?: boolean;
  /** Add unresolved dynamic relocations at offsets relative to the load base. */
  readonly unresolvedRelocations?: readonly {
    readonly offset: number;
    readonly kind: number;
  }[];
  /** Write DT_RELA twice. */
  readonly duplicateRela?: boolean;
  /** Override DT_RELASZ or DT_RELAENT. */
  readonly relaSize?: bigint;
  readonly relaEntry?: bigint;
  /** Move mscorlib.dll's method pointers into zero-fill past the file end. */
  readonly zeroFilledTable?: boolean;
}

/** A valid large RELA image; extra file-backed pointers do not add IL2CPP registrations. */
export const createLargeElfRelativeFixture = (
  image: Buffer,
  extraRecords: number,
  machine = 183,
): Buffer => {
  const original = createElfFixture(image, { machine });
  const originalDynamic = Number(original.readBigUInt64LE(128));
  const originalRelaSize = Number(
    original.readBigUInt64LE(originalDynamic + 24),
  );
  const pointersAt = Math.ceil(original.length / 8) * 8;
  const relaAt = pointersAt + extraRecords * 8;
  const relaSize = originalRelaSize + extraRecords * 24;
  const dynamicAt = relaAt + relaSize;
  const bytes = Buffer.alloc(dynamicAt + 64);
  original.copy(bytes);
  original.copy(bytes, relaAt, 0x1000, 0x1000 + originalRelaSize);
  for (let index = 0; index < extraRecords; index++) {
    const row = relaAt + originalRelaSize + index * 24;
    bytes.writeBigUInt64LE(
      FIXTURE_BINARY_BASE + BigInt(pointersAt + index * 8),
      row,
    );
    bytes.writeBigUInt64LE(machine === 62 ? 8n : 1027n, row + 8);
    bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x100n, row + 16);
  }
  for (const [index, [tag, value]] of [
    [7n, FIXTURE_BINARY_BASE + BigInt(relaAt)],
    [8n, BigInt(relaSize)],
    [9n, 24n],
    [0n, 0n],
  ].entries()) {
    bytes.writeBigUInt64LE(tag!, dynamicAt + index * 16);
    bytes.writeBigUInt64LE(value!, dynamicAt + index * 16 + 8);
  }
  bytes.writeBigUInt64LE(BigInt(bytes.length), 96);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 104);
  bytes.writeBigUInt64LE(BigInt(dynamicAt), 128);
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(dynamicAt), 136);
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(dynamicAt), 144);
  bytes.writeBigUInt64LE(64n, 152);
  bytes.writeBigUInt64LE(64n, 160);
  return bytes;
};

/**
 * Rewrap a fixture image as a 64-bit ELF shared object loaded at the same
 * base: every pointer slot into the image is zeroed on disk and restored by
 * an R_AARCH64_RELATIVE entry, as a position-independent libil2cpp.so stores it.
 */
export const createElfFixture = (
  image: Buffer,
  options: ElfFixtureOptions = {},
): Buffer => {
  const body = Buffer.from(image);
  body.fill(0, 0, 0x100);
  const relocations: [slot: bigint, value: bigint, kind?: number][] = [];
  for (let at = 0x100; at + 8 <= SIZE; at += 8) {
    const value = body.readBigUInt64LE(at);
    if (
      value < FIXTURE_BINARY_BASE ||
      value >= FIXTURE_BINARY_BASE + BigInt(SIZE)
    )
      continue;
    relocations.push([FIXTURE_BINARY_BASE + BigInt(at), value]);
    body.writeBigUInt64LE(0n, at);
  }
  for (const relocation of options.unresolvedRelocations ?? [])
    relocations.push([
      FIXTURE_BINARY_BASE + BigInt(relocation.offset),
      0n,
      relocation.kind,
    ]);
  const tagCount =
    4 +
    (options.duplicateRela === true ? 1 : 0) +
    (options.androidPacked === true ? 1 : 0);
  const fileSize = SIZE + relocations.length * 24 + tagCount * 16;
  if (options.zeroFilledTable === true) {
    // The second module record's methodPointers field (MODULES + 0x40 + 16).
    const slot = FIXTURE_BINARY_BASE + BigInt(0x400 + 0x40 + 16);
    const entry = relocations.find(([at]) => at === slot)!;
    entry[1] = FIXTURE_BINARY_BASE + BigInt(fileSize);
  }
  const rela = Buffer.alloc(relocations.length * 24);
  relocations.forEach(([slot, value, kind], index) => {
    rela.writeBigUInt64LE(slot, index * 24);
    rela.writeBigUInt64LE(
      (options.symbolRelocations === true || kind !== undefined
        ? 1n << 32n
        : 0n) | BigInt(kind ?? (options.machine === 62 ? 8 : 1027)),
      index * 24 + 8,
    );
    rela.writeBigInt64LE(value, index * 24 + 16);
  });
  const tags: [bigint, bigint][] = [
    [7n, FIXTURE_BINARY_BASE + BigInt(SIZE)],
    ...(options.duplicateRela === true
      ? [[7n, FIXTURE_BINARY_BASE + BigInt(SIZE)] as [bigint, bigint]]
      : []),
    [8n, options.relaSize ?? BigInt(rela.length)],
    [9n, options.relaEntry ?? 24n],
    ...(options.androidPacked === true
      ? [[0x60000011n, 0n] as [bigint, bigint]]
      : []),
    [0n, 0n],
  ];
  const dynamic = Buffer.alloc(tags.length * 16);
  tags.forEach(([tag, value], index) => {
    dynamic.writeBigInt64LE(tag, index * 16);
    dynamic.writeBigUInt64LE(value, index * 16 + 8);
  });
  const file = Buffer.concat([body, rela, dynamic]);
  if (file.length !== fileSize) throw new Error("ELF fixture size drifted");
  const withDynamic = options.dynamic !== false;
  // ELF64 header: little-endian shared object, no section headers.
  file.write("\x7fELF", 0, "latin1");
  file.writeUInt8(2, 4);
  file.writeUInt8(1, 5);
  file.writeUInt8(1, 6);
  file.writeUInt16LE(3, 16);
  file.writeUInt16LE(options.machine ?? 183, 18);
  file.writeUInt32LE(1, 20);
  file.writeBigUInt64LE(64n, 32);
  file.writeUInt16LE(64, 52);
  file.writeUInt16LE(56, 54);
  file.writeUInt16LE(withDynamic ? 2 : 1, 56);
  // Synthetic PT_LOAD maps code and relocation data read-write-execute.
  file.writeUInt32LE(1, 64);
  file.writeUInt32LE(7, 68);
  file.writeBigUInt64LE(FIXTURE_BINARY_BASE, 80);
  file.writeBigUInt64LE(FIXTURE_BINARY_BASE, 88);
  file.writeBigUInt64LE(BigInt(file.length), 96);
  file.writeBigUInt64LE(
    BigInt(file.length) + (options.zeroFilledTable === true ? 0x100n : 0n),
    104,
  );
  if (withDynamic) {
    const at = SIZE + rela.length;
    file.writeUInt32LE(2, 120);
    file.writeUInt32LE(6, 124);
    file.writeBigUInt64LE(BigInt(at), 128);
    file.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(at), 136);
    file.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(at), 144);
    file.writeBigUInt64LE(BigInt(dynamic.length), 152);
    file.writeBigUInt64LE(BigInt(dynamic.length), 160);
  }
  return file;
};

/** A code-loaded type table plus isolated one-entry candidate runs in disjoint ELF mappings. */
export const createIl2cppTypeScanFixture = (
  mappingCount: number,
  bytesPerMapping: number,
): Buffer => {
  const image = createIl2cppBinaryFixture({
    metadataRegistration: false,
    adrpAdd: [[0xc20, 0x900]],
  });
  const original = createElfFixture(image);
  const candidates = Buffer.alloc(mappingCount * bytesPerMapping);
  for (let at = 0; at < candidates.length; at += 16)
    candidates.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x9b0n, at);
  // The original dynamic segment and complete payload retain their addresses.
  // Move only the program header table to the unmapped end of the file.
  const headers: Buffer[] = [Buffer.from(original.subarray(120, 176))];
  for (let index = 0; index <= mappingCount; index++) {
    const offset =
      index === 0 ? 0 : original.length + (index - 1) * bytesPerMapping;
    const size = index === 0 ? original.length : bytesPerMapping;
    const header = Buffer.alloc(56);
    header.writeUInt32LE(1);
    header.writeUInt32LE(index === 0 ? 7 : 6, 4);
    header.writeBigUInt64LE(BigInt(offset), 8);
    header.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(offset), 16);
    header.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(offset), 24);
    header.writeBigUInt64LE(BigInt(size), 32);
    header.writeBigUInt64LE(BigInt(size), 40);
    header.writeBigUInt64LE(1n, 48);
    headers.push(header);
  }
  const result = Buffer.concat([original, candidates, ...headers]);
  result.writeBigUInt64LE(BigInt(original.length + candidates.length), 32);
  result.writeUInt16LE(headers.length, 56);
  return result;
};

export interface GenericRegistrationImageOptions {
  /** Let the 104-byte layout bound the rows as well as the 120-byte one. */
  readonly ambiguous?: boolean;
  /** Leave the methodSpecs table in the segment's zero-fill tail. */
  readonly zeroFilledSpecs?: boolean;
  /** genericMethodTableCount written in MetadataRegistration. */
  readonly tableCount?: bigint;
}

/** Load address of createGenericRegistrationImage, low as an ELF libil2cpp.so's. */
export const GENERIC_IMAGE_BASE = 0x10000n;

/**
 * A Mach-O image holding only version 29/31 generic registration tables at a
 * low base, so a pointer value also reads as a bounded count. The 120-byte
 * CodeRegistration layout always bounds the three rows; with `ambiguous` the
 * 104-byte layout, eight bytes later, bounds them too. MetadataRegistration
 * records no generic instances, so no row is named.
 */
export const createGenericRegistrationImage = (
  options: GenericRegistrationImageOptions = {},
) => {
  const size = 0x1000;
  const specs = options.zeroFilledSpecs === true ? 0xf00 : 0xb80;
  const bytes = Buffer.alloc(options.zeroFilledSpecs === true ? specs : size);
  const address = (offset: number) => GENERIC_IMAGE_BASE + BigInt(offset);
  bytes.writeUInt32LE(0xfeedfacf, 0);
  bytes.writeUInt32LE(0x0100000c, 4);
  bytes.writeUInt32LE(6, 12);
  bytes.writeUInt32LE(1, 16);
  bytes.writeUInt32LE(72, 20);
  bytes.writeUInt32LE(0x19, 32);
  bytes.writeUInt32LE(72, 36);
  bytes.write("__TEXT", 40, "latin1");
  bytes.writeBigUInt64LE(GENERIC_IMAGE_BASE, 56);
  bytes.writeBigUInt64LE(BigInt(size), 64);
  bytes.writeBigUInt64LE(0n, 72);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  bytes.writeUInt32LE(5, 88);
  bytes.writeUInt32LE(5, 92);
  const modules = 0x600;
  const pointers = address(0xd00);
  // 120-byte layout from 0x588: pointer count at +16, array at +24 and
  // invoker count at +40. The 104-byte layout starts at 0x598, so its
  // wrapper count and array are the 120 layout's pointer count and array,
  // and its pointer array at +40 is the 120 layout's invoker count.
  bytes.writeBigUInt64LE(3n, 0x598);
  bytes.writeBigUInt64LE(pointers, 0x5a0);
  bytes.writeBigUInt64LE(3n, 0x5a8);
  bytes.writeBigUInt64LE(pointers, 0x5b0);
  bytes.writeBigUInt64LE(options.ambiguous === true ? 4n : 0n, 0x5c0);
  const rows = [
    [0, 0, 0],
    [1, 1, 3],
    [2, 2, -1],
  ];
  rows.forEach((row, index) =>
    row.forEach((value, field) =>
      bytes.writeInt32LE(value, 0xbc0 + index * 16 + field * 4),
    ),
  );
  if (options.zeroFilledSpecs !== true)
    [
      [3, 0, -1],
      [2, 0, -1],
      [4, 0, -1],
    ].forEach((spec, index) =>
      spec.forEach((value, field) =>
        bytes.writeInt32LE(value, specs + index * 12 + field * 4),
      ),
    );
  [0x100, 0x110, 0].forEach((slot, index) =>
    bytes.writeBigUInt64LE(slot === 0 ? 0n : address(slot), 0xd00 + index * 8),
  );
  const registration = 0x800;
  bytes.writeBigUInt64LE(options.tableCount ?? 3n, registration + 32);
  bytes.writeBigUInt64LE(address(0xbc0), registration + 40);
  bytes.writeBigUInt64LE(3n, registration + 64);
  bytes.writeBigUInt64LE(address(specs), registration + 72);
  return {
    bytes,
    modulesField: address(modules),
    metadataRegistration: address(registration),
  };
};
