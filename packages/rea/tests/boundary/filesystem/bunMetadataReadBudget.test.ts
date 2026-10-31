import { open, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import {
  BUN_TRAILER,
  locateBunStandaloneGraph,
} from "../../../src/artifacts/bun/BunModuleGraphLayout.js";
import { decodeBunModuleGraph } from "../../../src/artifacts/bun/BunModuleGraphMembers.js";
import { elfAppendedBunPayload } from "../../../src/artifacts/bun/BunStandalone.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("keeps scattered tiny metadata reads proportional to the graph instead of cache pages", async () => {
  const count = 200;
  const tableAt = 6 * 65_536;
  const data = Buffer.alloc(tableAt + count * 52);
  for (let page = 0; page < 6; page++) data[page * 65_536 + 100] = 97;
  for (let index = 0; index < count; index++) {
    const row = data.subarray(tableAt + index * 52, tableAt + (index + 1) * 52);
    for (const [field, page] of [
      [0, (index * 3) % 6],
      [8, (index * 3 + 1) % 6],
      [40, (index * 3 + 2) % 6],
    ] as const) {
      row.writeUInt32LE(page * 65_536 + 100, field);
      row.writeUInt32LE(1, field + 4);
    }
    row[48] = 1;
    row[49] = 1;
    row[50] = 1;
  }
  const offsets = Buffer.alloc(32);
  offsets.writeBigUInt64LE(BigInt(data.length));
  offsets.writeUInt32LE(tableAt, 8);
  offsets.writeUInt32LE(count * 52, 12);
  const bytes = elfAppendedBunPayload(
    Buffer.concat([data, offsets, BUN_TRAILER]),
  );
  const path = join(
    await createTestTempDirectory("rea-bun-scattered-metadata-"),
    "app",
  );
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  const read = handle.read.bind(handle);
  let bytesRead = 0;
  const guard = bytes.length * 2;
  const counted = new Proxy(handle, {
    get: (target, key) =>
      key === "read"
        ? async (...args: Parameters<typeof read>) => {
            const result = await read(...args);
            bytesRead += result.bytesRead;
            if (bytesRead > guard)
              throw new Error(
                "Metadata read amplification crossed the owned test guard",
              );
            return result;
          }
        : Reflect.get(target, key),
  });
  try {
    const located = await locateBunStandaloneGraph(counted, bytes.length);
    if (located.status !== "present" || located.graph === undefined)
      throw new Error("Missing graph");
    const decoded = await decodeBunModuleGraph(located.graph);
    expect(decoded.modules).toHaveLength(count);
    expect(
      decoded.modules.every((module) => module.nameText.text === "a"),
    ).toBe(true);
    expect(bytesRead).toBeLessThan(guard);
  } finally {
    await handle.close();
  }
});

it("refuses cumulative uncached metadata work before the next file read", async () => {
  const rangeLength = 256 * 1024 + 1;
  const data = Buffer.alloc(rangeLength);
  const offsets = Buffer.alloc(32);
  offsets.writeBigUInt64LE(BigInt(data.length));
  const bytes = elfAppendedBunPayload(
    Buffer.concat([data, offsets, BUN_TRAILER]),
  );
  const path = join(
    await createTestTempDirectory("rea-bun-metadata-work-"),
    "app",
  );
  await writeFile(path, bytes);
  const handle = await open(path, "r");
  let reads = 0;
  const read = handle.read.bind(handle);
  const counted = new Proxy(handle, {
    get: (target, key) =>
      key === "read"
        ? async (...args: Parameters<typeof read>) => {
            reads++;
            return read(...args);
          }
        : Reflect.get(target, key),
  });
  try {
    const located = await locateBunStandaloneGraph(counted, bytes.length);
    if (located.status !== "present" || located.graph === undefined)
      throw new Error("Missing graph");
    const graph = located.graph;
    for (
      let index = 0;
      index < Math.floor((256 * 1024 * 1024) / rangeLength);
      index++
    )
      await graph.data.read(0, rangeLength);
    const admittedReads = reads;
    await expect(graph.data.read(0, rangeLength)).rejects.toMatchObject({
      reason: "limit",
      boundary: "capacity",
    });
    expect(reads).toBe(admittedReads);
  } finally {
    await handle.close();
  }
});
