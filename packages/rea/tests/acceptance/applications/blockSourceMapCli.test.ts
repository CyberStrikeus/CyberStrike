import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, sep } from "node:path";

import { createPackageWithOptions, listPackage } from "@electron/asar";
import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "links a block source-map URL containing an asterisk through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-block-map-");
    const directory = join(root, "input");
    await mkdir(directory);
    const url = "app*part.js.map";
    const directive = "/*# sourceMappingURL=" + url;
    await writeFile(join(directory, "app.js"), directive + "*/");
    await writeFile(
      join(directory, "app_part.js.map"),
      JSON.stringify({ version: 3, sources: [], names: [], mappings: "" }),
    );
    const archive = join(root, "app.asar");
    await createPackageWithOptions(directory, archive, {});
    // ASAR logical names can contain '*' even on Windows. Rename this header
    // key without changing entry bytes, sizes or payload offsets.
    const bytes = await readFile(archive);
    const key = Buffer.from('"app_part.js.map"');
    const offset = bytes.indexOf(key);
    expect(offset).toBeGreaterThan(0);
    expect(bytes.indexOf(key, offset + key.length)).toBe(-1);
    Buffer.from('"' + url + '"').copy(bytes, offset);
    await writeFile(archive, bytes);
    expect(listPackage(archive, { isPack: false })).toContain(sep + url);
    let document: unknown;
    if (surface === "CLI") {
      const result = await cli.run({
        arguments: ["analyze-javascript-application", archive, "--json"],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      document = result.json;
    } else {
      const { call } = await connectLocalToolsMcp();
      const result = await call("analyze_javascript_application", {
        input_path: archive,
        format: "asar",
      });
      expect(result.isError).not.toBe(true);
      document = result.structuredContent;
    }
    const {
      normalized_result: { graph },
    } = z
      .object({
        normalized_result: javascriptApplicationAnalysisResultSchema,
      })
      .parse(document);
    const digest = createHash("sha256").update(url).digest("hex");
    const map = graph.nodes.find(({ observations }) =>
      observations.some(({ properties }) => properties.declared_url === url),
    );
    expect(
      map,
      "the complete declared URL must identify the map",
    ).toBeDefined();
    expect(map?.observations).toContainEqual(
      expect.objectContaining({
        properties: {
          declared_url: url,
          declared_url_sha256: digest,
          resolved_path: url,
          resolution_status: "resolved",
          available: true,
        },
        evidence: expect.objectContaining({
          location: {
            available: true,
            value: {
              kind: "source-range",
              source: "app.js",
              start: { line: 1, column: 0 },
              end: { line: 1, column: directive.length },
            },
          },
        }),
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        relation: "maps_to",
        target_node_id: map?.node_id,
        properties: {
          declared_url_sha256: digest,
          resolved_path: url,
          resolution_status: "resolved",
        },
      }),
    );
  },
);
