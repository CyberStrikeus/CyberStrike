import { createHash } from "node:crypto";
import { truncate, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { parseBinaryTarget } from "../../../src/application/BinaryTargetResolver.js";
import { buildGamecubeDol } from "../../../src/domain/gamecubeDol.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe("gamecube-dol admission", () => {
  it("admits an explicitly selected DOL as big-endian 32-bit powerpc", async () => {
    const directory = await createTestTempDirectory("rea-dol-admit-");
    const bytes = buildGamecubeDol();
    await writeFile(join(directory, "game.dol"), bytes);
    const target = await parseBinaryTarget("game.dol", {
      cwd: directory,
      formatHint: "gamecube-dol",
    });
    expect(target).toMatchObject({
      ok: true,
      value: {
        kind: "executable",
        format: "gamecube-dol",
        architecture: "powerpc",
        availableArchitectures: ["powerpc"],
        byteOrder: "big",
        bits: 32,
        entryPoint: "0x80003100",
        entryPointSource: "dol-header",
        sha256: createHash("sha256").update(bytes).digest("hex"),
        dol: { entryPoint: 0x8000_3100, bssOverlaps: [] },
      },
    });
  });

  it("refuses a caller architecture that conflicts with the DOL header", async () => {
    const directory = await createTestTempDirectory("rea-dol-arch-");
    await writeFile(join(directory, "game.dol"), buildGamecubeDol());
    const target = await parseBinaryTarget("game.dol", {
      cwd: directory,
      formatHint: "gamecube-dol",
      architecture: "x86",
    });
    expect(target.ok).toBe(false);
    if (!target.ok)
      expect(target.error.message).toContain(
        "takes its architecture from the DOL header",
      );
  });

  it("refuses a caller entry that conflicts with the DOL header entry", async () => {
    const directory = await createTestTempDirectory("rea-dol-entry-");
    await writeFile(join(directory, "game.dol"), buildGamecubeDol());
    const target = await parseBinaryTarget("game.dol", {
      cwd: directory,
      formatHint: "gamecube-dol",
      entryPoint: "0x80003104",
    });
    expect(target.ok).toBe(false);
    if (!target.ok)
      expect(target).toMatchObject({
        error: { constraint: "load_selection_rejected" },
      });
  });

  it("refuses a selected file whose header fails parsing", async () => {
    const directory = await createTestTempDirectory("rea-dol-bad-");
    await writeFile(join(directory, "bad.dol"), Buffer.alloc(0x100));
    const target = await parseBinaryTarget("bad.dol", {
      cwd: directory,
      formatHint: "gamecube-dol",
    });
    expect(target.ok).toBe(false);
    if (!target.ok)
      expect(target).toMatchObject({
        error: {
          constraint: "file_format_rejected",
          message: expect.stringContaining("DOL has no used text section"),
        },
      });
  });

  it("refuses a large selected file with an invalid header after reading only the header", async () => {
    // Sparse: the 2 GiB length is a metadata extension, so no real disk is used.
    // A whole-file read would allocate the full length before the header check.
    const directory = await createTestTempDirectory("rea-dol-sparse-");
    const path = join(directory, "huge.dol");
    await writeFile(path, Buffer.alloc(0x100));
    await truncate(path, 2 * 1024 ** 3);
    const target = await parseBinaryTarget("huge.dol", {
      cwd: directory,
      formatHint: "gamecube-dol",
    });
    expect(target.ok).toBe(false);
    if (!target.ok)
      expect(target).toMatchObject({
        error: {
          constraint: "file_format_rejected",
          message: expect.stringContaining(
            "gamecube-dol header rejected: DOL has no used text section",
          ),
        },
      });
  });

  it("never auto-detects a DOL without the caller's format selection", async () => {
    const directory = await createTestTempDirectory("rea-dol-detect-");
    await writeFile(join(directory, "game.dol"), buildGamecubeDol());
    const target = await parseBinaryTarget("game.dol", { cwd: directory });
    if (target.ok) expect(target.value.format).not.toBe("gamecube-dol");
  });
});
