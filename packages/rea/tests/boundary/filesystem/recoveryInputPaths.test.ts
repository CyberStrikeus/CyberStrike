import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { AnalysisInputError } from "../../../src/domain/analysisErrorCore.js";
import { snapshotRecoveryInputs } from "../../../src/javascript/recovery/RecoveryFiles.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it
  .skipIf(process.platform === "win32")
  .each(["cafe\u0301.js", "chunk\\name.js"])(
  "refuses an unsupported Wakaru multi-input spelling %s before snapshotting",
  async (name) => {
    const root = await createTestTempDirectory("rea-recovery-input-path-");
    const selected = join(root, name);
    const ordinary = join(root, "main.js");
    const staging = join(root, "snapshots");
    await writeFile(selected, "export const value = 'literal';");
    await writeFile(ordinary, "export const value = 'ordinary';");
    const slashDecoy = join(root, "chunk", "name.js");
    await mkdir(join(root, "chunk"));
    await writeFile(slashDecoy, "export const value = 'slash decoy';");
    await expect(
      snapshotRecoveryInputs([selected, ordinary], staging),
    ).rejects.toBeInstanceOf(AnalysisInputError);
    await expect(access(staging)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(selected, "utf8")).toBe(
      "export const value = 'literal';",
    );
    expect(await readFile(ordinary, "utf8")).toBe(
      "export const value = 'ordinary';",
    );
    expect(await readFile(slashDecoy, "utf8")).toBe(
      "export const value = 'slash decoy';",
    );
  },
);

it.skipIf(process.platform === "win32")(
  "keeps ordinary slash layout and safely renames a single literal input",
  async () => {
    const root = await createTestTempDirectory("rea-recovery-input-path-");
    const literal = join(root, "chunk\\name.js");
    const slash = join(root, "chunk", "name.js");
    const main = join(root, "main.js");
    await mkdir(join(root, "chunk"));
    await writeFile(literal, "export const value = 'literal';");
    await writeFile(slash, "export const value = 'slash';");
    await writeFile(main, "export const value = 'main';");
    const single = await snapshotRecoveryInputs(
      [literal],
      join(root, "single"),
    );
    expect(single[0].relative_path).toBe("bundle.js");
    expect(await readFile(single[0].snapshot_path, "utf8")).toBe(
      "export const value = 'literal';",
    );
    const multiple = await snapshotRecoveryInputs(
      [main, slash],
      join(root, "multiple"),
    );
    expect(multiple.map(({ relative_path }) => relative_path)).toEqual([
      "main.js",
      "chunk/name.js",
    ]);
    expect(await readFile(multiple[1]?.snapshot_path ?? "", "utf8")).toBe(
      "export const value = 'slash';",
    );
    expect(await readFile(literal, "utf8")).toBe(
      "export const value = 'literal';",
    );
  },
);
