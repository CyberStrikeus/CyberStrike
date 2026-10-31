import { execFile } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

import { expect, it } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);

it("reports partial JavaScript request targets through the public CLI", async () => {
  const root = await createTestTempDirectory("rea-js-partial-endpoints-cli-");
  await writeFile(
    join(root, "main.js"),
    "fetch(target); fetch('target'); fetch(`https://${hosts['a@b']}/items/${id}`); function other(target) { fetch(target); }",
  );
  const { stdout } = await execute(
    process.execPath,
    ["scripts/rea.mjs", "analyze-javascript-application", root, "--json"],
    { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 },
  );
  const result = javascriptApplicationAnalysisResultSchema.parse(
    parseEvidence(JSON.parse(stdout)).normalized_result,
  );
  const endpoints = result.graph.nodes.filter(
    ({ kind }) => kind === "endpoint",
  );
  const partial = endpoints.flatMap(({ observations, node_id }) =>
    observations
      .filter(({ properties }) => properties.resolution === "partial")
      .map((observation) => ({ node_id, ...observation })),
  );

  expect(partial.map(({ properties }) => properties.value).sort()).toEqual([
    "`https://${hosts['a@b']}/items/${id}`",
    "target",
    "target",
  ]);
  expect(new Set(partial.map(({ node_id }) => node_id)).size).toBe(3);
  expect(
    partial.find(({ properties }) => properties.value === "target")?.evidence,
  ).toMatchObject({
    authority: "ast-static-analysis",
    state: "observed",
    limitations: [expect.stringContaining("not an exact literal")],
  });
  expect(
    endpoints.some(({ observations }) =>
      observations.some(
        ({ properties }) =>
          properties.value === "target" && properties.resolution === undefined,
      ),
    ),
  ).toBe(true);
}, 20_000);
