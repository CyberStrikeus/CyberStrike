import { writeFile, stat, open } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { GodotPckArtifactReader } from "../../../src/artifacts/GodotPckArtifactReader.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { buildGodotPck, pckU64 } from "../../fixtures/godotPck.js";
import {
  scanArtifactInventory,
  materializeArtifactInventory,
} from "../../fixtures/artifactInventory.js";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { elf } from "../../../src/domain/binaryTarget.fixture.js";

it.each(
  [true, false].flatMap((matchingDigest) =>
    ["stable", "changed", "unavailable", "read failure"].map((sourceState) => ({
      matchingDigest,
      sourceState,
    })),
  ),
)(
  "preserves verified carrier binding through final cancellation (matching=$matchingDigest, source=$sourceState)",
  async ({ matchingDigest, sourceState }) => {
    const root = await createTestTempDirectory("rea-pck-binding-finalization-");
    const path = join(root, "game.pck");
    const bytes = buildGodotPck(4, [
      { path: "res://main.gd", data: "extends Node\n" },
    ]);
    await writeFile(path, bytes);
    const handle = await open(path);
    const initial = await handle.stat();
    const observedSha256 = createHash("sha256").update(bytes).digest("hex");
    const expectedSha256 = matchingDigest ? observedSha256 : "0".repeat(64);
    const controller = new AbortController();
    const reason = { stage: "carrier final source validation" };
    const physical = Object.assign(
      new Error("carrier source I/O unavailable"),
      { code: "EIO" },
    );
    const nativeStat = handle.stat.bind(handle);
    let validations = 0;
    vi.spyOn(handle, "stat").mockImplementation(async () => {
      const observed = await nativeStat();
      if (++validations === 2) {
        controller.abort(reason);
        if (sourceState === "unavailable") throw physical;
        if (sourceState === "changed") observed.ino += 1;
      }
      return observed;
    });
    if (sourceState === "read failure")
      vi.spyOn(handle, "read").mockImplementationOnce(async () => {
        controller.abort(reason);
        throw physical;
      });
    const reader = new GodotPckArtifactReader(path, { handle, initial });
    try {
      const failure: unknown = await reader
        .prepareContainer(expectedSha256, controller.signal)
        .catch((cause: unknown) => cause);
      expect(controller.signal.reason).toBe(reason);
      if (sourceState === "unavailable" || sourceState === "read failure")
        expect(failure).toBe(physical);
      else if (sourceState === "changed")
        expect(failure).toMatchObject({
          reason: "integrity",
          details: undefined,
          message: expect.stringContaining("source identity changed"),
        });
      else if (matchingDigest)
        expect(failure).toMatchObject({ reason: "cancelled", cause: reason });
      else
        expect(failure).toMatchObject({
          reason: "integrity",
          details: {
            declaredSha256: expectedSha256,
            calculatedSha256: observedSha256,
          },
        });
      await reader.close();
      // The admitted descriptor is borrowed; only its original caller closes it.
      expect(handle.fd).toBeGreaterThanOrEqual(0);
    } finally {
      await reader.close();
      await handle.close();
      vi.restoreAllMocks();
    }
  },
);

it("binds extraction to the original carrier even if a changed directory names identical payloads", async () => {
  const root = await createTestTempDirectory("rea-pck-extraction-identity-");
  const source = join(root, "game.pck");
  const bytes = buildGodotPck(4, [{ path: "res://a.txt", data: "unchanged" }]);
  await writeFile(source, bytes);
  const snapshot = await scanArtifactInventory(source);
  // A version field changes the carrier identity without changing any member's
  // path, length or bytes. Per-member SHA-256 checks alone cannot detect this.
  bytes.writeUInt32LE(7, 12);
  await writeFile(source, bytes);
  const output = join(root, "out");
  await expect(
    materializeArtifactInventory(
      {
        inputPath: source,
        inputFormat: "godot-pck",
        outputRoot: output,
        environment: {},
        integrityPolicy: "fail",
      },
      source,
      snapshot,
    ),
  ).rejects.toMatchObject({ reason: "integrity" });
  await expect(stat(output)).rejects.toMatchObject({ code: "ENOENT" });
});

it("preserves native defaults and explicit native selection for embedded carriers", async () => {
  const root = await createTestTempDirectory("rea-pck-native-selection-");
  const source = join(root, "game.x86_64");
  const pack = buildGodotPck(4, [{ path: "res://a.txt", data: "a" }]);
  await writeFile(
    source,
    Buffer.concat([
      elf(2, 1, 62),
      pack,
      pckU64(pack.length),
      Buffer.from("GDPC"),
    ]),
  );
  expect(await parseBinaryTarget(source)).toMatchObject({
    ok: true,
    value: { kind: "executable", format: "elf" },
  });
  expect(
    await parseBinaryTarget(source, { targetKind: "executable" }),
  ).toMatchObject({
    ok: true,
    value: { kind: "executable", format: "elf", architecture: "x86_64" },
  });
});
