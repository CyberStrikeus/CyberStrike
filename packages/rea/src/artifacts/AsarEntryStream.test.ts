import type { FileHandle } from "node:fs/promises";
import { expect, it } from "vitest";
import { readArtifactFileChunks } from "./readArtifactFileChunks.js";
import { readValidatedAsarEntry } from "./AsarEntryStream.js";

it.each(["complete", "truncated"])(
  "preserves %s source facts when output is cancelled after physical EOF",
  async (kind) => {
    const controller = new AbortController();
    const bytes = Buffer.from("ASAR member");
    let delivered = false;
    const read = (async (target: Buffer) => {
      if (delivered) return { bytesRead: 0, buffer: target };
      delivered = true;
      bytes.copy(target);
      return { bytesRead: bytes.length, buffer: target };
    }) as FileHandle["read"];
    const source = readArtifactFileChunks(
      { read },
      { signal: controller.signal },
    );
    const output = readValidatedAsarEntry(
      source,
      bytes.length + (kind === "truncated" ? 1 : 0),
      "member",
      "/fixture/archive.asar",
      controller.signal,
    );
    const failed = new Promise<Error>((resolve) =>
      output.once("error", resolve),
    );
    output.read(0);
    await expect.poll(() => source.readCoverage().kind).toBe("complete");
    expect(output.readableLength).toBeGreaterThan(0);
    expect(output.readableEnded).toBe(false);
    controller.abort(null);
    await expect(failed).resolves.toMatchObject(
      kind === "complete"
        ? { reason: "cancelled", cancellation: { reason: null } }
        : { reason: "integrity" },
    );
  },
);
