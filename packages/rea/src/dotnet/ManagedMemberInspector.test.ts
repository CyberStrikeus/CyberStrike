import { describe, expect, it } from "vitest";

import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import {
  ManagedDecodeBudget,
  managedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import { metadataRowCursor, readMetadataBlob } from "./ManagedMetadataHeaps.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
  type ManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { memberListIndexSize } from "./ManagedMemberPointers.js";
import { edges } from "./ManagedMemberRows.js";
import { parseUserStrings } from "./ManagedUserStrings.js";
import {
  readCompressed,
  signature,
  isParsedTokenInstruction,
  type DecodedMethod,
  type ManagedMethod,
} from "./ManagedMemberInspectorCore.js";
import { decodeInstructions } from "./ManagedMemberInstructionDecoder.js";
import { ManagedReaderFailure } from "./ManagedReaderFailure.js";
import { managedTypeReferences } from "./ManagedTypeReferences.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import { managedMemberInspectionSchema } from "../domain/managed/managedArtifact.js";
import { comparisonLimitations } from "../domain/managed/managedMemberComparisonCoverage.js";
import { buildManagedPeFixture as buildMultiMethodManagedPeFixture } from "../../scripts/fixtures/managed/pe.mjs";

import {
  buildManagedNestedTypeFixture,
  buildManagedPeFixture,
  buildNativePeFixture,
  fixtureUserStringHeap,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";

/** Decode real token operands for capacity tests that do not need a PE method body. */
const decodedTokenInstructions = (
  opcode: number,
  tokens: readonly number[],
) => {
  const il = Buffer.alloc(tokens.length * 5);
  for (const [index, token] of tokens.entries()) {
    il.writeUInt8(opcode, index * 5);
    il.writeUInt32LE(token, index * 5 + 1);
  }
  return decodeInstructions(il).parsed.filter(isParsedTokenInstruction);
};

/** A tiny-header body that loads each `ldstr` token, discards it, and returns. */
const ldstrBody = (tokens: readonly string[]): Buffer => {
  const il = Buffer.concat([
    ...tokens.map((token) => {
      const instruction = Buffer.from([0x72, 0, 0, 0, 0, 0x26]);
      instruction.writeUInt32LE(Number.parseInt(token, 16), 1);
      return instruction;
    }),
    Buffer.from([0x2a]),
  ]);
  return Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]);
};

it.each([
  {
    options: { methodSignature: Buffer.from([0x06, 0x08]) },
    collection: "methods",
    expected: "method",
  },
  {
    options: { fieldSignature: Buffer.from([0x00, 0x00, 0x01]) },
    collection: "fields",
    expected: "field",
  },
] as const)(
  "rejects a wrong-kind $expected signature at its metadata owner",
  ({ options, collection, expected }) => {
    const bytes = buildManagedPeFixture(options);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result[collection][0]?.signature).toMatchObject({
      parse_status: "malformed",
      resolved_sha256: null,
      issue: expect.stringContaining(`Expected ${expected} signature`),
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: expect.arrayContaining([
        expect.objectContaining({
          code: "invalid-blob",
          detail: expect.stringContaining(`Expected ${expected} signature`),
        }),
      ]),
    });
  },
);

describe("managed compressed integer framing", () => {
  it.each([[0x80], [0xc0], [0xc0, 1], [0xc0, 1, 2]])(
    "keeps an incomplete width %j distinct from a reserved prefix",
    (...value) => {
      expect(() => readCompressed(Buffer.from(value), 0)).toThrow(
        "truncated compressed integer",
      );
    },
  );
  it("preserves complete widths and rejects reserved leading bits", () => {
    expect(readCompressed(Buffer.from([0x80, 1]), 0)).toEqual({
      value: 1,
      next: 2,
    });
    expect(readCompressed(Buffer.from([0xc0, 1, 2, 3]), 0)).toEqual({
      value: 0x010203,
      next: 4,
    });
    expect(() => readCompressed(Buffer.from([0xe0, 1, 2, 3]), 0)).toThrow(
      "reserved compressed integer",
    );
  });
});

describe("managed method body anchors", () => {
  it.each([
    ["field", Buffer.from([0x06, 0x08]), "field"],
    ["method", Buffer.from([0x00, 0x00, 0x01]), "method"],
    ["unknown", Buffer.from([0x7f]), "token"],
  ] as const)(
    "classifies ldtoken MemberRefs from their parsed %s signature",
    (_label, memberRefSignature, expectedKind) => {
      const il = Buffer.from([0xd0, 1, 0, 0, 0x0a, 0x26, 0x2a]);
      const bytes = buildManagedPeFixture({
        targetFramework: null,
        memberRefName: "Counter",
        memberRefParentRaw: 8,
        memberRefSignature,
        ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
      });
      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
      );

      expect(result.member_refs[0]?.signature.kind).toBe(
        expectedKind === "token" ? "unknown" : expectedKind,
      );
      expect(result.methods[0]?.body.anchors[0]).toMatchObject({
        opcode: "ldtoken",
        operand_kind: expectedKind,
        operand: "0x0a000001",
      });
      expect(result.call_edges).toEqual([]);
      expect(result.field_accesses).toEqual([]);
    },
  );

  it("keeps operand-free instructions in anchors so branch comparison constants stay recoverable", () => {
    // ldloc.s 4; ldc.i4.4; bne.un.s +0; ret. The constant this branch compares
    // against is carried by the operand-free ldc.i4.4 opcode itself, so the
    // anchors must retain the instruction rather than only its operand.
    const il = Buffer.from([0x11, 0x04, 0x1a, 0x33, 0x00, 0x2a]);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]?.body.opcode_counts).toEqual({
      "ldloc.s": 1,
      "ldc.i4.4": 1,
      "bne.un.s": 1,
      ret: 1,
    });
    expect(result.methods[0]?.body.anchors).toEqual([
      {
        il_offset: 0,
        opcode: "ldloc.s",
        operand_kind: "variable",
        operand: "4",
      },
      {
        il_offset: 2,
        opcode: "ldc.i4.4",
        operand_kind: "none",
        operand: null,
      },
      {
        il_offset: 3,
        opcode: "bne.un.s",
        operand_kind: "branch",
        operand: "5",
      },
      {
        il_offset: 5,
        opcode: "ret",
        operand_kind: "none",
        operand: null,
      },
    ]);
  });
});

it.each([0x06000001, 0x11000001])(
  "marks an invalid LocalVarSigTok %s malformed without losing CIL",
  (token) => {
    const body = Buffer.alloc(13);
    body.writeUInt16LE(0x3003, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(1, 4);
    body[12] = 0x2a;
    const bytes = buildManagedPeFixture({ ilBody: body });
    const initial = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const offset = initial.methods[0]?.body.file_offset;
    if (offset === null || offset === undefined)
      throw new Error("fixture body has no offset");
    bytes.writeUInt32LE(token, offset + 8);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      local_var_sig_token: `0x${token.toString(16).padStart(8, "0")}`,
      anchors: expect.arrayContaining([
        expect.objectContaining({ opcode: "ret" }),
      ]),
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({ code: "invalid-row", offset: offset + 8 }),
      ],
    });
  },
);

it.each([
  ["CIL", false, "Two-byte CIL opcode"],
  ["exception section", true, "section"],
] as const)(
  "preserves malformed %s alongside an unsupported local signature",
  (_name, hasSection, issue) => {
    const body = Buffer.alloc(hasSection ? 20 : 14);
    body.writeUInt16LE(hasSection ? 0x300b : 0x3003, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(2, 4);
    body.writeUInt32LE(0x11000001, 8);
    body[12] = 0x00; // A usable nop precedes the malformed instruction.
    body[13] = hasSection ? 0x2a : 0xfe; // ret or truncated two-byte opcode.
    if (hasSection) {
      body[16] = 2; // Unsupported extra-section kind.
      body[17] = 4;
    }
    const bytes = buildManagedPeFixture({
      ilBody: body,
      standaloneSignatures: [Buffer.from([0x07, 0x01, 0xff])],
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status: "malformed",
      normalized_il_sha256: null,
      anchors: expect.arrayContaining([
        expect.objectContaining({ opcode: "nop" }),
      ]),
      issue: expect.stringContaining(issue),
    });
    expect(result.methods[0]?.body.issue).toContain("unsupported element type");
    expect(result.coverage.state).toBe("partial");
    expect(result.coverage.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "unsupported-signature" }),
      ]),
    );
  },
);

it.each([
  ["valid LocalVarSig", Buffer.from([0x07, 0x01, 0x08]), "present"],
  [
    "valid pinned LocalVarSig",
    Buffer.from([0x07, 0x01, 0x45, 0x08]),
    "present",
  ],
  [
    "valid pinned by-reference LocalVarSig",
    Buffer.from([0x07, 0x01, 0x45, 0x10, 0x08]),
    "present",
  ],
  [
    "valid pinned pointer with a nested custom modifier",
    Buffer.from([0x07, 0x01, 0x45, 0x0f, 0x1f, 0x04, 0x08]),
    "present",
  ],
  [
    "valid pinned function pointer with a TYPEDBYREF return",
    Buffer.from([0x07, 0x01, 0x45, 0x1b, 0x00, 0x00, 0x16]),
    "present",
  ],
  ["wrong signature kind", Buffer.from([0x00, 0x00, 0x01]), "malformed"],
  ["truncated LocalVarSig", Buffer.from([0x07, 0x01]), "malformed"],
] as const)(
  "checks the StandAloneSig payload kind: %s",
  (_name, standaloneSignature, status) => {
    const body = Buffer.alloc(13);
    body.writeUInt16LE(0x3003, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(1, 4);
    body.writeUInt32LE(0x11000001, 8);
    body[12] = 0x2a;
    const bytes = buildManagedPeFixture({
      ilBody: body,
      standaloneSignatures: [standaloneSignature],
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body.status).toBe(status);
    if (status === "present")
      expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
    else
      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: [expect.objectContaining({ code: expect.any(String) })],
      });
  },
);

it.each([
  [
    "void local element",
    Buffer.from([0x07, 0x01, 0x01]),
    "malformed",
    "invalid-blob",
    2,
  ],
  [
    "local modifier after PINNED constraint",
    Buffer.from([0x07, 0x01, 0x45, 0x1f, 0x04, 0x08]),
    "malformed",
    "invalid-blob",
    3,
  ],
  [
    "PINNED typed reference local",
    Buffer.from([0x07, 0x01, 0x45, 0x16]),
    "malformed",
    "invalid-blob",
    3,
  ],
  [
    "trailing signature data",
    Buffer.from([0x07, 0x01, 0x08, 0xff]),
    "malformed",
    "invalid-blob",
    3,
  ],
  [
    "unsupported local element",
    Buffer.from([0x07, 0x01, 0xff]),
    "partial",
    "unsupported-signature",
    2,
  ],
  [
    "zero local count with trailing byte",
    Buffer.from([0x07, 0x00, 0xff]),
    "malformed",
    "invalid-blob",
    1,
  ],
] as const)(
  "preserves CIL and reports %s at its source byte",
  (_name, standaloneSignature, status, code, localOffset) => {
    const body = Buffer.alloc(13);
    body.writeUInt16LE(0x3003, 0);
    body.writeUInt16LE(8, 2);
    body.writeUInt32LE(1, 4);
    body.writeUInt32LE(0x11000001, 8);
    body[12] = 0x2a;
    const bytes = buildManagedPeFixture({
      ilBody: body,
      standaloneSignatures: [standaloneSignature],
    });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "metadata"),
      pe.cli.metadata.size,
    );
    const row = metadataRowCursor(bytes, layout, 17, 1);
    const blob = readMetadataBlob(
      bytes,
      layout,
      row.readIndex(layout.blobIndexSize),
      layout.blob?.size ?? 0,
    );
    const blobOffset = blob.byteOffset - bytes.byteOffset;
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status,
      anchors: expect.arrayContaining([
        expect.objectContaining({ opcode: "ret" }),
      ]),
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code,
          scope: "metadata.StandAloneSig:0x11000001.signature",
          offset: blobOffset + localOffset,
        }),
      ],
    });
  },
);

/** Artifact offset of row 1's signature blob, read with the production heap reader. */
const memberSignatureBlobOffset = (
  bytes: Buffer,
  table: 4 | 6 | 10,
): number => {
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("fixture has no CLI header");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "metadata"),
    pe.cli.metadata.size,
  );
  const row = metadataRowCursor(bytes, layout, table, 1);
  // ECMA-335 II.22.15 Field, II.22.26 MethodDef and II.22.25 MemberRef
  // columns before Name.
  if (table === 4) row.readUInt16();
  if (table === 6) {
    row.readUInt32();
    row.readUInt16();
    row.readUInt16();
  }
  if (table === 10) row.readIndex(layout.codedIndexSize("MemberRefParent"));
  row.readIndex(layout.stringIndexSize);
  const blob = readMetadataBlob(
    bytes,
    layout,
    row.readIndex(layout.blobIndexSize),
    layout.blob?.size ?? 0,
  );
  return blob.byteOffset - bytes.byteOffset;
};

// CLASS (0x12) followed by TypeDefOrRefOrSpec 0x07, whose tag 3 is undefined.
const INVALID_CLASS_OPERAND = [0x12, 0x07] as const;

it.each([
  {
    member: "field",
    table: 4,
    scope: "Field:0x04000001.signature",
    signature: {
      fieldSignature: Buffer.from([0x06, ...INVALID_CLASS_OPERAND]),
    },
    operandOffset: 2,
  },
  {
    member: "method parameter",
    table: 6,
    scope: "MethodDef:0x06000001.signature",
    signature: {
      methodSignature: Buffer.from([
        0x00,
        0x01,
        0x01,
        ...INVALID_CLASS_OPERAND,
      ]),
    },
    operandOffset: 4,
  },
  {
    member: "member reference parameter",
    table: 10,
    scope: "MemberRef:0x0a000001.signature",
    signature: {
      memberRefSignature: Buffer.from([
        0x20,
        0x01,
        0x01,
        ...INVALID_CLASS_OPERAND,
      ]),
    },
    operandOffset: 4,
  },
] as const)(
  "reports an invalid $member signature operand at its artifact offset",
  ({ table, scope, signature, operandOffset }) => {
    const bytes = buildManagedPeFixture(signature);
    const blobOffset = memberSignatureBlobOffset(bytes, table);
    expect(bytes[blobOffset + operandOffset]).toBe(0x07);

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage.state).toBe("partial");
    expect(result.coverage.issues).toContainEqual({
      code: "invalid-row",
      scope,
      offset: blobOffset + operandOffset,
      detail:
        "TypeDefOrRefOrSpec operand 0x7 is invalid: coded index tag 3 is not defined",
    });
  },
);

describe("managed member inspection", () => {
  it("keeps metadata handles distinct from calls and field accesses", () => {
    const il = Buffer.from([
      0xd0, 0x01, 0, 0, 0x06, 0x26, 0xd0, 0x01, 0, 0, 0x04, 0x26, 0x28, 0x01, 0,
      0, 0x0a, 0x7b, 0x01, 0, 0, 0x04, 0x26, 0x2a,
    ]);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]?.body.anchors.map(({ opcode }) => opcode)).toEqual(
      ["ldtoken", "pop", "ldtoken", "pop", "call", "ldfld", "pop", "ret"],
    );
    expect(result.call_edges.map(({ opcode }) => opcode)).toEqual(["call"]);
    expect(result.field_accesses.map(({ opcode }) => opcode)).toEqual([
      "ldfld",
    ]);
  });

  it("inspects metadata members, signatures, CIL hashes, call edges, and field anchors", () => {
    const bytes = buildManagedPeFixture();
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.identity_scope).toEqual({
      token_identity: "build-local",
      requires_artifact_sha256: managedPeFixtureTarget(bytes).sha256,
      requires_mvid: "00112233-4455-6677-8899-aabbccddeeff",
    });
    expect(result.types).toEqual([
      expect.objectContaining({
        token: "0x02000001",
        full_name: "Fixture.Program",
        field_list: { first_row: 1, last_row: 1, count: 1 },
        method_list: { first_row: 1, last_row: 1, count: 1 },
      }),
    ]);
    expect(result.fields).toEqual([
      expect.objectContaining({
        token: "0x04000001",
        declaring_type: "Fixture.Program",
        name: "counter",
        signature: expect.objectContaining({
          kind: "field",
          parse_status: "decoded",
          field_type: "i4",
        }),
      }),
    ]);
    expect(result.methods).toEqual([
      expect.objectContaining({
        token: "0x06000001",
        declaring_type: "Fixture.Program",
        name: "Main",
        rva: 0x2800,
        signature: expect.objectContaining({
          kind: "method",
          parse_status: "decoded",
          return_type: "void",
          parameter_types: [],
        }),
        body: expect.objectContaining({
          status: "present",
          header_format: "tiny",
          file_offset: 0x0a00,
          il_size: 12,
          instruction_count: 4,
          decoded_instruction_count: 4,
          truncated_instructions: 0,
          opcode_counts: { "ldarg.0": 1, ldfld: 1, call: 1, ret: 1 },
          anchors: [
            {
              il_offset: 0,
              opcode: "ldarg.0",
              operand_kind: "none",
              operand: null,
            },
            {
              il_offset: 1,
              opcode: "ldfld",
              operand_kind: "field",
              operand: "0x04000001",
            },
            {
              il_offset: 6,
              opcode: "call",
              operand_kind: "method",
              operand: "0x0a000001",
            },
            {
              il_offset: 11,
              opcode: "ret",
              operand_kind: "none",
              operand: null,
            },
          ],
        }),
      }),
    ]);
    expect(result.member_refs).toEqual([
      expect.objectContaining({
        token: "0x0a000001",
        parent_token: "0x01000001",
        parent_name: "System.Runtime.Versioning.TargetFrameworkAttribute",
        name: ".ctor",
        signature: expect.objectContaining({
          kind: "method",
          parse_status: "decoded",
          parameter_types: ["string"],
        }),
      }),
    ]);
    expect(result.call_edges).toEqual([
      {
        caller_token: "0x06000001",
        il_offset: 6,
        target_identity_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        caller: "Fixture.Program.Main",
        opcode: "call",
        target_token: "0x0a000001",
        target_kind: "member-ref",
        target_name: ".ctor",
        target_declaring_type:
          "System.Runtime.Versioning.TargetFrameworkAttribute",
      },
    ]);
    expect(result.field_accesses).toEqual([
      {
        method_token: "0x06000001",
        il_offset: 1,
        target_identity_sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        method: "Fixture.Program.Main",
        opcode: "ldfld",
        field_token: "0x04000001",
        field_name: "counter",
        field_declaring_type: "Fixture.Program",
      },
    ]);
    expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
  });
});

/** A tiny-header body of token-operand instructions followed by `ret`. */
const tokenBody = (
  instructions: readonly (readonly [opcode: number, token: number])[],
): Buffer => {
  const il = Buffer.concat([
    ...instructions.map(([opcode, token]) => {
      const instruction = Buffer.alloc(5);
      instruction.writeUInt8(opcode, 0);
      instruction.writeUInt32LE(token, 1);
      return instruction;
    }),
    Buffer.from([0x2a]),
  ]);
  return Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]);
};

const attribute = "System.Runtime.Versioning.TargetFrameworkAttribute";
const inspect = (options: Parameters<typeof buildManagedPeFixture>[0]) => {
  const bytes = buildManagedPeFixture(options);
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
};
const call = 0x28;
const ldsfld = 0x7e;
const memberRefOnTypeSpec = (signature: Buffer) =>
  inspect({
    typeSpecSignatures: [signature],
    memberRefParentRaw: (1 << 3) | 4,
  });

// HASTHIS | GENERIC, one generic parameter, no parameters, void.
const genericRef = Buffer.from([0x30, 0x01, 0x00, 0x01]);
// GENERIC, one generic parameter, no parameters, void.
const genericDef = Buffer.from([0x10, 0x01, 0x00, 0x01]);

it.each([
  { badName: true, parent: 0, expectedHeap: "#Strings" },
  { badName: false, parent: 0, expectedHeap: "#Blob" },
  { badName: true, parent: 17, expectedHeap: "#Strings" },
  { badName: false, parent: 17, expectedHeap: "#Blob" },
])(
  "reports $expectedHeap before invalid MemberRef parent $parent (bad name $badName)",
  ({ badName, parent, expectedHeap }) => {
    const bytes = buildManagedPeFixture({ memberRefParentRaw: parent });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "metadata"),
      size,
    );
    const nameColumn =
      metadataRowOffset(layout, 10, 1) +
      layout.codedIndexSize("MemberRefParent");
    if (badName) {
      if (layout.stringIndexSize === 2) bytes.writeUInt16LE(0xffff, nameColumn);
      else bytes.writeUInt32LE(0xffffffff, nameColumn);
    }
    const signatureColumn = nameColumn + layout.stringIndexSize;
    if (layout.blobIndexSize === 2)
      bytes.writeUInt16LE(0xffff, signatureColumn);
    else bytes.writeUInt32LE(0xffffffff, signatureColumn);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.member_refs).toEqual([]);
    expect(result.coverage.state).toBe("partial");
    expect(
      result.coverage.issues.filter(
        ({ scope }) =>
          scope === "metadata.#Strings" ||
          scope === "metadata.#Blob" ||
          scope === "metadata.MemberRef:0x0a000001",
      ),
    ).toEqual([
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: `metadata.${expectedHeap}`,
      }),
    ]);
  },
);

describe("managed TypeSpec declaring names", () => {
  it("names a generic TypeSpec parent by its generic type and leaves other TypeSpecs unknown", () => {
    // GENERICINST CLASS TypeRef(1) <string>
    const generic = memberRefOnTypeSpec(
      Buffer.from([0x15, 0x12, (1 << 2) | 1, 0x01, 0x0e]),
    );
    expect(generic.member_refs[0]?.parent_name).toBe(attribute);
    expect(generic.call_edges[0]?.target_declaring_type).toBe(attribute);

    // SZARRAY i4
    const array = memberRefOnTypeSpec(Buffer.from([0x1d, 0x08]));
    expect(array.member_refs[0]?.parent_name).toBeNull();
    expect(array.coverage).toEqual({ state: "complete", issues: [] });
  });

  it.each([{ prefix: [0x0f] }, { prefix: [0x1d] }, { prefix: [0x1f, 0x05] }])(
    "leaves a wrapped generic TypeSpec unnamed with prefix $prefix",
    ({ prefix }) => {
      const result = memberRefOnTypeSpec(
        Buffer.from([...prefix, 0x15, 0x12, 0x05, 0x01, 0x0e]),
      );

      expect(result.member_refs[0]?.parent_name).toBeNull();
      expect(result.call_edges[0]?.target_declaring_type).toBeNull();
      expect(result.coverage).toEqual({ state: "complete", issues: [] });
    },
  );

  it.each([
    [
      "names a TypeSpec as its generic type",
      [0x15, 0x12, (1 << 2) | 2, 0x01, 0x0e],
      "invalid-row",
      "metadata.TypeSpec:0x1b000001",
    ],
    [
      "has no type arguments",
      [0x15, 0x12, (1 << 2) | 1],
      "invalid-blob",
      "metadata.TypeSpec:0x1b000001",
    ],
    [
      "names a missing TypeRef",
      [0x15, 0x12, (9 << 2) | 1, 0x01, 0x0e],
      "invalid-row",
      "metadata.TypeSpec:0x1b000001",
    ],
    [
      "names a missing TypeDef",
      [0x15, 0x12, (9 << 2) | 0, 0x01, 0x0e],
      "invalid-row",
      "metadata.TypeSpec:0x1b000001",
    ],
    [
      "has a type argument naming a missing TypeRef",
      [0x15, 0x12, (1 << 2) | 1, 0x01, 0x12, (9 << 2) | 1],
      "invalid-row",
      "metadata.TypeSpec:0x1b000001",
    ],
  ])(
    "reports a generic TypeSpec parent that %s and leaves it unknown",
    (_case, signature, code, scope) => {
      const result = memberRefOnTypeSpec(Buffer.from(signature));

      expect(result.member_refs[0]?.parent_name).toBeNull();
      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: [{ code, scope }],
      });
    },
  );

  it("validates late generic arguments before exposing a TypeSpec's nominal head", () => {
    const result = memberRefOnTypeSpec(
      Buffer.from([0x15, 0x12, 0x05, 0x02, 0x0e, 0x12, 0x25]),
    );

    expect(result.member_refs[0]?.parent_name).toBeNull();
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "invalid-row",
          scope: "metadata.TypeSpec:0x1b000001",
          detail:
            "TypeDefOrRefOrSpec operand 0x25 is invalid: coded index selects row 9 in table 1, which has 1 rows",
        },
      ],
    });
  });
});

describe("managed edge target declaring types", () => {
  it("reports unsupported TypeSpec and MethodSpec forms instead of treating them as unknown", () => {
    const typeSpec = memberRefOnTypeSpec(Buffer.from([0xff]));
    const methodSpec = inspect({
      memberRefSignature: genericRef,
      methodSpecMethods: [(1 << 1) | 1],
      methodSpecInstantiation: Buffer.from([0x0a, 0x01, 0xff]),
      ilBody: tokenBody([[call, 0x2b00_0001]]),
    });

    expect(typeSpec.member_refs[0]?.parent_name).toBeNull();
    expect(typeSpec.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "unsupported-signature",
          scope: "metadata.TypeSpec:0x1b000001",
        },
      ],
    });
    expect(methodSpec.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "unsupported-signature",
          scope: "metadata.MethodSpec:0x2b000001",
        },
      ],
    });
  });

  it("names field MemberRefs as fields and leaves mismatched member kinds unnamed", () => {
    const result = inspect({
      memberRefName: "Empty",
      // FIELD string
      memberRefSignature: Buffer.from([0x06, 0x0e]),
      ilBody: tokenBody([
        [ldsfld, 0x0a00_0001],
        [call, 0x0400_0001],
      ]),
    });
    const methodRef = inspect({ ilBody: tokenBody([[ldsfld, 0x0a00_0001]]) });
    const flaggedField = inspect({
      memberRefName: "Empty",
      // GENERIC | FIELD string: FieldSig allows no flags.
      memberRefSignature: Buffer.from([0x16, 0x0e]),
      ilBody: tokenBody([[ldsfld, 0x0a00_0001]]),
    });

    expect(result.field_accesses).toMatchObject([
      { field_name: "Empty", field_declaring_type: attribute },
    ]);
    expect(methodRef.field_accesses).toMatchObject([
      { field_name: null, field_declaring_type: null },
    ]);
    expect(flaggedField.field_accesses).toMatchObject([
      { field_name: null, field_declaring_type: null },
    ]);
    expect(flaggedField.coverage.state).toBe("partial");
    expect(result.call_edges).toMatchObject([
      {
        target_kind: "unknown",
        target_name: null,
        target_declaring_type: null,
      },
    ]);
  });

  it("reads Evidence recorded before declaring types were named as unknown", () => {
    const current = inspect({});
    const parsed = managedMemberInspectionSchema.parse({
      ...current,
      member_refs: current.member_refs.map(
        ({ parent_name: _omitted, ...legacy }) => legacy,
      ),
      call_edges: current.call_edges.map(
        ({ target_declaring_type: _omitted, ...legacy }) => legacy,
      ),
      field_accesses: current.field_accesses.map(
        ({ field_declaring_type: _omitted, ...legacy }) => legacy,
      ),
    });

    expect(parsed.member_refs[0]?.parent_name).toBeNull();
    expect(parsed.call_edges[0]?.target_declaring_type).toBeNull();
    expect(parsed.field_accesses[0]?.field_declaring_type).toBeNull();
  });
});

describe("managed TypeRef resolution scopes", () => {
  it.each([0, 9])(
    "retains invalid enclosing TypeRef row %s without granting scope validity",
    (enclosingRow) => {
      const bytes = buildManagedPeFixture({
        typeRefScopeRaw: enclosingRow * 4 + 3,
      });
      const pe = readManagedPeLayout(bytes);
      if (pe.cli === null) throw new Error("fixture has no CLI header");
      const { rva, size } = pe.cli.metadata;
      const layout = readManagedMetadataLayout(
        bytes,
        pe.rvaToOffset(rva, size, "metadata"),
        size,
      );
      const issues: ManagedParseIssue[] = [];
      const reference = managedTypeReferences(bytes, layout, issues)(1);

      expect(reference).toMatchObject({ enclosingRow, scopeValid: false });
      expect(issues).toMatchObject([
        {
          code: "invalid-row",
          scope: "metadata.TypeRef:0x01000001",
          detail: expect.stringContaining(
            enclosingRow === 0
              ? "coded index selects row zero in table 1"
              : "coded index selects row 9 in table 1, which has 1 rows",
          ),
        },
      ]);
    },
  );

  it.each([
    // AssemblyRef 9 does not exist.
    ["an invalid", (9 << 2) | 2, "is invalid"],
    // The TypeRef is its own enclosing type.
    ["a cyclic", (1 << 2) | 3, "contains a cycle"],
  ])(
    "keeps a TypeRef name beside %s resolution scope",
    (_case, typeRefScopeRaw, detail) => {
      const result = inspect({ typeRefScopeRaw });

      expect(result.member_refs[0]?.parent_name).toBe(attribute);
      expect(result.call_edges[0]?.target_declaring_type).toBe(attribute);
      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: [
          {
            code: "invalid-row",
            scope: "metadata.TypeRef:0x01000001",
            detail: expect.stringContaining(detail),
          },
        ],
      });
    },
  );
});

describe("managed MethodSpec call targets", () => {
  it("names generic method calls after the method they instantiate", () => {
    const result = inspect({
      memberRefSignature: genericRef,
      methodSignature: genericDef,
      methodSpecMethods: [(1 << 1) | 1, (1 << 1) | 0],
      ilBody: tokenBody([
        [call, 0x2b00_0001],
        [call, 0x2b00_0002],
      ]),
    });

    expect(
      result.call_edges.map((edge) => [
        edge.target_kind,
        edge.target_name,
        edge.target_declaring_type,
      ]),
    ).toEqual([
      ["method-spec", ".ctor", attribute],
      ["method-spec", "Main", "Fixture.Program"],
    ]);
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
  });

  it.each([
    [
      "a non-generic method",
      {},
      Buffer.from([0x0a, 0x01, 0x0e]),
      "but its method declares 0 generic parameter(s)",
    ],
    [
      "the wrong number of type arguments",
      { memberRefSignature: genericRef },
      Buffer.from([0x0a, 0x02, 0x0e, 0x08]),
      "supplies 2 type argument(s), but its method declares 1",
    ],
    [
      "a field reference",
      { memberRefSignature: Buffer.from([0x06, 0x0e]) },
      Buffer.from([0x0a, 0x01, 0x0e]),
      "does not have a decodable method signature",
    ],
    [
      "a property signature",
      // PROPERTY | GENERIC, one generic parameter, no parameters, void.
      { memberRefSignature: Buffer.from([0x18, 0x01, 0x00, 0x01]) },
      Buffer.from([0x0a, 0x01, 0x0e]),
      "does not have a decodable method signature",
    ],
    [
      "a truncated signature",
      // HASTHIS | GENERIC, one generic parameter, no parameters, no return type.
      { memberRefSignature: Buffer.from([0x30, 0x01, 0x00]) },
      Buffer.from([0x0a, 0x01, 0x0e]),
      "does not have a decodable method signature",
    ],
    [
      "a type argument naming a missing TypeRef",
      { memberRefSignature: genericRef },
      Buffer.from([0x0a, 0x01, 0x12, (9 << 2) | 1]),
      "TypeDefOrRefOrSpec operand 0x25 is invalid",
    ],
    [
      "an unmanaged-convention signature",
      // C | GENERIC: a function pointer convention, not a MethodRefSig one.
      { memberRefSignature: Buffer.from([0x11, 0x01, 0x00, 0x01]) },
      Buffer.from([0x0a, 0x01, 0x0e]),
      "does not have a decodable method signature",
    ],
  ])(
    "reports a MethodSpec that instantiates %s",
    (_case, options, methodSpecInstantiation, detail) => {
      const result = inspect({
        ...options,
        methodSpecMethods: [(1 << 1) | 1],
        methodSpecInstantiation,
        ilBody: tokenBody([[call, 0x2b00_0001]]),
      });

      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: [
          {
            code: "invalid-row",
            scope: "metadata.MethodSpec:0x2b000001",
            detail: expect.stringContaining(detail),
          },
        ],
      });
    },
  );

  it("never names a field through a MethodSpec", () => {
    const result = inspect({
      memberRefName: "Empty",
      // FIELD string: a MethodSpec on it is malformed.
      memberRefSignature: Buffer.from([0x06, 0x0e]),
      methodSpecMethods: [(1 << 1) | 1],
      ilBody: tokenBody([
        [ldsfld, 0x2b00_0001],
        [call, 0x2b00_0001],
      ]),
    });

    expect(result.field_accesses).toMatchObject([
      { field_name: null, field_declaring_type: null },
    ]);
    expect(result.call_edges).toMatchObject([
      { target_name: null, target_declaring_type: null },
    ]);
    expect(result.coverage.state).toBe("partial");
  });

  it("keeps a readable MethodSpec method beside a malformed instantiation", () => {
    const result = inspect({
      methodSpecMethods: [(1 << 1) | 1, (9 << 1) | 1],
      methodSpecInstantiation: Buffer.from([0x0a, 0x00]),
      ilBody: tokenBody([
        [call, 0x2b00_0001],
        [call, 0x2b00_0002],
      ]),
    });

    expect(
      result.call_edges.map(({ target_name, target_declaring_type }) => [
        target_name,
        target_declaring_type,
      ]),
    ).toEqual([
      [".ctor", attribute],
      [null, null],
    ]);
    expect(result.coverage.state).toBe("partial");
    expect(
      result.coverage.issues.map(({ code, scope }) => [code, scope]),
    ).toEqual([
      ["invalid-blob", "metadata.MethodSpec:0x2b000001"],
      ["invalid-row", "metadata.MethodSpec:0x2b000002"],
      ["invalid-blob", "metadata.MethodSpec:0x2b000002"],
    ]);
  });
});

it("reads MethodSpec arity from an unnamed MemberRef independently of parent admission", () => {
  const bytes = buildManagedPeFixture({
    memberRefSignature: genericRef,
    memberRefParentRaw: 17,
    methodSpecMethods: [(1 << 1) | 1],
    methodSpecInstantiation: Buffer.from([0x0a, 0x01, 0x0e]),
    ilBody: tokenBody([[call, 0x2b00_0001]]),
  });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("fixture has no CLI header");
  const { rva, size } = pe.cli.metadata;
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(rva, size, "metadata"),
    size,
  );
  const nameColumn =
    metadataRowOffset(layout, 10, 1) + layout.codedIndexSize("MemberRefParent");
  if (layout.stringIndexSize === 2) bytes.writeUInt16LE(0xffff, nameColumn);
  else bytes.writeUInt32LE(0xffffffff, nameColumn);
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.member_refs).toEqual([]);
  expect(result.call_edges).toMatchObject([
    {
      target_token: "0x2b000001",
      target_kind: "method-spec",
      target_name: null,
      target_declaring_type: null,
    },
  ]);
  expect(result.coverage).toMatchObject({
    state: "partial",
    issues: [
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: "metadata.#Strings",
      }),
    ],
  });
  expect(
    result.coverage.issues.some(({ scope }) =>
      scope.startsWith("metadata.MethodSpec:"),
    ),
  ).toBe(false);
});

describe("managed MethodDef heap admission", () => {
  it("keeps names from unpaged methods without reading their signatures or bodies", () => {
    const bytes = buildMultiMethodManagedPeFixture({
      methods: [
        { name: "Outside", body: tokenBody([]) },
        { name: "Caller", body: tokenBody([[call, 0x06000001]]) },
      ],
    });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "metadata"),
      size,
    );
    const row = metadataRowOffset(layout, 6, 1);
    bytes.writeUInt32LE(0xffffffff, row);
    const signatureOffset = row + 8 + layout.stringIndexSize;
    if (layout.blobIndexSize === 2)
      bytes.writeUInt16LE(0xffff, signatureOffset);
    else bytes.writeUInt32LE(0xffffffff, signatureOffset);

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
      {
        methodOffset: 1,
        methodLimit: 1,
      },
    );

    expect(result.methods).toMatchObject([
      { token: "0x06000002", name: "Caller" },
    ]);
    expect(result.call_edges).toMatchObject([
      { target_token: "0x06000001", target_name: "Outside" },
    ]);
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
  });

  it.each([
    {
      name: "valid instantiation",
      instantiation: [0x0a, 1, 0x0e],
      code: "invalid-heap-index",
      scope: "metadata.#Blob",
    },
    {
      name: "malformed instantiation",
      instantiation: [0x0a, 0],
      code: "invalid-blob",
      scope: "metadata.MethodSpec:0x2b000001",
    },
  ])(
    "reads an unpaged MethodDef signature only after a $name",
    ({ instantiation, code, scope }) => {
      const bytes = buildManagedPeFixture({
        methodRowCount: 2,
        methodSignature: genericDef,
        methodSpecMethods: [2 << 1],
        methodSpecInstantiation: Buffer.from(instantiation),
        ilBody: tokenBody([[call, 0x2b000001]]),
      });
      const pe = readManagedPeLayout(bytes);
      if (pe.cli === null) throw new Error("fixture has no CLI header");
      const { rva, size } = pe.cli.metadata;
      const layout = readManagedMetadataLayout(
        bytes,
        pe.rvaToOffset(rva, size, "metadata"),
        size,
      );
      const signatureOffset =
        metadataRowOffset(layout, 6, 2) + 8 + layout.stringIndexSize;
      if (layout.blobIndexSize === 2)
        bytes.writeUInt16LE(0xffff, signatureOffset);
      else bytes.writeUInt32LE(0xffffffff, signatureOffset);

      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
        {
          methodLimit: 1,
        },
      );

      expect(result.methods).toMatchObject([
        { token: "0x06000001", name: "Main" },
      ]);
      expect(result.call_edges).toMatchObject([
        { target_token: "0x2b000001", target_name: "Main" },
      ]);
      expect(result.coverage).toMatchObject({
        state: "partial",
        issues: [{ code, scope }],
      });
    },
  );
});

describe("managed nested types", () => {
  const inspectNested = (
    options: Parameters<typeof buildManagedNestedTypeFixture>[0] = {},
  ) => {
    const bytes = buildManagedNestedTypeFixture(options);
    return inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes, "/fixture/nested.dll"),
    );
  };

  it("reports the enclosing type of each nested type", () => {
    const result = inspectNested();

    expect(
      result.types.map(({ full_name, enclosing_type_token }) => [
        full_name,
        enclosing_type_token,
      ]),
    ).toEqual([
      ["<Module>", null],
      ["Fixture.A", null],
      ["Fixture.B", null],
      ["Inner", "0x02000002"],
      ["Inner", "0x02000003"],
      ["Leaf", "0x02000004"],
    ]);
    expect(result.nesting_read).toBe(true);
    expect(result.coverage.issues).toEqual([]);
  });

  it.each([2, 3, 4, 5, 6, 7])(
    "keeps nested visibility %i unresolved when its parent entry is missing",
    (visibility) => {
      const bytes = buildManagedNestedTypeFixture({ nestedClassRows: [] });
      const target = () => managedPeFixtureTarget(bytes, "/fixture/nested.dll");
      const row = inspectManagedMembersBytes(bytes, target()).types.find(
        (type) => type.token === "0x02000004",
      )!.row_offset;
      bytes.writeUInt32LE((bytes.readUInt32LE(row) & ~7) | visibility, row);
      const result = inspectManagedMembersBytes(bytes, target());
      expect(result.nesting_read).toBe(true);
      expect(
        result.types.find((type) => type.token === "0x02000004"),
      ).toMatchObject({ enclosing_type_token: null, name_sha256: null });
      expect(result.coverage.issues).toContainEqual(
        expect.objectContaining({
          code: "invalid-row",
          scope: "metadata.TypeDef:0x02000004",
          offset: row,
        }),
      );
    },
  );

  it("retains a selected child's contradictory parent issue exactly once", () => {
    const bytes = buildManagedNestedTypeFixture();
    const target = () => managedPeFixtureTarget(bytes, "/fixture/nested.dll");
    const row = inspectManagedMembersBytes(bytes, target()).types.find(
      (type) => type.token === "0x02000004",
    )!.row_offset;
    bytes.writeUInt32LE((bytes.readUInt32LE(row) & ~7) | 1, row);
    const result = inspectManagedMembersBytes(bytes, target(), {
      typeNames: ["Leaf"],
    });
    expect(result.types).toHaveLength(1);
    expect(result.types[0]?.name_sha256).toBeNull();
    expect(result.coverage.state).toBe("partial");
    expect(
      result.coverage.issues.filter(
        (issue) => issue.scope === "metadata.TypeDef:0x02000004",
      ),
    ).toEqual([expect.objectContaining({ code: "invalid-row", offset: row })]);
  });

  it("reports NestedClass rows that do not pair distinct existing types once", () => {
    const result = inspectNested({
      nestedClassRows: [
        [4, 4],
        [5, 3],
        [5, 2],
        [6, 9],
        [0, 2],
        [4, 0],
        [9, 2],
      ],
    });

    expect(
      result.types.map(({ enclosing_type_token }) => enclosing_type_token),
    ).toEqual([null, null, null, null, "0x02000003", null]);
    expect(result.nesting_read).toBe(false);
    expect(
      result.coverage.issues.map(({ code, scope }) => [code, scope]),
    ).toEqual([
      ["invalid-row", "metadata.NestedClass:0x29000001"],
      ["invalid-row", "metadata.NestedClass:0x29000003"],
      ["invalid-row", "metadata.NestedClass:0x29000004"],
      ["invalid-row", "metadata.NestedClass:0x29000005"],
      ["invalid-row", "metadata.NestedClass:0x29000006"],
      ["invalid-row", "metadata.NestedClass:0x29000007"],
    ]);
  });
});

describe("managed exported types", () => {
  it("reports type forwarders and nested exported types with their implementation scope", () => {
    const bytes = buildManagedPeFixture({
      exportedTypes: [
        {
          namespace: "System",
          name: "Object",
          flags: 0x0020_0001,
          implementationRaw: (1 << 2) | 1,
        },
        {
          namespace: "",
          name: "Enumerator",
          flags: 0x0000_0002,
          implementationRaw: (1 << 2) | 2,
        },
      ],
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.metadata.table_row_counts).toMatchObject({
      ExportedType: 2,
    });
    expect(result.exported_types).toMatchObject([
      {
        token: "0x27000001",
        namespace: "System",
        name: "Object",
        flags: 0x0020_0001,
        forwarder: true,
        type_def_id: 0,
        implementation_token: "0x23000001",
      },
      {
        token: "0x27000002",
        namespace: "",
        name: "Enumerator",
        forwarder: false,
        implementation_token: "0x27000001",
      },
    ]);
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
  });

  it("leaves exported types unknown when CLI metadata is unavailable", () => {
    const bytes = buildNativePeFixture();
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage.state).toBe("unavailable");
    expect(result.exported_types).toBeNull();
  });

  it("reads member Evidence recorded before exported types as unexamined", () => {
    const bytes = buildManagedPeFixture();
    const { exported_types: _omitted, ...legacy } = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const parsed = managedMemberInspectionSchema.parse(legacy);

    expect(parsed.exported_types).toBeNull();
    expect(comparisonLimitations(parsed, parsed)).toContain(
      "At least one managed member observation did not examine ExportedType rows; its exported and forwarded types are unknown.",
    );
  });

  it("retains an exported type whose implementation is out of range as partial", () => {
    const bytes = buildManagedPeFixture({
      exportedTypes: [
        {
          namespace: "System",
          name: "Object",
          flags: 0x0020_0001,
          implementationRaw: (9 << 2) | 1,
        },
      ],
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.exported_types).toMatchObject([
      { token: "0x27000001", name: "Object", implementation_token: null },
    ]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "invalid-row",
          scope: "metadata.ExportedType:0x27000001",
          detail: expect.stringContaining(
            "ExportedType implementation coded index 0x25 is invalid",
          ),
        },
      ],
    });
  });
});

describe("managed user strings", () => {
  const inspect = (options: Parameters<typeof buildManagedPeFixture>[0]) => {
    const bytes = buildManagedPeFixture(options);
    return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
  };

  it("decodes each loaded literal once, in token order, without changing CIL tokens", () => {
    const { heap, tokens } = fixtureUserStringHeap([
      "quicksave.peak",
      "unused",
      "Ünïcødé 𝄞",
      "\ud800",
    ]);
    const [path, , unicode, lone] = tokens as [string, string, string, string];
    // 0x70000000 names the heap's empty entry at offset 0.
    const empty = "0x70000000";
    const ilBody = ldstrBody([unicode, path, lone, path, empty]);
    const result = inspect({ ilBody, userStringHeap: heap });

    expect(result.user_strings?.literals).toEqual([
      { token: empty, offset: expect.any(Number), value: "" },
      { token: path, offset: expect.any(Number), value: "quicksave.peak" },
      { token: unicode, offset: expect.any(Number), value: "Ünïcødé 𝄞" },
      { token: lone, offset: expect.any(Number), value: "\ud800" },
    ]);
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
    expect(result.user_strings).toMatchObject({
      state: "complete",
      issues: [],
    });
    const body = result.methods[0]?.body;
    // Each ldstr is followed by an operand-free pop, and ret ends the body;
    // anchors keep those null-operand instructions too.
    expect(body?.anchors.map(({ operand }) => operand)).toEqual([
      unicode,
      null,
      path,
      null,
      lone,
      null,
      path,
      null,
      empty,
      null,
      null,
    ]);
    expect(body?.normalized_il_sha256).toBe(
      inspect({ ilBody }).methods[0]?.body.normalized_il_sha256,
    );
    expect(comparisonLimitations(result, result)).toContain(
      "ldstr literals are not compared; normalized CIL keeps #US tokens rather than decoded text, so an unchanged method does not establish unchanged string literals.",
    );
  });

  it("ignores a 0x70 token carried by an instruction other than ldstr", () => {
    const { heap, tokens } = fixtureUserStringHeap(["not loaded"]);
    const token = Number.parseInt(tokens[0] ?? "", 16);
    const ldtoken = Buffer.from([0xd0, 0, 0, 0, 0, 0x26, 0x2a]);
    ldtoken.writeUInt32LE(token, 1);
    const result = inspect({
      ilBody: Buffer.concat([
        Buffer.from([(ldtoken.length << 2) | 2]),
        ldtoken,
      ]),
      userStringHeap: heap,
    });

    expect(result.methods[0]?.body.anchors[0]).toMatchObject({
      opcode: "ldtoken",
      operand_kind: "string",
    });
    expect(result.user_strings?.literals).toEqual([]);
  });

  it("admits ldstr tokens before collecting them", () => {
    const layout = { userStrings: null } as unknown as ManagedMetadataLayout;
    // Leave 1 KiB of the 64 MiB budget: too little for 100 distinct tokens.
    managedDecodeBudget(layout).reserve(64 * 1024 * 1024 - 1024, null);
    const method: DecodedMethod = {
      method: {} as ManagedMethod,
      tokenInstructions: decodedTokenInstructions(
        0x72,
        Array.from({ length: 100 }, (_, index) => 0x70000001 + index),
      ),
      catchTokens: new Map(),
    };

    expect(() =>
      parseUserStrings(Buffer.alloc(0), layout, {
        methods: [method],
        unscannedMethods: 0,
      }),
    ).toThrow(ManagedReaderFailure);
  });

  it("retains readable literals beside malformed #US items", () => {
    const { heap, tokens } = fixtureUserStringHeap(["ok", "bad", "worse"]);
    const [ok, bad, worse] = tokens as [string, string, string];
    // "bad" encodes 7 bytes; an even length cannot end in the flag byte.
    heap.writeUInt8(6, Number.parseInt(bad.slice(4), 16));
    // 0xe0 is a reserved compressed-length prefix.
    heap.writeUInt8(0xe0, Number.parseInt(worse.slice(4), 16));
    const result = inspect({
      ilBody: ldstrBody([ok, bad, worse, "0x70ffffff", "0x06000001"]),
      userStringHeap: heap,
    });

    expect(result.user_strings?.literals).toEqual([
      { token: ok, offset: expect.any(Number), value: "ok" },
    ]);
    expect(result.user_strings?.state).toBe("partial");
    expect(
      result.user_strings?.issues.map(({ code, scope }) => [code, scope]),
    ).toEqual([
      ["invalid-heap-index", "metadata.#US:0x06000001"],
      ["invalid-string", `metadata.#US:${bad}`],
      ["invalid-string", `metadata.#US:${worse}`],
      ["invalid-heap-index", "metadata.#US:0x70ffffff"],
    ]);
  });

  it("rejects #US items that run past the end of the stream", () => {
    const { heap: readable, tokens } = fixtureUserStringHeap(["ok"]);
    // An odd length claiming 127 bytes with two left, then a two-byte length
    // prefix whose second byte lies past the stream end.
    const crossing = Buffer.from([0x7f, 0x41, 0x00]);
    const heap = Buffer.concat([readable, crossing, Buffer.from([0x80])]);
    const token = (offset: number) =>
      `0x70${offset.toString(16).padStart(6, "0")}`;
    const crossingToken = token(readable.length);
    const truncatedToken = token(readable.length + crossing.length);
    const result = inspect({
      ilBody: ldstrBody([tokens[0] ?? "", crossingToken, truncatedToken]),
      userStringHeap: heap,
    });

    expect(result.user_strings?.literals).toEqual([
      { token: tokens[0], offset: expect.any(Number), value: "ok" },
    ]);
    expect(result.user_strings).toMatchObject({
      state: "partial",
      issues: [crossingToken, truncatedToken].map((item) => ({
        code: "invalid-string",
        scope: `metadata.#US:${item}`,
        detail: "User string leaves #US",
      })),
    });
  });

  it("leaves user strings unexamined when CLI metadata is unavailable or predates them", () => {
    const native = buildNativePeFixture();
    expect(
      inspectManagedMembersBytes(native, managedPeFixtureTarget(native))
        .user_strings,
    ).toBeNull();

    const { user_strings: _omitted, ...legacy } = inspect({});
    const parsed = managedMemberInspectionSchema.parse(legacy);
    expect(parsed.user_strings).toBeNull();
    expect(comparisonLimitations(parsed, inspect({}))).toContain(
      "ldstr literals are not compared; normalized CIL keeps #US tokens rather than decoded text, so an unchanged method does not establish unchanged string literals.",
    );
  });
});

describe("managed user string issues", () => {
  const inspect = (options: Parameters<typeof buildManagedPeFixture>[0]) => {
    const bytes = buildManagedPeFixture(options);
    return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
  };

  it("reports a missing #US stream once and keeps the method", () => {
    const result = inspect({
      // A MethodDef operand is not a #US reference, so it is reported alone.
      ilBody: ldstrBody([
        "0x70000001",
        "0x70000005",
        "0x70000001",
        "0x06000001",
      ]),
    });

    expect(result.methods).toHaveLength(1);
    expect(result.coverage.state).toBe("complete");
    expect(result.user_strings).toEqual({
      state: "partial",
      literals: [],
      issues: [
        {
          code: "invalid-heap-index",
          scope: "metadata.#US:0x06000001",
          offset: null,
          detail: "ldstr operand does not name an item inside #US",
        },
        {
          code: "missing-stream",
          scope: "metadata.#US",
          offset: null,
          detail:
            "2 distinct ldstr operand(s) reference #US, but the metadata has no #US stream",
        },
      ],
    });
  });

  it("rejects a nonempty item at the reserved #US offset 0", () => {
    // "A" with its flag, where only the empty entry may sit.
    const result = inspect({
      ilBody: ldstrBody(["0x70000000"]),
      userStringHeap: Buffer.from([3, 0x41, 0, 0]),
    });

    expect(result.user_strings?.literals).toEqual([]);
    expect(result.user_strings).toMatchObject({
      state: "partial",
      issues: [{ code: "invalid-string", scope: "metadata.#US:0x70000000" }],
    });
  });

  it.each([
    // "ok" is 5 bytes, which ECMA-335 encodes in one prefix byte, not 0x80 0x05.
    ["0x70000001", [0, 0x80, 0x05, 0x6f, 0, 0x6b, 0, 0], "ok"],
    // The empty entry at offset 0 is the single byte 0x00, not 0x80 0x00.
    ["0x70000000", [0x80, 0x00], ""],
  ])(
    "keeps %s when its length prefix is wider than ECMA-335 assigns",
    (token, heap, value) => {
      const result = inspect({
        ilBody: ldstrBody([token]),
        userStringHeap: Buffer.from(heap),
      });

      expect(result.user_strings?.literals).toEqual([
        { token, offset: expect.any(Number), value },
      ]);
      expect(result.user_strings).toMatchObject({
        state: "partial",
        issues: [
          {
            code: "invalid-string",
            scope: `metadata.#US:${token}`,
            detail: expect.stringContaining("prefix wider than ECMA-335"),
          },
        ],
      });
    },
  );

  it("admits no width issue for an item that then fails", () => {
    // 64 overlong zero lengths away from offset 0: each item is fatal.
    const heap = Buffer.concat([
      Buffer.from([0]),
      ...Array.from({ length: 64 }, () => Buffer.from([0x80, 0x00])),
    ]);
    const layout = {
      userStrings: { name: "#US", offset: 0, size: heap.length },
    } as unknown as ManagedMetadataLayout;
    // Leave 24 KiB: enough for the failures, not for 512 bytes leaked each.
    managedDecodeBudget(layout).reserve(64 * 1024 * 1024 - 24 * 1024, null);
    const method: DecodedMethod = {
      method: {} as ManagedMethod,
      tokenInstructions: decodedTokenInstructions(
        0x72,
        Array.from({ length: 64 }, (_, index) => 0x70000001 + index * 2),
      ),
      catchTokens: new Map(),
    };

    expect(
      parseUserStrings(heap, layout, { methods: [method], unscannedMethods: 0 })
        .issues,
    ).toHaveLength(64);
  });

  it("keeps literals whose terminal flag differs from ECMA-335 and reports each flag", () => {
    const { heap, tokens } = fixtureUserStringHeap(["ok", "it's"]);
    const [ok, quoted] = tokens as [string, string];
    // A short item is a one-byte length, the UTF-16 text, then the flag byte.
    const flagAt = (token: string, value: string) =>
      Number.parseInt(token.slice(4), 16) + 1 + value.length * 2;
    heap.writeUInt8(1, flagAt(ok, "ok"));
    heap.writeUInt8(0, flagAt(quoted, "it's"));
    const result = inspect({
      ilBody: ldstrBody([ok, quoted]),
      userStringHeap: heap,
    });

    expect(result.coverage.state).toBe("complete");
    expect(result.user_strings?.literals.map(({ value }) => value)).toEqual([
      "ok",
      "it's",
    ]);
    expect(result.user_strings).toMatchObject({
      state: "partial",
      issues: [ok, quoted].map((token) => ({
        code: "invalid-string",
        scope: `metadata.#US:${token}`,
        detail: expect.stringContaining("terminal flag"),
      })),
    });
  });
});

describe("managed user string scan completeness", () => {
  const inspect = (options: Parameters<typeof buildManagedPeFixture>[0]) => {
    const bytes = buildManagedPeFixture(options);
    return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
  };

  it("marks user strings partial when a method body is not fully decoded", () => {
    const { heap, tokens } = fixtureUserStringHeap(["ok", "later"]);
    const [ok, later] = tokens as [string, string];
    // ldstr "ok", then an undefined opcode before ldstr "later".
    const il = Buffer.from([
      0x72, 0, 0, 0, 0, 0x26, 0xfe, 0xff, 0x72, 0, 0, 0, 0, 0x26, 0x2a,
    ]);
    il.writeUInt32LE(Number.parseInt(ok, 16), 1);
    il.writeUInt32LE(Number.parseInt(later, 16), 9);
    const result = inspect({
      ilBody: Buffer.concat([Buffer.from([(il.length << 2) | 2]), il]),
      userStringHeap: heap,
    });

    expect(result.methods[0]?.body.status).toBe("malformed");
    expect(result.user_strings).toEqual({
      state: "partial",
      literals: [{ token: ok, offset: expect.any(Number), value: "ok" }],
      issues: [],
    });
  });

  it.each([
    ["outside", 1, "complete"],
    ["inside", 2, "partial"],
  ])(
    "judges an unreadable method row %s the selection by its owner",
    (_where, badRow, state) => {
      const bytes = buildManagedPeFixture({
        additionalEmptyTypes: 1,
        methodRowCount: 2,
      });
      const cli = readManagedPeLayout(bytes);
      if (cli.cli === null) throw new Error("fixture has no CLI header");
      const { rva, size } = cli.cli.metadata;
      const layout = readManagedMetadataLayout(
        bytes,
        cli.rvaToOffset(rva, size, "cli.metadata"),
        size,
      );
      const write = (offset: number, width: number, value: number) =>
        width === 2
          ? bytes.writeUInt16LE(value, offset)
          : bytes.writeUInt32LE(value, offset);
      // Fixture.Program's methods now start at row 2, so Fixture.Empty0 owns row 1.
      write(
        metadataRowOffset(layout, 2, 2) +
          4 +
          2 * layout.stringIndexSize +
          layout.codedIndexSize("TypeDefOrRef") +
          layout.tableIndexSize(4),
        layout.tableIndexSize(6),
        2,
      );
      // An out-of-range name index makes that method row unreadable.
      write(
        metadataRowOffset(layout, 6, badRow) + 8,
        layout.stringIndexSize,
        0xffff,
      );
      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
        { typeNames: ["Fixture.Program"] },
      );

      expect(result.user_strings?.state).toBe(state);
    },
  );

  it("keeps user strings complete when only the exception section is malformed", () => {
    const { heap, tokens } = fixtureUserStringHeap(["ok"]);
    // ldstr "ok"; pop; ret all decode before an exception section that
    // holds no whole clause.
    const il = Buffer.from([0x72, 0, 0, 0, 0, 0x26, 0x2a]);
    il.writeUInt32LE(Number.parseInt(tokens[0] ?? "", 16), 1);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x300b, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const section = Buffer.alloc(17);
    section[0] = 0x01;
    section[1] = section.length;
    const result = inspect({
      ilBody: Buffer.concat([header, il, Buffer.alloc(1), section]),
      userStringHeap: heap,
    });

    expect(result.methods[0]?.body.status).toBe("malformed");
    expect(result.user_strings).toMatchObject({
      state: "complete",
      literals: [{ value: "ok" }],
    });
  });

  it("marks user strings partial when selected type identity is unreadable", () => {
    const layout = {
      userStrings: { name: "#US", offset: 0, size: 1 },
    } as unknown as ManagedMetadataLayout;
    expect(
      parseUserStrings(Buffer.from([0]), layout, {
        methods: [],
        unscannedMethods: 0,
        unreadableSelectedTypes: 1,
      }),
    ).toEqual({ state: "partial", literals: [], issues: [] });
  });

  it("marks user strings partial when an inspected method row was not read", () => {
    const layout = {
      userStrings: { name: "#US", offset: 0, size: 1 },
    } as unknown as ManagedMetadataLayout;
    // The omitted row's body, and any ldstr in it, was never scanned.
    expect(
      parseUserStrings(Buffer.from([0]), layout, {
        methods: [],
        unscannedMethods: 1,
      }),
    ).toEqual({ state: "partial", literals: [], issues: [] });
  });
});

describe("managed member decoding budget", () => {
  it("admits a wide-instruction method whose actual records fit the budget", () => {
    // Five-byte branches all target the next instruction. A final ret leaves
    // the method stack-neutral, despite over 256 KiB of valid IL bytes.
    const il = Buffer.alloc(270_001);
    for (let offset = 0; offset < il.length - 1; offset += 5) {
      il[offset] = 0x38;
    }
    il[il.length - 1] = 0x2a;
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x3003, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([header, il]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
    expect(result.types).toHaveLength(1);
    expect(result.methods[0]?.body).toMatchObject({
      status: "present",
      il_size: il.length,
      decoded_instruction_count: 54_001,
      opcode_counts: { br: 54_000, ret: 1 },
    });
  });

  it("rejects dense one-byte instructions while retaining admitted types", () => {
    // All NOPs: unlike wide instructions, each IL byte adds a decoded record.
    // A true oversized transient must remain an actionable resource limit.
    const il = Buffer.alloc(270_001);
    il[il.length - 1] = 0x2a;
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x3003, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([header, il]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [{ code: "resource-limit", scope: "metadata.representation" }],
    });
    // Report the originating IL coordinate, not a generic decoding error.
    expect(result.coverage.issues[0]?.offset).toBeGreaterThan(0);
    expect(result.types).toHaveLength(1);
    expect(result.methods).toEqual([]);
  });

  it("charges decoded output rather than accumulated decoding bounds", () => {
    // Each bound fits alone, but 256 bytes per IL and signature byte together
    // exceed the 64 MiB budget although the retained members are small.
    const il = Buffer.concat([Buffer.alloc(200_000), Buffer.from([0x2a])]);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x3003, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([header, il]),
      methodSignature: Buffer.concat([
        Buffer.from([0x00, 0x00, 0x01]),
        Buffer.alloc(80_000),
      ]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage.state).not.toBe("unavailable");
    expect(result.methods[0]?.body).toMatchObject({
      status: "present",
      il_size: il.length,
      opcode_counts: { nop: 200_000, ret: 1 },
    });
  });

  it("bounds a method's IL and exception sections together", () => {
    // Each bound fits alone; both stay live while one method is decoded.
    const il = Buffer.concat([Buffer.alloc(159_999), Buffer.from([0x2a])]);
    const header = Buffer.alloc(12);
    header.writeUInt16LE(0x300b, 0);
    header.writeUInt16LE(8, 2);
    header.writeUInt32LE(il.length, 4);
    const clauses = 110_000;
    const section = Buffer.alloc(4 + clauses * 24);
    section.writeUInt32LE(0x41 | ((4 + clauses * 24) << 8), 0);
    const bytes = buildManagedPeFixture({
      ilBody: Buffer.concat([header, il, section]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [{ code: "resource-limit" }],
    });
    expect(result.methods).toEqual([]);
    expect(result.types).toHaveLength(1);
  });
});

describe("managed derived edges", () => {
  it("admits call edges before the derived graph exceeds the budget", () => {
    const method = {
      token: "0x06000001",
      declaring_type: "T".repeat(2000),
      name: "m",
    } as unknown as ManagedMethod;

    const decoded: DecodedMethod = {
      method,
      tokenInstructions: decodedTokenInstructions(
        0x28,
        Array(16).fill(0x0a000001),
      ),
      catchTokens: new Map(),
    };

    const budget = new ManagedDecodeBudget();
    // Exercise the same capacity boundary without constructing 64 MiB of edges.
    budget.reserve(64 * 1024 * 1024 - 16 * 1024, null);
    expect(() => edges([decoded], new Map(), budget)).toThrow(
      ManagedReaderFailure,
    );
  });
});

describe("managed derived caller names", () => {
  it("admits a caller name before building it", () => {
    let built = false;
    // A string-like type name records whether the caller was interpolated.
    const declaringType = {
      length: 2048,
      charCodeAt: () => 0x54,
      toString: () => {
        built = true;
        return "T";
      },
    } as unknown as string;
    const method = {
      token: "0x06000001",
      declaring_type: declaringType,
      name: "m",
    } as unknown as ManagedMethod;

    const decoded: DecodedMethod = {
      method,
      tokenInstructions: decodedTokenInstructions(0x28, [0x0a000001]),
      catchTokens: new Map(),
    };

    const budget = new ManagedDecodeBudget();
    // Only the remaining capacity matters to refusal before interpolation.
    budget.reserve(64 * 1024 * 1024 - 1024, null);
    expect(() => edges([decoded], new Map(), budget)).toThrow(
      ManagedReaderFailure,
    );
    expect(built).toBe(false);
  });
});

describe("managed TypeDef list ownership bounds", () => {
  it("retains rows but leaves ownership unknown for zero TypeDef list starts", () => {
    const bytes = buildManagedPeFixture();
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "cli.metadata"),
      size,
    );
    const listOffset =
      metadataRowOffset(layout, 2, 1) +
      4 +
      2 * layout.stringIndexSize +
      layout.codedIndexSize("TypeDefOrRef");
    const listIndexWidth = Math.max(
      layout.tableIndexSize(3),
      layout.tableIndexSize(4),
      layout.tableIndexSize(5),
      layout.tableIndexSize(6),
    );
    const writeIndex = (offset: number) =>
      listIndexWidth === 2
        ? bytes.writeUInt16LE(0, offset)
        : bytes.writeUInt32LE(0, offset);
    writeIndex(listOffset);
    writeIndex(listOffset + listIndexWidth);

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.types[0]).toMatchObject({
      field_list: { first_row: null, last_row: null, count: 0 },
      method_list: { first_row: null, last_row: null, count: 0 },
    });
    expect(result.fields[0]).toMatchObject({
      token: "0x04000001",
      name: "counter",
      declaring_type: null,
    });
    expect(result.methods[0]).toMatchObject({
      token: "0x06000001",
      name: "Main",
      declaring_type: null,
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          detail: expect.stringContaining("TypeDef FieldList start 0"),
        }),
        expect.objectContaining({
          code: "invalid-row",
          detail: expect.stringContaining("TypeDef MethodList start 0"),
        }),
      ],
    });
    const selected = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
      { typeNames: ["Fixture.Program"] },
    );
    expect(selected.methods).toEqual([]);
    expect(selected.user_strings).toMatchObject({
      state: "partial",
      literals: [],
    });
  });

  it("does not infer an earlier owner from an invalid next list endpoint", () => {
    const bytes = buildManagedPeFixture({ additionalEmptyTypes: 1 });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "cli.metadata"),
      size,
    );
    const methodStartOffset =
      metadataRowOffset(layout, 2, 2) +
      4 +
      2 * layout.stringIndexSize +
      layout.codedIndexSize("TypeDefOrRef") +
      memberListIndexSize(layout, 4);
    if (memberListIndexSize(layout, 6) === 2)
      bytes.writeUInt16LE(0, methodStartOffset);
    else bytes.writeUInt32LE(0, methodStartOffset);

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods[0]).toMatchObject({
      token: "0x06000001",
      declaring_type: null,
    });
    expect(result.types[0]?.method_list).toMatchObject({
      first_row: null,
      last_row: null,
      count: 0,
    });
    expect(result.coverage.state).toBe("partial");
  });
});

describe("managed TypeDef list ordering", () => {
  it("leaves adjacent ownership unknown when valid list starts decrease", () => {
    const bytes = buildManagedPeFixture({
      additionalEmptyTypes: 1,
      methodRowCount: 2,
    });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "cli.metadata"),
      size,
    );
    const methodOffset =
      4 +
      2 * layout.stringIndexSize +
      layout.codedIndexSize("TypeDefOrRef") +
      memberListIndexSize(layout, 4);
    const writeMethodStart = (row: number, value: number): void => {
      const offset = metadataRowOffset(layout, 2, row) + methodOffset;
      if (memberListIndexSize(layout, 6) === 2)
        bytes.writeUInt16LE(value, offset);
      else bytes.writeUInt32LE(value, offset);
    };
    writeMethodStart(1, 2);
    writeMethodStart(2, 1);

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.methods.map(({ declaring_type }) => declaring_type)).toEqual([
      null,
      null,
    ]);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          detail: expect.stringContaining(
            "MethodList start 1 decreases from preceding start 2",
          ),
        }),
      ],
    });
  });

  it("accepts the one-based start for an empty ordinary member table", () => {
    const bytes = buildManagedPeFixture({ methodRowCount: 0 });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.types[0]?.method_list).toEqual({
      first_row: null,
      last_row: null,
      count: 0,
    });
    expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
  });
});

describe("managed metadata reference bounds", () => {
  it("retains members and reports an out-of-range TypeDef coded index as partial", () => {
    const bytes = buildManagedPeFixture({ extendsRaw: 12 });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.types[0]).toMatchObject({
      token: "0x02000001",
      extends_token: null,
    });
    expect(result.fields).toHaveLength(1);
    expect(result.methods).toHaveLength(1);
    expect(result.metadata.status).toBe("partial");
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "invalid-row",
          scope: "metadata.TypeDef:0x02000001",
          detail: expect.stringContaining(
            "TypeDef Extends coded index 0xc is invalid: coded index selects row 3 in table 2, which has 1 rows",
          ),
        },
      ],
    });
    expect(result.coverage.issues[0]?.offset).toBe(
      (result.types[0]?.row_offset ?? 0) + 8,
    );
  });

  it("retains a MemberRef with an out-of-range parent as an unknown partial reference", () => {
    const bytes = buildManagedPeFixture({ memberRefParentRaw: 40 });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.member_refs[0]).toMatchObject({
      token: "0x0a000001",
      parent_token: null,
      name: ".ctor",
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        {
          code: "invalid-row",
          scope: "metadata.MemberRef:0x0a000001",
          detail: expect.stringContaining(
            "MemberRef parent coded index 0x28 is invalid: coded index selects row 5 in table 2, which has 1 rows",
          ),
        },
      ],
    });
    expect(result.coverage.issues[0]?.offset).toBe(
      result.member_refs[0]?.row_offset,
    );
  });

  it("reports a null required MemberRef parent without dropping the reference", () => {
    const bytes = buildManagedPeFixture({ memberRefParentRaw: 0 });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.member_refs[0]).toMatchObject({
      token: "0x0a000001",
      parent_token: null,
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          detail:
            "MemberRef parent coded index 0x0 is null, but the Class column must reference a row",
        }),
      ],
    });
  });

  it("decodes deeply nested supported pointer signatures without recursion", () => {
    const depth = 8_000;
    const bytes = buildManagedPeFixture({
      fieldSignature: Buffer.concat([
        Buffer.from([0x06]),
        Buffer.alloc(depth, 0x0f),
        Buffer.from([0x08]),
      ]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.fields[0]?.signature).toMatchObject({
      kind: "field",
      parse_status: "decoded",
      field_type: `${"i4"}${"*".repeat(depth)}`,
      issue: null,
    });
    expect(result.methods[0]?.body.status).toBe("present");
    expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
  });
});

it.each([
  Buffer.alloc(0),
  Buffer.from([0]),
  Buffer.from([0, 0, 0x12]),
  Buffer.from([0x10, 0x80]),
  Buffer.from([0, 0xe0]),
])(
  "marks incomplete or reserved method signatures malformed: %j",
  (methodSignature) => {
    const bytes = buildManagedPeFixture({ methodSignature });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.signature).toMatchObject({
      parse_status: "malformed",
      kind: "unknown",
    });
  },
);

it.each([
  [[], "truncated compressed integer"],
  [[0x80], "truncated compressed integer"],
  [[0xc0, 0, 0], "truncated compressed integer"],
  [[0xe0], "reserved compressed integer"],
] as const)(
  "retains TypeSpec prefix failure %j at its owning row",
  (prefix, issue) => {
    const bytes = buildManagedPeFixture({
      typeSpecSignatures: [Buffer.from([0x12, ...prefix])],
      memberRefParentRaw: (1 << 3) | 4,
    });
    const pe = readManagedPeLayout(bytes);
    if (pe.cli === null) throw new Error("fixture has no CLI header");
    const { rva, size } = pe.cli.metadata;
    const layout = readManagedMetadataLayout(
      bytes,
      pe.rvaToOffset(rva, size, "metadata"),
      size,
    );
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.member_refs[0]?.parent_name).toBeNull();
    expect(result.coverage.issues).toContainEqual({
      code: "invalid-blob",
      scope: "metadata.TypeSpec:0x1b000001",
      offset: metadataRowOffset(layout, 27, 1),
      detail: issue,
    });
  },
);

it.each([
  [[0x01], -64],
  [[0x80, 0x01], -8192],
  [[0xc0, 0x00, 0x00, 0x01], -268435456],
] as const)(
  "preserves compressed signed width for array bound %j",
  (bound, lower) => {
    const bytes = buildManagedPeFixture({
      fieldSignature: Buffer.from([
        0x06,
        0x14,
        0x08,
        0x01,
        0x00,
        0x01,
        ...bound,
      ]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.fields[0]?.signature).toMatchObject({
      parse_status: "decoded",
      field_type: `i4[${lower}...]`,
    });
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
  },
);

it("decodes generic instantiation member signatures as complete coverage", () => {
  // System.Runtime.Caching 0x06000001: instance void (Dictionary<string, object>)
  // shape, with TypeRef/TypeSpec coded tokens kept as encoded.
  const bytes = buildManagedPeFixture({
    methodSignature: Buffer.from([
      0x00, 0x01, 0x01, 0x15, 0x12, 0x09, 0x01, 0x0e,
    ]),
    fieldSignature: Buffer.from([
      0x06, 0x15, 0x11, 0x0d, 0x02, 0x13, 0x00, 0x1e, 0x01,
    ]),
    typeReferences: [
      { namespace: "System", name: "Func`1" },
      { namespace: "System", name: "ValueTuple`2" },
    ],
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );

  expect(result.methods[0]?.signature).toMatchObject({
    parse_status: "decoded",
    return_type: "void",
    parameter_types: ["class:9 (System.Func`1)<string>"],
    issue: null,
  });
  expect(result.fields[0]?.signature).toMatchObject({
    parse_status: "decoded",
    field_type: "valuetype:13 (System.ValueTuple`2)<var:0,mvar:1>",
  });
  expect(result.coverage).toMatchObject({ state: "complete", issues: [] });
});

it.each([
  ["reserved TypeDefOrRef tag", Buffer.from([0x06, 0x12, 0x07])],
  ["missing TypeSpec row", Buffer.from([0x06, 0x12, 0x06])],
])(
  "retains a field with an invalid signature type operand: %s",
  (_name, fieldSignature) => {
    const bytes = buildManagedPeFixture({ fieldSignature });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.fields[0]).toMatchObject({
      name: "counter",
      signature: { kind: "field", parse_status: "malformed", field_type: null },
    });
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({
          code: "invalid-row",
          scope: "Field:0x04000001.signature",
        }),
      ],
    });
  },
);

it.each([
  ["single-dimension general array", [0x14, 0x08, 0x01, 0x00, 0x00], "i4[...]"],
  [
    "sized array with signed lower bounds",
    [0x14, 0x08, 0x02, 0x02, 0x04, 0x03, 0x02, 0x02, 0x7f],
    "i4[1...4,-1...1]",
  ],
  [
    "partially bounded array",
    [0x14, 0x0e, 0x03, 0x01, 0x05, 0x00],
    "string[5,,]",
  ],
  [
    "function pointer",
    [0x1b, 0x00, 0x02, 0x08, 0x0e, 0x1c],
    "fnptr[default](string,object)->i4",
  ],
  ["required modifier", [0x1f, 0x09, 0x08], "i4 modreq:9"],
  [
    "optional modifier under a pointer",
    [0x0f, 0x20, 0x0d, 0x08],
    "i4 modopt:13*",
  ],
  [
    "adjacent modifiers in source order",
    [0x1f, 0x05, 0x20, 0x09, 0x08],
    "i4 modreq:5 modopt:9",
  ],
  [
    "modifier runs separated by a pointer",
    [0x1f, 0x05, 0x0f, 0x20, 0x09, 0x08],
    "i4 modopt:9* modreq:5",
  ],
  [
    "unmanaged cdecl function pointer",
    [0x1b, 0x01, 0x01, 0x01, 0x18],
    "fnptr[c](native-int)->void",
  ],
  [
    "array of generic instantiations",
    [0x1d, 0x15, 0x12, 0x05, 0x01, 0x14, 0x08, 0x01, 0x01, 0x03, 0x00],
    "class:5<i4[3]>[]",
  ],
])("decodes a %s field signature", (_name, type, expected) => {
  expect(signature(Buffer.from([0x06, ...type]))).toMatchObject({
    kind: "field",
    parse_status: "decoded",
    field_type: expected,
    issue: null,
  });
});

it.each([
  ["generic instantiation without arguments", [0x15, 0x12, 0x05, 0x00]],
  ["generic instantiation of a primitive", [0x15, 0x08, 0x05, 0x01, 0x08]],
  ["zero-rank array", [0x14, 0x08, 0x00, 0x00, 0x00]],
  [
    "array with more sizes than dimensions",
    [0x14, 0x08, 0x01, 0x02, 0x01, 0x01, 0x00],
  ],
  ["truncated generic argument list", [0x15, 0x12, 0x05, 0x02, 0x08]],
  ["truncated function pointer", [0x1b, 0x00, 0x01, 0x08]],
  ["function pointer with a field header", [0x1b, 0x06, 0x00, 0x01]],
  ["function pointer with a reserved flag", [0x1b, 0x80, 0x00, 0x01]],
  [
    "function pointer with explicit-this but no has-this",
    [0x1b, 0x40, 0x00, 0x01],
  ],
  ["typed reference field", [0x16]],
  ["modified typed reference field", [0x20, 0x09, 0x16]],
  ["typed reference generic argument", [0x15, 0x12, 0x05, 0x01, 0x16]],
  ["typed reference array element", [0x1d, 0x16]],
  ["by-reference generic argument", [0x15, 0x12, 0x05, 0x01, 0x10, 0x08]],
  ["void generic argument", [0x15, 0x12, 0x05, 0x01, 0x01]],
  ["void function pointer parameter", [0x1b, 0x00, 0x01, 0x01, 0x01]],
  ["by-reference pointee", [0x0f, 0x10, 0x08]],
  ["nested by-reference", [0x10, 0x10, 0x08]],
  ["void field", [0x01]],
  ["void array element", [0x1d, 0x01]],
])("reports a %s as malformed", (_name, type) => {
  expect(signature(Buffer.from([0x06, ...type]))).toMatchObject({
    kind: "unknown",
    parse_status: "malformed",
  });
});

it.each([
  ["a property header", [0x08, 0x00, 0x08]],
  ["an explicit-this header without has-this", [0x40, 0x00, 0x01]],
  ["a C calling convention header", [0x01, 0x00, 0x01]],
  ["a generic vararg header", [0x15, 0x01, 0x00, 0x01]],
])("reports %s as a malformed member signature", (_name, blob) => {
  expect(signature(Buffer.from(blob))).toMatchObject({
    kind: "unknown",
    parse_status: "malformed",
  });
});

it("rejects array ranks beyond the CLR limit before rendering dimensions", () => {
  expect(
    signature(
      Buffer.from([0x06, 0x14, 0x08, 0xdf, 0xff, 0xff, 0xff, 0x00, 0x00]),
    ),
  ).toMatchObject({
    parse_status: "unsupported",
    issue: "array rank 536870911 exceeds the 32 dimensions the CLR supports",
  });
  expect(
    signature(Buffer.from([0x06, 0x14, 0x08, 0x20, 0x00, 0x00])),
  ).toMatchObject({
    parse_status: "decoded",
    field_type: `i4[${",".repeat(31)}]`,
  });
});

it("decodes typed references in parameter and return positions", () => {
  expect(
    signature(Buffer.from([0x00, 0x02, 0x16, 0x20, 0x09, 0x16, 0x08])),
  ).toMatchObject({
    kind: "method",
    parse_status: "decoded",
    return_type: "typedbyref",
    parameter_types: ["typedbyref modopt:9", "i4"],
  });
  expect(
    signature(Buffer.from([0x06, 0x1b, 0x20, 0x01, 0x01, 0x16])),
  ).toMatchObject({
    parse_status: "decoded",
    field_type: "fnptr[default has-this](typedbyref)->void",
  });
});

it("decodes VARARG optional parameters in method and function-pointer signatures", () => {
  expect(
    signature(Buffer.from([0x05, 0x02, 0x01, 0x08, 0x41, 0x0e])),
  ).toMatchObject({
    kind: "method",
    parse_status: "decoded",
    parameter_count: 2,
    parameter_types: ["i4", "string"],
  });
  expect(
    signature(Buffer.from([0x06, 0x1b, 0x05, 0x02, 0x01, 0x08, 0x41, 0x0e])),
  ).toMatchObject({
    kind: "field",
    parse_status: "decoded",
    field_type: "fnptr[vararg](i4,string)->void",
  });
});

it.each([
  [
    "sentinel in a DEFAULT signature",
    [0x00, 0x01, 0x01, 0x41, 0x08],
    "unsupported",
  ],
  [
    "duplicate VARARG sentinels",
    [0x05, 0x02, 0x01, 0x41, 0x41, 0x08],
    "malformed",
  ],
])("does not accept %s as a valid method signature", (_name, bytes, status) => {
  expect(signature(Buffer.from(bytes))).toMatchObject({
    kind: "unknown",
    parse_status: status,
  });
});

it.each([
  ["by-reference field", [0x06, 0x10, 0x08], { field_type: "i4&" }],
  ["void pointer field", [0x06, 0x0f, 0x01], { field_type: "void*" }],
  [
    "by-reference function pointer return and parameter",
    [0x06, 0x1b, 0x00, 0x01, 0x10, 0x08, 0x10, 0x0e],
    { field_type: "fnptr[default](string&)->i4&" },
  ],
  [
    "by-reference method return and parameter",
    [0x00, 0x01, 0x10, 0x08, 0x10, 0x15, 0x12, 0x05, 0x01, 0x0f, 0x01],
    { return_type: "i4&", parameter_types: ["class:5<void*>&"] },
  ],
])("decodes a %s in its grammar position", (_name, blob, expected) => {
  expect(signature(Buffer.from(blob))).toMatchObject({
    parse_status: "decoded",
    ...expected,
  });
});

it("keeps element types that member signatures do not assign unsupported", () => {
  expect(signature(Buffer.from([0x06, 0x45, 0x08]))).toMatchObject({
    parse_status: "unsupported",
    issue: "unsupported element type 0x45",
  });
});

it("decodes deeply nested generic instantiations without recursion", () => {
  const depth = 4_000;
  const decoded = signature(
    Buffer.concat([
      Buffer.from([0x06]),
      Buffer.from(
        Array.from({ length: depth }, () => [0x15, 0x12, 0x05, 0x01]).flat(),
      ),
      Buffer.from([0x08]),
    ]),
  );

  expect(decoded).toMatchObject({
    parse_status: "decoded",
    field_type: `${"class:5<".repeat(depth)}i4${">".repeat(depth)}`,
  });
});

it("preserves leading U+FEFF as metadata name content", () => {
  const bytes = buildManagedPeFixture({
    typeNamespace: "\uFEFFFixture",
    typeName: "\uFEFFProgram",
    methodName: "\uFEFFMain",
    fieldName: "\uFEFFcounter",
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.types[0]?.full_name).toBe("\uFEFFFixture.\uFEFFProgram");
  expect(result.methods[0]?.name).toBe("\uFEFFMain");
  expect(result.fields[0]?.name).toBe("\uFEFFcounter");
  expect(result.call_edges[0]?.caller).toBe(
    "\uFEFFFixture.\uFEFFProgram.\uFEFFMain",
  );
});

it.each([
  { implFlags: 1, flags: 0, label: "native" },
  { implFlags: 3, flags: 0, label: "runtime" },
  { implFlags: 4, flags: 0, label: "unmanaged" },
  { implFlags: 0, flags: 0x2000, label: "pinvoke" },
])(
  "does not interpret $label implementations as CIL",
  ({ implFlags, flags }) => {
    const bytes = buildManagedPeFixture();
    const original = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const row = original.methods[0]?.row_offset;
    expect(row).toBeDefined();
    if (row === undefined) return;
    bytes.writeUInt16LE(implFlags, row + 4);
    bytes.writeUInt16LE(bytes.readUInt16LE(row + 6) | flags, row + 6);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.methods[0]?.body).toMatchObject({
      status: "partial",
      header_format: "unknown",
      rva: original.methods[0]?.rva,
      il_sha256: null,
      normalized_il_sha256: null,
      anchors: [],
    });
    expect(result.methods[0]?.body.issue).toMatch(/CIL/u);
    expect(result.coverage.state).toBe("partial");
    expect(result.call_edges).toEqual([]);
    expect(result.field_accesses).toEqual([]);
  },
);

it.each([
  { facet: "fields", nameOffsets: [2] },
  { facet: "methods", nameOffsets: [8] },
  { facet: "member_refs", nameOffsets: [2] },
  { facet: "types", nameOffsets: [4] },
  { facet: "types", nameOffsets: [6] },
  { facet: "types", nameOffsets: [4, 6] },
] as const)(
  "preserves independent metadata when $facet name columns $nameOffsets are unreadable",
  ({ facet, nameOffsets }) => {
    const bytes = buildManagedPeFixture();
    const original = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    const row = original[facet][0]?.row_offset;
    if (row === undefined) throw new Error(`Fixture must contain ${facet}`);
    for (const [index, nameOffset] of nameOffsets.entries())
      bytes.writeUInt16LE(0xffff - index, row + nameOffset);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.module?.mvid).toBe(original.module?.mvid);
    expect(result.metadata.status).toBe("partial");
    expect(result[facet]).toEqual([]);
    for (const remaining of [
      "fields",
      "methods",
      "member_refs",
      "types",
    ] as const)
      if (remaining !== facet)
        expect(result[remaining]).toHaveLength(original[remaining].length);
    expect(result.coverage).toMatchObject({
      state: "partial",
      issues: nameOffsets.map(() =>
        expect.objectContaining({
          code: "invalid-heap-index",
          scope: "metadata.#Strings",
          offset: expect.any(Number),
        }),
      ),
    });
    expect(
      new Set(result.coverage.issues.map(({ offset }) => offset)).size,
    ).toBe(nameOffsets.length);
    if (facet === "types") {
      expect(result.fields[0]).toMatchObject({
        declaring_type_token: "0x02000001",
        declaring_type: null,
      });
      expect(result.methods[0]).toMatchObject({
        declaring_type_token: "0x02000001",
        declaring_type: null,
      });
    }
  },
);

describe("managed member type selection", () => {
  const bytes = buildManagedPeFixture();
  const target = managedPeFixtureTarget(bytes);
  const everything = inspectManagedMembersBytes(bytes, target);

  it("reports no selection when every type is inspected", () => {
    expect(everything.selection).toBeNull();
  });

  it("decodes the selected type's members and reports unmatched names", () => {
    const result = inspectManagedMembersBytes(bytes, target, {
      typeNames: ["Fixture.Program", "Missing.Type"],
    });

    expect(result.selection).toEqual({
      type_names: ["Fixture.Program", "Missing.Type"],
      unmatched_type_names: ["Missing.Type"],
    });
    expect(result.types).toEqual(everything.types);
    expect(result.fields).toEqual(everything.fields);
    expect(result.methods).toEqual(everything.methods);
    expect(result.call_edges).toEqual(everything.call_edges);
    expect(result.field_accesses).toEqual(everything.field_accesses);
    expect(result.coverage).toEqual(everything.coverage);
    expect(result.limitations).toContain(
      "Types, fields, methods, call edges, field accesses, and user strings cover only the selected declaring types; coverage describes that selection. Edge targets outside it keep their names but are not described.",
    );
  });

  it.each([
    { column: "name", offset: 4 },
    { column: "namespace", offset: 6 },
  ])(
    "does not treat a name as absent when a TypeDef $column is unreadable",
    ({ offset }) => {
      const corrupt = Buffer.from(bytes);
      const row = everything.types[0]?.row_offset ?? 0;
      corrupt.writeUInt16LE(0xffff, row + offset);
      const result = inspectManagedMembersBytes(
        corrupt,
        managedPeFixtureTarget(corrupt),
        { typeNames: ["Fixture.Program"] },
      );

      expect(result.selection?.unmatched_type_names).toEqual([
        "Fixture.Program",
      ]);
      expect(result.coverage.state).toBe("partial");
      // Its methods were never inspected, so neither were their literals.
      expect(result.user_strings?.state).toBe("partial");
      expect(result.limitations).toContain(
        "1 TypeDef name(s) could not be read; a name in selection.unmatched_type_names may belong to one of them, so its absence is not observed.",
      );
    },
  );

  it("omits members of unselected types without dropping member references", () => {
    const result = inspectManagedMembersBytes(bytes, target, {
      typeNames: ["Missing.Type"],
    });

    expect(result.selection).toEqual({
      type_names: ["Missing.Type"],
      unmatched_type_names: ["Missing.Type"],
    });
    expect(result.types).toEqual([]);
    expect(result.fields).toEqual([]);
    expect(result.methods).toEqual([]);
    expect(result.call_edges).toEqual([]);
    expect(result.field_accesses).toEqual([]);
    expect(result.member_refs).toEqual(everything.member_refs);
  });
});

describe("managed member method paging", () => {
  it("returns only the requested MethodDef rows", () => {
    const image = buildMultiMethodManagedPeFixture({
      methods: [
        { name: "First", body: Buffer.from([0x2a]) },
        { name: "Second", body: Buffer.from([0x2a]) },
        { name: "Third", body: Buffer.from([0x2a]) },
      ],
    });
    const all = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
    );
    expect(all.methods.map(({ name }) => name)).toEqual([
      "First",
      "Second",
      "Third",
    ]);

    const page = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
      { methodOffset: 1, methodLimit: 1 },
    );

    expect(page.methods.map(({ name, token }) => ({ name, token }))).toEqual([
      { name: "Second", token: "0x06000002" },
    ]);
    expect(page.coverage.state).toBe("complete");

    const offsetOnly = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
      { methodOffset: 1 },
    );
    expect(offsetOnly.methods.map(({ name }) => name)).toEqual([
      "Second",
      "Third",
    ]);

    const emptyPage = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
      { methodOffset: 1, methodLimit: 0 },
    );
    expect(emptyPage.methods).toEqual([]);
  });

  it("rejects invalid method page bounds", () => {
    const image = buildManagedPeFixture();
    expect(() =>
      inspectManagedMembersBytes(image, managedPeFixtureTarget(image), {
        methodOffset: -1,
      }),
    ).toThrow(RangeError);
  });
});

it("retains names of unselected fields without admitting their malformed signatures", () => {
  const bytes = buildManagedNestedTypeFixture({ topLevelTypes: true });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const { rva, size } = pe.cli.metadata;
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(rva, size, "cli.metadata"),
    size,
  );
  const field = metadataRowOffset(layout, 4, 1);
  bytes.writeUIntLE(
    layout.blobIndexSize === 2 ? 0xffff : 0xffffffff,
    field + 2 + layout.stringIndexSize,
    layout.blobIndexSize,
  );
  const method = metadataRowOffset(layout, 6, 2);
  const methodRva = bytes.readUInt32LE(method);
  const body = tokenBody([[ldsfld, 0x04000001]]);
  bytes.set(body, pe.rvaToOffset(methodRva, body.length, "fixture CIL"));
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
    {
      typeNames: ["OtherInner"],
    },
  );
  expect(result.fields).toMatchObject([{ token: "0x04000002", name: "F" }]);
  expect(result.methods).toMatchObject([{ token: "0x06000002", name: "M" }]);
  expect(result.field_accesses).toMatchObject([
    {
      field_token: "0x04000001",
      field_name: "F",
      field_declaring_type: "Inner",
    },
  ]);
  expect(
    result.coverage.issues.filter(
      ({ scope }) =>
        scope === "metadata.#Blob" || scope === "Field:0x04000001.signature",
    ),
  ).toEqual([]);
});

it.each([false, true])(
  "keeps ordinary TypeSpec operands distinct from GENERICINST heads (generic=%s)",
  (generic) => {
    const bytes = buildManagedPeFixture({
      typeSpecSignatures: [Buffer.from([0x15, 0x12, 0x05, 0x01, 0x0e])],
      fieldSignature: Buffer.from(
        generic ? [0x06, 0x15, 0x12, 0x06, 0x01, 0x0e] : [0x06, 0x12, 0x06],
      ),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.fields[0]?.signature).toMatchObject({
      kind: "field",
      parse_status: generic ? "malformed" : "decoded",
      field_type: generic ? null : "class:6",
    });
    const issues = result.coverage.issues.filter(
      ({ scope }) => scope === "Field:0x04000001.signature",
    );
    expect(issues).toEqual(
      generic ? [expect.objectContaining({ code: "invalid-row" })] : [],
    );
  },
);
