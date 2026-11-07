import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import {
  buildManagedPeFixture,
  fixtureUserStringHeap,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";
import { parseExceptionRegions } from "./ManagedMemberInstructionDecoder.js";

const managedBodyWithSections = (...sections: Buffer[]) => {
  const header = Buffer.alloc(12);
  header.writeUInt16LE(0x300b, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(1, 4);
  const bytes = buildManagedPeFixture({
    ilBody: Buffer.concat([
      header,
      Buffer.from([0x2a]),
      Buffer.alloc(3),
      ...sections,
    ]),
  });
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes))
    .methods[0]?.body;
};

const managedBodyWithRegion = ({
  il,
  flags = 0,
  tryOffset = 0,
  tryLength = 1,
  handlerOffset,
  handlerLength = 1,
  extra = 0x0200_0001,
}: {
  readonly il: Buffer;
  readonly flags?: number;
  readonly tryOffset?: number;
  readonly tryLength?: number;
  readonly handlerOffset: number;
  readonly handlerLength?: number;
  readonly extra?: number;
}) => {
  const header = Buffer.alloc(12);
  header.writeUInt16LE(0x300b, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(il.length, 4);
  const section = Buffer.alloc(16);
  section[0] = 0x01;
  section[1] = section.length;
  section.writeUInt16LE(flags, 4);
  section.writeUInt16LE(tryOffset, 6);
  section[8] = tryLength;
  section.writeUInt16LE(handlerOffset, 9);
  section[11] = handlerLength;
  section.writeUInt32LE(extra, 12);
  const bytes = buildManagedPeFixture({
    ilBody: Buffer.concat([
      header,
      il,
      Buffer.alloc((4 - (il.length % 4)) % 4),
      section,
    ]),
  });
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes))
    .methods[0]?.body;
};

const fatBody = (il: Buffer) => {
  const header = Buffer.alloc(12);
  header.writeUInt16LE(0x3013, 0);
  header.writeUInt16LE(8, 2);
  header.writeUInt32LE(il.length, 4);
  const bytes = buildManagedPeFixture({
    ilBody: Buffer.concat([header, il]),
  });
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes))
    .methods[0]?.body;
};

/** Build a tiny method body whose declared IL extent matches its supplied bytes. */
const tinyBody = (il: readonly number[]) => {
  const bytes = buildManagedPeFixture({
    ilBody: Buffer.from([(il.length << 2) | 0x02, ...il]),
  });
  const inspection = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  return { body: inspection.methods[0]?.body, coverage: inspection.coverage };
};

describe("managed CIL decoding", () => {
  it("reads fat method header size from the full flags-and-size word", () => {
    const il = Buffer.from([
      0x21, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x26, 0x22, 0x00,
      0x00, 0x80, 0x3f, 0x26, 0x23, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xf0,
      0x3f, 0x26, 0xfe, 0x06, 0x01, 0x00, 0x00, 0x06, 0x26, 0x2a,
    ]);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x3013, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([header, il]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]?.body).toMatchObject({
      status: "present",
      header_format: "fat",
      il_size: il.length,
      il_sha256: createHash("sha256").update(il).digest("hex"),
      opcode_counts: {
        "ldc.i8": 1,
        pop: 4,
        "ldc.r4": 1,
        "ldc.r8": 1,
        ldftn: 1,
        ret: 1,
      },
      issue: null,
    });
  });

  it("does not normalize reserved CIL opcodes as operand-free instructions", () => {
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.from([0x0a, 0x24, 0x2a]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      il_size: 2,
      normalized_il_sha256: null,
      decoded_instruction_count: 0,
      issue: "Unsupported CIL opcode 0x24 at IL offset 0",
    });
  });

  it("does not decode overlay bytes after the method's file-backed PE section", () => {
    const original = buildManagedPeFixture();
    const bytes = Buffer.concat([original, Buffer.from([0x2a])]);
    const parsed = inspectManagedMembersBytes(
      original,
      managedPeFixtureTarget(original),
    );
    const methodRow = parsed.methods[0]?.row_offset;
    expect(methodRow).toBeDefined();
    if (methodRow === undefined) return;
    bytes.writeUInt32LE(0x2dff, methodRow);
    bytes[0xfff] = 0x06;
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      header_format: "unknown",
      issue: "Method body leaves file-backed PE section data",
      anchors: [],
    });
  });

  it("does not decode overlay exception sections after the file-backed PE section", () => {
    const original = buildManagedPeFixture();
    const overlay = Buffer.from([0x01, 0x04, 0x00, 0x00]);
    const bytes = Buffer.concat([original, overlay]);
    const parsed = inspectManagedMembersBytes(
      original,
      managedPeFixtureTarget(original),
    );
    const methodRow = parsed.methods[0]?.row_offset;
    expect(methodRow).toBeDefined();
    if (methodRow === undefined) return;
    const body = Buffer.alloc(16);
    body.writeUInt16LE(0x301b, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(1, 4);
    body[12] = 0x2a;
    body.copy(bytes, 0xff0);
    bytes.writeUInt32LE(0x2df0, methodRow);
    overlay.copy(bytes, 0x1000);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      issue: "Exception section header leaves artifact",
      exception_regions: [],
    });
  });

  it("keeps the documented decoded-CIL v1 golden vector stable", () => {
    const il = Buffer.from([0x00, 0x2a]);
    const tinyBytes = buildManagedPeFixture({
      ilBody: Buffer.from([0x0a, ...il]),
    });
    const fatHeader = Buffer.alloc(12);
    fatHeader.writeUInt16LE(0x3013, 0);
    fatHeader.writeUInt16LE(32, 2);
    fatHeader.writeUInt32LE(il.length, 4);
    fatHeader.writeUInt32LE(0x1100_0001, 8);
    const fatBytes = buildManagedPeFixture({
      standaloneSignatures: [Buffer.from([0x07, 0x01, 0x08])],
      ilBody: Buffer.concat([fatHeader, il]),
    });
    const tiny = inspectManagedMembersBytes(
      tinyBytes,
      managedPeFixtureTarget(tinyBytes),
    );
    const fat = inspectManagedMembersBytes(
      fatBytes,
      managedPeFixtureTarget(fatBytes),
    );

    expect(tiny.methods[0]?.body).toMatchObject({
      status: "present",
      header_format: "tiny",
      max_stack: 8,
      init_locals: false,
      local_var_sig_token: null,
      il_size: 2,
      il_sha256: createHash("sha256").update(il).digest("hex"),
      normalized_il_sha256:
        "5e5fad7741cb44bca3a4f045546b7449990da343f612f5f34c0ca30e9eee0636",
      opcode_counts: { nop: 1, ret: 1 },
      exception_regions: [],
    });
    expect(fat.methods[0]?.body).toMatchObject({
      header_format: "fat",
      max_stack: 32,
      init_locals: true,
      local_var_sig_token: "0x11000001",
      il_sha256: tiny.methods[0]?.body.il_sha256,
      normalized_il_sha256: tiny.methods[0]?.body.normalized_il_sha256,
    });
  });
});

describe("managed operand extent diagnostics", () => {
  it.each([
    [[0x20], 0, "Instruction ldc.i4 at IL offset 0 leaves method body"],
    [
      [0x00, 0x20, 0x01],
      1,
      "Instruction ldc.i4 at IL offset 1 leaves method body",
    ],
    [[0x2b], 0, "Instruction br.s at IL offset 0 leaves method body"],
    [[0x45, 0x02], 0, "Instruction switch at IL offset 0 leaves method body"],
    [
      [0xfe, 0x09, 0x00],
      0,
      "Instruction ldarg at IL offset 0 leaves method body",
    ],
    [[0x00, 0xfe], 1, "Two-byte CIL opcode at IL offset 1 leaves method body"],
  ] as const)(
    "reports the instruction and IL offset for tiny IL %j",
    (il, decoded, issue) => {
      const { body, coverage } = tinyBody(il);
      expect(body).toMatchObject({
        status: "malformed",
        header_format: "tiny",
        il_size: il.length,
        decoded_instruction_count: decoded,
        normalized_il_sha256: null,
        issue,
      });
      expect(coverage.state).toBe("partial");
    },
  );

  it.each([
    ["short variable", Buffer.from([0x0e]), "ldarg.s"],
    ["wide variable", Buffer.from([0xfe, 0x09]), "ldarg"],
    ["int32 constant", Buffer.from([0x20]), "ldc.i4"],
    ["int64 constant", Buffer.from([0x21]), "ldc.i8"],
    ["float32 constant", Buffer.from([0x22]), "ldc.r4"],
    ["float64 constant", Buffer.from([0x23]), "ldc.r8"],
    ["short branch", Buffer.from([0x2b]), "br.s"],
    ["long branch", Buffer.from([0x38]), "br"],
    ["prefixed short constant", Buffer.from([0xfe, 0x12]), "unaligned."],
    ["string token", Buffer.from([0x72]), "ldstr"],
    ["type token", Buffer.from([0x71]), "ldobj"],
    ["field token", Buffer.from([0x7b]), "ldfld"],
    ["method token", Buffer.from([0x28]), "call"],
  ] as const)(
    "reports a truncated %s operand at its own instruction",
    (_label, il, name) => {
      expect(fatBody(il)).toMatchObject({
        status: "malformed",
        decoded_instruction_count: 0,
        normalized_il_sha256: null,
        issue: `Instruction ${name} at IL offset 0 leaves method body`,
      });
    },
  );

  // A width declared too small still passes the extent check when no operand
  // bytes are present, so the zero-byte cases above cannot catch it. Supplying
  // one byte less than the real width makes a wrong width let the read run,
  // which surfaces as the raw Buffer error rather than the diagnostic.
  it.each([
    ["wide variable", Buffer.from([0xfe, 0x09]), 2, "ldarg"],
    ["int32 constant", Buffer.from([0x20]), 4, "ldc.i4"],
    ["int64 constant", Buffer.from([0x21]), 8, "ldc.i8"],
    ["float32 constant", Buffer.from([0x22]), 4, "ldc.r4"],
    ["float64 constant", Buffer.from([0x23]), 8, "ldc.r8"],
    ["long branch", Buffer.from([0x38]), 4, "br"],
    ["method token", Buffer.from([0x28]), 4, "call"],
    ["type token", Buffer.from([0x71]), 4, "ldobj"],
    ["string token", Buffer.from([0x72]), 4, "ldstr"],
    ["field token", Buffer.from([0x7b]), 4, "ldfld"],
  ] as const)(
    "rejects a %s operand one byte short of its declared width",
    (_label, opcode, width, name) => {
      expect(
        fatBody(Buffer.concat([opcode, Buffer.alloc(width - 1)])),
      ).toMatchObject({
        status: "malformed",
        decoded_instruction_count: 0,
        normalized_il_sha256: null,
        issue: `Instruction ${name} at IL offset 0 leaves method body`,
      });
    },
  );
});

describe("managed CIL prefix completion", () => {
  it.each([
    ["unaligned.", [0xfe, 0x12, 1], 1],
    ["volatile.", [0xfe, 0x13], 1],
    ["tail.", [0xfe, 0x14], 1],
    ["constrained.", [0xfe, 0x16, 1, 0, 0, 2], 1],
    ["no.", [0xfe, 0x19, 4], 1],
    ["readonly.", [0xfe, 0x1e], 1],
    ["unaligned. volatile. chain", [0xfe, 0x12, 1, 0xfe, 0x13], 2],
  ] as const)(
    "retains decoded evidence but rejects a terminal %s prefix",
    (_label, prefix, prefixCount) => {
      const il = Buffer.from([0x00, ...prefix]);
      const { body, coverage } = tinyBody([...il]);
      expect(body).toMatchObject({
        status: "malformed",
        il_size: il.length,
        il_sha256: createHash("sha256").update(il).digest("hex"),
        normalized_il_sha256: null,
        decoded_instruction_count: 1 + prefixCount,
        opcode_counts: { nop: 1 },
        issue: "CIL prefix chain at IL offset 1 has no following instruction",
      });
      expect(coverage.state).toBe("partial");
    },
  );

  it.each([
    [[0xfe], "Two-byte CIL opcode at IL offset 2 leaves method body"],
    [[0x20], "Instruction ldc.i4 at IL offset 2 leaves method body"],
    [[0xfe, 0xff], "Unsupported CIL opcode 0xfeff at IL offset 2"],
  ] as const)(
    "keeps the original failure after a prefix followed by %j",
    (suffix, issue) => {
      const { body } = tinyBody([0xfe, 0x13, ...suffix]);
      expect(body).toMatchObject({
        status: "malformed",
        decoded_instruction_count: 1,
        normalized_il_sha256: null,
        issue,
      });
    },
  );

  it("locates a dangling prefix after a completed chain", () => {
    const { body, coverage } = tinyBody([
      0xfe, 0x12, 1, 0xfe, 0x13, 0x4a, 0xfe, 0x13,
    ]);
    expect(body).toMatchObject({
      status: "malformed",
      decoded_instruction_count: 4,
      opcode_counts: { "unaligned.": 1, "volatile.": 2, "ldind.i4": 1 },
      normalized_il_sha256: null,
      issue: "CIL prefix chain at IL offset 6 has no following instruction",
    });
    expect(coverage.state).toBe("partial");
  });

  it("rejects a fat method ending in a prefix without a normalized fingerprint", () => {
    expect(fatBody(Buffer.from([0xfe, 0x13]))).toMatchObject({
      status: "malformed",
      header_format: "fat",
      il_size: 2,
      decoded_instruction_count: 1,
      opcode_counts: { "volatile.": 1 },
      normalized_il_sha256: null,
      issue: "CIL prefix chain at IL offset 0 has no following instruction",
    });
  });

  it("keeps a completed prefix chain present with its fingerprint", () => {
    const { body, coverage } = tinyBody([
      0xfe, 0x12, 1, 0xfe, 0x13, 0x4a, 0x2a,
    ]);
    expect(body).toMatchObject({
      status: "present",
      decoded_instruction_count: 4,
      normalized_il_sha256: expect.any(String),
      issue: null,
    });
    expect(coverage.state).toBe("complete");
  });
});

describe("managed complete operand decoding", () => {
  // The extent check must also reject nothing that fits, so every multi-byte
  // width is exercised at exactly its own size with a known value. Each body
  // ends at its operand, so a width declared too large turns a valid operand
  // into the leaves-method-body diagnostic and these value assertions catch it.
  // The -0 constants keep the floating-point sign fix covered through this same
  // path.
  it.each([
    ["wide variable", [0xfe, 0x09], [0x01, 0x00], "variable", "1"],
    ["int32 constant", [0x20], [0x01, 0x00, 0x00, 0x00], "constant", "1"],
    [
      "int64 constant",
      [0x21],
      [0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00],
      "constant",
      "1",
    ],
    ["float32 constant", [0x22], [0x00, 0x00, 0x00, 0x80], "constant", "-0"],
    [
      "float64 constant",
      [0x23],
      [0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x80],
      "constant",
      "-0",
    ],
    ["long branch", [0x38], [0x00, 0x00, 0x00, 0x00], "branch", "5"],
    ["method token", [0x28], [0x01, 0x00, 0x00, 0x00], "method", "0x00000001"],
    ["type token", [0x71], [0x02, 0x00, 0x00, 0x00], "type", "0x00000002"],
    ["string token", [0x72], [0x03, 0x00, 0x00, 0x00], "string", "0x00000003"],
    ["field token", [0x7b], [0x04, 0x00, 0x00, 0x00], "field", "0x00000004"],
  ] as const)(
    "decodes a %s operand at exactly its declared width",
    (_label, opcode, operand, operandKind, value) => {
      expect(fatBody(Buffer.from([...opcode, ...operand]))).toMatchObject({
        status: "present",
        issue: null,
        decoded_instruction_count: 1,
        anchors: [{ il_offset: 0, operand_kind: operandKind, operand: value }],
      });
    },
  );

  it("reports a switch whose target table is missing", () => {
    expect(
      fatBody(Buffer.from([0x00, 0x45, 0x02, 0x00, 0x00, 0x00])),
    ).toMatchObject({
      status: "malformed",
      decoded_instruction_count: 1,
      opcode_counts: { nop: 1 },
      issue: "Instruction switch at IL offset 1 leaves method body",
    });
  });

  it("reports a switch whose target count is itself truncated", () => {
    expect(fatBody(Buffer.from([0x45, 0x02]))).toMatchObject({
      status: "malformed",
      decoded_instruction_count: 0,
      issue: "Instruction switch at IL offset 0 leaves method body",
    });
  });

  it("preserves instructions decoded before a truncated operand", () => {
    expect(fatBody(Buffer.from([0x00, 0x20]))).toMatchObject({
      status: "malformed",
      il_size: 2,
      decoded_instruction_count: 1,
      opcode_counts: { nop: 1 },
      issue: "Instruction ldc.i4 at IL offset 1 leaves method body",
    });
  });

  it("retains named references and loaded literals before a truncated operand", () => {
    const { heap, tokens } = fixtureUserStringHeap(["observed"]);
    const literalToken = tokens[0]!;
    const il = Buffer.from([
      0x28, 1, 0, 0, 0x0a, 0x7e, 1, 0, 0, 0x04, 0x26, 0x72, 0, 0, 0, 0, 0x26,
      0x20,
    ]);
    il.writeUInt32LE(Number.parseInt(literalToken, 16), 12);
    const bytes = buildManagedPeFixture({
      memberRefParentRaw: 8,
      memberRefName: "ObservedCall",
      fieldName: "ObservedField",
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
      userStringHeap: heap,
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      il_size: il.length,
      il_sha256: createHash("sha256").update(il).digest("hex"),
      normalized_il_sha256: null,
      decoded_instruction_count: 5,
      anchors: [
        { opcode: "call", operand: "0x0a000001" },
        { opcode: "ldsfld", operand: "0x04000001" },
        { opcode: "pop", operand: null },
        { opcode: "ldstr", operand: literalToken },
        { opcode: "pop", operand: null },
      ],
      issue: "Instruction ldc.i4 at IL offset 17 leaves method body",
    });
    expect(result.call_edges).toMatchObject([
      {
        opcode: "call",
        target_token: "0x0a000001",
        target_name: "ObservedCall",
        target_declaring_type: "Fixture.Program",
      },
    ]);
    expect(result.field_accesses).toMatchObject([
      {
        opcode: "ldsfld",
        field_token: "0x04000001",
        field_name: "ObservedField",
        field_declaring_type: "Fixture.Program",
      },
    ]);
    expect(result.user_strings).toMatchObject({
      state: "partial",
      literals: [{ token: literalToken, value: "observed" }],
      issues: [],
    });
    expect(result.coverage.state).toBe("partial");
  });

  it("keeps a complete operand-bearing body decodable", () => {
    expect(
      fatBody(Buffer.from([0x00, 0x20, 0x01, 0x00, 0x00, 0x00, 0x2a])),
    ).toMatchObject({
      status: "present",
      decoded_instruction_count: 3,
      opcode_counts: { nop: 1, "ldc.i4": 1, ret: 1 },
      issue: null,
    });
  });

  it("still decodes a switch whose targets fit", () => {
    const il = Buffer.from([
      0x00, 0x45, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x2a,
    ]);
    expect(fatBody(il)).toMatchObject({
      status: "present",
      il_size: il.length,
      opcode_counts: { nop: 1, switch: 1, ret: 1 },
      issue: null,
    });
  });
});

describe("managed exception region bounds", () => {
  it("marks out-of-method ranges malformed and preserves the raw EH clause", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x2a]),
        tryOffset: 0,
        tryLength: 2,
        handlerOffset: 0,
      }),
    ).toMatchObject({
      status: "malformed",
      il_size: 1,
      exception_regions: [
        {
          flags: 0,
          try_offset: 0,
          try_length: 2,
          handler_offset: 0,
          handler_length: 1,
          class_token: "0x02000001",
        },
      ],
      issue: "Exception clause try range leaves the method IL body",
    });
  });

  it("uses half-open method bounds and permits zero-length ranges", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x00, 0x00, 0x2a]),
        tryOffset: 0,
        tryLength: 1,
        handlerOffset: 1,
        handlerLength: 2,
      }),
    ).toMatchObject({ status: "present", il_size: 3, issue: null });
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x2a]),
        tryOffset: 0,
        tryLength: 0,
        handlerOffset: 0,
        handlerLength: 0,
      }),
    ).toMatchObject({ status: "present", il_size: 1, issue: null });
  });

  it.each([
    ["try start", { tryOffset: 1, tryLength: 4, handlerOffset: 5 }],
    ["try end", { tryOffset: 0, tryLength: 1, handlerOffset: 5 }],
    ["handler start", { tryLength: 5, handlerOffset: 1, handlerLength: 5 }],
    ["handler end", { tryLength: 5, handlerOffset: 0, handlerLength: 1 }],
  ] as const)(
    "preserves clauses with a mid-instruction %s",
    (_label, region) => {
      const body = managedBodyWithRegion({
        il: Buffer.from([0x20, 0, 0, 0, 0, 0x2a]),
        ...region,
      });
      expect(body).toMatchObject({
        status: "malformed",
        exception_regions: [expect.any(Object)],
        issue:
          "Exception clause " +
          (_label.startsWith("try") ? "try" : "handler") +
          " range does not align with CIL instruction boundaries",
      });
    },
  );

  it("rejects a filter start inside an instruction and retains the clause", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x20, 0, 0, 0, 0, 0x2a]),
        flags: 1,
        tryLength: 5,
        handlerOffset: 5,
        extra: 1,
      }),
    ).toMatchObject({
      status: "malformed",
      exception_regions: [expect.objectContaining({ filter_offset: 1 })],
      issue:
        "Exception clause filter range does not align with CIL instruction boundaries",
    });
  });
});

describe("managed exception region prefix boundaries", () => {
  it("treats a CIL prefix chain and its opcode as one boundary", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0xfe, 0x12, 1, 0xfe, 0x13, 0x4a, 0x2a]),
        tryOffset: 0,
        tryLength: 6,
        handlerOffset: 6,
      }),
    ).toMatchObject({ status: "present", issue: null, il_size: 7 });
  });

  it("keeps constrained callvirt as a single region boundary", () => {
    const il = Buffer.from([0xfe, 0x16, 1, 0, 0, 1, 0x6f, 1, 0, 0, 6, 0x2a]);
    expect(
      managedBodyWithRegion({
        il,
        tryOffset: 0,
        tryLength: 11,
        handlerOffset: 11,
      }),
    ).toMatchObject({ status: "present", issue: null, il_size: 12 });
    expect(
      managedBodyWithRegion({
        il,
        tryOffset: 6,
        tryLength: 1,
        handlerOffset: 11,
      }),
    ).toMatchObject({
      status: "malformed",
      issue:
        "Exception clause try range does not align with CIL instruction boundaries",
    });
  });

  it("decodes the no. prefix and keeps it with its opcode", () => {
    // ldarg.0; no. nullcheck; ldfld 0x04000001; pop; ret
    const il = Buffer.from([2, 0xfe, 0x19, 4, 0x7b, 1, 0, 0, 4, 0x26, 0x2a]);
    expect(
      managedBodyWithRegion({ il, tryLength: 10, handlerOffset: 10 }),
    ).toMatchObject({
      status: "present",
      issue: null,
      decoded_instruction_count: 5,
      opcode_counts: { "ldarg.0": 1, "no.": 1, ldfld: 1, pop: 1, ret: 1 },
    });
    expect(
      managedBodyWithRegion({
        il,
        tryOffset: 4,
        tryLength: 5,
        handlerOffset: 10,
      }),
    ).toMatchObject({
      status: "malformed",
      issue:
        "Exception clause try range does not align with CIL instruction boundaries",
    });
  });

  it.each([
    ["start", { tryOffset: 5, tryLength: 1, handlerOffset: 6 }],
    [
      "end after first prefix",
      { tryOffset: 0, tryLength: 3, handlerOffset: 6 },
    ],
    [
      "end after second prefix",
      { tryOffset: 0, tryLength: 5, handlerOffset: 6 },
    ],
  ] as const)(
    "rejects a region %s between a prefix and its opcode",
    (_edge, region) => {
      expect(
        managedBodyWithRegion({
          il: Buffer.from([0xfe, 0x12, 1, 0xfe, 0x13, 0x4a, 0x2a]),
          ...region,
        }),
      ).toMatchObject({
        status: "malformed",
        exception_regions: [expect.any(Object)],
        issue:
          "Exception clause try range does not align with CIL instruction boundaries",
      });
    },
  );
});

describe("managed exception region flags and filters", () => {
  it("marks reserved clause flags malformed without dropping its bytes", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x00, 0x2a]),
        flags: 8,
        tryLength: 1,
        handlerOffset: 1,
      }),
    ).toMatchObject({
      status: "malformed",
      exception_regions: [expect.objectContaining({ flags: 8 })],
      issue: "Exception clause has unsupported flags 0x8",
    });
  });

  it.each([2, 4])(
    "accepts the defined finally/fault clause flag %s",
    (flags) => {
      expect(
        managedBodyWithRegion({
          il: Buffer.from([0x00, 0x00, 0x2a]),
          flags,
          tryOffset: 0,
          tryLength: 1,
          handlerOffset: 1,
          handlerLength: 2,
        }),
      ).toMatchObject({ status: "present", issue: null });
    },
  );

  it("validates filter ordering", () => {
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x00, 0x00, 0xfe, 0x11, 0x2a]),
        flags: 1,
        tryOffset: 0,
        tryLength: 1,
        handlerOffset: 4,
        extra: 1,
      }),
    ).toMatchObject({ status: "present", il_size: 5, issue: null });
    expect(
      managedBodyWithRegion({
        il: Buffer.from([0x00, 0x00, 0x2a]),
        flags: 1,
        tryOffset: 0,
        tryLength: 1,
        handlerOffset: 1,
        extra: 1,
      }),
    ).toMatchObject({
      status: "malformed",
      issue:
        "Exception clause filter must start before its handler within the method IL body",
    });
  });
});

describe("managed exception section decoding", () => {
  it("reads legacy small EH DataSize without counting its header", () => {
    const section = Buffer.alloc(16);
    section[0] = 0x01;
    section[1] = 12;

    expect(managedBodyWithSections(section)).toMatchObject({
      status: "present",
      issue: null,
      exception_regions: [expect.any(Object)],
      normalized_il_sha256: expect.any(String),
    });
  });

  it("advances a chained legacy section by its physical size", () => {
    const legacy = Buffer.alloc(16);
    legacy[0] = 0x81;
    legacy[1] = 12;
    const conformant = Buffer.alloc(16);
    conformant[0] = 0x01;
    conformant[1] = 16;

    expect(managedBodyWithSections(legacy, conformant)).toMatchObject({
      status: "present",
      issue: null,
      exception_regions: [expect.any(Object), expect.any(Object)],
      normalized_il_sha256: expect.any(String),
    });
  });

  it("rejects a legacy-sized clause whose physical bytes leave the artifact", () => {
    const section = Buffer.alloc(12);
    section[0] = 0x01;
    section[1] = 12;

    expect(parseExceptionRegions(section, 0, section.length)).toMatchObject({
      status: "malformed",
      regions: [],
      issue: "Exception section size leaves artifact",
    });
  });

  it("still rejects a small EH DataSize that matches neither layout", () => {
    const section = Buffer.alloc(17);
    section[0] = 0x01;
    section[1] = 13;

    expect(managedBodyWithSections(section)).toMatchObject({
      status: "malformed",
      exception_regions: [],
      issue: "Exception section size does not contain whole clauses",
    });
  });

  it("marks an exception section with a partial clause as malformed", () => {
    const section = Buffer.alloc(17);
    section[0] = 0x01;
    section[1] = section.length;

    expect(managedBodyWithSections(section)).toMatchObject({
      status: "malformed",
      exception_regions: [],
      issue: "Exception section size does not contain whole clauses",
    });
  });

  it("reads every chained exception section", () => {
    const first = Buffer.alloc(16);
    first[0] = 0x81;
    first[1] = first.length;
    const second = Buffer.alloc(16);
    second[0] = 0x01;
    second[1] = second.length;
    expect(managedBodyWithSections(first, second)).toMatchObject({
      status: "present",
      issue: null,
      exception_regions: [
        { flags: 0, try_offset: 0, try_length: 0, handler_offset: 0 },
        { flags: 0, try_offset: 0, try_length: 0, handler_offset: 0 },
      ],
    });
  });

  it("keeps small section reserved bytes invalid", () => {
    const section = Buffer.alloc(16);
    section[0] = 0x01;
    section[1] = 16;
    section[2] = 1;

    expect(managedBodyWithSections(section)).toMatchObject({
      status: "malformed",
      exception_regions: [],
      issue: "Small exception section reserved bytes are nonzero",
    });
  });

  it("preserves decoded clauses when a chained section has an unsupported kind", () => {
    const first = Buffer.alloc(16);
    first[0] = 0x81;
    first[1] = first.length;
    const second = Buffer.from([0x02, 0x04, 0x00, 0x00]);
    expect(managedBodyWithSections(first, second)).toMatchObject({
      status: "malformed",
      exception_regions: [expect.objectContaining({ flags: 0 })],
      issue: "Unsupported method data section kind 2",
    });
  });

  it("preserves decoded clauses when a later section has a partial clause", () => {
    const first = Buffer.alloc(16);
    first[0] = 0x81;
    first[1] = first.length;
    first.writeUInt16LE(2, 4);
    const later = Buffer.alloc(17);
    later[0] = 0x01;
    later[1] = later.length;

    expect(managedBodyWithSections(first, later)).toMatchObject({
      status: "malformed",
      exception_regions: [expect.objectContaining({ flags: 2 })],
      issue: "Exception section size does not contain whole clauses",
    });
  });

  it.each([
    {
      name: "unsupported section kind",
      section: Buffer.from([0x02, 0x04, 0x00, 0x00]),
      issue: "Unsupported method data section kind 2",
    },
    {
      name: "section size outside artifact",
      section: Buffer.from([0x41, 0xff, 0xff, 0xff]),
      issue: "Exception section size leaves artifact",
    },
  ])("rejects $name", ({ section, issue }) => {
    expect(managedBodyWithSections(section)).toMatchObject({
      status: "malformed",
      exception_regions: [],
      issue,
    });
  });
});

describe("managed catch fact retention", () => {
  it.each([
    {
      name: "local TypeDef",
      classToken: 0x0200_0001,
      typeRefScopeRaw: 0,
      classType: "Fixture.Program",
      identityResolved: true,
    },
    {
      name: "TypeRef with an unavailable AssemblyRef scope",
      classToken: 0x0100_0001,
      typeRefScopeRaw: (9 << 2) | 2,
      classType: "System.Runtime.Versioning.TargetFrameworkAttribute",
      identityResolved: false,
    },
    {
      name: "TypeRef with a cyclic scope",
      classToken: 0x0100_0001,
      typeRefScopeRaw: (1 << 2) | 3,
      classType: "System.Runtime.Versioning.TargetFrameworkAttribute",
      identityResolved: false,
    },
  ])(
    "retains $name catch facts before a malformed later EH section",
    ({ classToken, typeRefScopeRaw, classType, identityResolved }) => {
      const header = Buffer.alloc(12);
      header.writeUInt16LE(0x300b, 0);
      header.writeUInt16LE(8, 2);
      header.writeUInt32LE(1, 4);
      const first = Buffer.alloc(16);
      first[0] = 0x81;
      first[1] = first.length;
      first.writeUInt32LE(classToken, 12);
      const later = Buffer.alloc(17);
      later[0] = 0x01;
      later[1] = later.length;
      const il = Buffer.from([0x2a]);
      const bytes = buildManagedPeFixture({
        typeRefScopeRaw,
        ilBody: Buffer.concat([header, il, Buffer.alloc(3), first, later]),
      });
      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
      );

      expect(result.methods[0]?.body).toMatchObject({
        status: "malformed",
        il_sha256: createHash("sha256").update(il).digest("hex"),
        normalized_il_sha256: null,
        decoded_instruction_count: 1,
        anchors: [{ opcode: "ret", operand: null }],
        exception_regions: [
          {
            flags: 0,
            class_token: `0x${classToken.toString(16).padStart(8, "0")}`,
            class_type: classType,
            class_type_name_sha256: identityResolved
              ? expect.any(String)
              : null,
            class_type_identity_resolved: identityResolved,
          },
        ],
        issue: "Exception section size does not contain whole clauses",
      });
      expect(result.coverage.state).toBe("partial");
      if (!identityResolved)
        expect(result.coverage.issues).toContainEqual(
          expect.objectContaining({
            code: "invalid-row",
            scope: "metadata.TypeRef:0x01000001",
          }),
        );
      expect(result.user_strings?.state).toBe("complete");
    },
  );
});
