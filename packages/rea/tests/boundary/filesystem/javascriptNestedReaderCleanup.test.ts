import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { createPackage } from "@electron/asar";
import { expect, it, onTestFinished, vi } from "vitest";

import { AsarArtifactReader } from "../../../src/artifacts/AsarArtifactReader.js";
import { ArtifactResourceScope } from "../../../src/artifacts/ArtifactResourceScope.js";
import { ArtifactReaderFailure } from "../../../src/artifacts/ArtifactReader.js";
import { reconstructJavaScriptArtifact } from "../../../src/application/javascript/JavaScriptArtifactReconstruction.js";
import { analyzeJavaScriptApplicationInputSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("retains a failed nested reader through blocked work and scope cleanup", async () => {
  const root = await createTestTempDirectory("rea-js-nested-reader-cleanup-");
  const bundle = join(root, "bundle");
  const contents = join(root, "asar-contents");
  const archive = join(bundle, "app.asar");
  await Promise.all([mkdir(bundle), mkdir(contents)]);
  await writeFile(join(contents, "package.json"), '{"main":"index.js"}\n');
  await writeFile(join(contents, "index.js"), "module.exports = 1;\n");
  await createPackage(contents, archive);

  const scope = new ArtifactResourceScope();
  const originalClose = AsarArtifactReader.prototype.close;
  const closedReaders: AsarArtifactReader[] = [];
  const closeFailure = new Error("nested ASAR close failed");
  let blockReadPhaseClose = true;
  onTestFinished(async () => {
    blockReadPhaseClose = false;
    await scope.close().catch(() => undefined);
    vi.restoreAllMocks();
  });
  vi.spyOn(AsarArtifactReader.prototype, "close").mockImplementation(
    async function (this: AsarArtifactReader) {
      closedReaders.push(this);
      // Inventory closes its nested reader first. Fail the next, read-phase
      // reader close after its native handle remains available for scope retry.
      if (this === closedReaders[1] && blockReadPhaseClose) throw closeFailure;
      await originalClose.call(this);
    },
  );

  const input = analyzeJavaScriptApplicationInputSchema.parse({
    input_path: bundle,
  });
  const firstFailure = await reconstructJavaScriptArtifact(input, scope).catch(
    (cause: unknown) => cause,
  );
  expect(firstFailure).toBeInstanceOf(ArtifactReaderFailure);
  expect(firstFailure).toMatchObject({
    cleanup: {
      reason: closeFailure.message,
      resources: [expect.stringContaining("app.asar")],
    },
  });
  expect(closedReaders).toHaveLength(2);
  const retainedReader = closedReaders[1];
  expect(retainedReader).toBeDefined();
  expect(retainedReader).not.toBe(closedReaders[0]);

  const blockedWork = await reconstructJavaScriptArtifact(input, scope).catch(
    (cause: unknown) => cause,
  );
  expect(blockedWork).toMatchObject({
    reason: "unavailable",
    cleanup: {
      reason: closeFailure.message,
      resources: [expect.stringContaining("app.asar")],
    },
  });
  expect(closedReaders).toHaveLength(3);
  expect(closedReaders[2]).toBe(retainedReader);

  blockReadPhaseClose = false;
  await scope.close();
  expect(closedReaders).toHaveLength(4);
  expect(closedReaders[3]).toBe(retainedReader);
});
