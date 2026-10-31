import { expect, it } from "vitest";
import { readMachoCommandNames } from "../../../../src/native/MachoCommandNames.js";
import { projectMachoBinary } from "../../../../src/native/MachoBinaryProjection.js";

it.each([
  [true, true, 64, "little"],
  [false, true, 32, "little"],
  [true, false, 64, "big"],
  [false, false, 32, "big"],
] as const)(
  "projects word size and byte order from the binary header",
  async (wide, little, wordSize, endian) => {
    const image = Buffer.alloc(wide ? 32 : 28);
    const magic = wide ? 0xfeedfacf : 0xfeedface;
    if (little) {
      image.writeUInt32LE(magic, 0);
      image.writeUInt32LE(2, 12);
      image.writeUInt32LE(0x200085, 24);
    } else {
      image.writeUInt32BE(magic, 0);
      image.writeUInt32BE(2, 12);
      image.writeUInt32BE(0x200085, 24);
    }
    const binary = await readMachoCommandNames(
      async (offset, length) => image.subarray(offset, offset + length),
      image.length,
      1024,
      1,
    );
    expect(projectMachoBinary(binary)).toMatchObject({
      wordSize,
      endian,
      fileType: "2",
      flags: ["0x00200085"],
    });
  },
);
