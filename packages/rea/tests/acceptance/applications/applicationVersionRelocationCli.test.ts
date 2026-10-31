import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { applicationVersionComparisonResultSchema } from "../../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest(
  "retains exact factory bytes and relocation while exposing unresolved chunk alignment",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-version-relocation-");
    const bundle =
      "globalThis.webpackChunkApp.push([[1], {11(module,exports){exports.value=11;},22(module,exports){exports.value=22;}}]);";
    const versions = [];
    for (const side of [1, 2]) {
      const application = join(root, String(side));
      await mkdir(application);
      await writeFile(
        join(application, "main.js"),
        `${side === 1 ? "" : "/* earlier bundle edit */\n"}${bundle}`,
      );
      const response = await cli.run({
        arguments: ["analyze-javascript-application", application, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      versions.push(parseEvidence(response.json));
    }
    const [left, right] = versions;
    if (left === undefined || right === undefined)
      throw new Error("Missing analyzed versions");
    const analyses = versions.map((value) =>
      javascriptApplicationAnalysisResultSchema.parse(value.normalized_result),
    );
    const modules = analyses.map((value) =>
      value.graph.nodes.filter(
        (node) =>
          node.kind === "javascript-module" &&
          node.observations.some(
            ({ properties }) => properties.module_key !== undefined,
          ),
      ),
    );
    expect(modules[0]).toHaveLength(2);
    expect(modules[1]).toHaveLength(2);
    const input = join(root, "comparison.json");
    await writeFile(input, JSON.stringify({ left, right }));
    const response = await cli.run({
      arguments: ["compare-application-versions", input, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    expect(result.coverage.status).toBe("complete-within-inputs");
    const moduleItems = result.items.filter((item) =>
      modules[0]?.some((node) => node.node_id === item.left_node_id),
    );
    expect(moduleItems).toHaveLength(2);
    for (const item of moduleItems) {
      expect(item).toMatchObject({
        status: "unknown",
        dimensions: ["location"],
        match: { basis: "exact-module-source-digest" },
      });
      expect(item.limitations.join(" ")).toMatch(
        /relationship.*identity.*unresolved/iu,
      );
      const a = modules[0]?.find((node) => node.node_id === item.left_node_id),
        b = modules[1]?.find((node) => node.node_id === item.right_node_id);
      expect(typeof a?.observations[0]?.properties.source_sha256).toBe(
        "string",
      );
      expect(a?.observations[0]?.properties.source_sha256).toBe(
        b?.observations[0]?.properties.source_sha256,
      );
      expect(a?.observations[0]?.evidence.location).not.toEqual(
        b?.observations[0]?.evidence.location,
      );
      expect(
        result.graph.nodes.find((node) => node.node_id === item.left_node_id),
      ).toEqual(a);
      expect(
        result.graph.nodes.find((node) => node.node_id === item.right_node_id),
      ).toEqual(b);
    }
    expect(result.summary.unknown).toBeGreaterThanOrEqual(2);
    expect(
      result.items.find((item) => item.node_kind === "javascript-asset"),
    ).toMatchObject({
      status: "changed",
      dimensions: expect.arrayContaining(["content"]),
    });
  },
);

cliTest(
  "preserves ambiguous imported factory identity through public version comparison",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-version-ambiguous-import-");
    const bundle =
      "globalThis.webpackChunkApp.push([[1], {11:function(module,exports,__webpack_require__){exports.value=__webpack_require__(22).value;},22:function(module,exports){exports.value=1;},33:function(module,exports){exports.value=1;}}]);";
    const versions = [];
    for (const side of [1, 2]) {
      const application = join(root, String(side));
      await mkdir(application);
      await writeFile(
        join(application, "main.js"),
        `${side === 1 ? "" : "/* shifted */\n"}${bundle}`,
      );
      const run = await cli.run({
        arguments: ["analyze-javascript-application", application, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(run.exitCode, run.stderr).toBe(0);
      versions.push(parseEvidence(run.json));
    }
    const [left, right] = versions;
    if (left === undefined || right === undefined)
      throw new Error("Missing versions");
    const analyses = versions.map((e) =>
      javascriptApplicationAnalysisResultSchema.parse(e.normalized_result),
    );
    const main = analyses[0]?.graph.nodes.find(
      (n) =>
        n.kind === "javascript-module" &&
        n.observations.some((o) => o.properties.module_key === "11"),
    );
    const peer = analyses[0]?.graph.nodes.find(
      (n) =>
        n.kind === "javascript-module" &&
        n.observations.some((o) => o.properties.module_key === "22"),
    );
    if (main === undefined || peer === undefined)
      throw new Error("Missing fixture factories");
    expect(analyses[0]?.graph.edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_node_id: main.node_id,
          target_node_id: peer.node_id,
          relation: "imports",
        }),
      ]),
    );
    const input = join(root, "compare.json");
    await writeFile(input, JSON.stringify({ left, right }));
    const run = await cli.run({
      arguments: ["compare-application-versions", input, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(run.exitCode, run.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(run.json).normalized_result,
    );
    const item = result.items.find((i) => i.left_node_id === main.node_id),
      target = result.items.find((i) => i.left_node_id === peer.node_id);
    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(item).toMatchObject({
      status: "unknown",
      match: { basis: "exact-module-source-digest", confidence: "exact" },
    });
    expect(item?.limitations.join(" ")).toMatch(
      /relationship.*identity.*unresolved/iu,
    );
    expect(target?.match).toMatchObject({ status: "ambiguous" });
    expect(target?.match.candidate_right_node_ids).toHaveLength(2);
  },
);
