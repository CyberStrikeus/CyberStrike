import { expect, it } from "vitest";

import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";
import { buildManagedMemberCapacityFixture } from "../../tests/fixtures/managedMemberCapacity.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import type { ManagedParseIssue } from "../domain/managed/managedArtifact.js";
import {
  parseTypes,
  readTypeDefinitions,
} from "./ManagedMemberInspectorCore.js";
import {
  readManagedMetadataInventory,
  readManagedResourceDirectory,
} from "./ManagedMetadataInventory.js";
import { managedMetadataTypeNames } from "./ManagedMetadataInventoryRows.js";
import { readTypeMemberListFacts } from "./ManagedTypeMemberLists.js";
import {
  metadataRowOffset,
  readManagedMetadataLayout,
} from "./ManagedMetadataLayout.js";

it("retains admitted type names, member counts and artifact identity", () => {
  const bytes = buildManagedMemberCapacityFixture();
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.coverage.issues).toContainEqual(
    expect.objectContaining({
      code: "resource-limit",
      scope: "metadata.representation",
      offset: expect.any(Number),
    }),
  );
  expect(result.types).toHaveLength(3);
  expect(
    result.types.find((type) => type.full_name === "Fixture.Program"),
  ).toMatchObject({
    method_list: { count: 1 },
    field_list: { count: 1 },
    name_sha256: expect.any(String),
  });
  expect(result.module).toMatchObject({ mvid: expect.any(String) });
  expect(result.identity_scope.requires_mvid).toBe(result.module?.mvid);
  expect(result.metadata.table_row_counts).toMatchObject({
    TypeDef: 3,
    MethodDef: 1,
  });
  expect(result.metadata.version).not.toBeNull();
  expect(result.methods).toEqual([]);
  expect(result.fields).toEqual([]);
  expect(result.member_refs).toEqual([]);
  expect(result.call_edges).toEqual([]);
  expect(result.field_accesses).toEqual([]);
  expect(result.user_strings).toBeNull();
  expect(result.exported_types).toBeNull();
  expect(result.signature_resolution).toBeNull();
  expect(result.limitations.join(" ")).toContain("not examined to completion");
});

it("lets a caller select an inventoried empty type without decoding the oversized body", () => {
  const bytes = buildManagedMemberCapacityFixture();
  const target = managedPeFixtureTarget(bytes);
  const inventory = inspectManagedMembersBytes(bytes, target);
  const empty = inventory.types.find((type) => type.method_list.count === 0);
  expect(empty).toBeDefined();
  const result = inspectManagedMembersBytes(bytes, target, {
    typeNames: [empty!.full_name],
  });
  expect(result.coverage).toEqual({ state: "complete", issues: [] });
  expect(result.types).toHaveLength(1);
  expect(result.types[0]?.token).toBe(empty?.token);
  expect(result.methods).toEqual([]);
});

it("preserves explicit type selection when its selected body exhausts capacity", () => {
  const bytes = buildManagedMemberCapacityFixture();
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
    {
      typeNames: ["Fixture.Program", "Missing.Type"],
    },
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.types.map((type) => type.full_name)).toEqual([
    "Fixture.Program",
  ]);
  expect(result.selection).toEqual({
    type_names: ["Fixture.Program", "Missing.Type"],
    unmatched_type_names: ["Missing.Type"],
  });
});

it("retains types when a field signature exceeds the decoding bound", () => {
  const bytes = buildManagedPeFixture({
    fieldSignature: Buffer.alloc(270_001, 0x06),
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.types[0]?.full_name).toBe("Fixture.Program");
  expect(result.coverage.issues).toContainEqual(
    expect.objectContaining({ code: "resource-limit" }),
  );
  expect(result.fields).toEqual([]);
});

it("keeps metadata admission failures unavailable rather than inventing an inventory", () => {
  const bytes = buildManagedPeFixture({ corruptMetadataSignature: true });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("unavailable");
  expect(result.types).toEqual([]);
  expect(result.metadata.status).toBe("malformed");
});

it("retains a large type inventory without relaxing the member budget", () => {
  const bytes = buildManagedMemberCapacityFixture({
    additionalEmptyTypes: 2_041,
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.types).toHaveLength(2_042);
  expect(result.types.at(-1)?.full_name).toBe("Fixture.Program");
  expect(result.types.every((type) => type.name_sha256 !== null)).toBe(true);
  expect(result.methods).toEqual([]);
});

it("does not recover an inventory whose names already exceed capacity", () => {
  const bytes = buildManagedPeFixture({
    typeName: "T".repeat(12 * 1024 * 1024),
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("unavailable");
  expect(result.coverage.issues).toContainEqual(
    expect.objectContaining({ code: "resource-limit" }),
  );
  expect(result.types).toEqual([]);
});

it("keeps malformed type facts alongside the later capacity diagnostic", () => {
  const bytes = buildManagedMemberCapacityFixture({ extendsRaw: 0xffff });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.types).toHaveLength(3);
  expect(result.types.every((type) => type.extends_token === null)).toBe(true);
  expect(result.coverage.issues).toContainEqual(
    expect.objectContaining({ code: "invalid-row" }),
  );
  expect(result.coverage.issues.at(-1)).toMatchObject({
    code: "resource-limit",
  });
});

it("does not repair cyclic nesting into a definite nominal identity", () => {
  const bytes = buildManagedMemberCapacityFixture({
    additionalEmptyTypes: 1,
    nestedTypes: [
      [1, 2],
      [2, 1],
    ],
  });
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.types).toHaveLength(2);
  expect(result.types.every((type) => type.name_sha256 === null)).toBe(true);
  expect(result.types.map((type) => type.enclosing_type_token)).toEqual([
    "0x02000002",
    "0x02000001",
  ]);
});

it("does not turn an unreadable requested type name into observed absence during recovery", () => {
  const bytes = buildManagedMemberCapacityFixture();
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
  expect(layout.stringIndexSize).toBe(2);
  bytes.writeUInt16LE(0xffff, metadataRowOffset(layout, 2, 1) + 4);
  const result = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
    {
      typeNames: ["Fixture.Program", "Fixture.Empty0"],
    },
  );
  expect(result.coverage.state).toBe("partial");
  expect(result.selection?.unmatched_type_names).toEqual(["Fixture.Empty0"]);
  expect(result.types.map((type) => type.full_name)).toEqual([
    "Fixture.Program",
  ]);
  expect(result.limitations.join(" ")).toContain("absence is not observed");
});

it("keeps later type identity, member ownership and constructor names at their original row", () => {
  const bytes = buildManagedPeFixture({
    additionalEmptyTypes: 1,
    customAttributeTypeRaw: (1 << 3) | 2,
    typeName: "LookupAttribute",
    extendsRaw: 0,
    methodName: ".ctor",
    methodFlags: 0x1886,
    methodSignature: Buffer.from([0x20, 0x01, 0x01, 0x0e]),
  });
  const healthy = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  const owner = healthy.types.find(({ token }) => token === "0x02000002");
  expect(owner?.full_name).toBe("Fixture.LookupAttribute");
  expect(owner?.name_sha256).toMatch(/^[0-9a-f]{64}$/u);
  expect(healthy.fields).toHaveLength(1);
  expect(healthy.methods).toHaveLength(1);
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
  expect(layout.stringIndexSize).toBe(2);
  // Only the preceding empty type's name is unreadable; row 2 still owns
  // FieldDef 1 and MethodDef 1, including the local attribute constructor.
  bytes.writeUInt16LE(0xffff, metadataRowOffset(layout, 2, 1) + 4);
  const target = managedPeFixtureTarget(bytes);
  const result = inspectManagedMembersBytes(bytes, target, {
    typeNames: ["Fixture.LookupAttribute", "Fixture.Empty0"],
  });

  expect(result.types).toEqual([owner]);
  expect(result.types[0]).toMatchObject({
    token: "0x02000002",
    row_offset: metadataRowOffset(layout, 2, 2),
    name_sha256: owner?.name_sha256,
    field_list: { first_row: 1, last_row: 1, count: 1 },
    method_list: { first_row: 1, last_row: 1, count: 1 },
  });
  expect(result.fields).toEqual(healthy.fields);
  expect(result.methods).toEqual(healthy.methods);
  for (const member of [...result.fields, ...result.methods])
    expect(member).toMatchObject({
      declaring_type_token: "0x02000002",
      declaring_type: "Fixture.LookupAttribute",
    });
  expect(result.artifact.sha256).toBe(target.sha256);
  expect(result.coverage.state).toBe("partial");
  expect(result.selection?.unmatched_type_names).toEqual(["Fixture.Empty0"]);
  expect(result.limitations.join(" ")).toContain("absence is not observed");

  // Member inspection uses the parsed-type name owner for its metadata
  // inventory, whose attribute names are not included in the member report.
  const issues: ManagedParseIssue[] = [];
  const memberLists = readTypeMemberListFacts(bytes, layout);
  const definitions = readTypeDefinitions(bytes, layout, issues, memberLists);
  const parsedTypes = parseTypes(bytes, layout, definitions);
  const names = managedMetadataTypeNames(bytes, layout, issues, parsedTypes);
  const inventory = readManagedMetadataInventory(
    bytes,
    layout,
    readManagedResourceDirectory(pe, issues),
    memberLists,
    undefined,
    names,
  );
  expect(inventory.attributes).toMatchObject([
    {
      constructor_token: "0x06000001",
      type_name: "Fixture.LookupAttribute",
    },
  ]);
});

it("keeps independent name failures ahead of conditional Extends diagnostics", () => {
  const bytes = buildManagedPeFixture({ extendsRaw: 12 });
  const readable = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  const row = readable.types[0]?.row_offset;
  if (row === undefined) throw new Error("Expected TypeDef fixture");
  expect(readable.coverage.issues).toContainEqual(
    expect.objectContaining({
      code: "invalid-row",
      scope: "metadata.TypeDef:0x02000001",
      offset: row + 8,
      detail: expect.stringContaining("Extends"),
    }),
  );
  bytes.writeUInt16LE(0xffff, row + 4);
  bytes.writeUInt16LE(0xfffe, row + 6);
  const partial = inspectManagedMembersBytes(
    bytes,
    managedPeFixtureTarget(bytes),
  );
  expect(partial.types).toEqual([]);
  expect(partial.fields).toHaveLength(1);
  expect(partial.methods).toHaveLength(1);
  for (const member of [...partial.fields, ...partial.methods])
    expect(member).toMatchObject({
      declaring_type_token: "0x02000001",
      declaring_type: null,
    });
  expect(partial.module).toEqual(readable.module);
  expect(partial.coverage).toMatchObject({
    state: "partial",
    issues: [
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: "metadata.#Strings",
      }),
      expect.objectContaining({
        code: "invalid-heap-index",
        scope: "metadata.#Strings",
      }),
    ],
  });
  expect(
    new Set(partial.coverage.issues.map(({ offset }) => offset)).size,
  ).toBe(2);
});

it("reads inventory names on demand without admitting TypeDef member lists or Extends", () => {
  const bytes = buildManagedPeFixture({
    additionalEmptyTypes: 1,
    typeName: "Lookup",
  });
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Expected CLI fixture");
  const layout = readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
  expect(layout.stringIndexSize).toBe(2);
  const earlier = metadataRowOffset(layout, 2, 1);
  bytes.writeUInt16LE(0xffff, earlier + 4);
  bytes.writeUInt16LE(0xfffe, earlier + 6);
  const selected = metadataRowOffset(layout, 2, 2);
  bytes.writeUInt16LE(0xffff, selected + 8);
  bytes.writeUInt16LE(0, selected + 10);
  bytes.writeUInt16LE(0, selected + 12);
  const issues: ManagedParseIssue[] = [];
  const names = managedMetadataTypeNames(bytes, layout, issues);
  expect(names(2, 2)).toBe("Fixture.Lookup");
  expect(issues).toEqual([]);
  expect(readTypeMemberListFacts(bytes, layout).issues).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ code: "invalid-row", offset: selected + 10 }),
      expect.objectContaining({ code: "invalid-row", offset: selected + 12 }),
    ]),
  );
});
