import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { buffer } from "node:stream/consumers";
import { expect, it } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { BunStandaloneArtifactReader } from "../BunStandaloneArtifactReader.js";
import {
  bunModuleGraphPayload,
  elfAppendedBunPayload,
} from "./BunStandalone.fixture.js";

it("keeps duplicate and unsafe names distinct while extracting exact bytes", async () => {
  const path = join(await createTestTempDirectory("rea-bun-reader-"), "app");
  await writeFile(
    path,
    elfAppendedBunPayload(
      bunModuleGraphPayload({
        modules: [
          { name: "/$bunfs/a.js", contents: Buffer.from("first") },
          { name: "/$bunfs/a.js", contents: Buffer.from("second") },
          { name: "../../escape", contents: Buffer.from("third") },
        ],
      }),
    ),
  );
  const reader = new BunStandaloneArtifactReader(path);
  try {
    const entries = await collect(reader.entries());
    expect(entries.map((entry) => entry.path)).toEqual([
      "$bunfs/a.js",
      "$bunfs/a.js",
      "bun-modules/2",
    ]);
    expect(new Set(entries.map((entry) => entry.adapterKey)).size).toBe(3);
    for (const [index, entry] of entries.entries())
      expect((await buffer(await reader.open(entry))).toString()).toBe(
        ["first", "second", "third"][index],
      );
    const entry = entries[0]!;
    await expect(
      reader.open({ ...entry, byteOffset: 0 }),
    ).rejects.toMatchObject({ reason: "integrity" });
    const controller = new AbortController();
    controller.abort();
    await expect(reader.open(entry, controller.signal)).rejects.toMatchObject({
      reason: "cancelled",
    });
    await writeFile(path, "changed");
    await expect(reader.open(entry)).rejects.toMatchObject({
      reason: "integrity",
    });
  } finally {
    await reader.close();
  }
  await expect(collect(reader.entries())).rejects.toMatchObject({
    reason: "unavailable",
  });
});

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}
