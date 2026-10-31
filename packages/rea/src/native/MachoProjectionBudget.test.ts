import { expect, it } from "vitest";
import { readMachoCommandNames } from "./MachoCommandNames.js";
import { projectMachoBinary } from "./MachoBinaryProjection.js";

it.each([0xff, 0x01])(
  "admits a bounded section projection with name byte %i",
  async (nameByte) => {
    const count = 1000;
    const commandSize = 72 + 80 * count;
    const image = Buffer.alloc(32 + commandSize, 0xff);
    image.fill(nameByte, 40, 56);
    for (let index = 0; index < count; index++) {
      image.fill(nameByte, 104 + index * 80, 136 + index * 80);
    }
    image.writeUInt32LE(0xfeedfacf, 0);
    image.writeUInt32LE(1, 16);
    image.writeUInt32LE(commandSize, 20);
    image.writeUInt32LE(0x19, 32);
    image.writeUInt32LE(commandSize, 36);
    image.writeUInt32LE(count, 96);
    const read = async (offset: number, size: number) =>
      image.subarray(offset, offset + size);
    const projectedBudget = 8192 + 2048 + count * 2048 + (16 + 32 * count) * 24;
    const parsed = await readMachoCommandNames(
      read,
      image.length,
      16 + 32 * count,
      count + 1,
      projectedBudget,
    );
    const projection = projectMachoBinary(parsed);
    expect(projection.segments[0]?.sections).toHaveLength(count);
    expect(Buffer.byteLength(JSON.stringify(projection))).toBeLessThanOrEqual(
      projectedBudget,
    );
    await expect(
      readMachoCommandNames(
        read,
        image.length,
        16 + 32 * count,
        count + 1,
        projectedBudget - 1,
      ),
    ).rejects.toMatchObject({
      maximum: projectedBudget - 1,
      unit: "projected_bytes",
    });
  },
);

it("rejects section expansion before reading or allocating section records", async () => {
  const count = 170_000;
  const commandSize = 72 + 80 * count;
  const prefix = Buffer.alloc(104);
  prefix.writeUInt32LE(0xfeedfacf, 0);
  prefix.writeUInt32LE(1, 16);
  prefix.writeUInt32LE(commandSize, 20);
  prefix.writeUInt32LE(0x19, 32);
  prefix.writeUInt32LE(commandSize, 36);
  prefix.writeUInt32LE(count, 96);
  const offsets: number[] = [];
  const read = async (offset: number, size: number) => {
    offsets.push(offset);
    if (offset + size > prefix.length)
      throw new Error("section read before admission");
    return prefix.subarray(offset, offset + size);
  };
  await expect(
    readMachoCommandNames(
      read,
      32 + commandSize,
      64 * 1024 * 1024,
      count + 1,
      64 * 1024 * 1024,
    ),
  ).rejects.toMatchObject({
    maximum: 64 * 1024 * 1024,
    unit: "projected_bytes",
  });
  expect(offsets.every((offset) => offset < 104)).toBe(true);
});

it("reserves the projection envelope for an empty command table", async () => {
  const image = Buffer.alloc(32);
  image.writeUInt32LE(0xfeedfacf, 0);
  const read = async (offset: number, size: number) =>
    image.subarray(offset, offset + size);
  const minimum = 8192;
  const parsed = await readMachoCommandNames(read, image.length, 0, 0, minimum);
  expect(
    Buffer.byteLength(JSON.stringify(projectMachoBinary(parsed))),
  ).toBeLessThanOrEqual(minimum);
  for (const budget of [0, minimum - 1]) {
    await expect(
      readMachoCommandNames(read, image.length, 0, 0, budget),
    ).rejects.toMatchObject({
      maximum: budget,
      unit: "projected_bytes",
    });
  }
});
