import { Uint8ArrayReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { parseBinaryTarget } from "../../../../src/application/BinaryTargetResolver.js";
import { ArtifactProvider } from "../../../../src/artifacts/ArtifactProvider.js";
import { ArtifactReaderFailure } from "../../../../src/artifacts/ArtifactReader.js";
import { SafeOutputTree } from "../../../../src/artifacts/SafeOutputTree.js";
import { artifactExtractionResultSchema } from "../../../../src/domain/artifactGraph.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

it("preserves a real ZIP stream's caller cancellation through extraction rollback", async () => {
  const root = await createTestTempDirectory("rea-extract-zip-cancellation-");
  const source = join(root, "source.zip");
  const bytes = new Uint8Array(512 * 1024).fill(0x71);
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("member.bin", new Uint8ArrayReader(bytes), { level: 0 });
  await writeFile(source, await writer.close());
  const target = await parseBinaryTarget(source);
  if (!target.ok) throw target.error;
  const client = new ArtifactProvider(process.env).createClient(target.value);
  const output = join(root, "cancelled-output");
  const controller = new AbortController();
  const reason = { requested: "stop member extraction" };
  const originalWrite = SafeOutputTree.prototype.write;
  let zipFailure: unknown;
  let chunks = 0;
  const writeSpy = vi
    .spyOn(SafeOutputTree.prototype, "write")
    .mockImplementation(async function (
      this: SafeOutputTree,
      ...args: Parameters<SafeOutputTree["write"]>
    ) {
      const [relativePath, stream, expected, signal] = args;
      const iterator = stream[Symbol.asyncIterator]();
      const next = iterator.next.bind(iterator);
      iterator.next = async (...nextArgs: Parameters<typeof iterator.next>) => {
        if (chunks === 1) {
          // The first ZIP chunk reached the actual output file. Abort before
          // requesting the next chunk, so the ZIP stream owns this failure.
          expect(
            (await readFile(join(output, relativePath))).length,
          ).toBeGreaterThan(0);
          controller.abort(reason);
        }
        try {
          const result = await next(...nextArgs);
          if (!result.done) chunks += 1;
          return result;
        } catch (failure) {
          zipFailure = failure;
          throw failure;
        }
      };
      const iteratorSpy = vi
        .spyOn(stream, Symbol.asyncIterator)
        .mockReturnValue(iterator);
      try {
        return await originalWrite.call(
          this,
          relativePath,
          stream,
          expected,
          signal,
        );
      } finally {
        iteratorSpy.mockRestore();
      }
    });
  try {
    const cancelled = await client.execute(
      "extract_artifact",
      { output_root: output },
      { signal: controller.signal },
    );
    expect(chunks).toBe(1);
    expect(zipFailure).toBeInstanceOf(ArtifactReaderFailure);
    if (!(zipFailure instanceof ArtifactReaderFailure))
      throw new Error("Expected the ZIP iterator to report cancellation");
    expect(zipFailure.reason).toBe("cancelled");
    expect(zipFailure.cancellation?.reason).toBe(reason);
    expect(cancelled).toMatchObject({
      ok: false,
      error: { _tag: "ArtifactOperationError", reason: "cancelled" },
    });
    if (cancelled.ok) throw new Error("Expected cancelled extraction");
    expect(cancelled.error.cause).toBe(reason);
    expect(cancelled.error.cleanupIncomplete).toBe(false);
    await expect(access(output)).rejects.toMatchObject({ code: "ENOENT" });

    writeSpy.mockRestore();
    const controlOutput = join(root, "control-output");
    const control = await client.execute("extract_artifact", {
      output_root: controlOutput,
    });
    if (!control.ok) throw control.error;
    expect(
      artifactExtractionResultSchema.parse(control.value.result),
    ).toMatchObject({
      containment_verified: true,
      artifacts: [expect.objectContaining({ relative_path: "member.bin" })],
    });
    expect(
      Buffer.compare(
        await readFile(join(controlOutput, "member.bin")),
        Buffer.from(bytes),
      ),
    ).toBe(0);
    expect(await client.close()).toMatchObject({ ok: true });
  } finally {
    writeSpy.mockRestore();
    await client.close();
  }
});
