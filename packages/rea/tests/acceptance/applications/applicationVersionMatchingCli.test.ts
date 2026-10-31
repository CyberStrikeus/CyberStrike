import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { applicationVersionComparisonResultSchema } from "../../../src/domain/javascript/javascriptApplicationVersionComparisonSchemas.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest, runFileCli } from "../../support/cli/cliFixture.js";

cliTest(
  "keeps unavailable source-selection scopes unknown in version comparisons",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-version-scope-");
    const application = join(root, "application");
    const copy = join(root, "copy");
    await Promise.all([mkdir(application), mkdir(copy)]);
    const files = [
      ["lib.js", "export function shared() { return 1; }\n"],
      ["main.js", 'export const name = "one";\n'],
    ] as const;
    for (const [name, contents] of files) {
      await Promise.all([
        writeFile(join(application, name), contents),
        writeFile(join(copy, name), contents),
      ]);
    }

    const analyze = async (input: string, selected: boolean) => {
      const response = await cli.run({
        arguments: [
          "analyze-javascript-application",
          input,
          ...(selected ? ["--source-path", "main.js"] : []),
          "--json",
        ],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      return parseEvidence(response.json);
    };
    const full = await analyze(application, false);
    const selected = await analyze(application, true);
    const fullCopy = await analyze(copy, false);
    const selectedAnalysis = javascriptApplicationAnalysisResultSchema.parse(
      selected.normalized_result,
    );
    const parseScope = selectedAnalysis.graph.nodes.find(
      ({ kind, observations }) =>
        kind === "unknown" &&
        observations.some(
          ({ properties }) =>
            properties.path === "lib.js" &&
            properties.operation === "select-javascript-sources",
        ),
    );
    expect(parseScope?.observations[0]?.evidence).toMatchObject({
      state: "unavailable",
      limitations: [
        "Source is outside the caller-selected source_paths; it was inventoried but not analyzed.",
      ],
    });

    const compare = async (
      left: ReturnType<typeof parseEvidence>,
      right: ReturnType<typeof parseEvidence>,
      name: string,
    ) => {
      const inputPath = join(root, `${name}.json`);
      await writeFile(inputPath, JSON.stringify({ left, right }));
      const response = await runFileCli(cli, {
        arguments: ["compare-application-versions", inputPath, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      return applicationVersionComparisonResultSchema.parse(
        parseEvidence(response.json).normalized_result,
      );
    };
    const forward = await compare(full, selected, "forward");
    const reverse = await compare(selected, full, "reverse");
    const unchangedCopy = await compare(full, fullCopy, "full-copy");

    expect(
      forward.items.find(
        ({ right_node_id }) => right_node_id === parseScope?.node_id,
      ),
    ).toMatchObject({
      status: "unknown",
      dimensions: ["availability"],
      limitations: [
        "Source is outside the caller-selected source_paths; it was inventoried but not analyzed.",
      ],
      evidence_links: expect.arrayContaining([
        full.evidence_id,
        selected.evidence_id,
      ]),
    });
    expect(
      reverse.items.find(
        ({ left_node_id }) => left_node_id === parseScope?.node_id,
      ),
    ).toMatchObject({
      status: "unknown",
      dimensions: ["availability"],
      limitations: [
        "Source is outside the caller-selected source_paths; it was inventoried but not analyzed.",
      ],
    });
    expect(forward.summary.added).toBe(0);
    expect(forward.summary.removed).toBe(0);
    expect(reverse.summary.added).toBe(0);
    expect(reverse.summary.removed).toBe(0);
    expect(unchangedCopy.summary).toMatchObject({ added: 0, removed: 0 });
  },
);

cliTest(
  "uses syntax-aware bundle fingerprints for changed syntax and renamed bindings",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-fingerprint-version-");
    const pairs = [
      ["bigint", "exports.v = 1n;", "exports.v = 2n;"],
      ["bigint-key", "exports.v = { 1n: 1 };", "exports.v = { 2n: 1 };"],
      ["directive", '"use strict";', '"use asm";'],
      ["assignment", "exports.v = 1;", "exports.v += 1;"],
      ["string", 'exports.v = "left";', 'exports.v = "right";'],
      ["class-method", "class A { foo() {} }", "class A { bar() {} }"],
      ["class-field", "class A { foo = 1; }", "class A { bar = 1; }"],
      [
        "rename",
        "const key = selectKey(); exports.read = value[key];",
        "const selector = selectKey(); exports.read = value[selector];",
      ],
      [
        "rename-class-method",
        "const key = selectKey(); class A { [key]() {} }",
        "const selector = selectKey(); class B { [selector]() {} }",
      ],
      [
        "rename-class-field",
        "const key = selectKey(); class A { [key] = 1; }",
        "const selector = selectKey(); class B { [selector] = 1; }",
      ],
    ] as const;
    const versions = [];
    for (const side of [1, 2] as const) {
      const application = join(root, String(side));
      await mkdir(application);
      for (const [name, left, right] of pairs)
        await writeFile(
          join(application, `${name}.js`),
          `globalThis.webpackChunkApp.push([[1], {17(module, exports) {${side === 1 ? left : right}}}]);`,
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
      throw new Error("Missing bundle version Evidence");
    const analyses = versions.map(({ normalized_result }) =>
      javascriptApplicationAnalysisResultSchema.parse(normalized_result),
    );
    const modules = analyses.map(({ graph }) => {
      expect(graph.coverage.status).toBe("complete");
      return new Map(
        graph.nodes.flatMap((node) =>
          node.observations.flatMap(({ properties, evidence }) =>
            typeof properties.structural_fingerprint_sha256 === "string"
              ? [[properties.path, { node, properties, evidence }] as const]
              : [],
          ),
        ),
      );
    });
    const inputPath = join(root, "comparison.json");
    await writeFile(inputPath, JSON.stringify({ left, right }));
    const response = await cli.run({
      arguments: ["compare-application-versions", inputPath, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );
    expect(result.coverage.status).toBe("complete-within-inputs");
    for (const [name] of pairs) {
      const isRename = name.startsWith("rename");
      const a = modules[0]?.get(`${name}.js`);
      const b = modules[1]?.get(`${name}.js`);
      if (a === undefined || b === undefined)
        throw new Error(`Missing ${name} bundle module`);
      expect(a.evidence.coverage.status).toBe("complete");
      expect(b.evidence.coverage.status).toBe("complete");
      expect(a.properties.structural_fingerprint_algorithm).toBe(
        "babel-ast-v3",
      );
      expect(b.properties.structural_fingerprint_algorithm).toBe(
        "babel-ast-v3",
      );
      expect(a.properties.source_sha256).not.toBe(b.properties.source_sha256);
      expect(
        a.properties.structural_fingerprint_sha256 ===
          b.properties.structural_fingerprint_sha256,
        name,
      ).toBe(isRename);
      const item = result.items.find(
        ({ left_node_id }) => left_node_id === a.node.node_id,
      );
      expect(item).toMatchObject(
        isRename
          ? {
              right_node_id: b.node.node_id,
              status: "changed",
              match: {
                status: "matched",
                basis: "structural-fingerprint",
                confidence: "medium",
              },
            }
          : {
              right_node_id: null,
              status: "removed",
              match: { status: "unmatched" },
            },
      );
      if (!isRename)
        expect(
          result.items.find(
            ({ right_node_id }) => right_node_id === b.node.node_id,
          ),
        ).toMatchObject({
          left_node_id: null,
          status: "added",
          match: { status: "unmatched" },
        });
      const asset = analyses[0]?.graph.nodes.find(
        ({ kind, observations }) =>
          kind === "javascript-asset" &&
          observations.some(
            ({ properties }) => properties.path === `${name}.js`,
          ),
      );
      expect(asset).toBeDefined();
      expect(
        result.items.find(
          ({ left_node_id }) => left_node_id === asset?.node_id,
        ),
      ).toMatchObject({
        status: "changed",
        dimensions: expect.arrayContaining(["content"]),
        match: { status: "matched", basis: "semantic-key" },
      });
    }
    expect(result.matching.structural_fingerprint).toBe(3);
  },
);

cliTest(
  "pairs repeated factory bodies by identity when application versions retain a shared bundle",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-version-matching-");
    const factoryCount = 32;
    const factories = Array.from(
      { length: factoryCount },
      (_, index) => `${index}: function() {}`,
    ).join(",");
    const bundle = `globalThis.webpackChunkApp.push([[1], {${factories}}]);`;
    const versions = await Promise.all(
      [1, 2].map(async (version) => {
        const application = join(root, String(version));
        await mkdir(application);
        await writeFile(
          join(application, "package.json"),
          JSON.stringify({ name: "shared-bundle", version: `${version}.0.0` }),
        );
        await writeFile(join(application, "chunk.js"), bundle);
        const response = await cli.run({
          arguments: ["analyze-javascript-application", application, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(response.exitCode, response.stderr).toBe(0);
        return parseEvidence(response.json);
      }),
    );
    const [left, right] = versions;
    if (left === undefined || right === undefined)
      throw new Error("Missing application version Evidence");
    const analyses = versions.map(({ normalized_result }) =>
      javascriptApplicationAnalysisResultSchema.parse(normalized_result),
    );
    const factoryNodes = analyses.map(({ graph }) => {
      expect(graph.coverage.status).toBe("complete");
      const nodes = graph.nodes.filter(
        ({ kind, observations }) =>
          kind === "javascript-module" &&
          observations.some(
            ({ properties }) => properties.module_key !== undefined,
          ),
      );
      expect(nodes).toHaveLength(factoryCount);
      const sourceDigests = nodes.flatMap(({ observations }) =>
        observations.map(({ properties }) => properties.source_sha256),
      );
      expect(sourceDigests.every((digest) => typeof digest === "string")).toBe(
        true,
      );
      expect(new Set(sourceDigests).size).toBe(1);
      return nodes;
    });
    const inputPath = join(root, "comparison.json");
    await writeFile(inputPath, JSON.stringify({ left, right }));
    const response = await cli.run({
      arguments: ["compare-application-versions", inputPath, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );

    expect(result.left.root_artifact_sha256).not.toBe(
      result.right.root_artifact_sha256,
    );
    expect(result.matching.ambiguous).toBe(0);
    expect(result.coverage.status).toBe("complete-within-inputs");
    expect(factoryNodes[0]?.map(({ node_id }) => node_id)).toEqual(
      factoryNodes[1]?.map(({ node_id }) => node_id),
    );
    for (const node of factoryNodes[0] ?? []) {
      expect(
        result.items.find(({ left_node_id }) => left_node_id === node.node_id),
      ).toMatchObject({
        status: "unchanged",
        right_node_id: node.node_id,
        match: {
          status: "matched",
          basis: "exact-node-identity",
          candidate_left_node_ids: [],
          candidate_right_node_ids: [],
        },
      });
    }
  },
);

cliTest(
  "retains exact source-module pairing while a changed sibling's identity is unresolved",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-source-module-version-");
    const versions = await Promise.all(
      ["left", "right"].map(async (name) => {
        const application = join(root, name);
        await mkdir(join(application, "src"), { recursive: true });
        await writeFile(
          join(application, "package.json"),
          JSON.stringify({
            name: "source-module-fixture",
            version: "1.0.0",
            main: "src/main.js",
          }),
        );
        await writeFile(
          join(application, "src/main.js"),
          'require("./util.js");\n',
        );
        await writeFile(
          join(application, "src/util.js"),
          `module.exports = ${JSON.stringify(name)};\n`,
        );
        const response = await cli.run({
          arguments: ["analyze-javascript-application", application, "--json"],
          environment: { REA_LOG_LEVEL: "silent" },
        });
        expect(response.exitCode, response.stderr).toBe(0);
        return parseEvidence(response.json);
      }),
    );
    const [left, right] = versions;
    if (left === undefined || right === undefined)
      throw new Error("Missing source module Evidence");
    const analyses = versions.map(({ normalized_result }) =>
      javascriptApplicationAnalysisResultSchema.parse(normalized_result),
    );
    const sourceModules = analyses.map(({ graph }) => {
      const node = graph.nodes.find(
        ({ kind, observations }) =>
          kind === "javascript-module" &&
          observations.some(
            ({ properties }) =>
              properties.semantic_role === "source-module" &&
              properties.path === "src/main.js",
          ),
      );
      if (node === undefined) throw new Error("Missing main source module");
      expect(
        node.observations.some(
          ({ properties }) => typeof properties.source_sha256 === "string",
        ),
      ).toBe(true);
      return node;
    });
    const inputPath = join(root, "comparison.json");
    await writeFile(inputPath, JSON.stringify({ left, right }));
    const response = await cli.run({
      arguments: ["compare-application-versions", inputPath, "--json"],
      environment: { REA_LOG_LEVEL: "silent" },
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const result = applicationVersionComparisonResultSchema.parse(
      parseEvidence(response.json).normalized_result,
    );

    const item = result.items.find(
      ({ left_node_id }) => left_node_id === sourceModules[0]?.node_id,
    );
    expect(item).toMatchObject({
      left_node_id: sourceModules[0]?.node_id,
      right_node_id: sourceModules[1]?.node_id,
      status: "unknown",
      dimensions: [],
      match: {
        status: "matched",
        basis: "exact-module-source-digest",
        confidence: "exact",
      },
    });
    expect(item?.limitations.join(" ")).toMatch(
      /relationship.*identity.*unresolved/iu,
    );
    expect(result.coverage.status).toBe("complete-within-inputs");
    const mainId = sourceModules[0]?.node_id;
    const neighbors = new Set(
      analyses[0]?.graph.edges.flatMap((edge) =>
        edge.source_node_id === mainId
          ? [edge.target_node_id]
          : edge.target_node_id === mainId
            ? [edge.source_node_id]
            : [],
      ),
    );
    expect(
      result.items.some(
        (other) =>
          other.left_node_id !== null &&
          neighbors.has(other.left_node_id) &&
          other.match.status !== "matched",
      ),
    ).toBe(true);
  },
);

cliTest(
  "matches unchanged module exports after a sibling file changes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-export-version-");
    const util = {
      v1: "module.exports = { greet: () => 1 };\n",
      v2: "module.exports = { greet: () => 2 };\n",
    };
    const analyze = async (
      name: string,
      version: string,
      utilSource: string,
    ) => {
      const application = join(root, name);
      await mkdir(join(application, "src"), { recursive: true });
      await writeFile(
        join(application, "package.json"),
        JSON.stringify({
          name: "export-fixture",
          version,
          main: "src/main.js",
        }),
      );
      await writeFile(
        join(application, "src/main.js"),
        'const util = require("./util.js");\nmodule.exports = { start: () => util.greet() };\n',
      );
      await writeFile(join(application, "src/util.js"), utilSource);
      const response = await cli.run({
        arguments: ["analyze-javascript-application", application, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      return parseEvidence(response.json);
    };
    const compare = async (left: unknown, right: unknown) => {
      const inputPath = join(root, `comparison-${Math.random()}.json`);
      await writeFile(inputPath, JSON.stringify({ left, right }));
      const response = await runFileCli(cli, {
        arguments: ["compare-application-versions", inputPath, "--json"],
        environment: { REA_LOG_LEVEL: "silent" },
      });
      expect(response.exitCode, response.stderr).toBe(0);
      return applicationVersionComparisonResultSchema.parse(
        parseEvidence(response.json).normalized_result,
      );
    };
    const exportsOf = (evidence: { normalized_result: unknown }) =>
      javascriptApplicationAnalysisResultSchema
        .parse(evidence.normalized_result)
        .graph.nodes.filter(({ observations }) =>
          observations.some(
            ({ properties }) => properties.semantic_role === "export-binding",
          ),
        );
    const base = await analyze("base", "1.0.0", util.v1);
    // Only package.json differs: both JavaScript files are byte-identical.
    const bumped = await analyze("bumped", "1.0.1", util.v1);
    const edited = await analyze("edited", "1.0.1", util.v2);
    const baseExports = exportsOf(base);
    expect(baseExports.length).toBeGreaterThanOrEqual(2);

    const unchanged = await compare(base, bumped);
    for (const node of baseExports)
      expect(unchanged.items).toContainEqual(
        expect.objectContaining({
          left_node_id: node.node_id,
          status: "unchanged",
          match: expect.objectContaining({
            basis: "exact-module-source-digest",
            confidence: "exact",
          }),
        }),
      );
    expect(
      unchanged.items.filter(
        ({ node_kind, status }) =>
          node_kind === "javascript-module" && status !== "unchanged",
      ),
    ).toEqual([]);

    // An edited file's export is not paired by name alone.
    const changed = await compare(base, edited);
    const utilExport = baseExports.find(({ observations }) =>
      observations.some(
        ({ properties }) => properties.module_path === "src/util.js",
      ),
    );
    expect(changed.items).toContainEqual(
      expect.objectContaining({
        left_node_id: utilExport?.node_id,
        status: "removed",
      }),
    );
  },
);
