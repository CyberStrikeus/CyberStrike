import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { createInspectionResources } from "../../tests/fixtures/inspectionResources.js";
import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { AnalysisCancelledError } from "../domain/analysisErrorCore.js";
import { BinaryTargetError } from "../domain/configurationErrors.js";
import {
  HopperCancelledError,
  HopperStartError,
} from "../domain/hopperErrors.js";
import {
  prepareHopperMachOImage,
  resolveHopperMachOImage as resolveHopperMachOImageWithOwner,
} from "./HopperMachOImage.js";

let inspectionResources = createInspectionResources();
afterEach(async () => {
  await inspectionResources.close();
  inspectionResources = createInspectionResources();
});

const resolveHopperMachOImage = (
  target: Parameters<typeof resolveHopperMachOImageWithOwner>[0],
) =>
  resolveHopperMachOImageWithOwner(target, {
    resourceScope: inspectionResources.owner,
  });

type NativeFs = typeof import("node:fs/promises");
type NativeFilePath = Parameters<NativeFs["open"]>[0];

const createFileSystemWithCloseHook = async (
  onClose: (path: NativeFilePath, close: () => Promise<void>) => Promise<void>,
  onRead?: () => Promise<unknown>,
) => {
  const actualFs = await vi.importActual<NativeFs>("node:fs/promises");
  return {
    open: async (...args: Parameters<NativeFs["open"]>) => {
      const handle = await actualFs.open(...args);
      const path = args[0];
      const closeHandle = handle.close.bind(handle);
      Object.defineProperty(handle, "close", {
        configurable: true,
        value: () => onClose(path, closeHandle),
      });
      if (onRead !== undefined) {
        Object.defineProperty(handle, "read", {
          configurable: true,
          value: onRead,
        });
      }
      return handle;
    },
  };
};

const prepareWithChunkWriteFailure = (
  fixture: Awaited<ReturnType<typeof createThinCopyFixture>>,
  cause: Error,
  options: Omit<Parameters<typeof prepareHopperMachOImage>[4], "observer">,
) =>
  prepareHopperMachOImage(
    fixture.sourcePath,
    fixture.sha256,
    fixture.image,
    fixture.destination,
    {
      ...options,
      observer: {
        afterChunkWritten: async () => {
          throw cause;
        },
      },
    },
  );

it("keeps an observer failure primary and closes real source handles", async () => {
  const fixture = await createThinCopyFixture("rea-hopper-copy-primary-");
  const writeFailure = new Error("controlled copy observer failure");
  const prepared = await prepareWithChunkWriteFailure(fixture, writeFailure, {
    resourceScope: new ArtifactResourceScope(),
  });

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("A failed copy was accepted");
  expect(prepared.error.cause).toBe(writeFailure);
  expect(prepared.error.cleanupIncomplete).toBe(false);
});

it("keeps a copy failure primary while retaining and retrying a real source handle", async () => {
  const fixture = await createThinCopyFixture("rea-hopper-copy-cleanup-");

  const firstCloseFailure = new Error("source close is not confirmed");
  let allowSourceClose = false;
  let sourceCloseAttempts = 0;
  let outputCloseAttempts = 0;
  const fileSystem = await createFileSystemWithCloseHook(
    async (path, close) => {
      if (path === fixture.sourcePath) {
        sourceCloseAttempts += 1;
        if (!allowSourceClose) throw firstCloseFailure;
      } else {
        outputCloseAttempts += 1;
      }
      await close();
    },
  );
  const resourceScope = new ArtifactResourceScope();
  const writeFailure = new Error("controlled copy observer failure");
  const prepared = await prepareWithChunkWriteFailure(fixture, writeFailure, {
    resourceScope,
    fileSystem,
  });

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("A failed copy was accepted");
  expect(prepared.error.cause).toBe(writeFailure);
  expect(prepared.error.cleanupIncomplete).toBe(true);
  expect(prepared.error.cleanupResources).toEqual([
    `hopper-image-source:${fixture.sourcePath}`,
  ]);
  expect(outputCloseAttempts).toBe(1);
  expect(sourceCloseAttempts).toBe(2);

  allowSourceClose = true;
  await resourceScope.retryCleanup();
  expect(sourceCloseAttempts).toBe(3);
  expect(prepared.error.cause).toBe(writeFailure);
  expect(prepared.error.cleanupIncomplete).toBe(false);
});

it("keeps an output-close failure primary when cancellation first arrives during source close", async () => {
  const fixture = await createThinCopyFixture("rea-hopper-late-close-abort-");
  const controller = new AbortController();
  const reason = { request: "abort-during-source-close" };
  const outputCloseFailure = new Error("destination close failed first");
  let allowOutputClose = false;
  const fileSystem = await createFileSystemWithCloseHook(
    async (path, close) => {
      if (path === fixture.destination && !allowOutputClose)
        throw outputCloseFailure;
      await close();
      if (path === fixture.sourcePath) controller.abort(reason);
    },
  );
  const resourceScope = new ArtifactResourceScope();

  const prepared = await prepareHopperMachOImage(
    fixture.sourcePath,
    fixture.sha256,
    fixture.image,
    fixture.destination,
    { fileSystem, resourceScope, signal: controller.signal },
  );

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("Failed output closure was accepted");
  expect(prepared.error).toBeInstanceOf(HopperStartError);
  expect(prepared.error.cause).toBe(outputCloseFailure);
  expect(prepared.error.cause).not.toBe(reason);
  expect(prepared.error.cleanupIncomplete).toBe(true);
  expect(prepared.error.cleanupResources).toEqual([
    `hopper-prepared-image:${fixture.destination}`,
  ]);

  allowOutputClose = true;
  await resourceScope.retryCleanup();
  expect(prepared.error.cleanupIncomplete).toBe(false);
});

it("keeps cancellation observed before close primary and retains an output-close failure", async () => {
  const fixture = await createThinCopyFixture("rea-hopper-cancel-close-error-");
  const controller = new AbortController();
  const reason = { request: "abort-before-close" };
  const outputCloseFailure = new Error("destination close failed");
  let allowOutputClose = false;
  const fileSystem = await createFileSystemWithCloseHook(
    async (path, close) => {
      if (path === fixture.destination && !allowOutputClose)
        throw outputCloseFailure;
      await close();
    },
  );
  const resourceScope = new ArtifactResourceScope();

  const prepared = await prepareHopperMachOImage(
    fixture.sourcePath,
    fixture.sha256,
    fixture.image,
    fixture.destination,
    {
      fileSystem,
      resourceScope,
      signal: controller.signal,
      observer: {
        afterChunkWritten: async () => controller.abort(reason),
      },
    },
  );

  expect(prepared.ok).toBe(false);
  if (prepared.ok) throw new Error("Cancelled copy was accepted");
  expect(prepared.error).toBeInstanceOf(HopperCancelledError);
  expect(prepared.error.cause).toBe(reason);
  expect(prepared.error.cleanupIncomplete).toBe(true);
  expect(prepared.error.cleanupResources).toEqual([
    `hopper-prepared-image:${fixture.destination}`,
  ]);
  expect(
    prepared.error.secondaryFailures.some(
      (failure) => failure.cause === outputCloseFailure,
    ),
  ).toBe(true);

  allowOutputClose = true;
  await resourceScope.retryCleanup();
  expect(prepared.error.cleanupIncomplete).toBe(false);
});

it("preserves a physical preflight read failure and retains the handle after close fails", async () => {
  const fixture = await createThinCopyFixture(
    "rea-hopper-preflight-read-close-",
  );
  const readFailure = new Error("controlled preflight read failure");
  const closeFailure = new Error("controlled preflight close failure");
  let allowClose = false;
  let closeAttempts = 0;
  const fileSystem = await createFileSystemWithCloseHook(
    async (_path, close) => {
      closeAttempts += 1;
      if (!allowClose) throw closeFailure;
      await close();
    },
    async () => {
      throw readFailure;
    },
  );
  const owner = inspectionResources;

  const result = await resolveHopperMachOImageWithOwner(fixture.target, {
    resourceScope: owner.owner,
    fileSystem,
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Read failure was accepted");
  expect(result.error).toBeInstanceOf(BinaryTargetError);
  expect(result.error.cause).toBe(readFailure);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.cleanupResources).toEqual([
    `hopper-macho-preflight:${fixture.sourcePath}`,
  ]);
  expect(result.error.secondaryFailures).toHaveLength(1);
  expect(result.error.secondaryFailures[0]?.cleanupIncomplete).toBe(true);
  expect(closeAttempts).toBe(1);

  allowClose = true;
  await owner.close();
  expect(closeAttempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
  expect(result.error.secondaryFailures[0]?.cleanupIncomplete).toBe(false);
});

it("retains exact cancellation during preflight close without replacing its close failure", async () => {
  const fixture = await createThinCopyFixture(
    "rea-hopper-preflight-close-cancel-",
  );
  const controller = new AbortController();
  const reason = { request: "abort-during-preflight-close" };
  const closeFailure = new Error("controlled preflight close failure");
  let allowClose = false;
  let closeAttempts = 0;
  const fileSystem = await createFileSystemWithCloseHook(
    async (_path, close) => {
      closeAttempts += 1;
      if (!allowClose) {
        controller.abort(reason);
        throw closeFailure;
      }
      await close();
    },
  );
  const owner = inspectionResources;

  const result = await resolveHopperMachOImageWithOwner(fixture.target, {
    resourceScope: owner.owner,
    fileSystem,
    signal: controller.signal,
  });

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Close failure was accepted");
  expect(result.error).toBeInstanceOf(BinaryTargetError);
  expect(result.error.cause).toBe(closeFailure);
  expect(result.error.cleanupIncomplete).toBe(true);
  expect(result.error.secondaryFailures).toHaveLength(1);
  expect(result.error.secondaryFailures[0]).toBeInstanceOf(
    AnalysisCancelledError,
  );
  expect(result.error.secondaryFailures[0]?.cause).toBe(reason);

  allowClose = true;
  await owner.close();
  expect(closeAttempts).toBe(2);
  expect(result.error.cleanupIncomplete).toBe(false);
});

const createThinCopyFixture = async (prefix: string) => {
  const directory = await createTestTempDirectory(prefix);
  const bytes = Buffer.alloc(100_000, 0x5a);
  bytes.writeUInt32BE(0xfeedfacf, 0);
  bytes.writeUInt32BE(0x0100000c, 4);
  bytes.writeUInt32BE(0x80000002, 8);
  const sourcePath = join(directory, "source.macho");
  const destination = join(directory, "image.macho");
  await writeFile(sourcePath, bytes);
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const target = {
    path: sourcePath,
    sha256,
    kind: "executable" as const,
    format: "mach-o" as const,
    architecture: "arm64" as const,
    availableArchitectures: ["arm64"] as const,
  };
  const resolved = await resolveHopperMachOImage({
    ...target,
  });
  if (!resolved.ok) throw resolved.error;
  return {
    sourcePath,
    destination,
    sha256,
    target,
    image: resolved.value,
  };
};
