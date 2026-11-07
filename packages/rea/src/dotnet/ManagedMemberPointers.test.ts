import { describe, expect, it } from "vitest";

import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { readManagedMetadataLayout } from "./ManagedMetadataLayout.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import {
  buildManagedMemberPointerFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";

const metadataLayout = (bytes: Buffer) => {
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture omitted CLI metadata");
  return readManagedMetadataLayout(
    bytes,
    pe.rvaToOffset(pe.cli.metadata.rva, pe.cli.metadata.size, "cli.metadata"),
    pe.cli.metadata.size,
  );
};

describe("managed member pointer ownership", () => {
  it.each([
    {
      label: "identity pointer tables",
      fieldPointers: [1, 2],
      methodPointers: [1, 2],
      streamName: "#-" as const,
    },
    {
      label: "ordinary direct lists",
      fieldPointers: null,
      methodPointers: null,
      streamName: "#~" as const,
    },
    {
      label: "empty pointer tables with direct lists",
      fieldPointers: [],
      methodPointers: [],
      streamName: "#-" as const,
    },
  ])("preserves $label", ({ fieldPointers, methodPointers, streamName }) => {
    const bytes = buildManagedMemberPointerFixture({
      fieldPointers,
      methodPointers,
      streamName,
    });
    const target = managedPeFixtureTarget(bytes);
    const members = inspectManagedMembersBytes(bytes, target);
    const artifact = inspectManagedArtifactBytes(bytes, target);

    expect(members.coverage).toEqual({ state: "complete", issues: [] });
    expect(members.fields.map((field) => field.declaring_type)).toEqual([
      "Fixture.A",
      "Fixture.B",
    ]);
    expect(members.methods.map((method) => method.declaring_type)).toEqual([
      "Fixture.A",
      "Fixture.B",
    ]);
    expect(artifact.attributes[0]?.type_name).toBe("Fixture.A");
  });
});

describe("invalid managed member pointers", () => {
  describe.each([
    {
      table: "fields" as const,
      pointers: "fieldPointers" as const,
      scope: "metadata.FieldPtr",
      prefix: "0x040000",
      names: ["firstField", "secondField"],
      independent: "methods" as const,
    },
    {
      table: "methods" as const,
      pointers: "methodPointers" as const,
      scope: "metadata.MethodPtr",
      prefix: "0x060000",
      names: [".ctor", ".ctor"],
      independent: "fields" as const,
    },
  ])(
    "invalid $table pointers",
    ({ table, pointers, scope, prefix, names, independent }) => {
      it.each([
        { label: "zero row", rows: [0, 1], owners: [null, null] },
        { label: "out-of-range row", rows: [3, 1], owners: [null, null] },
        { label: "duplicate row", rows: [1, 1], owners: [null, null] },
        { label: "omitted row", rows: [1], owners: ["Fixture.A", null] },
      ])(
        "preserves member facts and independent ownership for $label",
        ({ rows, owners }) => {
          const bytes = buildManagedMemberPointerFixture({ [pointers]: rows });
          const result = inspectManagedMembersBytes(
            bytes,
            managedPeFixtureTarget(bytes),
          );

          expect(result.coverage.state).toBe("partial");
          expect(result.coverage.issues).toEqual(
            expect.arrayContaining([
              expect.objectContaining({
                code: "invalid-row",
                scope,
                offset: expect.any(Number),
              }),
            ]),
          );
          expect(
            result[table].map(
              ({ token, name, declaring_type, declaring_type_token }) => ({
                token,
                name,
                declaring_type,
                declaring_type_token,
              }),
            ),
          ).toEqual(
            owners.map((owner, index) => ({
              token: `${prefix}0${index + 1}`,
              name: names[index],
              declaring_type: owner,
              declaring_type_token: owner === null ? null : "0x02000002",
            })),
          );
          expect(
            result[independent].map((member) => member.declaring_type),
          ).toEqual(["Fixture.B", "Fixture.A"]);
          expect(
            result.coverage.issues.some(
              (issue) =>
                issue.scope ===
                (table === "fields"
                  ? "metadata.MethodPtr"
                  : "metadata.FieldPtr"),
            ),
          ).toBe(false);
        },
      );
    },
  );

  it.each([
    { label: "zero row", methodPointers: [2, 0] },
    { label: "duplicate row", methodPointers: [2, 2] },
    { label: "omitted constructor row", methodPointers: [2] },
  ])(
    "preserves attribute facts with an unknown constructor owner for $label",
    ({ methodPointers }) => {
      const controlBytes = buildManagedMemberPointerFixture();
      const control = inspectManagedArtifactBytes(
        controlBytes,
        managedPeFixtureTarget(controlBytes),
      ).attributes[0];
      if (control === undefined)
        throw new Error("Fixture omitted custom attribute");
      expect(control.type_name).toBe("Fixture.B");
      const bytes = buildManagedMemberPointerFixture({ methodPointers });
      const result = inspectManagedArtifactBytes(
        bytes,
        managedPeFixtureTarget(bytes),
      );

      expect(result.coverage.state).toBe("partial");
      expect(result.coverage.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            code: "invalid-row",
            scope: "metadata.MethodPtr",
          }),
        ]),
      );
      expect(result.attributes).toEqual([
        { ...control, row_offset: expect.any(Number), type_name: null },
      ]);
    },
  );

  it.each([
    { name: "FieldPtr", table: 3 },
    { name: "MethodPtr", table: 5 },
  ])("rejects a table stream ending inside a $name row", ({ table }) => {
    const bytes = buildManagedMemberPointerFixture();
    const layout = metadataLayout(bytes);
    const pointers = layout.table(table);
    if (pointers === undefined)
      throw new Error("Fixture omitted pointer table");
    const versionLength = bytes.readUInt32LE(layout.rootOffset + 12);
    const firstStreamHeader =
      ((layout.rootOffset + 16 + versionLength + 3) & ~3) + 4;
    const streamNameEnd = bytes.indexOf(0, firstStreamHeader + 8);
    expect(bytes.toString("ascii", firstStreamHeader + 8, streamNameEnd)).toBe(
      "#-",
    );
    const tablesOffset =
      layout.rootOffset + bytes.readUInt32LE(firstStreamHeader);
    bytes.writeUInt32LE(
      pointers.offset + pointers.rowSize - 1 - tablesOffset,
      firstStreamHeader + 4,
    );

    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.coverage).toMatchObject({
      state: "unavailable",
      issues: [
        expect.objectContaining({
          code: "invalid-metadata-root",
          scope: "metadata.table-data",
        }),
      ],
    });
    expect(result.fields).toEqual([]);
    expect(result.methods).toEqual([]);
  });
});
