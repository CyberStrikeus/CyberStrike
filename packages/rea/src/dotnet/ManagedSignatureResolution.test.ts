import { fc } from "@fast-check/vitest";
import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  attachManagedDecodeBudget,
  ManagedDecodeBudget,
} from "./ManagedDecodeBudget.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import {
  parseTypes,
  signature,
  readTypeDefinitions,
  type SignatureTypeName,
} from "./ManagedMemberInspectorCore.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { compareManagedMembers } from "../domain/managed/managedMemberComparison.js";
import { managedMemberInspectionSchema } from "../domain/managed/managedArtifact.js";
import { managedSignatureTypeNames } from "./ManagedSignatureTypeNames.js";
import { metadataCodedIndexCoordinate } from "./ManagedMetadataHeaps.js";
import { managedTypeReferences } from "./ManagedTypeReferences.js";
import { readTypeMemberListFacts } from "./ManagedTypeMemberLists.js";

// A top-level type's name digest, as ManagedSignatureTypeNames forms it.
const nameDigest = (name: string): Buffer => {
  const dot = name.lastIndexOf(".");
  return createHash("sha256")
    .update(Buffer.from([0]))
    .update(dot === -1 ? "" : name.slice(0, dot))
    .update(Buffer.from([0]))
    .update(name.slice(dot + 1))
    .digest();
};

const metadataLayout = (bytes: Buffer) => {
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture has no CLI metadata");
  return readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
};

const named =
  (names: Readonly<Record<number, string>>) =>
  ({ value }: Parameters<SignatureTypeName>[0]): Buffer | null => {
    const name = names[value];
    return name === undefined ? null : nameDigest(name);
  };

describe("layoutless signature coordinates", () => {
  it.each([
    [0, 2, 0],
    [0x25, 1, 9],
    [0x07, undefined, 1],
  ] as const)(
    "keeps layoutless operand %s decoded without admitting a metadata row",
    (value, table, row) => {
      const name = vi.fn<SignatureTypeName>(() => Buffer.alloc(32));
      const result = signature(
        Buffer.from([0x06, 0x12, value]),
        undefined,
        name,
      );

      expect(result.parse_status).toBe("decoded");
      expect(result.resolved_sha256).toMatch(/^[0-9a-f]{64}$/u);
      expect(name).toHaveBeenCalledTimes(1);
      expect(name).toHaveBeenCalledWith(
        expect.objectContaining({ value, coordinate: { table, row } }),
      );
    },
  );
});

describe("resolved member signature digests", () => {
  it("names modifier, class, and generic type operands instead of their rows", () => {
    // modreq(M) G<P> on the left and the same types at other rows on the right.
    const left = signature(
      Buffer.from([0x06, 0x1f, 0x05, 0x15, 0x12, 0x09, 0x01, 0x11, 0x0d]),
      undefined,
      named({ 0x05: "N.Mod", 0x09: "N.G`1", 0x0d: "N.P" }),
    );
    const right = signature(
      Buffer.from([0x06, 0x1f, 0x15, 0x15, 0x12, 0x19, 0x01, 0x11, 0x1d]),
      undefined,
      named({ 0x15: "N.Mod", 0x19: "N.G`1", 0x1d: "N.P" }),
    );

    expect(left.raw_sha256).not.toBe(right.raw_sha256);
    expect(left.resolved_sha256).toMatch(/^[0-9a-f]{64}$/u);
    expect(left.resolved_sha256).toBe(right.resolved_sha256);
  });

  it("keeps the raw digest for a signature without type operands", () => {
    const decoded = signature(Buffer.from([0x00, 0x01, 0x08, 0x0e]));

    expect(decoded.resolved_sha256).toBe(decoded.raw_sha256);
  });

  it("withholds the digest when an operand has no name", () => {
    expect(
      signature(Buffer.from([0x06, 0x12, 0x05]), undefined, named({}))
        .resolved_sha256,
    ).toBeNull();
  });

  it("leaves a blob forged from a resolved preimage undecoded", () => {
    // The resolved preimage of class "A": 0xff, then the name digest. 0xff
    // never starts a compressed coded index, so the forged blob does not
    // decode and has only a raw digest, equal to the resolved one; comparison
    // tags the two kinds apart.
    const forged = signature(
      Buffer.concat([Buffer.from([0x06, 0x12, 0xff]), nameDigest("A")]),
    );
    const resolved = signature(
      Buffer.from([0x06, 0x12, 0x05]),
      undefined,
      named({ 0x05: "A" }),
    );

    expect(forged.parse_status).toBe("malformed");
    expect(forged.resolved_sha256).toBeNull();
    expect(forged.raw_sha256).toBe(resolved.resolved_sha256);
  });

  it("decodes a valid but unnamed non-generic TypeSpec operand", () => {
    const inspection = fieldOf({
      typeSpecSignatures: [Buffer.from([0x08])],
      fieldSignature: Buffer.from([0x06, 0x12, (1 << 2) | 2]),
    });
    const field = inspection.fields[0];

    expect(field?.signature.parse_status).toBe("decoded");
    expect(field?.signature.resolved_sha256).toBeNull();
  });
});

describe("metadata type-name digest ownership", () => {
  it("shares declaration and operand identity while preserving invalid TypeDef diagnostics", () => {
    const bytes = buildManagedPeFixture();
    const layout = metadataLayout(bytes);
    const issues: ManagedParseIssue[] = [];
    const names = managedSignatureTypeNames(
      layout,
      issues,
      { types: [], nesting: { enclosing: new Map(), complete: true } },
      managedTypeReferences(bytes, layout, issues),
    );

    for (const row of [0, 9]) {
      expect(names.declaration(2, row)).toBeNull();
      const value = row * 4;
      expect(
        names.operand({
          value,
          coordinate: metadataCodedIndexCoordinate(value, 2, [2, 1, 27]),
        }),
      ).toBeNull();
    }
    expect(issues).toMatchObject([
      {
        code: "invalid-row",
        scope: "metadata.signature.type:2:0",
        detail: "Signature references an unavailable TypeDef row 0",
      },
      {
        code: "invalid-row",
        scope: "metadata.signature.type:2:9",
        detail: "Signature references an unavailable TypeDef row 9",
      },
    ]);
  });

  it("names each type operand once, so repeated operands are not charged again", () => {
    const bytes = buildManagedPeFixture({
      typeReferences: [{ namespace: "System", name: "Uri" }],
    });
    const layout = metadataLayout(bytes);
    const budget = new ManagedDecodeBudget();
    attachManagedDecodeBudget(layout, budget);
    const typeNames = managedSignatureTypeNames(
      layout,
      [],
      {
        types: [],
        nesting: { enclosing: new Map(), complete: true },
      },
      managedTypeReferences(bytes, layout, []),
    );
    const uri = (2 << 2) | 1;

    const operand = {
      value: uri,
      coordinate: metadataCodedIndexCoordinate(uri, 2, [2, 1, 27]),
    };
    expect(typeNames.operand(operand)).toEqual(nameDigest("System.Uri"));
    const reserve = vi.spyOn(budget, "reserve");
    expect(typeNames.operand(operand)).toEqual(nameDigest("System.Uri"));
    expect(typeNames.declaration(1, 2)).toEqual(nameDigest("System.Uri"));
    expect(typeNames.displayName(operand)).toBe("System.Uri");
    expect(reserve).not.toHaveBeenCalled();
  });

  it("bounds name loading before resolving a deep real TypeRef scope chain", () => {
    const name = "X".repeat(2048);
    const rows = 10_000;
    const bytes = buildManagedPeFixture({
      fieldSignature: Buffer.from([0x06, 0x12, (2 << 2) | 1]),
      typeReferences: Array.from({ length: rows }, (_, index) => ({
        namespace: "",
        name,
        ...(index + 1 === rows ? {} : { enclosingRow: index + 3 }),
      })),
    });
    const layout = metadataLayout(bytes);
    const first =
      metadataRowOffset(layout, 1, 2) +
      layout.codedIndexSize("ResolutionScope");
    const sharedName =
      layout.stringIndexSize === 4
        ? bytes.readUInt32LE(first)
        : bytes.readUInt16LE(first);
    for (let row = 3; row <= rows + 1; row += 1) {
      const offset =
        metadataRowOffset(layout, 1, row) +
        layout.codedIndexSize("ResolutionScope");
      if (layout.stringIndexSize === 4) bytes.writeUInt32LE(sharedName, offset);
      else bytes.writeUInt16LE(sharedName, offset);
    }
    const issues: Parameters<typeof managedTypeReferences>[2] = [];
    const parsedTypes = parseTypes(
      bytes,
      layout,
      readTypeDefinitions(
        bytes,
        layout,
        issues,
        readTypeMemberListFacts(bytes, layout),
      ),
    );
    const resolve = managedSignatureTypeNames(
      layout,
      issues,
      parsedTypes,
      managedTypeReferences(bytes, layout, issues),
    );
    expect(() => resolve.declaration(1, 2)).not.toThrow();
    expect(resolve.declaration(1, 2)).toBeNull();
    expect(issues).toEqual([]);
    const inspection = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(inspection.coverage).toEqual({ state: "complete", issues: [] });
    expect(inspection.fields[0]).toBeDefined();
    expect(inspection.fields[0]?.signature.resolved_sha256).toBeNull();
  });
});

const fieldOf = (options: Parameters<typeof buildManagedPeFixture>[0]) => {
  const bytes = buildManagedPeFixture(options);
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
};

describe("type operand names", () => {
  it("keeps a TypeRef's namespace and name apart", () => {
    const resolved = (namespace: string, name: string) =>
      fieldOf({
        typeReferences: [{ namespace, name }],
        fieldSignature: Buffer.from([0x06, 0x12, (2 << 2) | 1]),
      }).fields[0]?.signature.resolved_sha256;

    expect(resolved("A", "B.C")).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolved("A", "B.C")).not.toBe(resolved("A.B", "C"));
  });

  it("keeps a TypeDef's namespace and name apart", () => {
    const resolved = (typeNamespace: string, typeName: string) =>
      fieldOf({
        typeNamespace,
        typeName,
        fieldSignature: Buffer.from([0x06, 0x12, 1 << 2]),
      }).fields[0]?.signature.resolved_sha256;

    expect(resolved("A", "B.C")).toMatch(/^[0-9a-f]{64}$/u);
    expect(resolved("A", "B.C")).not.toBe(resolved("A.B", "C"));
  });

  it("names a TypeDef and a TypeRef of one namespace and name alike", () => {
    const definition = fieldOf({
      fieldSignature: Buffer.from([0x06, 0x12, 1 << 2]),
    }).fields[0]?.signature.resolved_sha256;
    const reference = fieldOf({
      typeReferences: [{ namespace: "Fixture", name: "Program" }],
      fieldSignature: Buffer.from([0x06, 0x12, (2 << 2) | 1]),
    }).fields[0]?.signature.resolved_sha256;

    expect(definition).toMatch(/^[0-9a-f]{64}$/u);
    expect(definition).toBe(reference);
  });

  it("reports an unreadable TypeRef operand row once in coverage", () => {
    const uri = (2 << 2) | 1;
    const bytes = buildManagedPeFixture({
      typeReferences: [{ namespace: "System", name: "Uri" }],
      fieldSignature: Buffer.from([0x06, 0x12, uri]),
      methodSignature: Buffer.from([0x00, 0x00, 0x12, uri]),
    });
    const layout = metadataLayout(bytes);
    // An out-of-range name index makes TypeRef row 2 unreadable.
    bytes.writeUInt16LE(
      0xffff,
      metadataRowOffset(layout, 1, 2) +
        layout.codedIndexSize("ResolutionScope"),
    );
    const inspection = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(inspection.fields[0]?.signature.resolved_sha256).toBeNull();
    expect(inspection.coverage.state).toBe("partial");
    expect(inspection.coverage.issues).toEqual([
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: "metadata.#Strings",
      }),
    ]);
  });

  it("retains an operand outside its type table as incomplete coverage", () => {
    const inspection = fieldOf({
      fieldSignature: Buffer.from([0x06, 0x12, (9 << 2) | 1]),
    });

    expect(inspection.fields[0]?.signature.parse_status).toBe("malformed");
    expect(inspection.fields[0]?.signature.issue).toContain(
      "coded index selects row 9 in table 1, which has 1 rows",
    );
    expect(inspection.fields[0]?.signature.resolved_sha256).toBeNull();
    expect(inspection.coverage.state).toBe("partial");
    expect(inspection.coverage.issues).toEqual([
      expect.objectContaining({ code: "invalid-row" }),
    ]);
  });

  it("preserves readable TypeRef names while withholding an invalid scope's signature identity", () => {
    const inspection = fieldOf({
      typeRefScopeRaw: (99 << 2) | 2,
      fieldSignature: Buffer.from([0x06, 0x12, (1 << 2) | 1]),
      memberRefParentRaw: (1 << 3) | 1,
    });
    expect(inspection.fields[0]?.signature.resolved_sha256).toBeNull();
    expect(inspection.member_refs[0]?.parent_name).toBe(
      "System.Runtime.Versioning.TargetFrameworkAttribute",
    );
    expect(inspection.coverage.state).toBe("partial");
    expect(inspection.coverage.issues).toEqual([
      expect.objectContaining({
        code: "invalid-row",
        scope: "metadata.TypeRef:0x01000001",
      }),
    ]);
  });

  it.each([
    {
      rows: [
        [1, 2],
        [1, 2],
      ],
    },
    {
      rows: [
        [1, 2],
        [1, 3],
      ],
    },
    { rows: [[1, 1]] },
    { rows: [[1, 0]] },
    { rows: [[0, 2]] },
    { rows: [[1, 4]] },
  ] as const)(
    "withholds TypeDef identity for invalid nesting $rows",
    ({ rows }) => {
      const inspection = fieldOf({
        additionalEmptyTypes: 2,
        nestedTypes: rows,
        fieldSignature: Buffer.from([0x06, 0x12, 1 << 2]),
      });
      expect(inspection.fields[0]?.signature.resolved_sha256).toBeNull();
      expect(inspection.coverage.state).toBe("partial");
      expect(inspection.coverage.issues).toEqual([
        expect.objectContaining({ code: "invalid-row" }),
      ]);
    },
  );
});

const inspectDisplayFixture = (
  options: Parameters<typeof buildManagedPeFixture>[0],
) => {
  const bytes = buildManagedPeFixture({
    typeSpecSignatures: [Buffer.from([0x08])],
    ...options,
  });
  return inspectManagedMembersBytes(bytes, managedPeFixtureTarget(bytes));
};
const displayReferences = [
  { namespace: "N", name: "G`1" },
  { namespace: "N", name: "Value" },
];

describe("readable signature operands", () => {
  it("names fields, method returns and parameters, and member references", () => {
    const result = inspectDisplayFixture({
      fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
      methodSignature: Buffer.from([0x00, 0x01, 0x12, 0x04, 0x11, 0x09]),
      memberRefSignature: Buffer.from([0x00, 0x01, 0x12, 0x09, 0x12, 0x04]),
      typeReferences: displayReferences,
    });
    expect(result.signature_resolution).toBe("type-names-v2");
    expect(result.fields[0]?.signature.field_type).toBe(
      "class:4 (Fixture.Program)",
    );
    expect(result.methods[0]?.signature).toMatchObject({
      return_type: "class:4 (Fixture.Program)",
      parameter_types: ["valuetype:9 (N.G`1)"],
    });
    expect(result.member_refs[0]?.signature).toMatchObject({
      return_type: "class:9 (N.G`1)",
      parameter_types: ["class:4 (Fixture.Program)"],
    });
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
  });

  it.each([
    ["class", [0x12, 0x09], "class:9 (N.G`1)"],
    ["value type", [0x11, 0x0d], "valuetype:13 (N.Value)"],
    ["pointer", [0x0f, 0x12, 0x09], "class:9 (N.G`1)*"],
    ["byref", [0x10, 0x12, 0x09], "class:9 (N.G`1)&"],
    ["vector", [0x1d, 0x12, 0x09], "class:9 (N.G`1)[]"],
    [
      "ranked array",
      [0x14, 0x12, 0x09, 0x02, 0x00, 0x00],
      "class:9 (N.G`1)[,]",
    ],
    [
      "required modifier",
      [0x1f, 0x0d, 0x12, 0x09],
      "class:9 (N.G`1) modreq:13 (N.Value)",
    ],
    [
      "optional modifier",
      [0x20, 0x0d, 0x12, 0x09],
      "class:9 (N.G`1) modopt:13 (N.Value)",
    ],
    [
      "generic argument",
      [0x15, 0x12, 0x09, 0x01, 0x11, 0x0d],
      "class:9 (N.G`1)<valuetype:13 (N.Value)>",
    ],
    [
      "generic variable",
      [0x15, 0x12, 0x09, 0x01, 0x13, 0x00],
      "class:9 (N.G`1)<var:0>",
    ],
    [
      "function pointer",
      [0x1b, 0x00, 0x01, 0x12, 0x09, 0x11, 0x0d],
      "fnptr[default](valuetype:13 (N.Value))->class:9 (N.G`1)",
    ],
    [
      "mixed resolved and unresolved",
      [0x15, 0x12, 0x09, 0x01, 0x12, 0x06],
      "class:9 (N.G`1)<class:6>",
    ],
  ])("preserves %s grammar and signature hashes", (_label, type, expected) => {
    const blob = Buffer.from([0x06, ...(type as number[])]);
    const result = inspectDisplayFixture({
      fieldSignature: blob,
      typeReferences: displayReferences,
    });
    const decoded = result.fields[0]?.signature;
    const names = named({ 9: "N.G`1", 13: "N.Value" });
    const original = signature(blob, undefined, names);
    expect(decoded?.field_type).toBe(expected);
    expect(decoded?.parse_status).toBe(original.parse_status);
    expect(decoded?.raw_sha256).toBe(original.raw_sha256);
    expect(decoded?.resolved_sha256).toBe(original.resolved_sha256);
  });
});

describe("signature display name validity", () => {
  it("resolves types outside the selected type inventory", () => {
    const result = inspectDisplayFixture({
      additionalEmptyTypes: 1,
      fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
    });
    expect(result.fields[0]?.signature.field_type).toBe(
      "class:4 (Fixture.Empty0)",
    );
    const bytes = buildManagedPeFixture({
      additionalEmptyTypes: 1,
      fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
    });
    const selected = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
      { typeNames: ["Fixture.Program"] },
    );
    expect(selected.fields[0]?.signature).toEqual(result.fields[0]?.signature);
  });

  it("uses the enclosing path for nested TypeDefs", () => {
    const result = inspectDisplayFixture({
      additionalEmptyTypes: 1,
      nestedTypes: [[2, 1]],
      fieldSignature: Buffer.from([0x06, 0x12, 0x08]),
    });
    expect(result.fields[0]?.signature.field_type).toBe(
      "class:8 (Fixture.Empty0/Fixture.Program)",
    );
  });

  it("uses the enclosing path for nested TypeRefs", () => {
    const result = inspectDisplayFixture({
      typeReferences: [
        { namespace: "N", name: "Outer" },
        { namespace: "", name: "Inner", enclosingRow: 2 },
      ],
      fieldSignature: Buffer.from([0x06, 0x12, 0x0d]),
    });
    expect(result.fields[0]?.signature.field_type).toBe(
      "class:13 (N.Outer/Inner)",
    );
  });

  it.each(["", "名", "A.B", "G`1", "A (B)<C>/D", "\uFEFFName"])(
    "preserves source name %j",
    (name) => {
      const result = inspectDisplayFixture({
        typeReferences: [{ namespace: "", name }],
        fieldSignature: Buffer.from([0x06, 0x12, 0x09]),
      });
      expect(result.fields[0]?.signature.field_type).toBe(`class:9 (${name})`);
    },
  );

  it.each([
    ["TypeSpec", 0x06, "class:6", "decoded"],
    ["missing TypeRef", 0x25, null, "malformed"],
    ["missing TypeDef", 0x24, null, "malformed"],
    ["invalid tag", 0x07, null, "malformed"],
    ["null TypeDef", 0x00, null, "malformed"],
  ] as const)(
    "preserves validity of unresolved %s operands",
    (_label, operand, display, status) => {
      const result = inspectDisplayFixture({
        fieldSignature: Buffer.from([0x06, 0x12, operand]),
      });
      expect(result.fields[0]?.signature.field_type).toBe(display);
      expect(result.fields[0]?.signature.parse_status).toBe(status);
      expect(result.fields[0]?.signature.resolved_sha256).toBeNull();
    },
  );

  it("keeps invalid-scope TypeRefs raw and retains their issue once", () => {
    const result = inspectDisplayFixture({
      typeRefScopeRaw: (99 << 2) | 2,
      fieldSignature: Buffer.from([0x06, 0x12, 0x05]),
      methodSignature: Buffer.from([0x00, 0x01, 0x12, 0x05, 0x12, 0x05]),
    });
    expect(result.fields[0]?.signature.field_type).toBe("class:5");
    expect(result.methods[0]?.signature.parameter_types).toEqual(["class:5"]);
    expect(result.coverage.issues).toHaveLength(1);
  });

  it("keeps cyclic TypeRefs raw", () => {
    const result = inspectDisplayFixture({
      typeReferences: [
        { namespace: "", name: "A", enclosingRow: 3 },
        { namespace: "", name: "B", enclosingRow: 2 },
      ],
      fieldSignature: Buffer.from([0x06, 0x12, 0x09]),
    });
    expect(result.fields[0]?.signature.field_type).toBe("class:9");
    expect(result.coverage.state).toBe("partial");
  });

  it.each([
    ["truncated", [0x06, 0x12], "malformed"],
    ["truncated compressed index", [0x06, 0x12, 0x80], "malformed"],
    ["unknown element", [0x06, 0x50], "unsupported"],
    ["trailing bytes", [0x06, 0x12, 0x04, 0x08], "partial"],
  ])("retains %s parse status and raw hash", (_label, bytes, status) => {
    const blob = Buffer.from(bytes as number[]);
    const result = inspectDisplayFixture({ fieldSignature: blob });
    expect(result.fields[0]?.signature.parse_status).toBe(status);
    expect(result.fields[0]?.signature.raw_sha256).toBe(
      signature(blob).raw_sha256,
    );
  });
});

describe("signature display compatibility and capacity", () => {
  it("reads historical v1 Evidence without relabelling its raw display", () => {
    const current = inspectDisplayFixture({
      fieldSignature: Buffer.from([0x06, 0x12, 0x04]),
    });
    const old = {
      ...current,
      signature_resolution: "type-names-v1",
      fields: current.fields.map((field) => ({
        ...field,
        signature: { ...field.signature, field_type: "class:4" },
      })),
    };
    const parsed = managedMemberInspectionSchema.parse(old);
    const comparison = compareManagedMembers(
      { evidenceId: `ev_${"a".repeat(64)}`, result: parsed },
      { evidenceId: `ev_${"b".repeat(64)}`, result: current },
    );
    expect(comparison.fields[0]?.status).toBe("unchanged");
    expect(comparison.methods[0]?.status).toBe("unchanged");
    expect(parsed.signature_resolution).toBe("type-names-v1");
    expect(parsed.fields[0]?.signature.field_type).toBe("class:4");
    expect(parsed.fields[0]?.signature.resolved_sha256).toBe(
      current.fields[0]?.signature.resolved_sha256,
    );
  });

  it.each([64, 65])("bounds a real %i-level TypeRef display path", (depth) => {
    const typeReferences = Array.from({ length: depth }, (_, index) => ({
      namespace: "",
      name: `T${index}`,
      ...(index === 0 ? {} : { enclosingRow: index + 1 }),
    }));
    const index = ((depth + 1) << 2) | 1;
    const encoded = [0x80 | (index >> 8), index & 0xff];
    const result = inspectDisplayFixture({
      typeReferences,
      fieldSignature: Buffer.from([0x06, 0x12, ...encoded]),
    });
    const expected =
      depth === 64
        ? `class:${index} (${typeReferences.map((ref) => ref.name).join("/")})`
        : `class:${index}`;
    expect(result.fields[0]?.signature.field_type).toBe(expected);
  });

  it("bounds repeated display-name expansion before allocation", () => {
    const bytes = buildManagedPeFixture({
      typeReferences: [{ namespace: "N", name: "X".repeat(200_000) }],
      methodSignature: Buffer.from([
        0x00,
        0x40,
        0x01,
        ...Array.from({ length: 64 }, () => [0x12, 0x09]).flat(),
      ]),
    });
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.coverage.state).not.toBe("complete");
    expect(result.coverage.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "resource-limit" }),
      ]),
    );
  });
});

describe("signature display property regressions", () => {
  const assertIdentity = (blob: Buffer) => {
    const digest = ({ value }: Parameters<SignatureTypeName>[0]) =>
      nameDigest(`N.Type${value}`);
    const old = signature(blob, undefined, digest);
    const current = signature(
      blob,
      undefined,
      digest,
      ({ value }) => `N.Type${value}`,
    );
    const identity = ({
      field_type: _field,
      parameter_types: _parameters,
      return_type: _return,
      ...rest
    }: typeof old) => rest;
    expect(identity(current)).toEqual(identity(old));
  };

  it("keeps parse status, hashes and counts for 1000 arbitrary blobs", () => {
    fc.assert(
      fc.property(fc.uint8Array({ maxLength: 128 }), (bytes) => {
        assertIdentity(Buffer.from(bytes));
      }),
      { seed: 5149, numRuns: 1000 },
    );
  });

  it("keeps identity through 1000 generated valid nested signatures", () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.constantFrom(
            "pointer",
            "vector",
            "array",
            "generic",
            "modifier",
            "fnptr",
          ),
          { maxLength: 30 },
        ),
        fc.constantFrom([0x12, 0x09], [0x11, 0x0d], [0x08]),
        (wrappers, leaf) => {
          let type: number[] = [...leaf];
          for (const wrapper of wrappers) {
            if (wrapper === "pointer") type = [0x0f, ...type];
            else if (wrapper === "vector") type = [0x1d, ...type];
            else if (wrapper === "array")
              type = [0x14, ...type, 0x02, 0x00, 0x00];
            else if (wrapper === "generic")
              type = [0x15, 0x12, 0x09, 0x01, ...type];
            else if (wrapper === "modifier") type = [0x1f, 0x0d, ...type];
            else type = [0x1b, 0x00, 0x00, ...type];
          }
          const blob = Buffer.from([0x06, ...type]);
          expect(signature(blob).parse_status).toBe("decoded");
          assertIdentity(blob);
        },
      ),
      { seed: 5149, numRuns: 1000 },
    );
  });
});
