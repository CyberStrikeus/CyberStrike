import { createHash } from "node:crypto";
import type { FileHandle } from "node:fs/promises";
import { lstat, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, onTestFinished, vi } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { classifyAndHashRoot } from "../../fixtures/artifactInventory.js";
import { asarHeaderBytes } from "../../fixtures/asarHeader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";

const injected = vi.hoisted(() => ({
  opened: undefined as
    | ((path: unknown, handle: FileHandle) => void)
    | undefined,
}));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    open: async (...args: Parameters<typeof actual.open>) => {
      const handle = await actual.open(...args);
      injected.opened?.(args[0], handle);
      return handle;
    },
  };
});

it.each(
  [1, 2].flatMap((selectedOpen) =>
    [
      "failed close",
      "cancelled failed close",
      "cancelled closed",
      "failed read",
    ].map((outcome) => ({ selectedOpen, outcome })),
  ),
)(
  "retains completed root identity at open $selectedOpen through $outcome",
  async ({ selectedOpen, outcome }) => {
    const root = await realpath(
      await createTestTempDirectory("rea-root-completed-cleanup-"),
    );
    const path = join(root, "payload.bin");
    const bytes = Buffer.from("completed selected root bytes");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(path, bytes);
    const client = new ArtifactProvider({}).createClient({
      path,
      sourcePath: path,
      sha256,
      kind: "artifact",
      format: "javascript",
    });
    const controller = new AbortController();
    const reason = { source: "root descriptor finalization" };
    const physical = Object.assign(new Error("physical root read failed"), {
      code: "EIO",
      errno: -5,
      syscall: "read",
    });
    let opened = 0;
    let descriptor: FileHandle | undefined;
    let blocked = outcome !== "cancelled closed";
    injected.opened = (candidate, file) => {
      if (String(candidate) !== path || ++opened !== selectedOpen) return;
      descriptor = file;
      if (outcome === "failed read")
        vi.spyOn(file, "read").mockRejectedValueOnce(physical);
      const close = file.close.bind(file);
      vi.spyOn(file, "close").mockImplementation(async () => {
        if (outcome !== "failed close") controller.abort(reason);
        if (blocked) throw new Error("root descriptor close denied");
        await close();
      });
    };
    onTestFinished(async () => {
      injected.opened = undefined;
      blocked = false;
      await client.close();
      vi.restoreAllMocks();
    });
    const result = await client.execute(
      "inventory_artifact",
      {},
      { signal: controller.signal },
    );
    if (result.ok) throw new Error("Expected root finalization failure");
    expect(result.error.partialObservation).toEqual(
      outcome === "failed read"
        ? undefined
        : { kind: "file-snapshot-hash", path, sha256, bytes: bytes.length },
    );
    expect(
      projectAnalysisError(result.error).details?.partial_observation,
    ).toEqual(result.error.partialObservation);
    if (outcome.startsWith("cancelled")) {
      expect(result.error).toMatchObject({
        reason: "cancelled",
        cause: reason,
      });
    } else if (outcome === "failed read") {
      expect(result.error).toMatchObject({
        reason: "io",
        detail: expect.stringContaining(physical.message),
        cause: { cause: { cause: physical } },
      });
    }
    expect(result.error.cleanupIncomplete).toBe(blocked);
    if (blocked) {
      expect((await client.close()).ok).toBe(false);
      expect(descriptor!.fd).toBeGreaterThanOrEqual(0);
      blocked = false;
    }
    expect((await client.close()).ok).toBe(true);
    expect(descriptor!.fd).toBe(-1);
    expect(result.error.cleanupIncomplete).toBe(false);
  },
);

it.each([false, true])(
  "preserves root admission failure and close authority (invalidated=%s)",
  async (invalidated) => {
    const root = await createTestTempDirectory("rea-root-admission-cleanup-");
    const path = join(root, "payload.bin");
    await writeFile(path, "selected bytes");
    const client = new ArtifactProvider({}).createClient({
      path,
      sourcePath: path,
      sha256: "0".repeat(64),
      kind: "artifact",
      format: "javascript",
    });
    let descriptor: FileHandle | undefined;
    let closeAttempts = 0;
    let blocked = true;
    injected.opened = (openedPath, handle) => {
      if (openedPath !== path || descriptor !== undefined) return;
      descriptor = handle;
      const close = handle.close.bind(handle);
      vi.spyOn(handle, "stat").mockRejectedValueOnce(
        Object.assign(new Error("primary admission stat failure"), {
          code: "EIO",
          errno: -5,
          syscall: "fstat",
        }),
      );
      vi.spyOn(handle, "close").mockImplementation(async () => {
        closeAttempts += 1;
        if (invalidated) await close();
        if (blocked) throw new Error("descriptor cleanup outcome unavailable");
        await close();
      });
    };
    onTestFinished(async () => {
      injected.opened = undefined;
      blocked = false;
      await client.close();
      vi.restoreAllMocks();
    });

    const inventory = await client.execute("inventory_artifact", {});
    expect(inventory).toMatchObject({
      ok: false,
      error: {
        reason: "io",
        detail: expect.stringContaining("primary admission stat failure"),
        cleanup: {
          resources: [expect.stringContaining(path)],
          reason: "descriptor cleanup outcome unavailable",
        },
      },
    });
    expect(descriptor).toBeDefined();
    expect((await client.close()).ok).toBe(false);
    const attemptsBeforeRecovery = closeAttempts;
    blocked = false;
    const recovery = await client.close();
    expect(recovery.ok).toBe(!invalidated);
    expect(closeAttempts).toBe(
      invalidated ? attemptsBeforeRecovery : attemptsBeforeRecovery + 1,
    );
    expect(descriptor?.fd).toBe(-1);
    if (!invalidated && !inventory.ok)
      expect(inventory.error.cleanupIncomplete).toBe(false);
    if (invalidated) expect(closeAttempts).toBe(1);
  },
);

it("classifies root ASAR, UDIF and raw DMG signatures across controlled short reads at both boundaries and closes the descriptor", async () => {
  const root = await createTestTempDirectory("rea-root-short-read-signature-");
  const compactPath = join(root, "compact.asar");
  const asarPath = join(root, "whitespace.asar");
  const dmgPath = join(root, "trailer.dmg");
  const asarBytes = asarHeaderBytes(
    `${" ".repeat(9_000)}\t\r\n${JSON.stringify({ files: {} })}`,
  );
  const dmgBytes = Buffer.alloc(1_024);
  const compactBytes = asarHeaderBytes(JSON.stringify({ files: {} }));
  dmgBytes.write("koly", dmgBytes.length - 512);
  const rawDmgPath = join(root, "raw.dmg");
  const rawDmgBytes = Buffer.alloc(4_096);
  rawDmgBytes.write("EFI PART", 512, "ascii");
  rawDmgBytes.writeUInt32LE(0x0001_0000, 520);
  rawDmgBytes.writeUInt32LE(92, 524);
  await writeFile(rawDmgPath, rawDmgBytes);
  await writeFile(asarPath, asarBytes);
  await writeFile(compactPath, compactBytes);
  await writeFile(dmgPath, dmgBytes);
  let openedPaths: readonly string[] = [];
  const descriptors: FileHandle[] = [];
  let largestActualRead = 0;
  injected.opened = (candidate, handle) => {
    if (typeof candidate !== "string" || !openedPaths.includes(candidate))
      return;
    descriptors.push(handle);
    const nativeRead = handle.read.bind(handle);
    const readAtMostThreeBytes = async (
      buffer: Buffer,
      offset: number,
      length: number,
      position: number | null,
    ) => {
      const boundedLength = Math.min(length, 3);
      largestActualRead = Math.max(largestActualRead, boundedLength);
      return nativeRead(buffer, offset, boundedLength, position);
    };
    vi.spyOn(handle, "read").mockImplementation(
      readAtMostThreeBytes as FileHandle["read"],
    );
  };
  onTestFinished(() => {
    injected.opened = undefined;
    vi.restoreAllMocks();
  });

  for (const [path, bytes, format] of [
    [compactPath, compactBytes, "asar"],
    [asarPath, asarBytes, "asar"],
    [dmgPath, dmgBytes, "dmg"],
    [rawDmgPath, rawDmgBytes, "dmg"],
  ] as const) {
    // Target admission opens the canonical path; inventory opens the input.
    openedPaths = [path, await realpath(path)];
    descriptors.length = 0;
    largestActualRead = 0;
    const result = await classifyAndHashRoot(path, false, await lstat(path));
    expect(result.format).toBe(format);
    expect(result.digest?.sha256).toBe(
      createHash("sha256").update(bytes).digest("hex"),
    );
    if (format === "asar")
      expect(result.digest?.asarHeader).toMatchObject({ state: "matched" });
    expect(largestActualRead).toBeLessThanOrEqual(3);
    expect(descriptors).toHaveLength(1);
    expect(descriptors[0]?.fd).toBe(-1);

    // Target admission must observe the same signature under short reads.
    descriptors.length = 0;
    largestActualRead = 0;
    expect(await parseBinaryTarget(path)).toMatchObject({
      ok: true,
      value: { format },
    });
    expect(descriptors.length).toBeGreaterThan(0);
    expect(largestActualRead).toBeGreaterThan(0);
    expect(largestActualRead).toBeLessThanOrEqual(3);
  }
});
