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

const execute = promisify(execFile);
const cli = fileURLToPath(new URL("../../scripts/rea.mjs", import.meta.url));
const plist =
  '<?xml version="1.0"?><plist version="1.0"><dict><key>label</key><string>hello</string></dict></plist>';

it("compares identical complete plist inventories across CLI and MCP and creates no unknowns", async () => {
  const root = await createTestTempDirectory("rea-plist-compare-acceptance-");
  const leftPath = join(root, "left.plist");
  const rightPath = join(root, "right.plist");
  await Promise.all([writeFile(leftPath, plist), writeFile(rightPath, plist)]);

  const cliResult = await execute(process.execPath, [
    cli,
    "inspect-artifact",
    leftPath,
    "--json",
  ]);
  const cliEvidence = parseEvidence(JSON.parse(cliResult.stdout));
  const cliInspection = artifactInspectionResultSchema.parse(
    cliEvidence.normalized_result,
  );
  const cliInventory = cliInspection.substeps[0]?.evidence;
  if (cliInventory === undefined)
    throw new Error("CLI inspection did not retain inventory Evidence");
  expect(cliInventory.normalized_result).toMatchObject({
    coverage: { scope: "root", status: "complete" },
    limitations: [
      "Inventory covers root bytes only; child container entries were not examined.",
    ],
  });

  const { call } = await connectLocalToolsMcp();
  const opened = await call("open_binary", { path: rightPath });
  expect(opened.isError, JSON.stringify(opened)).not.toBe(true);
  const inspected = await call("inspect_artifact", {});
  expect(inspected.isError, JSON.stringify(inspected)).not.toBe(true);
  const mcpEvidence = parseEvidence(inspected.structuredContent);
  const mcpInspection = artifactInspectionResultSchema.parse(
    mcpEvidence.normalized_result,
  );
  const mcpInventory = mcpInspection.substeps[0]?.evidence;
  if (mcpInventory === undefined)
    throw new Error("MCP inspection did not retain inventory Evidence");
  expect(mcpInventory.normalized_result).toMatchObject({
    coverage: { scope: "root", status: "complete" },
    limitations: [
      "Inventory covers root bytes only; child container entries were not examined.",
    ],
  });

  const compared = await call("compare_artifacts", {
    left: cliEvidence,
    right: mcpEvidence,
  });
  expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
  const comparison = parseEvidence(compared.structuredContent);
  expect(comparison.normalized_result).toMatchObject({
    status: "unchanged",
    summary: { unchanged: 1, unknown: 0 },
    changes: [],
  });

  const verified = await call("verify_reconstruction", {
    specification: {
      name: "Inspected artifact structures agree",
      claims: [
        {
          claim_id: "inspected-artifact",
          title: "The inspected artifact structures agree",
          kind: "structural-artifact",
          dimension: "overall",
          comparison_evidence_id: comparison.evidence_id,
        },
      ],
    },
  });
  expect(verified.isError, JSON.stringify(verified)).not.toBe(true);
  expect(verified.structuredContent).toMatchObject({
    normalized_result: {
      status: "pass",
      claims: {
        items: [
          {
            status: "pass",
            observed_status: "unchanged",
            evidence_links: expect.arrayContaining([
              cliEvidence.evidence_id,
              mcpEvidence.evidence_id,
              comparison.evidence_id,
            ]),
          },
        ],
      },
    },
  });

  const behavior = await call("find_changed_behavior", {
    comparisons: [comparison],
  });
  expect(behavior.isError, JSON.stringify(behavior)).not.toBe(true);
  expect(behavior.structuredContent).toMatchObject({
    normalized_result: {
      behavior_status: "unknown",
      findings: { items: [] },
    },
  });
  const unknowns = await call("list_unknowns", {
    domain: "artifact-comparison",
  });
  expect(unknowns.isError, JSON.stringify(unknowns)).not.toBe(true);
  expect(unknowns.structuredContent).toMatchObject({ result: { items: [] } });
});
