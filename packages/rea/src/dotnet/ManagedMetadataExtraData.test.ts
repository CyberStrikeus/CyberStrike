import { describe, expect, it } from "vitest";

import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import {
  buildManagedPeFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";

const fixtureTablesStream = (bytes: Buffer) => {
  const pe = readManagedPeLayout(bytes);
  if (pe.cli === null) throw new Error("Fixture omitted CLI metadata");
  const root = pe.rvaToOffset(
    pe.cli.metadata.rva,
    pe.cli.metadata.size,
    "cli.metadata",
  );
  const versionLength = bytes.readUInt32LE(root + 12);
  const streamHeader = ((root + 16 + versionLength + 3) & ~3) + 4;
  expect(
    bytes.toString(
      "ascii",
      streamHeader + 8,
      bytes.indexOf(0, streamHeader + 8),
    ),
  ).toBe("#~");
  const tablesOffset = root + bytes.readUInt32LE(streamHeader);
  const valid = bytes.readBigUInt64LE(tablesOffset + 8);
  let count = 0;
  for (let table = 0; table < 64; table += 1)
    if ((valid & (1n << BigInt(table))) !== 0n) count += 1;
  return { streamHeader, tablesOffset, extraDataOffset: 24 + count * 4 };
};

describe("CLR metadata tables ExtraData extension", () => {
  it.each([
    { label: "absent extension", metadataExtraData: undefined },
    { label: "zero word", metadataExtraData: 0 },
    { label: "nonzero word", metadataExtraData: 0x1234_5678 },
    { label: "maximum unsigned word", metadataExtraData: 0xffff_ffff },
  ])(
    "preserves metadata and member identities with $label",
    ({ metadataExtraData }) => {
      const plain = buildManagedPeFixture();
      const plainTarget = managedPeFixtureTarget(plain);
      const baseline = inspectManagedArtifactBytes(plain, plainTarget);
      const baselineMembers = inspectManagedMembersBytes(plain, plainTarget);
      const bytes = buildManagedPeFixture(
        metadataExtraData === undefined ? {} : { metadataExtraData },
      );
      const target = managedPeFixtureTarget(bytes);
      const artifact = inspectManagedArtifactBytes(bytes, target);
      const members = inspectManagedMembersBytes(bytes, target);
      const shift = metadataExtraData === undefined ? 0 : 4;

      expect(artifact.coverage).toEqual({ state: "complete", issues: [] });
      expect(members.coverage).toEqual({ state: "complete", issues: [] });
      if (baseline.module === null || baseline.assembly === null)
        throw new Error("Fixture omitted module or assembly");
      expect(artifact.module).toEqual({
        ...baseline.module,
        row_offset: baseline.module.row_offset + shift,
      });
      expect(artifact.assembly).toEqual({
        ...baseline.assembly,
        row_offset: baseline.assembly.row_offset + shift,
      });
      expect(artifact.metadata.table_row_counts).toEqual(
        baseline.metadata.table_row_counts,
      );
      expect(artifact.target_frameworks).toEqual(baseline.target_frameworks);
      expect(members.types).toEqual(
        baselineMembers.types.map((type) => ({
          ...type,
          row_offset: type.row_offset + shift,
        })),
      );
      expect(members.fields).toEqual(
        baselineMembers.fields.map((field) => ({
          ...field,
          row_offset: field.row_offset + shift,
        })),
      );
      expect(members.methods).toEqual(
        baselineMembers.methods.map((method) => ({
          ...method,
          row_offset: method.row_offset + shift,
        })),
      );
      expect(members.call_edges).toEqual(baselineMembers.call_edges);
      expect(members.field_accesses).toEqual(baselineMembers.field_accesses);
    },
  );
});

describe("CLR ExtraData index widths and boundaries", () => {
  it("combines ExtraData with actual four-byte string heap indexes", () => {
    const fieldName = "f".repeat(65_536);
    const plain = buildManagedPeFixture({ fieldName });
    const baseline = inspectManagedMembersBytes(
      plain,
      managedPeFixtureTarget(plain),
    );
    const bytes = buildManagedPeFixture({
      fieldName,
      metadataExtraData: 0x1234_5678,
    });
    const { tablesOffset } = fixtureTablesStream(bytes);
    expect(bytes[tablesOffset + 6]).toBe(0x41);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(baseline.coverage).toEqual({ state: "complete", issues: [] });
    expect(result.coverage).toEqual({ state: "complete", issues: [] });
    expect(result.module?.name).toBe("Fixture.dll");
    expect(result.module?.mvid).toBe(baseline.module?.mvid);
    expect(result.types.map((type) => type.full_name)).toEqual([
      "Fixture.Program",
    ]);
    expect(result.fields.map(({ token, name }) => ({ token, name }))).toEqual([
      { token: "0x04000001", name: fieldName },
    ]);
    // Main is placed after the large field name, so its index exceeds 0xffff.
    expect(result.methods.map(({ token, name }) => ({ token, name }))).toEqual([
      { token: "0x06000001", name: "Main" },
    ]);
  });

  it("honors ExtraData in an unoptimized table stream without pointer tables", () => {
    const bytes = buildManagedPeFixture({ metadataExtraData: 0x1234_5678 });
    const baselineTarget = managedPeFixtureTarget(bytes);
    const baseline = inspectManagedArtifactBytes(bytes, baselineTarget);
    const baselineMembers = inspectManagedMembersBytes(bytes, baselineTarget);
    const { streamHeader } = fixtureTablesStream(bytes);
    bytes.write("#-", streamHeader + 8, "ascii");
    const target = managedPeFixtureTarget(bytes);
    const result = inspectManagedArtifactBytes(bytes, target);
    const members = inspectManagedMembersBytes(bytes, target);

    expect(result.coverage).toEqual({ state: "complete", issues: [] });
    expect(members.coverage).toEqual({ state: "complete", issues: [] });
    expect(result.metadata.stream_names).toContain("#-");
    expect(result.metadata.stream_names).not.toContain("#~");
    expect(result.module).toEqual(baseline.module);
    expect(result.assembly).toEqual(baseline.assembly);
    expect(members.types).toEqual(baselineMembers.types);
    expect(members.fields).toEqual(baselineMembers.fields);
    expect(members.methods).toEqual(baselineMembers.methods);
  });

  it("reports a truncated row count before interpreting ExtraData", () => {
    const bytes = buildManagedPeFixture({ metadataExtraData: 0x1234_5678 });
    const { streamHeader, tablesOffset, extraDataOffset } =
      fixtureTablesStream(bytes);
    bytes.writeUInt32LE(extraDataOffset - 1, streamHeader + 4);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage).toMatchObject({
      state: "unavailable",
      issues: [
        expect.objectContaining({
          code: "invalid-metadata-root",
          scope: "metadata.table-row-count",
          // The last row count's artifact file offset, not its stream offset.
          offset: tablesOffset + extraDataOffset - 4,
        }),
      ],
    });
    expect(result.types).toEqual([]);
    expect(result.methods).toEqual([]);
  });

  it("reports a stream extent beyond the metadata root at its file offset", () => {
    const bytes = buildManagedPeFixture();
    const { streamHeader, tablesOffset } = fixtureTablesStream(bytes);
    bytes.writeUInt32LE(0xffff_ffff, streamHeader + 4);
    const result = inspectManagedMembersBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );

    expect(result.coverage.issues).toEqual([
      expect.objectContaining({
        code: "invalid-metadata-root",
        scope: "metadata.#~",
        offset: tablesOffset,
      }),
    ]);
  });

  it.each([0, 1, 3])(
    "rejects an ExtraData word with only %i declared bytes",
    (availableBytes) => {
      const bytes = buildManagedPeFixture({ metadataExtraData: 0x1234_5678 });
      const { streamHeader, tablesOffset, extraDataOffset } =
        fixtureTablesStream(bytes);
      expect(bytes[tablesOffset + 6]).toBe(0x40);
      expect(bytes.readUInt32LE(tablesOffset + extraDataOffset)).toBe(
        0x1234_5678,
      );
      // Only the declared tables-stream extent is shortened; the PE and heaps stay intact.
      bytes.writeUInt32LE(extraDataOffset + availableBytes, streamHeader + 4);

      const result = inspectManagedMembersBytes(
        bytes,
        managedPeFixtureTarget(bytes),
      );
      expect(result.coverage).toMatchObject({
        state: "unavailable",
        issues: [
          expect.objectContaining({
            code: "invalid-metadata-root",
            scope: "metadata.tables-extra-data",
            offset: tablesOffset + extraDataOffset,
          }),
        ],
      });
      expect(result.module).toBeNull();
      expect(result.types).toEqual([]);
      expect(result.methods).toEqual([]);
    },
  );
});
