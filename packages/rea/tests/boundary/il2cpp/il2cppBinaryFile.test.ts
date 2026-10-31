import { javaClassFile } from "../../fixtures/javaClassFile.js";
import { Il2cppBinaryFormatFailure } from "../../../src/il2cpp/Il2cppBinaryFormat.js";
import { readBinaryContainer } from "../../../src/native/metadata/readBinaryContainer.js";
import {
  openImageSteps,
  readUInt32,
} from "../../../src/il2cpp/Il2cppBinaryImage.js";
import { expect, it } from "vitest";
import { linkIl2cppBinarySteps } from "../../../src/il2cpp/Il2cppBinaryFile.js";
import {
  drain,
  linkIl2cppBinary,
  readIl2cppMetadataForLinking,
} from "../../fixtures/il2cpp/readers.js";
import {
  GENERIC_TABLE_LIMIT,
  linkGenericMethodsSteps,
} from "../../../src/il2cpp/Il2cppBinaryGenerics.js";
import {
  createElfFixture,
  createLargeElfRelativeFixture,
  createIl2cppBinaryFixture,
  createIl2cppDyldBindFixture,
  createIl2cppRegistrationTailFixture,
  createUniversalFixture,
  createGenericRegistrationImage,
  GENERIC_IMAGE_BASE,
  type GenericRegistrationImageOptions,
  createSplitPointerPeFixture,
  FIXTURE_BINARY_BASE,
  FIXTURE_GENERIC_INSTANCES,
  FIXTURE_METHOD_ADDRESSES,
  type GenericMethodFixtureOptions,
  FIXTURE_RETURN_TYPE_NAME,
  type Il2cppBinaryFixtureOptions,
} from "../../fixtures/il2cpp/binary.js";
import {
  createIl2cppMetadataFixture,
  createLinkedIl2cppMetadataFixture,
} from "../../fixtures/il2cpp/metadata.js";

const { metadata, link: facts } = readIl2cppMetadataForLinking(
  createLinkedIl2cppMetadataFixture().bytes,
);
const expectedAddress = (value: bigint | "no-body" | "unknown") =>
  typeof value === "bigint"
    ? {
        state: "code",
        address: `0x${value.toString(16)}`,
        rva: `0x${(value - FIXTURE_BINARY_BASE).toString(16)}`,
      }
    : { state: value, address: null, rva: null };
const expectedAddresses = FIXTURE_METHOD_ADDRESSES.map(expectedAddress);
const link = (bytes: Buffer, architecture?: string) =>
  linkIl2cppBinary(bytes, metadata, facts, architecture);
// A type-table fallback needs the metadata to reference most of the table, as
// real builds do; referencing type 3 requires all four fixture entries.
const wholeTable = {
  ...facts,
  returnTypes: Int32Array.from(facts.returnTypes, () => 3),
};
const linkWholeTable = (bytes: Buffer) =>
  linkIl2cppBinary(bytes, metadata, wholeTable);
const failure = (bytes: Buffer, architecture?: string) => {
  try {
    link(bytes, architecture);
  } catch (cause) {
    if (cause instanceof Il2cppBinaryFormatFailure)
      return { reason: cause.reason, kind: cause.kind };
    throw cause;
  }
  throw new Error("expected a link failure");
};
const addElfLoadAlias = (
  bytes: Buffer,
  fileOffset: number,
  address: bigint,
  size: number,
) => {
  const withAlias = Buffer.from(bytes);
  const count = withAlias.readUInt16LE(56);
  const at = 64 + count * 56;
  withAlias.writeUInt16LE(count + 1, 56);
  withAlias.writeUInt32LE(1, at);
  withAlias.writeUInt32LE(7, at + 4);
  withAlias.writeBigUInt64LE(BigInt(fileOffset), at + 8);
  withAlias.writeBigUInt64LE(address, at + 16);
  withAlias.writeBigUInt64LE(address, at + 24);
  const mappingSize = size === 0 ? withAlias.length : size;
  withAlias.writeBigUInt64LE(BigInt(mappingSize), at + 32);
  withAlias.writeBigUInt64LE(BigInt(mappingSize), at + 40);
  withAlias.writeBigUInt64LE(0x1000n, at + 48);
  return withAlias;
};

it("links methods to code through module tokens, not metadata order", () => {
  const linked = link(createIl2cppBinaryFixture());
  expect(linked).toMatchObject({
    format: "macho",
    architecture: "arm64",
    image_base: FIXTURE_BINARY_BASE,
    code_gen_modules_field: FIXTURE_BINARY_BASE + 0x600n,
    code_gen_modules_array: FIXTURE_BINARY_BASE + 0x500n,
    code_gen_modules: [
      {
        image: 0,
        address: FIXTURE_BINARY_BASE + 0x400n,
        method_pointer_count: 3,
      },
      {
        image: 1,
        address: FIXTURE_BINARY_BASE + 0x440n,
        method_pointer_count: 2,
      },
    ],
  });
  expect(linked.method_addresses).toEqual(expectedAddresses);
  expect(linked).toMatchObject({
    types_field: FIXTURE_BINARY_BASE + 0x830n,
    types_count: 4,
  });
  expect(linked.return_types).toEqual(
    Array.from({ length: 5 }, () => ({
      type: 0,
      name: FIXTURE_RETURN_TYPE_NAME,
    })),
  );
});

it.each([
  ["an identical range", 0, FIXTURE_BINARY_BASE, 0],
  ["a containing subrange", 0x400, FIXTURE_BINARY_BASE + 0x400n, 0x80],
] as const)(
  "counts one registration through %s only once",
  (_, offset, address, size) => {
    const bytes = addElfLoadAlias(
      createElfFixture(createIl2cppBinaryFixture()),
      offset,
      address,
      size,
    );

    expect(link(bytes).method_addresses).toEqual(expectedAddresses);
  },
);

it("still rejects distinct CodeRegistration module table fields", () => {
  expect(
    failure(
      createElfFixture(
        createIl2cppBinaryFixture({ duplicateCodeRegistration: true }),
      ),
    ),
  ).toEqual({ reason: "code-registration-not-found", kind: "malformed" });
});

it("still rejects distinct MetadataRegistration fields", () => {
  expect(
    failure(
      createElfFixture(
        createIl2cppBinaryFixture({ duplicateMetadataRegistration: true }),
      ),
    ),
  ).toEqual({ reason: "metadata-registration-not-found", kind: "malformed" });
});

it("rejects reused MethodDef tokens within an image but preserves cross-image reuse and folded addresses", () => {
  const duplicateTokens = Uint32Array.from(facts.methodTokens);
  duplicateTokens[1] = duplicateTokens[0]!;
  expect(() =>
    linkIl2cppBinary(createIl2cppBinaryFixture(), metadata, {
      ...facts,
      methodTokens: duplicateTokens,
    }),
  ).toThrow(
    expect.objectContaining({
      reason: "invalid-method-token",
      kind: "malformed",
    }),
  );

  // The fixture deliberately reuses MethodDef row ids in its second image.
  expect(link(createIl2cppBinaryFixture()).method_addresses).toEqual(
    expectedAddresses,
  );

  // Distinct rows may still point at the same native address after folding.
  const folded = createIl2cppBinaryFixture();
  folded.writeBigUInt64LE(folded.readBigUInt64LE(0x308), 0x300);
  const linkedFolded = link(folded);
  expect(linkedFolded.method_addresses[0]?.address).toBe(
    linkedFolded.method_addresses[1]?.address,
  );
});

it.each([0, 4000, 9000])(
  "reports a valid JVM class with %i unused constant bytes as unsupported",
  (constantBytes) => {
    expect(failure(javaClassFile(constantBytes, true))).toEqual({
      reason: "unsupported-container",
      kind: "unsupported",
    });
  },
);

it("does not infer universal Mach-O identity from a FAT-shaped non-Mach-O table", () => {
  // CAFEBABE also identifies JVM classes. A plausible FAT table and known CPU
  // do not prove Mach-O unless the declared slice contains a Mach-O header.
  const bytes = createUniversalFixture([
    { cpu: 0x0100000c, bytes: Buffer.alloc(0x100) },
  ]);
  expect(failure(bytes)).toEqual({
    reason: "unsupported-container",
    kind: "unsupported",
  });
  expect(failure(bytes, "arm64").reason).toBe("slice-not-found");
});

it("requires an explicit slice of a universal Mach-O and reads only that slice", () => {
  const thin = createIl2cppBinaryFixture();
  const universal = createUniversalFixture([
    { cpu: 0x01000007, bytes: createIl2cppBinaryFixture() },
    { cpu: 0x0100000c, bytes: thin },
  ]);
  expect(failure(universal)).toEqual({
    reason: "slice-selection-required",
    kind: "unsupported",
  });
  expect(link(universal, "arm64").method_addresses).toEqual(expectedAddresses);
  expect(failure(universal, "ppc64").reason).toBe("slice-not-found");
  expect(failure(thin, "arm64").reason).toBe("slice-not-found");
});

it.each(["thin", "universal"] as const)(
  "links a %s x86-64 Mach-O while retaining the reader's amd64 spelling",
  (format) => {
    const thin = createIl2cppBinaryFixture();
    thin.writeUInt32LE(0x01000007, 4);
    thin.writeUInt32LE(3, 8);
    const bytes =
      format === "thin"
        ? thin
        : createUniversalFixture([
            { cpu: 0x0100000c, bytes: createIl2cppBinaryFixture() },
            { cpu: 0x01000007, bytes: thin },
          ]);
    // Match the selected FAT declaration to CPU_SUBTYPE_X86_64_ALL in its header.
    if (format === "universal") bytes.writeUInt32BE(3, 8 + 20 + 4);
    const original = Buffer.from(bytes);
    const linked = link(bytes, format === "thin" ? undefined : "amd64");
    expect(linked).toMatchObject({
      format: "macho",
      architecture: "amd64",
      code_gen_modules_field: FIXTURE_BINARY_BASE + 0x600n,
      code_gen_modules_array: FIXTURE_BINARY_BASE + 0x500n,
    });
    expect(linked.method_addresses).toEqual(expectedAddresses);
    expect(linked.return_types).toEqual(
      link(createIl2cppBinaryFixture()).return_types,
    );
    expect(Buffer.compare(bytes, original)).toBe(0);
  },
);

it.each<
  [string, Il2cppBinaryFixtureOptions, string, "unsupported" | "malformed"]
>([
  [
    "a method count mismatch",
    { firstModuleCount: 4 },
    "code-gen-modules-not-found",
    "malformed",
  ],
  [
    "two matching module records",
    { duplicateModule: true },
    "ambiguous-code-gen-module",
    "malformed",
  ],
  [
    "no CodeRegistration module table",
    { codeRegistration: false },
    "code-registration-not-found",
    "malformed",
  ],
  [
    "no MetadataRegistration type table",
    { metadataRegistration: false },
    "metadata-registration-not-found",
    "malformed",
  ],
  [
    "chained fixups",
    { chainedFixups: true },
    "unsupported-pointer-encoding",
    "unsupported",
  ],
])("rejects %s without partial addresses", (_, options, reason, kind) => {
  expect(failure(createIl2cppBinaryFixture(options))).toEqual({ reason, kind });
});

it("reports type indices without names for metadata version 27", () => {
  const linked = linkIl2cppBinary(
    createIl2cppBinaryFixture(),
    { ...metadata, metadata_version: 27 },
    facts,
  );
  const rows = [
    ...linked.return_types,
    ...linked.field_types,
    ...linked.parameter_types,
  ];
  expect(rows.length).toBeGreaterThan(0);
  expect(rows.every((row) => row.name === null)).toBe(true);
  expect(link(createIl2cppBinaryFixture()).return_types[0]?.name).toBe(
    FIXTURE_RETURN_TYPE_NAME,
  );
});

it("renders nested generic arguments on the components that declare them", () => {
  const renderedName = (
    typeNames: Readonly<Record<number, string>>,
    genericTypeArgumentCounts: Readonly<Record<number, number>>,
    genericArgumentTypeIndices: readonly number[],
  ) => {
    const { metadata: nestedMetadata, link: nestedFacts } =
      readIl2cppMetadataForLinking(
        createLinkedIl2cppMetadataFixture({
          typeNames,
          typeNamespaces: { 0: "Game", 1: "" },
          genericTypeArgumentCounts,
        }).bytes,
      );
    return linkIl2cppBinary(
      createIl2cppBinaryFixture({
        genericDefinitionTypeIndex: 1,
        genericArgumentTypeIndices,
      }),
      nestedMetadata,
      nestedFacts,
    ).return_types[0]?.name;
  };

  expect(
    renderedName({ 0: "Outer`1", 1: "Inner`2" }, { 0: 1, 1: 2 }, [3, 3]),
  ).toBe("Game.Outer<int>+Inner<int>[]");
  expect(renderedName({ 0: "Outer`1", 1: "Leaf`1" }, { 0: 1, 1: 1 }, [3])).toBe(
    "Game.Outer<int>+Leaf[]",
  );
});

it("does not search for an empty image name", () => {
  const unnamed = {
    ...metadata,
    images: metadata.images.map((image, index) =>
      index === 0 ? { ...image, name: "" } : image,
    ),
  };
  expect(() =>
    linkIl2cppBinary(createIl2cppBinaryFixture(), unnamed, facts),
  ).toThrow("code-gen-modules-not-found");
});

it("refuses an image name repeated past the search bound", () => {
  const fixture = createIl2cppBinaryFixture();
  const flooded = Buffer.concat([
    fixture,
    Buffer.from("\0mscorlib.dll".repeat(65537) + "\0", "utf8"),
  ]);
  // The Mach-O segment covers the original size; widen it to the new tail.
  flooded.writeBigUInt64LE(BigInt(flooded.length), 64);
  flooded.writeBigUInt64LE(BigInt(flooded.length), 80);
  expect(failure(flooded)).toEqual({
    reason: "native-index-capacity",
    kind: "capacity",
  });
});

it.each([
  [{ duplicateRela: true }],
  [{ relaEntry: 16n }],
  [{ relaSize: 25n }],
] as const)("rejects malformed ELF relocation tables (%o)", (options) => {
  expect(
    failure(createElfFixture(createIl2cppBinaryFixture(), options)),
  ).toEqual({ reason: "malformed-container", kind: "malformed" });
});

it("does not apply symbol relocations as RELATIVE ones", () => {
  // With every slot left zero, no module table can be found.
  expect(() =>
    link(
      createElfFixture(createIl2cppBinaryFixture(), {
        symbolRelocations: true,
      }),
    ),
  ).toThrow(Il2cppBinaryFormatFailure);
});

it("reads a method pointer array in zero-fill as methods without bodies", () => {
  // An iOS-only assembly in an Android build keeps its array in .bss.
  const linked = link(
    createElfFixture(createIl2cppBinaryFixture(), { zeroFilledTable: true }),
  );
  expect(linked.method_addresses).toEqual([
    ...expectedAddresses.slice(0, 3),
    expectedAddress("no-body"),
    expectedAddress("no-body"),
  ]);
});

it("reads a PE pointer array across file bytes and the declared zero-fill tail", () => {
  const bytes = createSplitPointerPeFixture();
  const original = Buffer.from(bytes);
  expect(link(bytes).method_addresses).toEqual(expectedAddresses);
  expect(Buffer.compare(bytes, original)).toBe(0);
  expect(failure(createSplitPointerPeFixture(false)).reason).toBe(
    "code-gen-modules-not-found",
  );
});

it("reports a method no image range claims as unknown, not as without a body", () => {
  // No type's method range holds this row, so no module slot describes it.
  const orphan = {
    ...metadata,
    methods: [...metadata.methods, { name: "Lost", declaring_type: -1 }],
  };
  const tokens = Uint32Array.from([...facts.methodTokens, 0x06000001]);
  const linked = linkIl2cppBinary(createIl2cppBinaryFixture(), orphan, {
    ...facts,
    methodTokens: tokens,
  });
  expect(linked.method_addresses).toEqual([
    ...expectedAddresses,
    expectedAddress("unknown"),
  ]);
});

it("finds an x86-64 module array through the instruction that loads it", () => {
  const inlined = createElfFixture(
    createIl2cppBinaryFixture({ codeRegistration: false, codeReference: true }),
    { machine: 62 },
  );
  const linked = link(inlined);
  expect(linked.code_gen_modules_field).toBeNull();
  expect(linked.code_gen_modules_array).toBe(FIXTURE_BINARY_BASE + 0x500n);
  expect(linked.method_addresses).toEqual(
    link(createElfFixture(createIl2cppBinaryFixture(), { machine: 62 }))
      .method_addresses,
  );
});

it.each([
  ["no instruction loads the array", { machine: 62 }, { codeReference: false }],
  ["the image is not x86-64", { machine: 183 }, { codeReference: true }],
] as const)("keeps code-registration-not-found when %s", (_, elf, binary) => {
  expect(
    failure(
      createElfFixture(
        createIl2cppBinaryFixture({ codeRegistration: false, ...binary }),
        elf,
      ),
    ).reason,
  ).toBe("code-registration-not-found");
});

it("finds an arm64 module array through the ADRP+ADD pair that loads it", () => {
  const linked = link(
    createIl2cppBinaryFixture({
      codeRegistration: false,
      adrpAdd: [[0xc00, 0x500]],
    }),
  );
  expect(linked.code_gen_modules_field).toBeNull();
  expect(linked.code_gen_modules_array).toBe(FIXTURE_BINARY_BASE + 0x500n);
  expect(linked.method_addresses).toEqual(expectedAddresses);
});

it.each([
  ["no instruction pair loads the array", {}],
  ["the pair starts off a 4-byte instruction boundary", { at: 0xc02 }],
  ["two module-array candidates are each loaded", { second: true }],
  ["the pair lies outside executable ranges", { protection: 3 }],
] as const)(
  "keeps arm64 code-registration-not-found when %s",
  (_, variant: { at?: number; second?: boolean; protection?: number }) => {
    const bytes = createIl2cppBinaryFixture({
      codeRegistration: false,
      adrpAdd:
        Object.keys(variant).length === 0
          ? []
          : [
              [variant.at ?? 0xc00, 0x500],
              ...(variant.second === true ? [[0xc10, 0x520] as const] : []),
            ],
    });
    if (variant.second === true) bytes.copy(bytes, 0x520, 0x500, 0x510);
    if (variant.protection !== undefined)
      bytes.writeUInt32LE(variant.protection, 92);
    expect(failure(bytes).reason).toBe("code-registration-not-found");
  },
);

it("finds an arm64 type table through the ADRP+ADD pair that loads it", () => {
  const linked = linkWholeTable(
    createIl2cppBinaryFixture({
      metadataRegistration: false,
      adrpAdd: [[0xc20, 0x900]],
    }),
  );
  const reference = linkWholeTable(createIl2cppBinaryFixture());
  expect(linked.types_field).toBeNull();
  expect(linked.types_count).toBe(4);
  expect(linked.return_types).toEqual(reference.return_types);
  expect(linked.field_types).toEqual(reference.field_types);
  expect(linked.parameter_types).toEqual(reference.parameter_types);
});

it("finds an x86-64 type table through the instruction that loads it", () => {
  const image = createIl2cppBinaryFixture({ metadataRegistration: false });
  // lea rcx, [rip + disp32] at 0xc40, loading the type table at 0x900.
  image.set([0x48, 0x8d, 0x0d], 0xc40);
  image.writeInt32LE(0x900 - (0xc40 + 7), 0xc43);
  const linked = linkWholeTable(createElfFixture(image, { machine: 62 }));
  expect(linked.types_field).toBeNull();
  expect(linked.types_count).toBe(4);
  expect(linked.return_types).toEqual(
    linkWholeTable(
      createElfFixture(createIl2cppBinaryFixture(), { machine: 62 }),
    ).return_types,
  );
});

it.each([
  ["the pair loads an address inside the run", { target: 0x908 }],
  [
    "a type-shaped word extends the run before the loaded address",
    { before: true },
  ],
  ["two runs are each loaded", { second: true }],
  [
    "the loaded run is shorter than the referenced type indices",
    { short: true },
  ],
  ["a record's kind is past the Il2CppTypeEnum range", { kind: 0x1f }],
  [
    "a value-type record names a type definition past the metadata",
    { definition: 4n },
  ],
] as const)(
  "keeps metadata-registration-not-found when %s",
  (
    _,
    variant: {
      target?: number;
      before?: boolean;
      second?: boolean;
      short?: boolean;
      kind?: number;
      definition?: bigint;
    },
  ) => {
    const bytes = createIl2cppBinaryFixture({
      metadataRegistration: false,
      adrpAdd: [
        [0xc20, variant.target ?? 0x900],
        ...(variant.second === true ? [[0xc30, 0xb00] as const] : []),
      ],
    });
    if (variant.second === true) bytes.copy(bytes, 0xb00, 0x900, 0x920);
    // The int record (type 3) is a valid Il2CppType, so the run starts at 0x8f8.
    if (variant.before === true)
      bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x9b0n, 0x8f8);
    // Kind 0 ends the run after two entries; the facts below reference type 3.
    if (variant.short === true) bytes.writeUInt32LE(0, 0x980 + 2 * 16 + 8);
    // Either record breaks the four-entry run into pieces shorter than four.
    if (variant.kind !== undefined)
      bytes.writeUInt32LE(variant.kind << 16, 0x980 + 16 + 8);
    if (variant.definition !== undefined)
      bytes.writeBigUInt64LE(variant.definition, 0x980 + 2 * 16);
    // Facts referencing type 3 require a four-entry run.
    const required =
      variant.short === true ||
      variant.kind !== undefined ||
      variant.definition !== undefined
        ? { ...facts, returnTypes: Int32Array.from(facts.returnTypes, () => 3) }
        : facts;
    let reason: string | undefined;
    try {
      linkIl2cppBinary(bytes, metadata, required);
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      reason = cause.reason;
    }
    expect(reason).toBe("metadata-registration-not-found");
  },
);

it.each([
  [
    // The real table is unloaded; a copy elsewhere is loaded instead.
    "only a second long-enough run is loaded",
    { metadataRegistration: false, adrpAdd: [[0xc20, 0xb00]] },
    (bytes: Buffer) => bytes.copy(bytes, 0xb00, 0x900, 0x920),
  ],
  [
    "a static MetadataRegistration matches its counts but not its type table",
    { adrpAdd: [[0xc20, 0x900]] },
    (bytes: Buffer) =>
      bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0xdead0000n, 0x800 + 56),
  ],
  [
    "the loaded run reaches the end of its mapping",
    {
      metadataRegistration: false,
      adrpAdd: [[0xc20, 0x900]],
      splitSegmentAt: 0x920,
    },
    () => undefined,
  ],
  [
    "a record's kind is the unassigned Il2CppTypeEnum value 0x17",
    { metadataRegistration: false, adrpAdd: [[0xc20, 0x900]] },
    (bytes: Buffer) => bytes.writeUInt32LE(0x17 << 16, 0x980 + 16 + 8),
  ],
  [
    "a record's kind is the unassigned Il2CppTypeEnum value 0x1a",
    { metadataRegistration: false, adrpAdd: [[0xc20, 0x900]] },
    (bytes: Buffer) => bytes.writeUInt32LE(0x1a << 16, 0x980 + 16 + 8),
  ],
  [
    // Three entries, one short of the four that type 3 needs.
    "the loaded run is one entry short",
    { metadataRegistration: false, adrpAdd: [[0xc20, 0x900]] },
    (bytes: Buffer) => bytes.writeBigUInt64LE(0n, 0x918),
  ],
  [
    "the ADRP+ADD pair uses register 31",
    { metadataRegistration: false, adrpAdd: [[0xc20, 0x900]] },
    (bytes: Buffer) => {
      bytes.writeUInt32LE((bytes.readUInt32LE(0xc20) | 0x1f) >>> 0, 0xc20);
      bytes.writeUInt32LE((bytes.readUInt32LE(0xc24) | 0x3ff) >>> 0, 0xc24);
    },
  ],
] as const)(
  "keeps metadata-registration-not-found when %s, with the whole table referenced",
  (_, options, patch) => {
    const bytes = createIl2cppBinaryFixture(options);
    patch(bytes);
    let reason: string | undefined;
    try {
      linkWholeTable(bytes);
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      reason = cause.reason;
    }
    expect(reason).toBe("metadata-registration-not-found");
  },
);

it("does not choose a run that starts at its mapping start, where the table may continue backwards", () => {
  // The table spans 0x900..0x920; the split puts its first entry in the
  // previous mapping, and code loads 0x908, the first entry of the next.
  const bytes = createIl2cppBinaryFixture({
    metadataRegistration: false,
    splitSegmentAt: 0x908,
    adrpAdd: [[0xc20, 0x908]],
  });
  let reason: string | undefined;
  try {
    linkIl2cppBinary(bytes, metadata, {
      ...facts,
      returnTypes: Int32Array.from(facts.returnTypes, () => 1),
    });
  } catch (cause) {
    if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
    reason = cause.reason;
  }
  expect(reason).toBe("metadata-registration-not-found");
});

it("says why no MetadataRegistration or inferred type table was accepted", () => {
  const message = (bytes: Buffer) => {
    try {
      linkWholeTable(bytes);
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      return cause.message;
    }
    throw new Error("expected a link failure");
  };
  const unusable = createIl2cppBinaryFixture({ adrpAdd: [[0xc20, 0x900]] });
  unusable.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0xdead0000n, 0x800 + 56);
  expect(message(unusable)).toContain(
    "a MetadataRegistration counts 4 type definitions, but its type table",
  );
  expect(
    message(createIl2cppBinaryFixture({ metadataRegistration: false })),
  ).toContain("no single code-loaded run of Il2CppType pointers");
});

it("does not let a dyld-bound slot's placeholder decide the type-table run", () => {
  const outcome = (placeholder: bigint) => {
    // The last table slot (0x918) is bound by dyld; its stored word is only a
    // placeholder. Remove the static registration and load the table by code.
    const bytes = createIl2cppDyldBindFixture(placeholder, 0x918);
    bytes.fill(0, 0x800, 0x880);
    createIl2cppBinaryFixture({ adrpAdd: [[0xc20, 0x900]] }).copy(
      bytes,
      0xc20,
      0xc20,
      0xc28,
    );
    try {
      return linkWholeTable(bytes).types_count;
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      return cause.reason;
    }
  };
  // A type-shaped placeholder and a zero one give the same refusal.
  expect(outcome(FIXTURE_BINARY_BASE + 0x9b0n)).toBe(
    "metadata-registration-not-found",
  );
  expect(outcome(0n)).toBe("metadata-registration-not-found");
});

it("does not let a dyld-bound record field decide the type-table run", () => {
  const outcome = (bound: boolean) => {
    // The int record (0x9b0) is the table's last entry. Binding the word
    // that holds its kind leaves that kind to the loader, although the
    // stored placeholder still reads as a valid kind.
    const kindWord = createIl2cppBinaryFixture().readBigUInt64LE(0x9b8);
    const bytes = bound
      ? createIl2cppDyldBindFixture(kindWord, 0x9b8)
      : createIl2cppBinaryFixture();
    bytes.fill(0, 0x800, 0x880);
    createIl2cppBinaryFixture({ adrpAdd: [[0xc20, 0x900]] }).copy(
      bytes,
      0xc20,
      0xc20,
      0xc28,
    );
    try {
      return linkWholeTable(bytes).types_count;
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      return cause.reason;
    }
  };
  expect(outcome(false)).toBe(4);
  expect(outcome(true)).toBe("metadata-registration-not-found");
});

it("keeps metadata-registration-not-found when x86-64 code loads an address inside the run", () => {
  const image = createIl2cppBinaryFixture({ metadataRegistration: false });
  image.set([0x48, 0x8d, 0x0d], 0xc40);
  image.writeInt32LE(0x908 - (0xc40 + 7), 0xc43);
  let reason: string | undefined;
  try {
    linkWholeTable(createElfFixture(image, { machine: 62 }));
  } catch (cause) {
    if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
    reason = cause.reason;
  }
  expect(reason).toBe("metadata-registration-not-found");
});

it.each([
  ["a later page", { pages: 2, code: 0xc00, array: 0x1500 }],
  ["an earlier page", { pages: 3, code: 0x2c00, array: 0x500 }],
] as const)(
  "follows an arm64 ADRP page delta to a module array on %s",
  (_, layout) => {
    const bytes = createIl2cppBinaryFixture({
      codeRegistration: false,
      pages: layout.pages,
      adrpAdd: [[layout.code, layout.array]],
    });
    if (layout.array !== 0x500) {
      bytes.copy(bytes, layout.array, 0x500, 0x510);
      bytes.fill(0, 0x500, 0x510);
    }
    const linked = link(bytes);
    expect(linked.code_gen_modules_array).toBe(
      FIXTURE_BINARY_BASE + BigInt(layout.array),
    );
    expect(linked.method_addresses).toEqual(expectedAddresses);
  },
);

it("follows a negative arm64 ADRP page delta to the type table", () => {
  const linked = linkWholeTable(
    createIl2cppBinaryFixture({
      metadataRegistration: false,
      pages: 3,
      adrpAdd: [[0x2c20, 0x900]],
    }),
  );
  expect(linked.types_field).toBeNull();
  expect(linked.types_count).toBe(4);
});

it.each([
  ["destination", 0],
  ["source", 5],
] as const)(
  "keeps code-registration-not-found when the ADD %s register differs from the ADRP register",
  (_, shift) => {
    const bytes = createIl2cppBinaryFixture({
      codeRegistration: false,
      adrpAdd: [[0xc00, 0x500]],
    });
    const add = bytes.readUInt32LE(0xc04);
    // The fixture pair uses x8; write x9 into one register field of the ADD.
    bytes.writeUInt32LE(((add & ~(0x1f << shift)) | (9 << shift)) >>> 0, 0xc04);
    expect(failure(bytes).reason).toBe("code-registration-not-found");
  },
);

it("fails closed at the second type-table candidate when the metadata references few type indices", () => {
  const bytes = createIl2cppBinaryFixture({
    metadataRegistration: false,
    pages: 2,
    adrpAdd: [[0xc20, 0x900]],
  });
  // 65 isolated pointers to the int record, each a one-entry run.
  for (let index = 0; index < 65; index++)
    bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x9b0n, 0x1000 + index * 16);
  const outcome = (required: typeof facts) => {
    try {
      return linkIl2cppBinary(bytes, metadata, required).types_count;
    } catch (cause) {
      if (!(cause instanceof Il2cppBinaryFormatFailure)) throw cause;
      return cause.reason;
    }
  };
  // Fixture methods reference only type 0, so every isolated pointer is a
  // candidate run, and the second one ends the search.
  expect(outcome(facts)).toBe("metadata-registration-not-found");
  // Referencing type 3 requires four entries; the isolated pointers drop out.
  expect(
    outcome({
      ...facts,
      returnTypes: Int32Array.from(facts.returnTypes, () => 3),
    }),
  ).toBe(4);
});

it("refuses to choose among too many candidate module arrays", () => {
  const base = createIl2cppBinaryFixture({
    codeRegistration: false,
    codeReference: true,
  });
  // Copy the two-slot module array (16 bytes at 0x500) 80 times after the image.
  const copies = Buffer.concat(
    Array.from({ length: 80 }, () => base.subarray(0x500, 0x510)),
  );
  const crafted = Buffer.concat([base, copies]);
  crafted.writeBigUInt64LE(BigInt(crafted.length), 64);
  crafted.writeBigUInt64LE(BigInt(crafted.length), 80);
  // Mach-O is arm64 in the fixture; relabel it x86-64 so the fallback runs.
  crafted.writeUInt32LE(0x01000007, 4);
  crafted.writeUInt32LE(3, 8);
  expect(failure(crafted).reason).toBe("native-index-capacity");
});

it("retains overlapping fallback arrays when only the later window is referenced", () => {
  const bytes = createIl2cppBinaryFixture({
    codeRegistration: false,
    codeReference: true,
  });
  bytes.writeUInt32LE(0x01000007, 4);
  bytes.writeUInt32LE(3, 8);
  // [B, A, B] contains both [B, A] and [A, B]; code references only [A, B].
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x440n, 0x500);
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x400n, 0x508);
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x440n, 0x510);
  bytes.writeInt32LE(0x508 - (0xc00 + 7), 0xc03);
  const linked = link(bytes);
  expect(linked.code_gen_modules_field).toBeNull();
  expect(linked.code_gen_modules_array).toBe(FIXTURE_BINARY_BASE + 0x508n);
  expect(linked.method_addresses).toEqual(expectedAddresses);
});

it("finds image names padded with 0xFF as MSVC writes them", () => {
  expect(link(createIl2cppBinaryFixture({ namePadding: 0xff }))).toEqual(
    link(createIl2cppBinaryFixture()),
  );
});

it("does not match a longer string merely because its suffix names an image", () => {
  const bytes = createIl2cppBinaryFixture({ namePrefix: "Mono." });
  const suffix = bytes.readBigUInt64LE(0x440);
  bytes.writeBigUInt64LE(suffix - 5n, 0x440); // The record actually names Mono.mscorlib.dll.
  expect(failure(bytes).reason).toBe("code-gen-modules-not-found");
});
it("accepts a module's declared pointer into a suffix-shared C string", () => {
  expect(
    link(createIl2cppBinaryFixture({ namePrefix: "Mono." })).method_addresses,
  ).toEqual(expectedAddresses);
});

it("links an ELF shared object after applying its RELATIVE relocations", () => {
  const elf = createElfFixture(createIl2cppBinaryFixture());
  const fromMacho = link(createIl2cppBinaryFixture());
  expect(link(elf)).toEqual({ ...fromMacho, format: "elf" });
});

it.each([183, 62])(
  "streams more than 65536 file-backed relative writes without shrinking IL2CPP capacity (machine %s)",
  (machine) => {
    const source = createIl2cppBinaryFixture();
    const bytes = createLargeElfRelativeFixture(source, 65_537, machine);
    const snapshot = Buffer.from(bytes);
    expect(link(bytes).method_addresses).toEqual(
      link(createElfFixture(source, { machine })).method_addresses,
    );
    expect(bytes.equals(snapshot)).toBe(true);
  },
);

it.each([183, 62])(
  "links ELF relocations using the resolved PN_XNUM program count (machine %s)",
  (machine) => {
    const original = createElfFixture(createIl2cppBinaryFixture(), { machine });
    const count = 65536;
    const table = original.length;
    const sectionZero = table + count * 56;
    const extended = Buffer.concat([original, Buffer.alloc(count * 56 + 64)]);
    // Keep mapped payload bytes untouched; the last declaration is beyond
    // the raw 0xffff sentinel that the old relocation scan treated as a count.
    original.copy(extended, table, 64, 120);
    original.copy(extended, table + (count - 1) * 56, 120, 176);
    extended.writeBigUInt64LE(BigInt(table), 32);
    extended.writeBigUInt64LE(BigInt(sectionZero), 40);
    extended.writeUInt16LE(0xffff, 56);
    extended.writeUInt16LE(64, 58);
    extended.writeUInt16LE(1, 60);
    extended.writeUInt32LE(count, sectionZero + 44);
    expect(link(extended).method_addresses).toEqual(
      link(original).method_addresses,
    );
  },
);

it("ignores undefined PT_NULL fields while linking ELF relocations", () => {
  const original = createElfFixture(createIl2cppBinaryFixture());
  const bytes = Buffer.from(original);
  bytes.writeUInt16LE(3, 56);
  bytes.fill(0xff, 176, 232);
  bytes.writeUInt32LE(0, 176);
  expect(link(bytes).method_addresses).toEqual(link(original).method_addresses);
});

it.each(["outside", "misaligned", "duplicate"] as const)(
  "refuses a %s dynamic declaration at relocation admission",
  (shape) => {
    const bytes = createElfFixture(createIl2cppBinaryFixture());
    if (shape === "outside") bytes.writeBigUInt64LE(1n << 63n, 128);
    else if (shape === "misaligned") bytes.writeBigUInt64LE(17n, 152);
    else {
      bytes.copy(bytes, 176, 120, 176);
      bytes.writeUInt16LE(3, 56);
    }
    expect(() => readBinaryContainer(bytes)).not.toThrow();
    expect(() => link(bytes)).toThrow(
      shape === "duplicate"
        ? "multiple PT_DYNAMIC segments"
        : "PT_DYNAMIC is truncated or outside the file",
    );
  },
);

it.each([
  [{ dynamic: false }, "unsupported-container"],
  [{ machine: 243 }, "unsupported-container"],
  [{ androidPacked: true }, "unsupported-pointer-encoding"],
] as const)(
  "refuses ELF relocations it cannot apply (%o)",
  (options, reason) => {
    expect(
      failure(createElfFixture(createIl2cppBinaryFixture(), options)),
    ).toEqual({
      reason,
      kind: "unsupported",
    });
  },
);

it.each([
  ["Assembly CSharp.dll", "mscorlib.dll"],
  ["程序集.dll", "mscorlib.dll"],
  ["shared.dll", "shared.dll"],
] as const)(
  "preserves module names and all candidate owners: %s / %s",
  (first, second) => {
    const imageNames = [first, second] as const;
    const selected = {
      ...metadata,
      images: metadata.images.map((image, index) => ({
        ...image,
        name: imageNames[index]!,
      })),
    };
    const linked = linkIl2cppBinary(
      createIl2cppBinaryFixture({ imageNames }),
      selected,
      facts,
    );
    expect(linked.method_addresses).toEqual(expectedAddresses);
  },
);

it("requires executable loader coverage before calling a mapped pointer code", () => {
  const bytes = createIl2cppBinaryFixture();
  bytes.writeUInt32LE(3, 92); // __TEXT is mapped read/write, with no execute permission.
  expect(failure(bytes).reason).toBe("invalid-method-pointer");
});

it("does not treat RIP-relative-looking data as executable registration evidence", () => {
  const bytes = createIl2cppBinaryFixture({
    codeRegistration: false,
    codeReference: true,
  });
  bytes.writeUInt32LE(0x01000007, 4);
  bytes.writeUInt32LE(3, 92);
  expect(failure(bytes).reason).toBe("code-registration-not-found");
});

it("yields throughout a large scan before reaching a later invalid method token", () => {
  const bytes = Buffer.alloc(16 * 1024 * 1024, 0xaa);
  createIl2cppBinaryFixture().copy(bytes);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 64);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  const steps = linkIl2cppBinarySteps(bytes, metadata, {
    ...facts,
    methodTokens: Uint32Array.from([0, ...facts.methodTokens.slice(1)]),
  });
  for (let index = 0; index < 200; index++)
    expect(steps.next().done).toBe(false);
  // Abandoning the cooperatively cancellable scan owns no external resources.
  steps.return(undefined as never);
});

it("rejects a recursive binary type graph without overflowing the JavaScript stack", () => {
  const bytes = createIl2cppBinaryFixture();
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x980n, 0x980);
  expect(failure(bytes).reason).toBe("invalid-type");
});

it("guards a shared generic expansion before concatenating unchecked text", () => {
  const expanded = readIl2cppMetadataForLinking(
    createLinkedIl2cppMetadataFixture({
      genericTypeArgumentCounts: { 3: 2 },
    }).bytes,
  );
  const bytes = Buffer.alloc(0x4000);
  createIl2cppBinaryFixture().copy(bytes);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 64);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  let prior = FIXTURE_BINARY_BASE + 0x9b0n; // int
  for (let level = 0; level < 12; level++) {
    const at = 0x1000 + level * 96,
      address = FIXTURE_BINARY_BASE + BigInt(at);
    bytes.writeBigUInt64LE(address + 16n, at);
    bytes.writeUInt32LE(0x15 << 16, at + 8);
    bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0x9a0n, at + 16);
    bytes.writeBigUInt64LE(address + 32n, at + 24);
    bytes.writeUInt32LE(2, at + 32);
    bytes.writeBigUInt64LE(address + 48n, at + 40);
    bytes.writeBigUInt64LE(prior, at + 48);
    bytes.writeBigUInt64LE(prior, at + 56);
    prior = address;
  }
  bytes.writeBigUInt64LE(prior, 0x900);
  const stopped = new Error("type text admission");
  const steps = linkIl2cppBinarySteps(
    bytes,
    expanded.metadata,
    expanded.link,
    undefined,
    {
      beforeText: (size) => {
        if (size > 1024) throw stopped;
      },
    },
  );
  expect(() => {
    for (;;) {
      if (steps.next().done) break;
    }
  }).toThrow(stopped);
});

it("reports a symbol-relocated method slot as unknown rather than no-body", () => {
  const bytes = createElfFixture(createIl2cppBinaryFixture());
  const dynamic = Number(bytes.readBigUInt64LE(128));
  const relocationBytes = Number(bytes.readBigUInt64LE(dynamic + 24));
  for (let at = 0x1000; at < 0x1000 + relocationBytes; at += 24) {
    if (bytes.readBigUInt64LE(at) !== FIXTURE_BINARY_BASE + 0x300n) continue;
    bytes.writeBigUInt64LE((1n << 32n) | 1025n, at + 8); // unresolved symbol, not RELATIVE
  }
  const linked = link(bytes);
  expect(linked.method_addresses[1]).toEqual(expectedAddress("unknown"));
  expect(linked.method_addresses[0]).toEqual(expectedAddresses[0]);
});

it.each([0n, FIXTURE_BINARY_BASE + 0x210n])(
  "keeps a dyld-bound method slot unknown regardless of its raw word %s",
  (raw) => {
    const linked = link(createIl2cppDyldBindFixture(raw));
    expect(linked.method_addresses[1]).toEqual(expectedAddress("unknown"));
    expect(linked.method_addresses[0]).toEqual(expectedAddresses[0]);
    expect(linked.method_addresses[4]).toEqual(expectedAddress("no-body"));
  },
);

it("keeps unbound Mach-O method words classified from their values", () => {
  const linked = link(createIl2cppBinaryFixture());
  expect(linked.method_addresses[1]).toEqual(expectedAddresses[1]);
  expect(linked.method_addresses[4]).toEqual(expectedAddress("no-body"));
});
it("refuses an unresolved inner type value instead of rendering its stored placeholder", () => {
  expect(
    failure(createIl2cppDyldBindFixture(FIXTURE_BINARY_BASE + 0x990n, 0x980)),
  ).toEqual({
    reason: "unsupported-pointer-encoding",
    kind: "unsupported",
  });
});
it.each([
  [0x600, 2n, "code-registration-not-found"],
  [0x408, 3n, "code-gen-modules-not-found"],
  [0x850, 4n, "metadata-registration-not-found"],
  [0x860, 4n, "metadata-registration-not-found"],
  [0x988, 0x001d0000n, "unsupported-pointer-encoding"],
] as const)("does not trust a dyld-owned scalar at %s", (slot, raw, reason) => {
  expect(failure(createIl2cppDyldBindFixture(raw, slot)).reason).toBe(reason);
});
it.each([
  [0x5f8, 0n, 2],
  [0x5fc, 2n << 32n, "unknown"],
  [0x600, 2n, "unknown"],
  [0x604, 0n, 2],
] as const)(
  "uses the four-byte count span for a dyld bind at %s",
  (slot, raw, expected) => {
    const steps = openImageSteps(
      createIl2cppDyldBindFixture(raw, slot),
      undefined,
    );
    let step = steps.next();
    while (!step.done) step = steps.next();
    expect(readUInt32(step.value, FIXTURE_BINARY_BASE + 0x600n)).toBe(expected);
  },
);
it.each([
  [0x400, "code-gen-modules-not-found"],
  [0x410, "code-gen-modules-not-found"],
  [0x500, "code-registration-not-found"],
  [0x608, "code-registration-not-found"],
  [0x838, "metadata-registration-not-found"],
] as const)(
  "does not nominate a registration from dyld-owned word at %s",
  (slot, reason) => {
    const raw = createIl2cppBinaryFixture().readBigUInt64LE(slot);
    expect(failure(createIl2cppDyldBindFixture(raw, slot)).reason).toBe(reason);
  },
);
it.each([1, 0xff])(
  "ignores ABI count padding byte %d without accepting a changed count",
  (padding) => {
    const bytes = createIl2cppBinaryFixture();
    bytes.fill(padding, 0x604, 0x608);
    expect(link(bytes)).toEqual(link(createIl2cppBinaryFixture()));
    bytes.writeUInt32LE(3, 0x600);
    expect(failure(bytes).reason).toBe("code-registration-not-found");
  },
);
it.each([8, 16] as const)(
  "rejects %d absent registration bytes without declared zero-fill",
  (tailBytes) => {
    expect(
      failure(createIl2cppRegistrationTailFixture(tailBytes, false)).reason,
    ).toBe("metadata-registration-not-found");
  },
);

it.each([
  ["PC32", 2],
  ["ABS32", 10],
] as const)(
  "keeps a method pointer beside a non-overlapping %s relocation",
  (_, kind) => {
    const binary = createIl2cppBinaryFixture();
    const adjacent = createElfFixture(binary, {
      machine: 62,
      unresolvedRelocations: [{ offset: 0x2fc, kind }],
    });
    expect(link(adjacent).method_addresses).toEqual(expectedAddresses);

    const overlapping = createElfFixture(binary, {
      machine: 62,
      unresolvedRelocations: [{ offset: 0x300, kind }],
    });
    expect(link(overlapping).method_addresses[1]).toEqual(
      expectedAddress("unknown"),
    );
  },
);

it("reads a relative relocation into a zero-filled pointer array as a known value", () => {
  const bytes = createElfFixture(createIl2cppBinaryFixture(), {
    zeroFilledTable: true,
  });
  const dynamic = Number(bytes.readBigUInt64LE(128));
  const relocationBytes = Number(bytes.readBigUInt64LE(dynamic + 24));
  // Reuse the now-unused second module's file-backed first slot relocation.
  for (let at = 0x1000; at < 0x1000 + relocationBytes; at += 24) {
    if (bytes.readBigUInt64LE(at) === FIXTURE_BINARY_BASE + 0x318n)
      bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + BigInt(bytes.length), at);
  }
  expect(link(bytes).method_addresses).toEqual([
    ...expectedAddresses.slice(0, 4),
    expectedAddress("no-body"),
  ]);
});

it("refuses an ambiguous architecture instead of choosing the first FAT slice", () => {
  const bytes = createUniversalFixture([
    { cpu: 0x0100000c, bytes: createIl2cppBinaryFixture() },
    { cpu: 0x0100000c, bytes: createIl2cppBinaryFixture() },
  ]);
  expect(failure(bytes, "arm64").reason).toBe("ambiguous-slice-selection");
});
it("checks the observed slice header against the caller-selected FAT architecture", () => {
  const bytes = createUniversalFixture([
    { cpu: 0x01000007, bytes: createIl2cppBinaryFixture() },
  ]);
  expect(failure(bytes, "amd64").reason).toBe("malformed-container");
});
it.each([1, 0x80000000])(
  "checks the complete FAT CPU subtype including capability bits (%i)",
  (subtype) => {
    const thin = createIl2cppBinaryFixture();
    thin.writeUInt32LE(subtype, 8);
    const bytes = createUniversalFixture([{ cpu: 0x0100000c, bytes: thin }]);
    expect(failure(bytes, "arm64").reason).toBe("malformed-container");
    bytes.writeUInt32BE(subtype, 12);
    expect(link(bytes, "arm64").method_addresses).toEqual(expectedAddresses);
  },
);
it("still validates version 27 type indices when rendered names are unavailable", () => {
  const decoded = readIl2cppMetadataForLinking(
    createIl2cppMetadataFixture({ version: 27 }).bytes,
  );
  const input = {
    ...decoded.link,
    returnTypes: Int32Array.from([999, ...decoded.link.returnTypes.slice(1)]),
  };
  expect(() =>
    linkIl2cppBinary(createIl2cppBinaryFixture(), decoded.metadata, input),
  ).toThrow("invalid-type");
});

it("reads type attributes without requiring file-backed alignment padding", () => {
  const bytes = createIl2cppBinaryFixture().subarray(0, 0xffc);
  bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
  bytes.writeBigUInt64LE(FIXTURE_BINARY_BASE + 0xff0n, 0x900);
  bytes.writeBigUInt64LE(0n, 0xff0);
  bytes.writeUInt32LE(0x08 << 16, 0xff8);
  expect(link(bytes).return_types.map((row) => row.name)).toEqual(
    Array.from({ length: 5 }, () => "int"),
  );
});

// The generic owners declare the containers the fixture's instances fill.
const genericFacts = (version: 24 | 27 | 31 | 39) =>
  readIl2cppMetadataForLinking(
    createIl2cppMetadataFixture({ version, genericOwners: true }).bytes,
  );
it("allocates no generic container column, reading method containers on demand", () => {
  // Only the per-row columns every link uses are typed arrays; type rendering
  // keeps each type's generic argument count, but no container index.
  const { metadata: decoded, link } = genericFacts(31);
  const columns = Object.entries(link)
    .filter(([, value]) => ArrayBuffer.isView(value))
    .map(([key]) => key)
    .sort();
  expect(columns).toEqual([
    "fieldTypes",
    "genericTypeArgumentCounts",
    "methodTokens",
    "parameterTypes",
    "returnTypes",
  ]);
  const count = decoded.methods.length;
  expect(link.methodGenericContainer(-1)).toBeUndefined();
  expect(link.methodGenericContainer(count)).toBeUndefined();
  // ToString<int> (method 4) is generic; .ctor (method 3) is not.
  expect(link.methodGenericContainer(3)).toBe(-1);
  expect(link.methodGenericContainer(4)).toBeGreaterThanOrEqual(0);
});
const linkGeneric = (
  options: GenericMethodFixtureOptions = {},
  version: 24 | 27 | 31 | 39 = 31,
  bytes = createIl2cppBinaryFixture({ genericMethods: options }),
) => {
  const decoded = genericFacts(version);
  return linkIl2cppBinary(bytes, decoded.metadata, decoded.link, undefined, {
    genericInstances: true,
  });
};
const genericFailure = (
  options: GenericMethodFixtureOptions,
  version: 24 | 27 | 31 | 39 = 31,
) => {
  try {
    linkGeneric(options, version);
  } catch (cause) {
    if (cause instanceof Il2cppBinaryFormatFailure)
      return { reason: cause.reason, kind: cause.kind };
    throw cause;
  }
  throw new Error("expected a link failure");
};
const at = (offset: bigint) =>
  `0x${(FIXTURE_BINARY_BASE + offset).toString(16)}`;
const unknownRow = { state: "unknown", address: null, rva: null } as const;
// Smallest serialized generic row, checked per table entry before resolving.
const minimumGenericRow = JSON.stringify({
  ...unknownRow,
  method_spec: 0,
  method: 0,
  name: null,
}).length;

it("links generic method instances only when asked", () => {
  // Not requested is unknown, not an empty table.
  expect(
    link(createIl2cppBinaryFixture({ genericMethods: {} })).generic_methods,
  ).toBeNull();
  const linked = linkGeneric();
  expect(linked.method_addresses).toEqual(expectedAddresses);
  expect(linked.generic_methods).toEqual({
    generic_method_pointers_field: FIXTURE_BINARY_BASE + 0x600n - 104n + 16n,
    generic_method_pointers_count: 3,
    generic_method_table: FIXTURE_BINARY_BASE + 0xbc0n,
    generic_method_table_count: 3,
    generic_method_table_stride: 16,
    method_specs_count: 3,
    generic_insts_count: 2,
    instances: FIXTURE_GENERIC_INSTANCES,
    issues: [],
  });
});

it("admits every generic row and issue before retention", () => {
  const decoded = genericFacts(31);
  const rows: Readonly<Record<string, unknown>>[] = [];
  const checked: number[] = [];
  linkIl2cppBinary(
    createIl2cppBinaryFixture({ genericMethods: { firstSpecMethod: 9 } }),
    decoded.metadata,
    decoded.link,
    undefined,
    {
      genericInstances: true,
      onRow: (row) => rows.push(row),
      beforeText: (bytes) => checked.push(bytes),
    },
  );
  // The whole table is checked before the first row is resolved.
  expect(checked).toContain(3 * minimumGenericRow);
  expect(rows.filter((row) => "method_spec" in row)).toHaveLength(3);
  expect(rows).toContainEqual({
    row: 0,
    address: at(0xb80n),
    message: "method spec 0 names method 9 outside the 5 metadata methods",
  });
  // A refused budget check stops before any generic row is retained.
  const refused: unknown[] = [];
  expect(() =>
    linkIl2cppBinary(
      createIl2cppBinaryFixture({ genericMethods: {} }),
      decoded.metadata,
      decoded.link,
      undefined,
      {
        genericInstances: true,
        onRow: (row) => refused.push(row),
        beforeText: (bytes) => {
          if (bytes === 3 * minimumGenericRow) throw new Error("budget");
        },
      },
    ),
  ).toThrow("budget");
  expect(
    refused.some(
      (row) => typeof row === "object" && row !== null && "method_spec" in row,
    ),
  ).toBe(false);
});

it("reports entries past the 64-bit address space at their table row", () => {
  const top = 0xffffffffffffffffn;
  // Spec 1 from the last address is 0x1000000000000000b; every row stays
  // unknown and each issue keeps an address inside the binary.
  const specs = linkGeneric({ methodSpecs: top }).generic_methods!;
  expect(specs.instances.map((row) => row.state)).toEqual([
    "unknown",
    "unknown",
    "unknown",
  ]);
  expect(specs.issues.map((entry) => entry.address)).toEqual([
    at(0xbc0n),
    at(0xbd0n),
    at(0xbe0n),
  ]);
  expect(specs.issues[1]!.message).toBe(
    "method spec 1 lies outside the 64-bit address space from methodSpecs at 0xffffffffffffffff",
  );
  const slots = linkGeneric({ genericMethodPointers: top }).generic_methods!;
  expect(slots.instances.map((row) => row.state)).toEqual([
    "unknown",
    "unknown",
    "unknown",
  ]);
  expect(slots.issues).toContainEqual({
    row: 1,
    address: at(0xbd4n),
    message:
      "genericMethodPointers slot 1 lies outside the 64-bit address space from genericMethodPointers at 0xffffffffffffffff",
  });
});

it("keeps unreadable method-definition indexes unknown instead of inventing -1", () => {
  const generic = linkGeneric({
    methodSpecs: 0xffffffffffffffffn,
  }).generic_methods!;
  expect(generic.instances.map((row) => row.method)).toEqual([
    null,
    null,
    null,
  ]);
  expect(generic.instances.every((row) => row.state === "unknown")).toBe(true);
});

it("retains a recorded negative method-definition index as source evidence", () => {
  const generic = linkGeneric({ firstSpecMethod: -1 }).generic_methods!;
  expect(generic.instances[0]).toMatchObject({
    method: -1,
    state: "unknown",
    name: null,
  });
  expect(generic.issues[0]?.message).toContain("method -1");
});

it("selects the 27.0 layout by its 12-byte rows and agreeing counts", () => {
  const linked = linkGeneric({ stride: 12 }, 27);
  expect(linked.generic_methods).toMatchObject({
    generic_method_pointers_field: FIXTURE_BINARY_BASE + 0x600n - 96n + 16n,
    generic_method_table_stride: 12,
    instances: FIXTURE_GENERIC_INSTANCES,
  });
  // Header version 27 also covers 27.1 and 27.2, which add adjustor thunks.
  expect(linkGeneric({ stride: 16 }, 27).generic_methods).toMatchObject({
    generic_method_pointers_field: FIXTURE_BINARY_BASE + 0x600n - 104n + 16n,
    generic_method_table_stride: 16,
    instances: FIXTURE_GENERIC_INSTANCES,
  });
  // Version 31 has no 12-byte-row layout to try.
  expect(genericFailure({ stride: 12 }, 31).reason).toBe(
    "generic-method-registration-not-found",
  );
});

it.each<
  [string, GenericMethodFixtureOptions, 24 | 27 | 31 | 39, string, string]
>([
  [
    "a binary without CodeRegistration generic fields",
    { codeRegistration: false },
    31,
    "generic-method-registration-not-found",
    "malformed",
  ],
  [
    "a row past genericMethodPointersCount",
    { firstPointerSlot: 3 },
    31,
    "generic-method-registration-not-found",
    "malformed",
  ],
  [
    // Its type-definition container offset and generic class layout are
    // unchecked, although a 24.2 CodeRegistration layout would agree here.
    "metadata version 24",
    { stride: 12 },
    24,
    "generic-methods-unsupported",
    "unsupported",
  ],
  ["metadata version 39", {}, 39, "generic-methods-unsupported", "unsupported"],
])("refuses generic linking for %s", (_, options, version, reason, kind) => {
  expect(genericFailure(options, version)).toEqual({ reason, kind });
});

it("refuses generic linking when the type table was inferred", () => {
  // Without a static MetadataRegistration, genericMethodTable has no anchor.
  const decoded = genericFacts(31);
  expect(() =>
    linkIl2cppBinary(
      createIl2cppBinaryFixture({
        metadataRegistration: false,
        adrpAdd: [[0xc20, 0x900]],
      }),
      decoded.metadata,
      {
        ...decoded.link,
        returnTypes: Int32Array.from(decoded.link.returnTypes, () => 3),
      },
      undefined,
      { genericInstances: true },
    ),
  ).toThrow(
    expect.objectContaining({
      reason: "generic-methods-unsupported",
      message: expect.stringContaining("no static MetadataRegistration"),
    }),
  );
});

it("keeps contradicting rows unknown and reports the record address", () => {
  const issues = (options: GenericMethodFixtureOptions) => {
    const generic = linkGeneric(options).generic_methods!;
    return { first: generic.instances[0], issues: generic.issues };
  };
  // A contradicting method spec keeps no address, although its slot is valid.
  expect(issues({ firstSpecMethod: 9 })).toEqual({
    first: {
      ...FIXTURE_GENERIC_INSTANCES[0],
      ...unknownRow,
      method: 9,
      name: null,
    },
    issues: [
      {
        row: 0,
        address: at(0xb80n),
        message: "method spec 0 names method 9 outside the 5 metadata methods",
      },
    ],
  });
  expect(issues({ firstSpecClass: 2 })).toEqual({
    first: { ...FIXTURE_GENERIC_INSTANCES[0], ...unknownRow, name: null },
    issues: [
      {
        row: 0,
        address: at(0xb80n),
        message:
          "method spec 0 names generic instances 2 and -1, outside the 2 readable genericInsts",
      },
    ],
  });
  const outside = FIXTURE_BINARY_BASE + 0x10000n;
  expect(issues({ firstSlot: outside })).toEqual({
    first: { ...FIXTURE_GENERIC_INSTANCES[0], ...unknownRow },
    issues: [
      {
        row: 0,
        address: at(0xd00n),
        message: `genericMethodPointers slot 0 points outside unambiguous executable file data at 0x${outside.toString(16)}`,
      },
    ],
  });
  // Il2CppDumper keys pointers by method spec and refuses a second row, so
  // neither row's name or address is kept.
  const duplicate = linkGeneric({ duplicateSpec: true }).generic_methods!;
  expect(
    duplicate.instances.map(({ name, state }) => ({ name, state })),
  ).toEqual([
    { name: null, state: "unknown" },
    { name: FIXTURE_GENERIC_INSTANCES[1]!.name, state: "code" },
    { name: null, state: "unknown" },
  ]);
  expect(duplicate.issues).toEqual([
    {
      row: 0,
      address: at(0xbc0n),
      message:
        "method spec 0 is shared by 2 genericMethodTable rows, including row 2",
    },
    {
      row: 2,
      address: at(0xbc0n + 32n),
      message:
        "method spec 0 is shared by 2 genericMethodTable rows, including row 0",
    },
  ]);
});

it.each<[string, GenericMethodFixtureOptions, string]>([
  [
    "class arguments for a type without a generic container",
    { firstSpecMethod: 2 },
    "method spec 0 gives type 1 1 generic arguments, but it declares 0",
  ],
  [
    "class arguments that disagree with the container's count",
    { firstSpecClass: 1 },
    "method spec 0 gives type 3 2 generic arguments, but it declares 1",
  ],
  [
    "method arguments for a method without a generic container",
    { firstSpecMethodInstance: 0 },
    "method spec 0 gives method 3 1 generic arguments, but it declares 0",
  ],
])("keeps a method spec with %s unnamed", (_, options, message) => {
  const generic = linkGeneric(options).generic_methods!;
  expect(generic.instances[0]).toMatchObject({ name: null, ...unknownRow });
  expect(generic.instances.slice(1)).toEqual(
    FIXTURE_GENERIC_INSTANCES.slice(1),
  );
  expect(generic.issues).toEqual([{ row: 0, address: at(0xb80n), message }]);
});

it("keeps a method spec unnamed when its owner's container is out of range", () => {
  // Method 4 (ToString<int>) points past the decoded generic containers.
  const decoded = genericFacts(31);
  const link = {
    ...decoded.link,
    methodGenericContainer: (index: number) =>
      index === 4 ? 99 : decoded.link.methodGenericContainer(index),
  };
  const generic = linkIl2cppBinary(
    createIl2cppBinaryFixture({ genericMethods: {} }),
    decoded.metadata,
    link,
    undefined,
    { genericInstances: true },
  ).generic_methods!;
  expect(generic.instances).toEqual([
    FIXTURE_GENERIC_INSTANCES[0],
    FIXTURE_GENERIC_INSTANCES[1],
    { ...FIXTURE_GENERIC_INSTANCES[2], name: null, ...unknownRow },
  ]);
  expect(generic.issues).toEqual([
    {
      row: 2,
      address: at(0xb80n + 24n),
      message:
        "method spec 2 gives method 4 1 generic arguments, but its generic container 99 is out of range",
    },
  ]);
});

it("keeps a generic slot with an unresolved relocation unknown", () => {
  // An ELF symbol relocation on slot 1 leaves its pointer unresolved.
  const bytes = createElfFixture(
    createIl2cppBinaryFixture({ genericMethods: {} }),
  );
  const dynamic = Number(bytes.readBigUInt64LE(128));
  const relocationBytes = Number(bytes.readBigUInt64LE(dynamic + 24));
  for (let entry = 0x1000; entry < 0x1000 + relocationBytes; entry += 24)
    if (bytes.readBigUInt64LE(entry) === FIXTURE_BINARY_BASE + 0xd08n)
      bytes.writeBigUInt64LE((1n << 32n) | 1025n, entry + 8);
  const generic = linkGeneric({}, 31, bytes).generic_methods!;
  expect(generic.instances[1]).toEqual({
    ...FIXTURE_GENERIC_INSTANCES[1],
    ...unknownRow,
  });
  expect(generic.issues).toEqual([
    {
      row: 1,
      address: at(0xd08n),
      message: "genericMethodPointers slot 1 has an unresolved relocation",
    },
  ]);
});

it("keeps the other generic rows when one pointer slot is unmapped", () => {
  // Slot 2 lies past the only segment; rows 0 and 1 keep their code.
  const generic = linkGeneric({ unmappedLastSlot: true }).generic_methods!;
  expect(generic.instances).toEqual([
    FIXTURE_GENERIC_INSTANCES[0],
    FIXTURE_GENERIC_INSTANCES[1],
    { ...FIXTURE_GENERIC_INSTANCES[2], ...unknownRow },
  ]);
  expect(generic.issues).toEqual([
    {
      row: 2,
      address: at(0x1000n),
      message: "genericMethodPointers slot 2 is not file mapped",
    },
  ]);
});

it("names generic instances whose argument array spans two segments", () => {
  // <Größe<int>, int> keeps its arguments at 0xb68 and 0xb70, one per segment.
  const bytes = createIl2cppBinaryFixture({
    genericMethods: {},
    splitSegmentAt: 0xb70,
  });
  const generic = linkGeneric({}, 31, bytes).generic_methods!;
  expect(generic.instances).toEqual(FIXTURE_GENERIC_INSTANCES);
  expect(generic.issues).toEqual([]);
});

it("returns no instances for an empty genericMethodTable without picking a layout", () => {
  // With no rows every readable layout bounds the table, so none is chosen.
  expect(linkGeneric({ emptyTable: true }).generic_methods).toEqual({
    generic_method_pointers_field: null,
    generic_method_pointers_count: null,
    generic_method_table: FIXTURE_BINARY_BASE + 0xbc0n,
    generic_method_table_count: 0,
    generic_method_table_stride: null,
    method_specs_count: 3,
    generic_insts_count: 2,
    instances: [],
    issues: [],
  });
});

// Link a low-base image of generic tables only, recording yields and rows.
const linkLowBase = (
  options: GenericRegistrationImageOptions = {},
  events: string[] = [],
  checked: number[] = [],
) => {
  const fixture = createGenericRegistrationImage(options);
  const decoded = genericFacts(31);
  return drain(
    linkGenericMethodsSteps(
      drain(openImageSteps(fixture.bytes, undefined)),
      decoded.metadata,
      decoded.link,
      fixture.modulesField,
      fixture.metadataRegistration,
      {
        beforeText: (bytes) => checked.push(bytes),
        onRow: (row) => events.push("method_spec" in row ? "row" : "issue"),
      },
    ),
    () => events.push("yield"),
  );
};
const lowBaseFailure = (options: GenericRegistrationImageOptions) => {
  try {
    linkLowBase(options);
  } catch (cause) {
    if (cause instanceof Il2cppBinaryFormatFailure) return cause.reason;
    throw cause;
  }
  throw new Error("expected a link failure");
};

it("refuses generic rows that two CodeRegistration layouts both bound", () => {
  // The 120-byte layout alone is chosen when the 104-byte one disagrees.
  expect(linkLowBase()).toMatchObject({
    generic_method_pointers_field: GENERIC_IMAGE_BASE + 0x600n - 120n + 16n,
    generic_method_table_stride: 16,
  });
  // A low base lets a pointer double as a count, so both 29/31 layouts agree.
  expect(lowBaseFailure({ ambiguous: true })).toBe(
    "ambiguous-generic-method-registration",
  );
});

it("treats a zero-filled method spec as unobserved, not as method 0", () => {
  const generic = linkLowBase({ zeroFilledSpecs: true });
  expect(generic.instances.map(({ state, name }) => ({ state, name }))).toEqual(
    Array.from({ length: 3 }, () => ({ state: "unknown", name: null })),
  );
  expect(generic.issues.map(({ row, message }) => ({ row, message }))).toEqual(
    [0, 1, 2].map((row) => ({
      row,
      message: `method spec ${row} is not file backed`,
    })),
  );
});

it("yields before each pass over the genericMethodTable", () => {
  const events: string[] = [];
  linkLowBase({}, events);
  // Two candidate layouts, the shared-spec pass, then rows with their issues.
  expect(events).toEqual([
    "yield",
    "yield",
    "yield",
    "yield",
    ...Array.from({ length: 3 }, () => ["issue", "row"]).flat(),
  ]);
});

it("refuses a genericMethodTable count past the table limit before checking the budget", () => {
  const checked: number[] = [];
  expect(() =>
    linkLowBase({ tableCount: BigInt(GENERIC_TABLE_LIMIT) + 1n }, [], checked),
  ).toThrow("generic-method-registration-not-found");
  expect(checked).toEqual([]);
});

it("keeps a capacity refusal while naming a generic row a refusal", () => {
  const decoded = genericFacts(31);
  let tableChecked = false;
  const failure = (() => {
    try {
      linkIl2cppBinary(
        createIl2cppBinaryFixture({ genericMethods: {} }),
        decoded.metadata,
        decoded.link,
        undefined,
        {
          genericInstances: true,
          beforeText: (bytes) => {
            if (tableChecked)
              throw new Il2cppBinaryFormatFailure(
                "native-type-text-capacity",
                "budget",
              );
            tableChecked = bytes === 3 * minimumGenericRow;
          },
        },
      );
    } catch (cause) {
      return cause;
    }
    return undefined;
  })();
  expect(tableChecked).toBe(true);
  expect(failure).toBeInstanceOf(Il2cppBinaryFormatFailure);
  expect((failure as Il2cppBinaryFormatFailure).kind).toBe("capacity");
});

it("ignores CodeRegistration count alignment padding", () => {
  const bytes = createIl2cppBinaryFixture();
  bytes.fill(0xff, 0x604, 0x608);
  expect(link(bytes).method_addresses).toEqual(expectedAddresses);
});

it.each([0, 8, 16])(
  "finds registration with %s file-backed trailing zero bytes",
  (tail) => {
    const original = createIl2cppBinaryFixture();
    const bytes = Buffer.alloc(0x1000 + tail);
    original.copy(bytes);
    original.copy(bytes, 0xf90, 0x800, 0x880);
    bytes.fill(0, 0x800, 0x880);
    bytes.writeBigUInt64LE(0x2000n, 64);
    bytes.writeBigUInt64LE(BigInt(bytes.length), 80);
    const linked = link(bytes);
    expect(linked.types_field).toBe(FIXTURE_BINARY_BASE + 0xfc0n);
    expect(linked.method_addresses).toEqual(expectedAddresses);
    expect(linked.return_types).toEqual(link(original).return_types);
    if (tail === 0) {
      const missingTail = Buffer.from(bytes);
      missingTail.writeBigUInt64LE(BigInt(bytes.length), 64);
      expect(failure(missingTail).reason).toBe(
        "metadata-registration-not-found",
      );
    }
  },
);

it.each([0n, FIXTURE_BINARY_BASE + 0x980n, FIXTURE_BINARY_BASE + 0x9b0n])(
  "retains unknown dyld-bound type names regardless of raw word %s",
  (raw) => {
    const control = link(createIl2cppBinaryFixture());
    expect(control.return_types[0]).toEqual({
      type: 0,
      name: FIXTURE_RETURN_TYPE_NAME,
    });
    expect(control.method_addresses).toEqual(expectedAddresses);
    const bytes = createIl2cppDyldBindFixture(raw, 0x900);
    const linked = link(bytes);
    for (const collection of [
      "return_types",
      "field_types",
      "parameter_types",
    ] as const)
      expect(linked[collection]).toEqual(
        control[collection].map((row) =>
          row.type === 0 ? { type: row.type, name: null } : row,
        ),
      );
    expect(linked.method_addresses).toEqual(control.method_addresses);
    expect(bytes.readBigUInt64LE(0x900)).toBe(raw);
  },
);

it.each([183, 62])(
  "ignores R_NONE target and addend before relocation application (machine %s)",
  (machine) => {
    const image = createIl2cppBinaryFixture();
    const bytes = createElfFixture(image, {
      machine,
      unresolvedRelocations: [{ offset: 0x7fffffff, kind: 0 }],
    });
    const dynamic = Number(bytes.readBigUInt64LE(128));
    const relocationBytes = Number(bytes.readBigUInt64LE(dynamic + 24));
    const last = 0x1000 + relocationBytes - 24;
    bytes.writeBigUInt64LE(0xffffffffffffffffn, last);
    bytes.writeBigInt64LE(-0x8000000000000000n, last + 16);
    expect(link(bytes)).toEqual(link(createElfFixture(image, { machine })));
  },
);
