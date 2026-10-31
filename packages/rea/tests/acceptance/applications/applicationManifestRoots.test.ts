import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps dependency manifests out of application roots and Electron entries through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-application-manifest-");
    const dependency = join(root, "node_modules", "dep");
    const nested = join(root, "a");
    await Promise.all([mkdir(dependency, { recursive: true }), mkdir(nested)]);
    await Promise.all([
      writeFile(
        join(nested, "package.json"),
        JSON.stringify({ name: "nested" }),
      ),
      writeFile(
        join(root, "package.json"),
        JSON.stringify({ name: "app", main: "main.js" }),
      ),
      writeFile(
        join(root, "main.js"),
        "throw new Error('source must remain inert');",
      ),
      writeFile(
        join(dependency, "package.json"),
        JSON.stringify({
          name: "dep",
          main: "index.js",
          browser: "browser.js",
        }),
      ),
      writeFile(join(dependency, "index.js"), "module.exports = {};"),
      writeFile(join(dependency, "browser.js"), "export const browser = true;"),
    ]);

    let document: unknown;
    if (surface === "CLI") {
      const response = await cli.run({
        arguments: ["analyze-javascript-application", root, "--json"],
      });
      expect(response.exitCode).toBe(0);
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
    expect(
      graph.nodes
        .filter(({ node_id }) => graph.root_node_ids.includes(node_id))
        .flatMap(({ observations }) => observations.map(({ label }) => label)),
    ).toEqual(["app"]);
    expect(
      graph.nodes
        .filter(({ kind }) => kind === "electron-main")
        .flatMap(({ observations }) =>
          observations.map(({ properties }) => properties.declared_path),
        ),
    ).toEqual(["main.js"]);
    expect(
      graph.nodes.filter(({ kind }) => kind === "electron-renderer"),
    ).toEqual([]);
    expect(
      graph.nodes
        .filter(({ kind }) => kind === "package")
        .flatMap(({ observations }) => observations.map(({ label }) => label))
        .sort(),
    ).toEqual(["app", "dep", "nested"]);
  },
);

cliTest(
  "keeps the artifact root when only dependency manifests are present",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-dependency-only-");
    const dependency = join(root, "node_modules", "dep");
    await mkdir(dependency, { recursive: true });
    await writeFile(
      join(dependency, "package.json"),
      JSON.stringify({ name: "dep", main: "index.js" }),
    );
    await writeFile(join(dependency, "index.js"), "module.exports = {};");
    const response = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const { graph } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(response.json).normalized_result;
    expect(
      graph.nodes
        .filter(({ node_id }) => graph.root_node_ids.includes(node_id))
        .map(({ kind }) => kind),
    ).toEqual(["artifact"]);
    expect(
      graph.nodes
        .filter(({ kind }) => kind === "package")
        .flatMap(({ observations }) => observations.map(({ label }) => label)),
    ).toEqual(["dep"]);
    expect(
      graph.nodes.some(
        ({ kind }) => kind === "electron-main" || kind === "electron-renderer",
      ),
    ).toBe(false);
  },
);
