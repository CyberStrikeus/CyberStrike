import * as inventoryProducer from "./ManagedMetadataInventory.js";
import { describe, expect, it, vi } from "vitest";

import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { inspectManagedNativeBoundariesBytes } from "./ManagedNativeBoundaryInspector.js";
import {
  buildManagedPeFixture,
  buildNativePeFixture,
  managedPeFixtureTarget,
} from "./ManagedPe.fixture.js";

it("preserves a readable native declaration when inventory issue count exceeds call-argument capacity", () => {
  const original = inventoryProducer.readManagedMetadataInventory;
  const issue = {
    code: "invalid-row" as const,
    scope: "metadata.CustomAttribute:fixture",
    offset: 0,
    detail: "Controlled invalid constructor",
  };
  const issueCount = 150_000;
  const producer = vi
    .spyOn(inventoryProducer, "readManagedMetadataInventory")
    .mockImplementation((...args) => ({
      ...original(...args),
      issues: Array.from({ length: issueCount }, () => issue),
    }));
  try {
    const bytes = buildManagedPeFixture({
      targetFramework: null,
      pinvoke: { importName: "Observe" },
    });
    const result = inspectManagedNativeBoundariesBytes(
      bytes,
      managedPeFixtureTarget(bytes),
    );
    expect(result.pinvoke_imports[0]?.import_name).toBe("Observe");
    expect(result.coverage.state).toBe("partial");
    expect(result.coverage.issues.length).toBeGreaterThanOrEqual(issueCount);
    expect(
      result.coverage.issues.reduce(
        (count, observed) => count + Number(observed.scope === issue.scope),
        0,
      ),
    ).toBe(issueCount);
    expect(result.coverage.issues[0]).toEqual(issue);
    expect(result.coverage.issues[issueCount - 1]).toEqual(issue);
  } finally {
    producer.mockRestore();
  }
});

describe("managed artifact failure classification", () => {
  it("distinguishes native, malformed, and unsupported metadata", () => {
    const nativeBytes = buildNativePeFixture();
    const native = inspectManagedArtifactBytes(
      nativeBytes,
      managedPeFixtureTarget(nativeBytes),
    );
    expect(native).toMatchObject({
      classification: { status: "not-managed" },
      metadata: { status: "absent" },
      coverage: { state: "unavailable" },
    });

    const malformedBytes = buildManagedPeFixture({
      corruptMetadataSignature: true,
    });
    const malformed = inspectManagedArtifactBytes(
      malformedBytes,
      managedPeFixtureTarget(malformedBytes),
    );
    expect(malformed.classification.status).toBe("malformed");
    expect(malformed.coverage.issues).toEqual([
      expect.objectContaining({ code: "invalid-metadata-root" }),
    ]);

    const unsupportedTableBytes = buildManagedPeFixture({
      metadataValidMaskExtra: 1n << 50n,
    });
    const unsupportedTable = inspectManagedArtifactBytes(
      unsupportedTableBytes,
      managedPeFixtureTarget(unsupportedTableBytes),
    );
    expect(unsupportedTable.coverage.issues).toEqual([
      expect.objectContaining({ code: "invalid-tables" }),
    ]);
  });

  it("rejects a ReadyToRun OS-override machine without a CLI directory", () => {
    const bytes = buildNativePeFixture();
    bytes.writeUInt16LE(0x014c ^ 0x7b79, bytes.readUInt32LE(0x3c) + 4);
    expect(() =>
      inspectManagedArtifactBytes(bytes, managedPeFixtureTarget(bytes)),
    ).toThrow("Unsupported PE machine 0x7a35");
  });

  it("keeps malformed reference and attribute issues across inventory callers", () => {
    const bytes = buildManagedPeFixture({
      references: [
        "System.Runtime",
        "System.Runtime",
        "UnityEngine.CoreModule",
      ],
      malformedAssemblyReferenceRows: [3],
      malformedCustomAttributeRows: [1],
    });
    const target = managedPeFixtureTarget(bytes);
    const artifact = inspectManagedArtifactBytes(bytes, target);
    const members = inspectManagedMembersBytes(bytes, target);
    const boundaries = inspectManagedNativeBoundariesBytes(bytes, target);
    const issueCodes = ["invalid-heap-index", "invalid-row"];

    expect(artifact.references.map(({ name }) => name)).toEqual([
      "System.Runtime",
      "System.Runtime",
    ]);
    expect(artifact.attributes).toEqual([]);
    expect(artifact.coverage.issues.map(({ code }) => code)).toEqual(
      issueCodes,
    );
    expect(members.coverage.issues.map(({ code }) => code)).toEqual(issueCodes);
    expect(boundaries.coverage).toMatchObject({
      state: "partial",
      issues: [
        expect.objectContaining({ code: "invalid-heap-index" }),
        expect.objectContaining({ code: "invalid-row" }),
      ],
    });
  });
});

describe.each([0, 0x200])(
  "stream-name file offsets with %i bytes of padding",
  (padding) => {
    it.each([
      {
        label: "non-printable name",
        value: 0x1f,
        length: 1,
        detail: "Metadata stream name is not printable ASCII",
      },
      {
        label: "unterminated name",
        value: 0x41,
        length: 32,
        detail: "Metadata stream name is missing a bounded terminator",
      },
    ])(
      "reports the artifact location for $label",
      ({ value, length, detail }) => {
        const original = buildManagedPeFixture();
        const section =
          original.readUInt32LE(0x3c) +
          24 +
          original.readUInt16LE(original.readUInt32LE(0x3c) + 20);
        const rawOffset = original.readUInt32LE(section + 20);
        // Relocate the raw section while preserving RVAs and its internal layout.
        const bytes = Buffer.concat([
          original.subarray(0, rawOffset),
          Buffer.alloc(padding),
          original.subarray(rawOffset),
        ]);
        bytes.writeUInt32LE(rawOffset + padding, section + 20);
        const baseline = inspectManagedArtifactBytes(
          bytes,
          managedPeFixtureTarget(bytes),
        );
        expect(baseline.coverage).toEqual({ state: "complete", issues: [] });

        const pe = readManagedPeLayout(bytes);
        if (pe.cli === null) throw new Error("Fixture omitted CLI metadata");
        const root = pe.rvaToOffset(
          pe.cli.metadata.rva,
          pe.cli.metadata.size,
          "cli.metadata",
        );
        const versionLength = bytes.readUInt32LE(root + 12);
        const nameOffset =
          root + Math.ceil((16 + versionLength) / 4) * 4 + 4 + 8;
        bytes.fill(value, nameOffset, nameOffset + length);
        const target = managedPeFixtureTarget(bytes);
        const artifact = inspectManagedArtifactBytes(bytes, target);
        const members = inspectManagedMembersBytes(bytes, target);

        expect(artifact.classification.status).toBe("malformed");
        expect(artifact.coverage.issues).toEqual([
          expect.objectContaining({
            code: "invalid-stream",
            scope: "metadata.stream-name",
            detail,
            offset: nameOffset,
          }),
        ]);
        expect(artifact.classification.evidence).toContainEqual(
          expect.objectContaining({
            code: "metadata-not-admitted",
            file_offset: nameOffset,
          }),
        );
        expect(members.coverage.issues).toEqual(artifact.coverage.issues);
      },
    );
  },
);
