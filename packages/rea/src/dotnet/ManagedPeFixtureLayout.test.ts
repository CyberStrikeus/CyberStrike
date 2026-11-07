import { describe, expect, it } from "vitest";

import { buildManagedPeFixture } from "../../scripts/fixtures/managed/pe.mjs";
import { inspectManagedArtifactBytes } from "./ManagedArtifactInspector.js";
import { inspectManagedMembersBytes } from "./ManagedMemberInspector.js";
import { readManagedPeLayout } from "./ManagedPeReader.js";
import { managedPeFixtureTarget } from "./ManagedPe.fixture.js";

const rawOffset = (rva: number) => 0x200 + (rva - 0x2000);

describe("managed PE fixture layout", () => {
  it("preserves bodyless native methods without allocating an IL extent", () => {
    const image = buildManagedPeFixture({
      methods: [
        { name: "NativeMethod", flags: 0x2016, rva: 0 },
        { name: "ManagedMethod", body: Buffer.from([0x06, 0x2a]) },
      ],
    });
    const inspected = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
    );
    expect(inspected.methods[0]?.rva).toBe(0);
    expect(inspected.methods[0]?.body.status).toBe("absent");
    expect(inspected.methods[0]?.body.opcode_counts).toEqual({});
    expect(inspected.methods[1]?.body.opcode_counts).toEqual({ ret: 1 });
  });

  it("preserves complete adjacent method bodies", () => {
    const firstBody = Buffer.concat([
      Buffer.from([0x9e]),
      Buffer.alloc(38),
      Buffer.from([0x2a]),
    ]);
    const secondBody = Buffer.from([0x06, 0x2a]);
    const image = buildManagedPeFixture({
      methods: [
        { name: "LongBody", body: firstBody },
        { name: "NextBody", body: secondBody },
      ],
    });

    expect(
      Buffer.compare(
        image.subarray(rawOffset(0x2800), rawOffset(0x2800) + firstBody.length),
        firstBody,
      ),
    ).toBe(0);
    expect(
      Buffer.compare(
        image.subarray(
          rawOffset(0x2840),
          rawOffset(0x2840) + secondBody.length,
        ),
        secondBody,
      ),
    ).toBe(0);
    const inspected = inspectManagedMembersBytes(
      image,
      managedPeFixtureTarget(image),
    );
    expect(inspected.methods.map(({ body }) => body.opcode_counts)).toEqual([
      { nop: 38, ret: 1 },
      { ret: 1 },
    ]);
  });

  it("keeps the ReadyToRun signature outside expanded metadata", () => {
    const image = buildManagedPeFixture({
      readyToRun: true,
      methods: Array.from({ length: 47 }, (_, index) => ({
        name: `Method${index}`,
      })),
    });
    const nativeHeaderRva = image.readUInt32LE(0x240);
    const nativeHeaderSize = image.readUInt32LE(0x244);

    expect(nativeHeaderSize).toBe(4);
    expect(
      image
        .subarray(rawOffset(nativeHeaderRva), rawOffset(nativeHeaderRva) + 4)
        .toString("latin1"),
    ).toBe("RTR\0");
  });

  it("keeps all 2045 requested resource bytes file-backed and inspectable", () => {
    const resourceData = Buffer.alloc(2045, 0x41);
    const image = buildManagedPeFixture({ resourceData });
    const layout = readManagedPeLayout(image);
    if (layout.cli === null) throw new Error("fixture omitted CLI header");
    const directoryOffset = layout.rvaToOffset(
      layout.cli.resources.rva,
      layout.cli.resources.size,
      "cli.resources",
    );
    const inspection = inspectManagedArtifactBytes(
      image,
      managedPeFixtureTarget(image),
    );

    expect(layout.cli.resources.size).toBe(resourceData.length + 4);
    expect(image.readUInt32LE(directoryOffset)).toBe(resourceData.length);
    expect(
      Buffer.compare(
        image.subarray(
          directoryOffset + 4,
          directoryOffset + 4 + resourceData.length,
        ),
        resourceData,
      ),
    ).toBe(0);
    expect(inspection.classification.status).toBe("managed");
    expect(inspection.resources).toMatchObject([
      {
        name: "Fixture.resources",
        embedded: true,
        data_length: resourceData.length,
      },
    ]);
    expect(inspection.coverage).toMatchObject({
      state: "complete",
      issues: [],
    });
  });

  it("keeps metadata for all 60 requested assembly references file-backed", () => {
    const references = Array.from(
      { length: 60 },
      (_, index) => `System.Reference.Assembly.${index}`,
    );
    const image = buildManagedPeFixture({ references });
    const layout = readManagedPeLayout(image);
    if (layout.cli === null) throw new Error("fixture omitted CLI header");
    const metadataOffset = layout.rvaToOffset(
      layout.cli.metadata.rva,
      layout.cli.metadata.size,
      "cli.metadata",
    );
    const inspection = inspectManagedArtifactBytes(
      image,
      managedPeFixtureTarget(image),
    );

    expect(metadataOffset + layout.cli.metadata.size).toBeLessThanOrEqual(
      image.length,
    );
    expect(inspection.classification.status).toBe("managed");
    expect(inspection.references.map(({ name }) => name)).toEqual(references);
    expect(inspection.coverage).toMatchObject({
      state: "complete",
      issues: [],
    });
  });
});
