import {
  Il2cppMetadataFormatFailure,
  type Il2cppMetadataFailureReason,
} from "../../../src/il2cpp/Il2cppMetadataFormat.js";
import { describe, expect, it } from "vitest";
import {
  il2cppIndexWidth,
  il2cppMetadataRecordBytes,
  readIl2cppMetadataSteps,
} from "../../../src/il2cpp/Il2cppMetadataFile.js";
import {
  readIl2cppMetadata,
  readIl2cppMetadataForLinking,
} from "../../fixtures/il2cpp/readers.js";
import {
  createIl2cppMetadataFixture,
  FIXTURE_IMAGES,
  fixtureImages,
  FIXTURE_METHODS,
  FIXTURE_FIELDS,
  FIXTURE_PROPERTIES,
  FIXTURE_EVENTS,
  FIXTURE_PARAMETERS,
  FIXTURE_STRING_LITERALS,
  FIXTURE_TYPES,
  fixtureRows,
  type Il2cppMetadataFixture,
} from "../../fixtures/il2cpp/metadata.js";

const failure = (
  bytes: Buffer,
  reader:
    | typeof readIl2cppMetadata
    | typeof readIl2cppMetadataForLinking = readIl2cppMetadata,
) => {
  try {
    reader(bytes);
  } catch (cause: unknown) {
    if (cause instanceof Il2cppMetadataFormatFailure) return cause;
    throw cause;
  }
  throw new Error("Expected the metadata to be rejected");
};

const rejects = (
  bytes: Buffer,
  reason: Il2cppMetadataFailureReason,
  kind: "unsupported" | "corrupt" = "corrupt",
) => {
  const rejected = failure(bytes);
  expect(rejected.reason).toBe(reason);
  expect(rejected.kind).toBe(kind);
  expect(rejected.message.startsWith(`${reason}: `)).toBe(true);
};

const mutated = (
  edit: (fixture: Il2cppMetadataFixture, bytes: Buffer) => void,
  fixture = createIl2cppMetadataFixture(),
) => {
  const bytes = Buffer.from(fixture.bytes);
  edit(fixture, bytes);
  return bytes;
};

describe("IL2CPP global-metadata version 39", () => {
  it("yields through a large owner range before emitting its first parameter fact", () => {
    const fixture = createIl2cppMetadataFixture({
      wide: { fillerTypes: 0, genericContainers: 0, parameters: 65_000 },
    });
    const bytes = Buffer.from(fixture.bytes),
      total = fixture.section("parameters").count!;
    bytes.writeUInt16LE(
      total,
      fixture.record("methods", 2) + fixture.recordBytes.methods - 2,
    );
    let firstParameter = false,
      yieldsBeforeParameter = 0;
    const steps = readIl2cppMetadataSteps(bytes, {
      onRow: (row) => {
        if ("method" in row) firstParameter = true;
      },
    });
    for (;;) {
      const step = steps.next();
      if (step.done) break;
      if (!firstParameter) yieldsBeforeParameter++;
    }
    expect(firstParameter).toBe(true);
    expect(yieldsBeforeParameter).toBeGreaterThan(200);
  });
  it.each([-1, 0x7fffffff])(
    "rejects an invalid empty-literal sentinel %i",
    (sentinel) => {
      rejects(
        mutated((fixture, bytes) => {
          bytes.writeInt32LE(4, fixture.header("stringLiterals", "size"));
          bytes.writeInt32LE(1, fixture.header("stringLiterals", "count"));
          bytes.writeInt32LE(
            sentinel,
            fixture.section("stringLiterals").offset,
          );
        }),
        "index-out-of-range",
      );
    },
  );
  it.each([1, 2, 4] as const)(
    "decodes names, ranges and nesting with a %i-byte TypeIndex in about 1 KiB",
    (typeIndexWidth) => {
      const fixture = createIl2cppMetadataFixture({ typeIndexWidth });
      expect(fixture.bytes.length).toBeLessThan(1100);
      const decoded = readIl2cppMetadata(fixture.bytes);
      expect(decoded.magic).toBe(fixture.bytes.readUInt32LE(0));
      expect(decoded.metadata_version).toBe(39);
      expect(decoded.index_widths).toEqual({
        type_definition: 1,
        generic_container: 1,
        parameter: 1,
        type: typeIndexWidth,
        type_width_source: "interface-offsets-record",
      });
      expect(decoded.images).toEqual(FIXTURE_IMAGES);
      expect(decoded.types).toEqual(FIXTURE_TYPES);
      expect(decoded.methods).toEqual(FIXTURE_METHODS);
      expect(decoded.sections).toHaveLength(31);
      expect(decoded.sections[0]).toEqual({
        name: "stringLiterals",
        offset: 380,
        size: 12,
        count: 3,
      });
    },
  );

  it("recovers the TypeIndex width from type records without interfaceOffsets", () => {
    const fixture = createIl2cppMetadataFixture({
      typeIndexWidth: 2,
      interfaceOffsets: false,
    });
    const decoded = readIl2cppMetadata(fixture.bytes);
    expect(decoded.index_widths.type).toBe(2);
    expect(decoded.index_widths.type_width_source).toBe(
      "type-definition-record",
    );
    expect(decoded.methods).toEqual(FIXTURE_METHODS);
  });

  it("accepts empty sections that share an offset with occupied sections and padding gaps", () => {
    const bytes = mutated((fixture, target) => {
      const methods = fixture.section("methods");
      target.writeInt32LE(
        methods.offset + 3,
        fixture.header("windowsRuntimeStrings", "offset"),
      );
      // Grow strings into trailing padding that no other section occupies.
      target.writeInt32LE(
        fixture.section("strings").size,
        fixture.header("strings", "size"),
      );
    });
    expect(readIl2cppMetadata(bytes).types).toEqual(FIXTURE_TYPES);
  });
});

describe("rejected IL2CPP global-metadata", () => {
  it("rejects an unrecognized magic and other versions as unsupported", () => {
    rejects(
      mutated((_, bytes) => bytes.writeUInt32LE(0x12345678, 0)),
      "unrecognized-magic",
      "unsupported",
    );
    for (const length of [4, 5, 6, 7])
      rejects(Buffer.alloc(length), "unrecognized-magic", "unsupported");
    rejects(
      mutated((_, bytes) => bytes.writeInt32LE(30, 4)),
      "unsupported-version",
      "unsupported",
    );
  });

  it("retains the decoder's signed interpretation of a complete high-bit version", () => {
    const bytes = Buffer.alloc(8);
    bytes.writeUInt32LE(0xfab11baf, 0);
    bytes.writeUInt32LE(0xffffffff, 4);
    const rejected = failure(bytes);
    expect(rejected.reason).toBe("unsupported-version");
    expect(rejected.kind).toBe("unsupported");
    expect(rejected.message).toContain("metadata version -1 is not supported");
  });

  it.each([4, 5, 6, 7])(
    "retains recognized magic and reports a %i-byte version prefix as truncated",
    (length) => {
      const bytes = Buffer.alloc(length);
      bytes.writeUInt32LE(0xfab11baf, 0);
      const rejected = failure(bytes);
      expect(rejected.reason).toBe("truncated-header");
      expect(rejected.kind).toBe("corrupt");
      expect(rejected.message).toContain(
        "fewer than the 8-byte magic/version prefix",
      );
      expect(rejected.message).toContain("metadata version is unknown");
    },
  );

  it("uses the same truncated-prefix classification before native linking", () => {
    const bytes = Buffer.alloc(7);
    bytes.writeUInt32LE(0xfab11baf, 0);
    const rejected = failure(bytes, readIl2cppMetadataForLinking);
    expect(rejected.reason).toBe("truncated-header");
    expect(rejected.kind).toBe("corrupt");
    expect(rejected.message).toContain("metadata version is unknown");
  });

  it("rejects a truncated header and an unexpected header size", () => {
    rejects(
      createIl2cppMetadataFixture().bytes.subarray(0, 200),
      "truncated-header",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(384, fixture.header("stringLiterals", "offset")),
      ),
      "unexpected-header-size",
    );
  });

  it("rejects sections outside the file or with negative fields", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(bytes.length, fixture.header("methods", "size")),
      ),
      "section-out-of-bounds",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(-1, fixture.header("events", "count")),
      ),
      "section-out-of-bounds",
    );
  });

  it("rejects overlapping occupied sections", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(
          fixture.section("typeDefinitions").offset + 4,
          fixture.header("images", "offset"),
        ),
      ),
      "section-overlap",
    );
  });

  it("rejects record sizes that disagree with counts or index widths", () => {
    // Not a whole multiple of the record count.
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(
          fixture.section("methods").count! + 1,
          fixture.header("methods", "count"),
        ),
      ),
      "record-size-mismatch",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(2, fixture.header("nestedTypes", "count")),
      ),
      "record-size-mismatch",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(0, fixture.header("methods", "count")),
      ),
      "record-size-mismatch",
    );
  });

  it("rejects an interfaceOffsets record that implies no valid TypeIndex width", () => {
    rejects(
      createIl2cppMetadataFixture({ interfaceOffsetRecordBytes: 7 }).bytes,
      "type-index-width",
    );
  });
});

describe("IL2CPP generic-container linking facts", () => {
  it.each([31, 39] as const)(
    "retains type argument counts and version %i container admission",
    (version) => {
      const fixture = createIl2cppMetadataFixture({
        version,
        genericOwners: true,
      });
      const { link } = readIl2cppMetadataForLinking(fixture.bytes);
      expect(link.genericTypeArgumentCounts[3]).toBe(1);
      expect(link.methodGenericContainer(4)).toBe(2);
      expect(link.typeGenericContainer(3)).toBe(version === 39 ? undefined : 0);
      expect(link.genericContainer(0)).toEqual(
        version === 39 ? undefined : { count: 1, parameterStart: 0 },
      );
      expect(link.typeGenericContainer(-1)).toBeUndefined();
      expect(link.genericContainer(-1)).toBeUndefined();
    },
  );

  it.each([31, 39] as const)(
    "keeps negative argument counts admissible to inventory but refuses version %i linking",
    (version) => {
      const bytes = createIl2cppMetadataFixture({
        version,
        genericTypeArgumentCounts: { 3: -1 },
      }).bytes;
      expect(readIl2cppMetadata(bytes).types[3]?.name).toBe("Größe");
      const rejected = failure(bytes, readIl2cppMetadataForLinking);
      expect(rejected.reason).toBe("index-out-of-range");
      expect(rejected.message).toContain("negative argument count -1");
    },
  );
});

describe("IL2CPP generic-container extents", () => {
  it("checks generic-container count against its fixed 16-byte records before resolving widths", () => {
    // A positive count with no record bytes.
    for (const count of [1, 300])
      rejects(
        mutated((fixture, bytes) =>
          bytes.writeInt32LE(
            count,
            fixture.header("genericContainers", "count"),
          ),
        ),
        "record-size-mismatch",
      );
    const oneRecord = createIl2cppMetadataFixture({
      wide: { fillerTypes: 0, genericContainers: 1, parameters: 0 },
    });
    // A positive count with a partial record.
    rejects(
      mutated(
        (fixture, bytes) =>
          bytes.writeInt32LE(1, fixture.header("genericContainers", "size")),
        oneRecord,
      ),
      "record-size-mismatch",
    );
    // Bytes without a corresponding record.
    rejects(
      mutated(
        (fixture, bytes) =>
          bytes.writeInt32LE(0, fixture.header("genericContainers", "count")),
        oneRecord,
      ),
      "record-size-mismatch",
    );
  });

  it("retains width selection for empty and complete generic-container records", () => {
    const empty = readIl2cppMetadata(createIl2cppMetadataFixture().bytes);
    expect(empty.index_widths.generic_container).toBe(1);

    const one = readIl2cppMetadata(
      createIl2cppMetadataFixture({
        wide: { fillerTypes: 0, genericContainers: 1, parameters: 0 },
      }).bytes,
    );
    expect(one.index_widths.generic_container).toBe(1);

    const wide = readIl2cppMetadata(
      createIl2cppMetadataFixture({
        wide: { fillerTypes: 0, genericContainers: 300, parameters: 0 },
      }).bytes,
    );
    expect(wide.index_widths.generic_container).toBe(2);
  });
});

describe("rejected IL2CPP metadata references", () => {
  it("rejects image, type, method and nested-type indices outside their tables", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeUInt32LE(9, fixture.record("images", 1) + 9),
      ),
      "index-out-of-range",
    );
    rejects(
      mutated((fixture, bytes) => {
        // methodStart follows fieldStart in the int32 start block.
        const at = fixture.record("typeDefinitions", 0) + 8 + 3 + 1 + 4 + 4;
        bytes.writeInt32LE(4, at);
      }),
      "index-out-of-range",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeUInt8(4, fixture.record("methods", 2) + 4),
      ),
      "index-out-of-range",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(4, fixture.section("nestedTypes").offset),
      ),
      "index-out-of-range",
    );
  });

  it("rejects a type nested in two declaring types", () => {
    rejects(
      mutated((fixture, bytes) => {
        // Two string indices, three 1-byte type indices, generic container, flags.
        const starts = fixture.record("typeDefinitions", 3) + 8 + 3 + 1 + 4;
        bytes.writeInt32LE(0, starts + 16);
        bytes.writeUInt16LE(1, starts + 32 + 8);
      }),
      "nested-type-conflict",
    );
  });

  it("rejects unterminated, out-of-range and non-UTF-8 strings", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(
          fixture.section("strings").size,
          fixture.record("methods", 0),
        ),
      ),
      "invalid-string",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(
          fixture.section("strings").size - 1,
          fixture.header("strings", "size"),
        ),
      ),
      "invalid-string",
    );
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeUInt8(0xff, fixture.stringOffset("Update")),
      ),
      "invalid-string",
    );
  });

  it("rejects a string section overlapping literal data", () => {
    rejects(
      mutated((fixture, bytes) => {
        bytes.writeInt32LE(
          fixture.section("strings").offset - 1,
          fixture.header("strings", "offset"),
        );
      }),
      "section-overlap",
    );
  });

  it("decodes a valid string suffix from its byte offset", () => {
    const fixture = createIl2cppMetadataFixture({
      typeNames: { 0: "xPlayer" },
    });
    const bytes = Buffer.from(fixture.bytes);
    const originalOffset = fixture.record("typeDefinitions", 0);
    bytes.writeInt32LE(bytes.readInt32LE(originalOffset) + 1, originalOffset);

    expect(readIl2cppMetadata(bytes).types[0]?.name).toBe("Player");
  });

  it("accepts a UTF-8 code-point boundary suffix and rejects a split code point", () => {
    const fixture = createIl2cppMetadataFixture({
      typeNames: { 0: "xéclair" },
    });
    const nameOffset = fixture.record("typeDefinitions", 0);
    const sourceOffset = fixture.bytes.readInt32LE(nameOffset);
    const validSuffix = Buffer.from(fixture.bytes);
    validSuffix.writeInt32LE(sourceOffset + 1, nameOffset);
    expect(readIl2cppMetadata(validSuffix).types[0]?.name).toBe("éclair");

    const splitCodePoint = Buffer.from(fixture.bytes);
    splitCodePoint.writeInt32LE(sourceOffset + 2, nameOffset);
    rejects(splitCodePoint, "invalid-string");
  });

  it("rejects nesting cycles and self-nesting", () => {
    // Type 0 owns nestedTypes entry 0; listing itself there is a self-cycle.
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(0, fixture.section("nestedTypes").offset),
      ),
      "nested-type-conflict",
    );
    rejects(
      createIl2cppMetadataFixture({ nestingCycle: true }).bytes,
      "nested-type-conflict",
    );
  });

  it("rejects methods whose declaring type disagrees with the owning type range", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeUInt8(3, fixture.record("methods", 1) + 4),
      ),
      "declaring-type-mismatch",
    );
  });
});

describe("IL2CPP index widths", () => {
  it("switches widths at the runtime's 255 and 65535 entry boundaries", () => {
    expect(
      [0, 255, 256, 65535, 65536].map((entries) => il2cppIndexWidth(entries)),
    ).toEqual([1, 1, 2, 2, 4]);
    expect(
      il2cppMetadataRecordBytes(
        {
          type_definition: 2,
          generic_container: 2,
          parameter: 4,
          type: 2,
        },
        39,
      ),
    ).toEqual({ typeDefinitions: 76, images: 36, methods: 30 });
    const fixed = {
      type_definition: 4,
      generic_container: 4,
      parameter: 4,
      type: 4,
    } as const;
    expect(il2cppMetadataRecordBytes(fixed, 29)).toEqual({
      typeDefinitions: 88,
      images: 40,
      methods: 32,
    });
    expect(il2cppMetadataRecordBytes(fixed, 31).methods).toBe(36);
  });
});

describe("IL2CPP global-metadata versions 29 and 31", () => {
  it.each([29, 31] as const)(
    "decodes version %i with fixed 4-byte indices and size-only headers",
    (version) => {
      const fixture = createIl2cppMetadataFixture({ version });
      const decoded = readIl2cppMetadata(fixture.bytes);
      expect(decoded.metadata_version).toBe(version);
      expect(decoded.magic).toBe(fixture.bytes.readUInt32LE(0));
      expect(decoded.index_widths).toEqual({
        type_definition: 4,
        generic_container: 4,
        parameter: 4,
        type: 4,
        type_width_source: "fixed-width-version",
      });
      expect(decoded.sections[0]).toEqual({
        name: "stringLiterals",
        offset: 256,
        size: 16,
        count: null,
      });
      expect(decoded.sections.every((section) => section.count === null)).toBe(
        true,
      );
      expect(decoded.images).toEqual(FIXTURE_IMAGES);
      expect(decoded.types).toEqual(FIXTURE_TYPES);
      expect(decoded.methods).toEqual(FIXTURE_METHODS);
    },
  );

  it("rejects method records sized for the other version", () => {
    for (const [built, labeled] of [
      [29, 31],
      [31, 29],
    ] as const)
      rejects(
        mutated(
          (_, bytes) => bytes.writeInt32LE(labeled, 4),
          createIl2cppMetadataFixture({ version: built }),
        ),
        "record-size-mismatch",
      );
  });

  it("rejects a version 29 header that does not end at the first section", () => {
    rejects(
      createIl2cppMetadataFixture({ version: 29 }).bytes.subarray(0, 200),
      "truncated-header",
    );
    rejects(
      mutated(
        (fixture, bytes) =>
          bytes.writeInt32LE(380, fixture.header("stringLiterals", "offset")),
        createIl2cppMetadataFixture({ version: 29 }),
      ),
      "unexpected-header-size",
    );
  });

  it("rejects size-only sections that do not hold whole records", () => {
    rejects(
      mutated(
        (fixture, bytes) =>
          bytes.writeInt32LE(
            fixture.section("typeDefinitions").size - 1,
            fixture.header("typeDefinitions", "size"),
          ),
        createIl2cppMetadataFixture({ version: 31 }),
      ),
      "record-size-mismatch",
    );
  });

  it("applies the shared string and ownership checks", () => {
    const fixture = createIl2cppMetadataFixture({ version: 31 });
    rejects(
      mutated(
        (target, bytes) =>
          bytes.writeInt32LE(
            target.section("strings").size + 1,
            target.record("methods", 0),
          ),
        fixture,
      ),
      "invalid-string",
    );
    rejects(
      mutated(
        (target, bytes) =>
          bytes.writeInt32LE(3, target.record("methods", 1) + 4),
        fixture,
      ),
      "declaring-type-mismatch",
    );
  });
});

describe("IL2CPP metadata coverage checks", () => {
  it("rejects occupied sections that overlap the header", () => {
    rejects(
      mutated(
        (fixture, bytes) =>
          bytes.writeInt32LE(27, fixture.header("strings", "offset")),
        createIl2cppMetadataFixture({ version: 29 }),
      ),
      "section-out-of-bounds",
    );
  });

  it("rejects a method outside its declaring type's range", () => {
    // Type 3 owns methods [3, 5); shrinking it strands method 4.
    rejects(
      mutated((fixture, bytes) => {
        const starts = fixture.record("typeDefinitions", 3) + 8 + 3 + 1 + 4;
        bytes.writeUInt16LE(1, starts + 32);
      }),
      "declaring-type-mismatch",
    );
  });

  it("rejects images whose type ranges overlap", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeUInt8(2, fixture.record("images", 1) + 8),
      ),
      "image-range-overlap",
    );
  });

  it("preserves a leading byte order mark in names", () => {
    const fixture = createIl2cppMetadataFixture();
    const bytes = Buffer.from(fixture.bytes);
    // Replace the three bytes of "Add" with a lone UTF-8 byte order mark.
    const at = fixture.stringOffset("Add");
    bytes.set([0xef, 0xbb, 0xbf], at);
    expect(readIl2cppMetadata(bytes).methods[2]?.name).toBe("\ufeff");
  });
});

describe("IL2CPP version 39 wide indices", () => {
  it.each([
    [2, { fillerTypes: 300, genericContainers: 300, parameters: 300 }],
    [4, { fillerTypes: 65_540, genericContainers: 65_540, parameters: 65_540 }],
  ] as const)(
    "decodes %i-byte type-definition, generic-container and parameter indices",
    (width, wide) => {
      const decoded = readIl2cppMetadata(
        createIl2cppMetadataFixture({ wide }).bytes,
      );
      expect(decoded.index_widths).toMatchObject({
        type_definition: width,
        generic_container: width,
        parameter: width,
      });
      const rows = fixtureRows({ wide });
      expect(decoded.types).toEqual(rows.types);
      expect(decoded.methods).toEqual(rows.methods);
      // The last method declares a type index beyond the narrower widths.
      expect(decoded.methods.at(-1)?.declaring_type).toBe(
        rows.types.length - 1,
      );
      expect(decoded.images).toEqual(FIXTURE_IMAGES);
    },
  );
});

describe("IL2CPP narrow index sentinels", () => {
  it.each([
    [1, undefined],
    [2, { fillerTypes: 300, genericContainers: 0, parameters: 0 }],
  ] as const)(
    "reads an empty image's all-ones %i-byte type start as -1",
    (width, wide) => {
      const options = {
        emptyImage: true,
        ...(wide === undefined ? {} : { wide }),
      };
      const decoded = readIl2cppMetadata(
        createIl2cppMetadataFixture(options).bytes,
      );
      expect(decoded.index_widths.type_definition).toBe(width);
      expect(decoded.images).toEqual(fixtureImages(options));
    },
  );
});

describe("IL2CPP metadata members and string literals", () => {
  it.each([
    { version: 24, typeIndexWidth: 4 },
    { version: 27, typeIndexWidth: 4 },
    { version: 29, typeIndexWidth: 4 },
    { version: 31, typeIndexWidth: 4 },
    { version: 39, typeIndexWidth: 1 },
    { version: 39, typeIndexWidth: 2 },
    { version: 39, typeIndexWidth: 4 },
  ] as const)(
    "decodes nonempty properties and events with distinct owners: %j",
    (options) => {
      const fixture = createIl2cppMetadataFixture({
        ...options,
        propertiesAndEvents: true,
      });
      const decoded = readIl2cppMetadata(fixture.bytes);
      expect(decoded.properties).toEqual(FIXTURE_PROPERTIES);
      expect(decoded.events).toEqual(FIXTURE_EVENTS);
      expect(fixture.section("properties").size).toBe(3 * 20);
      expect(fixture.section("events").size).toBe(
        2 * (20 + options.typeIndexWidth),
      );
    },
  );
  it.each([29, 31, 39] as const)(
    "pairs version %i members with their owners and keeps undecodable literals as bytes",
    (version) => {
      const decoded = readIl2cppMetadata(
        createIl2cppMetadataFixture({ version }).bytes,
      );
      expect(decoded.fields).toEqual(FIXTURE_FIELDS);
      expect(decoded.parameters).toEqual(FIXTURE_PARAMETERS);
      expect(decoded.properties).toEqual([]);
      expect(decoded.events).toEqual([]);
      expect(decoded.string_literals).toEqual(FIXTURE_STRING_LITERALS);
    },
  );

  it("rejects member ranges claimed twice or outside their table", () => {
    // Type 1 claims field 0 as well, which type 0 already owns.
    rejects(
      mutated((fixture, bytes) => {
        const starts = fixture.record("typeDefinitions", 1) + 8 + 3 + 1 + 4;
        bytes.writeInt32LE(0, starts);
      }),
      "declaring-type-mismatch",
    );
    rejects(
      mutated((fixture, bytes) => {
        const starts = fixture.record("typeDefinitions", 1) + 8 + 3 + 1 + 4;
        bytes.writeInt32LE(2, starts);
      }),
      "index-out-of-range",
    );
  });

  it("rejects string literals outside the literal data", () => {
    rejects(
      mutated((fixture, bytes) =>
        bytes.writeInt32LE(99, fixture.section("stringLiterals").offset + 4),
      ),
      "index-out-of-range",
    );
  });
});

describe("IL2CPP global-metadata version 27", () => {
  it("decodes the version 29 record layout with version 27 section names", () => {
    const decoded = readIl2cppMetadata(
      createIl2cppMetadataFixture({ version: 27 }).bytes,
    );
    expect(decoded.metadata_version).toBe(27);
    expect(decoded.index_widths.type_width_source).toBe("fixed-width-version");
    expect(decoded.sections.slice(24, 28).map(({ name }) => name)).toEqual([
      "attributesInfo",
      "attributeTypes",
      "unresolvedVirtualCallParameterTypes",
      "unresolvedVirtualCallParameterRanges",
    ]);
    expect(decoded.images).toEqual(FIXTURE_IMAGES);
    expect(decoded.types).toEqual(FIXTURE_TYPES);
    expect(decoded.methods).toEqual(FIXTURE_METHODS);
  });
});

describe("IL2CPP global-metadata version 24", () => {
  it("decodes the 32-section header and five-type-index records", () => {
    const fixture = createIl2cppMetadataFixture({ version: 24 });
    const decoded = readIl2cppMetadata(fixture.bytes);
    expect(decoded.metadata_version).toBe(24);
    expect(decoded.sections).toHaveLength(32);
    expect(decoded.sections[0]?.offset).toBe(264);
    expect(decoded.sections[22]?.name).toBe("metadataUsageLists");
    expect(decoded.images).toEqual(FIXTURE_IMAGES);
    expect(decoded.types).toEqual(FIXTURE_TYPES);
    expect(decoded.methods).toEqual(FIXTURE_METHODS);
  });

  it("rejects version 24 records labeled as version 27", () => {
    rejects(
      mutated(
        (_, bytes) => bytes.writeInt32LE(27, 4),
        createIl2cppMetadataFixture({ version: 24 }),
      ),
      "unexpected-header-size",
    );
  });
});
