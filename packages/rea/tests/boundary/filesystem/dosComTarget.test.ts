import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("DOS COM admission", () => {
  it("requires explicit interpretation even when a DOS COM uses a misleading suffix", async () => {
    const directory = await createTestTempDirectory("rea-com-target-");
    const path = join(directory, "fixture.js");
    const bytes = Buffer.from("b83412c3", "hex");
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "arm64",
      formatHint: "dos-com",
    });
    expect(target).toMatchObject({
      ok: true,
      value: {
        path,
        format: "dos-com",
        kind: "executable",
        architecture: "x86",
        availableArchitectures: ["x86"],
        sha256: createHash("sha256").update(bytes).digest("hex"),
      },
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
    const detected = await parseBinaryTarget(path);
    expect(detected.ok && detected.value.format).not.toBe("dos-com");
  });
  it.each([0, 0xff01])("rejects invalid file extent %i", async (length) => {
    const directory = await createTestTempDirectory("rea-com-target-");
    const path = join(directory, "fixture.com");
    await writeFile(path, Buffer.alloc(length));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        formatHint: "dos-com",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "BinaryTargetError" } });
  });
  it.each([1, 0xff00])("admits the actual file extent %i", async (length) => {
    const directory = await createTestTempDirectory("rea-com-target-");
    const path = join(directory, "fixture.com");
    const bytes = Buffer.alloc(length, 0xc3);
    await writeFile(path, bytes);
    const target = await parseBinaryTarget(path, {
      cwd: directory,
      hostArchitecture: "x64",
      formatHint: "dos-com",
    });
    if (!target.ok) throw target.error;
    expect(target.value).toMatchObject({
      format: "dos-com",
      architecture: "x86",
      sha256: createHash("sha256").update(bytes).digest("hex"),
    });
    expect(Buffer.compare(await readFile(path), bytes)).toBe(0);
  });
  it("rejects contradictory target kind", async () => {
    const directory = await createTestTempDirectory("rea-com-target-");
    const path = join(directory, "fixture.com");
    await writeFile(path, Buffer.from("c3", "hex"));
    expect(
      await parseBinaryTarget(path, {
        cwd: directory,
        hostArchitecture: "x64",
        targetKind: "database",
        formatHint: "dos-com",
      }),
    ).toMatchObject({ ok: false, error: { _tag: "BinaryTargetError" } });
  });
});
