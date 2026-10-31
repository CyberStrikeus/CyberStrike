import { expect, it } from "vitest";
import { readMachoCommandNames } from "../../../../src/native/MachoCommandNames.js";
import { projectMachoBinary } from "../../../../src/native/MachoBinaryProjection.js";

it.each([
  [1, "CLANG"],
  [2, "SWIFT"],
  [3, "LD"],
  [4, "LLD"],
  [1024, "METAL"],
  [1025, "AIRLLD"],
  [1026, "AIRNT"],
  [1027, "AIRNT_PLUGIN"],
  [1028, "AIRPACK"],
  [1031, "GPUARCHIVER"],
  [1032, "METAL_FRAMEWORK"],
  [9999, "9999"],
])("decodes binary build tool %i as %s", async (tool, expected) => {
  const image = Buffer.alloc(64);
  image.writeUInt32LE(0xfeedfacf, 0);
  image.writeUInt32LE(0x0100000c, 4);
  image.writeUInt32LE(1, 16);
  image.writeUInt32LE(32, 20);
  image.writeUInt32LE(0x32, 32);
  image.writeUInt32LE(32, 36);
  image.writeUInt32LE(1, 40);
  image.writeUInt32LE(1, 52);
  image.writeUInt32LE(tool, 56);
  image.writeUInt32LE(0x00010203, 60);
  const binary = await readMachoCommandNames(
    async (offset, length) => image.subarray(offset, offset + length),
    image.length,
    1024,
    2,
  );
  expect(projectMachoBinary(binary).builds[0]?.tools).toEqual([
    { name: expected, version: "1.2.3" },
  ]);
});

it.each([4, 5])(
  "marks thread command %i entrypoints as unknown",
  async (command) => {
    const image = Buffer.alloc(48);
    image.writeUInt32LE(0xfeedfacf, 0);
    image.writeUInt32LE(0x0100000c, 4);
    image.writeUInt32LE(1, 16);
    image.writeUInt32LE(16, 20);
    image.writeUInt32LE(command, 32);
    image.writeUInt32LE(16, 36);
    const binary = await readMachoCommandNames(
      async (offset, length) => image.subarray(offset, offset + length),
      image.length,
      1024,
      1,
    );
    const result = projectMachoBinary(binary);
    expect(result.entrypoints).toEqual([]);
    expect(result.entrypointLimitations).toEqual(
      expect.arrayContaining([expect.stringContaining("Thread-state")]),
    );
    expect(result.commandLimitations.length).toBeGreaterThan(0);
  },
);
