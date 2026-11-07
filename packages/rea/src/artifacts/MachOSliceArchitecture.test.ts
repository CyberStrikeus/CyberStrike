import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { ok } from "../domain/result.js";
import { fatImage, machoImage } from "./apple/MachoImage.fixture.js";
import { MachOSliceArtifactReader } from "./MachOSliceArtifactReader.js";

const armSlices = async (
  name: string,
  subtype: number,
  reported: {
    readonly type?: number;
    readonly subtype?: number;
    readonly offset?: number;
    readonly size?: number;
    readonly alignment?: number;
  } = {},
  cpuType = 12,
) => {
  const root = await createTestTempDirectory("rea-arm-slice-identity-");
  const path = join(root, "fat");
  const cpu = { type: cpuType, subtype };
  const bytes = machoImage({ cpu, wide: cpuType !== 12 });
  await writeFile(path, fatImage([{ cpu, bytes }]));
  const reader = new MachOSliceArtifactReader(
    path,
    {},
    {
      run: async () =>
        ok({
          tool: "lipo",
          executable: "/usr/bin/lipo",
          executableSha256: "1".repeat(64),
          toolVersion: null,
          versionReason: "fixture",
          arguments: ["-detailed_info", path],
          stdout: `architecture ${name}\n cputype ${reported.type ?? cpu.type}\n cpusubtype ${reported.subtype ?? subtype}\n offset ${reported.offset ?? 4096}\n size ${reported.size ?? bytes.length}\n align 2^${reported.alignment ?? 12}\n`,
          stderr: "",
          stdoutBytes: 1,
          stderrBytes: 0,
          exitCode: 0,
          signal: null,
        }),
    },
  );
  onTestFinished(() => reader.close());
  const entries = [];
  for await (const entry of reader.entries()) entries.push(entry);
  return entries;
};

it.each([
  ["armv4t", 5],
  ["armv5", 7],
  ["xscale", 8],
  ["armv6", 6],
  ["armv7", 9],
  ["armv7f", 10],
  ["armv7s", 11],
  ["armv7k", 12],
  ["armv6m", 14],
  ["armv7m", 15],
  ["armv7em", 16],
  ["armv8m.main", 17],
  ["armv8m.base", 18],
  ["armv8.1m.main", 19],
  ["armv7", 0x80000009],
] as const)(
  "matches %s to its physical ARM subtype %i",
  async (name, subtype) => {
    const entries = await armSlices(name, subtype);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      path: `slices/${name}`,
      byteOffset: 4096,
      declaredSize: 44,
    });
    expect(entries[0]?.limitations).toEqual([]);
  },
);

it.each([
  ["armv7s", 9],
  ["armv7", 11],
  ["armv7", 42],
  ["armv99", 9],
] as const)(
  "rejects the inconsistent name %s for subtype %i",
  async (name, subtype) => {
    await expect(armSlices(name, subtype)).rejects.toMatchObject({
      reason: "integrity",
    });
  },
);

it.each([
  { type: 0x0100000c },
  { subtype: 11 },
  { subtype: 0x80000009 },
  { offset: 4097 },
  { size: 45 },
  { alignment: 11 },
])("still rejects physical metadata disagreement %j", async (reported) => {
  await expect(armSlices("armv7", 9, reported)).rejects.toMatchObject({
    reason: "integrity",
  });
});

it.each([
  ["arm64v8", 1],
  ["arm64", 1],
  ["arm64e.x1", 12],
  ["arm64e", 12],
  ["arm64e.v1", 0x81000002],
] as const)(
  "reconciles ARM64 source name %s with subtype %i",
  async (name, subtype) => {
    const entries = await armSlices(name, subtype, {}, 0x0100000c);
    expect(entries).toHaveLength(1);
    expect(entries[0]?.path).toBe(`slices/${name}`);
    expect(entries[0]?.limitations).toEqual([]);
  },
);

it("does not accept an ARM64 subtype label from a different slice", async () => {
  await expect(armSlices("arm64v8", 0, {}, 0x0100000c)).rejects.toMatchObject({
    reason: "integrity",
  });
});
