import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { afterEach, expect, it, vi } from "vitest";
import { createTestTempDirectory } from "../../../tests/fixtures/temporaryDirectory.js";
import { ArtifactProvider } from "../ArtifactProvider.js";
import { ArtifactReaderFailure } from "../ArtifactReader.js";
import { ArtifactResourceScope } from "../ArtifactResourceScope.js";
import { ZipArtifactReader } from "../ZipArtifactReader.js";
import { OwnedFileHandle } from "../../filesystem/OwnedFileHandle.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";
import {
  scanCanonicalArtifactInventoryForExtractionInScope,
  scanCanonicalArtifactInventoryInScope,
} from "./scanCanonical.js";

afterEach(() => vi.restoreAllMocks());

const zipFixture = async () => {
  const directory = await createTestTempDirectory(
    "rea-inventory-finalization-",
  );
  const path = join(directory, "input.zip");
  const writer = new ZipWriter(new Uint8ArrayWriter());
  await writer.add("member.txt", new TextReader("retained member evidence"));
  const bytes = await writer.close();
  await writeFile(path, bytes);
  return { path, sha256: createHash("sha256").update(bytes).digest("hex") };
};

it.each([
  { transfer: false, readerFails: false, rootFails: false, cancelAt: "reader" },
  { transfer: false, readerFails: false, rootFails: false, cancelAt: "root" },
  { transfer: false, readerFails: true, rootFails: true, cancelAt: "reader" },
  { transfer: false, readerFails: true, rootFails: true, cancelAt: "root" },
  { transfer: true, readerFails: false, rootFails: false, cancelAt: "reader" },
  { transfer: true, readerFails: false, rootFails: true, cancelAt: "reader" },
  { transfer: true, readerFails: true, rootFails: false, cancelAt: "reader" },
])(
  "retains completed inventory and exact cleanup owners: %j",
  async (scenario) => {
    const { path, sha256 } = await zipFixture();
    const scope = new ArtifactResourceScope();
    const controller = new AbortController();
    const reason = { request: "cancel during inventory finalization" };
    let retry = false;
    const readerClose = ZipArtifactReader.prototype.close;
    const reader = vi
      .spyOn(ZipArtifactReader.prototype, "close")
      .mockImplementation(async function (this: ZipArtifactReader) {
        if (scenario.cancelAt === "reader") controller.abort(reason);
        if (scenario.readerFails && !retry)
          throw new Error("reader close denied");
        await readerClose.call(this);
      });
    const rootClose = OwnedFileHandle.prototype.close;
    const root = vi
      .spyOn(OwnedFileHandle.prototype, "close")
      .mockImplementation(async function (this: OwnedFileHandle) {
        if (scenario.cancelAt === "root") controller.abort(reason);
        if (scenario.rootFails && !retry) throw new Error("root close denied");
        await rootClose.call(this);
      });
    const options = { resourceScope: scope, signal: controller.signal };
    const failure: unknown = await scope
      .run(async () => {
        if (scenario.transfer)
          await scanCanonicalArtifactInventoryForExtractionInScope(
            path,
            options,
          );
        else await scanCanonicalArtifactInventoryInScope(path, options);
      })
      .catch((cause: unknown) => cause);
    try {
      expect(failure).toBeInstanceOf(ArtifactReaderFailure);
      if (!(failure instanceof ArtifactReaderFailure))
        throw new Error("Expected inventory failure");
      const earlierCleanupFailure =
        scenario.readerFails && scenario.cancelAt === "root";
      expect(failure.reason).toBe(earlierCleanupFailure ? "io" : "cancelled");
      expect(failure.cancellation?.reason).toBe(
        earlierCleanupFailure ? undefined : reason,
      );
      expect(failure.partialObservation).toMatchObject({
        kind: "artifact-inventory",
        inventory: {
          manifest: { root_sha256: sha256, occurrence_count: 2 },
          coverage: { status: "complete" },
        },
      });
      expect(reader).toHaveBeenCalledTimes(1);
      expect(root).toHaveBeenCalledTimes(1);
      expect(failure.cleanupLeases).toHaveLength(
        Number(scenario.readerFails) + Number(scenario.rootFails),
      );
      expect(scope.hasPending).toBe(scenario.readerFails || scenario.rootFails);
      retry = true;
      await scope.retryCleanup();
      expect(scope.hasPending).toBe(false);
      expect(failure.cleanupLeases?.every((lease) => lease.released)).toBe(
        true,
      );
      expect(reader).toHaveBeenCalledTimes(scenario.readerFails ? 2 : 1);
      expect(root).toHaveBeenCalledTimes(scenario.rootFails ? 2 : 1);
    } finally {
      retry = true;
      await scope.close();
    }
  },
);

it("keeps an earlier inventory failure primary when cleanup is cancelled", async () => {
  const { path } = await zipFixture();
  const scope = new ArtifactResourceScope();
  const controller = new AbortController();
  const primary = new ArtifactReaderFailure(
    "format",
    "member enumeration failed",
  );
  const enumeration = vi
    .spyOn(ZipArtifactReader.prototype, "entries")
    .mockImplementation(async function* () {
      throw primary;
    });
  const close = ZipArtifactReader.prototype.close;
  vi.spyOn(ZipArtifactReader.prototype, "close").mockImplementation(
    async function (this: ZipArtifactReader) {
      controller.abort({ request: "later cleanup cancellation" });
      await close.call(this);
    },
  );
  try {
    await expect(
      scope.run(() =>
        scanCanonicalArtifactInventoryInScope(path, {
          resourceScope: scope,
          signal: controller.signal,
        }),
      ),
    ).rejects.toBe(primary);
    expect(enumeration).toHaveBeenCalledTimes(1);
    expect(scope.hasPending).toBe(false);
  } finally {
    await scope.close();
  }
});

it.each(["inventory_artifact", "inspect_artifact"] as const)(
  "reports finalization cancellation and retained inventory through provider %s",
  async (operation) => {
    const { path, sha256 } = await zipFixture();
    const controller = new AbortController();
    const reason = { request: "provider inventory cancellation" };
    const close = ZipArtifactReader.prototype.close;
    vi.spyOn(ZipArtifactReader.prototype, "close").mockImplementation(
      async function (this: ZipArtifactReader) {
        controller.abort(reason);
        await close.call(this);
      },
    );
    const client = new ArtifactProvider({}).createClient({
      kind: "archive",
      format: "zip",
      path,
      sha256,
    });
    try {
      const result = await client.execute(
        operation,
        {},
        { signal: controller.signal },
      );
      expect(result.ok).toBe(false);
      if (result.ok) throw new Error("Expected provider cancellation");
      expect(projectAnalysisError(result.error).code).toBe("cancelled");
      expect(result.error.cause).toBe(reason);
      expect(result.error.partialObservation).toMatchObject({
        kind: "artifact-inventory",
        inventory: { manifest: { root_sha256: sha256, occurrence_count: 2 } },
      });
    } finally {
      expect((await client.close()).ok).toBe(true);
    }
  },
);
