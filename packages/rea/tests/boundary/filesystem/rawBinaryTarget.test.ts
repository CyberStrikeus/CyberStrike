import { createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("raw-binary admission", () => {
  it("preserves the requested raw path for Windows reparse admission", async () => {
    const directory = await createTestTempDirectory("rea-raw-linked-");
    const actual = join(directory, "actual");
    const linked = join(directory, "linked");
    await mkdir(actual);
    const bytes = Buffer.from("a90160", "hex");
    await writeFile(join(actual, "fixture.bin"), bytes);
    await symlink(
      actual,
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );
    const requested = join(linked, "fixture.bin");
    const canonical = await realpath(requested);
    const target = await parseBinaryTarget("linked/fixture.bin", {
      cwd: directory,
      formatHint: "raw-binary",
      architecture: "6502",
      entryPoint: "0x8000",
    });
    expect(target).toMatchObject({
      ok: true,
      value: {
        path: canonical,
        sourcePath: process.platform === "win32" ? requested : canonical,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        format: "raw-binary",
        architecture: "6502",
      },
    });
  });
  it("requires explicit architecture and entry even with a misleading suffix", async () => {
    const directory = await createTestTempDirectory("rea-raw-target-");
    const path = join(directory, "fixture.js");
    const bytes = Buffer.from("1eff2fe1", "hex");
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "arm64",
      formatHint: "raw-binary",
      architecture: "arm",
      entryPoint: "0x08000000",
    });
    expect(target).toMatchObject({
      ok: true,
      value: {
        path,
        format: "raw-binary",
        kind: "executable",
        architecture: "arm",
        availableArchitectures: ["arm"],
        entryPoint: "0x8000000",
        entryPointSource: "0x08000000",
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    const detected = await parseBinaryTarget(path);
    expect(detected.ok && detected.value.format).not.toBe("raw-binary");
  });
  it("rejects raw-binary without architecture and entry", async () => {
    const directory = await createTestTempDirectory("rea-raw-missing-");
    const path = join(directory, "fixture.bin");
    await writeFile(path, Buffer.from("c3", "hex"));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        formatHint: "raw-binary",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        reason: expect.stringContaining("architecture"),
      },
    });
  });
  it("rejects architecture without format=raw-binary", async () => {
    const directory = await createTestTempDirectory("rea-raw-unpaired-");
    const path = join(directory, "fixture.bin");
    await writeFile(path, Buffer.from("c3", "hex"));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        architecture: "arm",
        entryPoint: "0x8000000",
      }),
    ).toMatchObject({
      ok: false,
      error: {
        _tag: "BinaryTargetError",
        reason: expect.stringContaining("format=raw-binary"),
      },
    });
  });
  it("rejects an empty image", async () => {
    const directory = await createTestTempDirectory("rea-raw-empty-");
    const path = join(directory, "fixture.bin");
    await writeFile(path, Buffer.alloc(0));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        formatHint: "raw-binary",
        architecture: "x86",
        entryPoint: "0x1000",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "BinaryTargetError" } });
  });
  it("rejects a contradictory target kind", async () => {
    const directory = await createTestTempDirectory("rea-raw-kind-");
    const path = join(directory, "fixture.bin");
    await writeFile(path, Buffer.from("c3", "hex"));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        targetKind: "database",
        formatHint: "raw-binary",
        architecture: "x86",
        entryPoint: "0x1000",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "BinaryTargetError" } });
  });
});
