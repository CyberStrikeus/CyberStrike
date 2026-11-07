import { TextReader, Uint8ArrayWriter, ZipWriter } from "@zip.js/zip.js";
import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it } from "vitest";

import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const cli = fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url));
const execute = promisify(execFile);

it("keeps observed entry differences when content identity is unknown", async () => {
  const root = await createTestTempDirectory("rea-artifact-unavailable-");
  const inspect = async (name: string, mode: number, content: string) => {
    const writer = new ZipWriter(new Uint8ArrayWriter(), {
      useWebWorkers: false,
    });
    await writer.add("entry", new TextReader(content), { unixMode: mode });
    const path = join(root, `${name}.zip`);
    await writeFile(path, Buffer.from(await writer.close()));
    const result = await execute(process.execPath, [
      cli,
      "inspect-artifact",
      path,
      "--detail",
      "complete",
      "--json",
    ]);
    const inspection = artifactInspectionResultSchema.parse(
      parseEvidence(JSON.parse(result.stdout)).normalized_result,
    );
    const inventory = inspection.substeps.find(
      ({ operation }) => operation === "inventory_artifact",
    )?.evidence;
    if (inventory === undefined) throw new Error("Missing inventory Evidence");
    return parseEvidence(inventory);
  };
  const symlink = await inspect("symlink", 0o120777, "target.txt");
  const executable = await inspect("executable", 0o100755, "target\n");
  const plain = await inspect("plain", 0o100644, "target\n");
  const { call } = await connectLocalToolsMcp();
  const compare = async (left: typeof symlink, right: typeof symlink) => {
    const response = await call("compare_artifacts", { left, right });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    return parseEvidence(response.structuredContent).normalized_result as {
      status: string;
      changes: {
        logical_path: string;
        classification: string;
        dimensions: string[];
        left_occurrence_id: string | null;
        right_occurrence_id: string | null;
      }[];
    };
  };
  for (const [left, right] of [
    [symlink, executable],
    [executable, symlink],
  ] as const) {
    const result = await compare(left, right);
    expect(result.status).toBe("unknown");
    const entry = result.changes.find(
      ({ logical_path }) => logical_path === "entry",
    );
    expect(entry?.dimensions).not.toContain("relations");
    expect(entry).toMatchObject({
      classification: "unknown",
      dimensions: expect.arrayContaining([
        "executable",
        "metadata",
        "availability",
      ]),
      left_occurrence_id: expect.any(String),
      right_occurrence_id: expect.any(String),
    });
  }
  expect((await compare(symlink, symlink)).status).toBe("unknown");
  expect(
    (await compare(executable, plain)).changes.find(
      ({ logical_path }) => logical_path === "entry",
    ),
  ).toMatchObject({ classification: "changed", dimensions: ["executable"] });
  expect((await compare(executable, executable)).status).toBe("unchanged");
});
