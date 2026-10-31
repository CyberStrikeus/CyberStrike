import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { artifactExtractionResultSchema } from "../../src/domain/artifactGraph.js";
import { artifactInspectionResultSchema } from "../../src/domain/artifactInspection.js";
import { parseEvidence } from "../../src/domain/evidence.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";
import { createSingleEntryZip } from "../fixtures/zipNames.js";

it("refuses changed admitted archives over stdio MCP before publishing extraction and accepts an explicit reopen", async () => {
  const root = await createTestTempDirectory("rea-admitted-archive-mcp-");
  const temporary = join(root, "temporary");
  await mkdir(temporary);
  const path = join(root, "selected.zip");
  const writeArchive = async (value: string) => {
    const bytes = await createSingleEntryZip("payload.txt", value);
    await writeFile(path, bytes);
    return createHash("sha256").update(bytes).digest("hex");
  };
  const initialDigest = await writeArchive("admitted version one");
  const { call } = await connectLocalToolsMcp({
    TMPDIR: temporary,
    TEMP: temporary,
    TMP: temporary,
    REA_MCP_TOOL_FAMILIES: "session,artifact",
  });
  expect((await call("open_binary", { path })).isError).not.toBe(true);
  const inspect = async (digest: string, payload: string) => {
    const inspected = await call("inspect_artifact", { detail: "complete" });
    expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
    const evidence = parseEvidence(inspected.structuredContent);
    expect(evidence.subject?.digest.sha256).toBe(digest);
    const inspection = artifactInspectionResultSchema.parse(
      evidence.normalized_result,
    );
    expect(inspection.subject).toMatchObject({
      root_sha256: digest,
      root_format: "zip",
    });
    const inventoryStep = inspection.substeps.find(
      (substep) => substep.operation === "inventory_artifact",
    );
    expect(inventoryStep).toBeDefined();
    if (inventoryStep === undefined)
      throw new Error("Missing inventory substep");
    const inventory = inventoryStep.evidence.normalized_result;
    const member = inventory.occurrences.find(
      (occurrence) => occurrence.logical_path === "payload.txt",
    );
    expect(member).toBeDefined();
    expect(
      inventory.nodes.find(
        (artifact) => artifact.artifact_id === member?.artifact_id,
      )?.sha256,
    ).toBe(createHash("sha256").update(payload).digest("hex"));
    return evidence;
  };
  const initial = await inspect(initialDigest, "admitted version one");
  const openedTemporaryBaseline = (await readdir(temporary)).sort();
  const changedDigest = await writeArchive("changed version two");
  for (const operation of ["inspect_artifact", "extract_artifact"]) {
    const refused = parseMcpToolError(await call(operation, {}));
    expect(refused.error).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "integrity" },
      message: expect.stringContaining("Reopen the selected artifact"),
    });
    expect((await readdir(temporary)).sort()).toEqual(openedTemporaryBaseline);
  }
  expect((await call("open_binary", { path })).isError).not.toBe(true);
  const reopened = await inspect(changedDigest, "changed version two");
  expect(reopened.evidence_id).not.toBe(initial.evidence_id);
  const extracted = await call("extract_artifact", {});
  expect(extracted.isError, JSON.stringify(extracted)).not.toBe(true);
  const result = artifactExtractionResultSchema.parse(
    parseEvidence(extracted.structuredContent).normalized_result,
  );
  try {
    expect(dirname(result.output_root)).toBe(temporary);
    expect(
      await readFile(join(result.output_root, "payload.txt"), "utf8"),
    ).toBe("changed version two");
  } finally {
    await rm(result.output_root, { recursive: true, force: true });
  }
  const reopenedTemporaryBaseline = (await readdir(temporary)).sort();
  await writeFile(path, "not an archive");
  for (const operation of ["inspect_artifact", "extract_artifact"]) {
    const refused = parseMcpToolError(await call(operation, {}));
    expect(refused.error).toMatchObject({
      code: "artifact_operation_failed",
      details: { reason: "integrity" },
    });
    expect((await readdir(temporary)).sort()).toEqual(
      reopenedTemporaryBaseline,
    );
  }
});
