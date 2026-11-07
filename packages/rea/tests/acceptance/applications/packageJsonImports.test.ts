import { mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "reports JSON availability for imported package manifests through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-package-json-imports-");
    const files = {
      "main.cjs": [
        'const version = require("./package.json").version;',
        'const data = require("./data.json");',
        'const helper = require("./helper.cjs");',
        'const broken = require("./broken/package.json");',
        'const nonObject = require("./non-object/package.json");',
        'const unavailable = require("./unavailable/package.json");',
      ].join("\n"),
      "package.json": '{"name":"app","version":"1.0.0"}',
      "data.json": "[]",
      "helper.cjs": "module.exports = 1;",
      "broken/package.json": "{",
      "non-object/package.json": "[]",
      "unavailable/package.json": Buffer.from([0xff]),
    };
    await Promise.all(
      Object.entries(files).map(async ([path, content]) => {
        const absolute = join(root, path);
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content);
      }),
    );
    const nativeRequire = createRequire(join(root, "main.cjs"));
    expect(nativeRequire("./package.json").version).toBe("1.0.0");
    expect(nativeRequire("./non-object/package.json")).toEqual([]);
    expect(nativeRequire("./data.json")).toEqual([]);

    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
      });
      expect(response.exitCode, response.stderr).toBe(0);
      document = response.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const response = await call("analyze_javascript_application", {
        input_path: root,
      });
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      document = response.structuredContent;
    }
    const { graph } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(document).normalized_result;
    const imports = graph.edges.filter(
      ({ properties }) => properties.module_link_kind === "require",
    );
    for (const [path, kind, status, metadataStatus] of [
      ["package.json", "package-json", "included", "included"],
      ["data.json", "json", "included", null],
      ["helper.cjs", "javascript", null, null],
      ["broken/package.json", "package-json", "invalid", "invalid"],
      ["non-object/package.json", "package-json", "included", "invalid"],
      [
        "unavailable/package.json",
        "package-json",
        "unavailable",
        "unavailable",
      ],
    ]) {
      expect(imports).toContainEqual(
        expect.objectContaining({
          properties: expect.objectContaining({
            specifier: `./${path}`,
            resolved_path: path,
            resolution_status: "resolved",
            target_file_kind: kind,
            target_json_status: status,
          }),
        }),
      );
      if (kind === "package-json")
        expect(
          graph.nodes
            .filter(({ kind }) => kind === "package")
            .flatMap(({ observations }) => observations),
        ).toContainEqual(
          expect.objectContaining({
            properties: expect.objectContaining({
              path,
              parse_status: metadataStatus,
            }),
          }),
        );
    }
  },
);
