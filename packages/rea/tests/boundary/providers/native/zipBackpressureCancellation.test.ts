import { once } from "node:events";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { expect, it } from "vitest";
import { ZipArtifactReader } from "../../../../src/artifacts/ZipArtifactReader.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it("cancels a ZIP read while its consumer is applying backpressure", async () => {
  const root = await createTestTempDirectory("rea-zip-backpressure-");
  const path = join(root, "fixture.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("large.txt", new TextReader("x".repeat(2 * 1024 * 1024)), {
    level: 0,
  });
  await writeFile(path, await writer.close());
  const reader = new ZipArtifactReader(path, "zip");
  try {
    const entries = [];
    for await (const entry of reader.entries()) entries.push(entry);
    const entry = entries[0];
    expect(entry).toBeDefined();
    if (entry === undefined) return;
    const controller = new AbortController();
    const stream = await reader.open(entry, controller.signal);
    stream.on("error", () => undefined);
    try {
      await once(stream, "readable");
      expect(stream.readableLength).toBeGreaterThan(0);
      const errorEvent = once(stream, "error");
      controller.abort();
      expect(stream.destroyed).toBe(true);
      const [failure] = await errorEvent;
      expect(failure).toMatchObject({
        name: "ArtifactReaderFailure",
        reason: "cancelled",
      });
    } finally {
      // Resume an old adapter's stalled producer so a failing regression owns cleanup too.
      stream.resume();
      stream.destroy();
    }
  } finally {
    await reader.close();
  }
});
