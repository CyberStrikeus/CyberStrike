import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { electronPageInspectionSchema } from "../../../src/domain/javascript/electronObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { passiveNetworkCapture } from "../../fixtures/passiveNetworkCapture.js";
import { webCaptureDiffSchema } from "../../../src/domain/webCaptureDiffSchemas.js";

for (const electron of [false, true])
  cliTest(
    `declares ${electron ? "Electron UTF-8" : "web UTF-16"} DOM value lengths through CLI and MCP without reinterpreting historical captures`,
    async ({ cli, onTestFinished }) => {
      const root = await createTestTempDirectory("rea-dom-value-units-");
      const path = join(root, "index.html");
      await writeFile(path, "<html/>");
      const fileUrl = pathToFileURL(path).href;
      const values = ["ASCII", "ééé😀", "漢字", "e\u0301"];
      let missingStrings = false;
      const browser = await startFakeCdpBrowser({
        ...(electron ? { electronFileUrl: fileUrl } : {}),
        commandResult: ({ method }, origin) => {
          if (method !== "DOMSnapshot.captureSnapshot") return undefined;
          if (missingStrings) return { documents: [] };
          return {
            strings: [
              electron ? fileUrl : `${origin}/app`,
              "#document",
              "#text",
              ...values,
            ],
            documents: [
              {
                documentURL: 0,
                nodes: {
                  nodeType: [9, 3, 3, 3, 3],
                  nodeName: [1, 2, 2, 2, 2],
                  nodeValue: [-1, 3, 4, 5, 6],
                  parentIndex: [-1, 0, 0, 0, 0],
                  attributes: [[], [], [], [], []],
                },
              },
            ],
          };
        },
      });
      onTestFinished(() => browser.close());
      const command = electron ? "inspect-electron-page" : "inspect-web-page";
      const target = electron ? "electron-page" : "allowed-page";
      const input = {
        cdp_endpoint: browser.endpoint,
        target_id: target,
        observation_ms: 0,
        ...(electron ? {} : { allowed_origins: [browser.allowedOrigin] }),
      };
      const result = await cli.run({
        arguments: [
          command,
          browser.endpoint,
          target,
          "--observation-ms",
          "0",
          ...(electron ? [] : ["--allowed-origins", browser.allowedOrigin]),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.stderr).toBe("");
      const schema = electron
        ? electronPageInspectionSchema
        : webPageInspectionSchema;
      const check = (value: unknown) => {
        const evidence = parseEvidence(value);
        const report = schema.parse(evidence.normalized_result);
        expect(report.dom).toMatchObject({
          node_value_length_unit: electron ? "utf8-bytes" : "utf16-code-units",
          total_nodes: 5,
        });
        expect(report.dom.nodes.map((node) => node.node_value_length)).toEqual([
          0,
          ...(electron ? [5, 10, 6, 3] : [5, 5, 2, 2]),
        ]);
        expect(report.dom.nodes.map((node) => node.index)).toEqual([
          0, 1, 2, 3, 4,
        ]);
        expect(report.dom.nodes[1]).not.toHaveProperty(
          "node_value_length_unit",
        );
        expect(JSON.stringify(report.dom)).not.toContain("ééé😀");
        const legacyDom = {
          total_nodes: report.dom.total_nodes,
          nodes: report.dom.nodes,
        };
        expect(schema.parse({ ...report, dom: legacyDom }).dom).toEqual(
          legacyDom,
        );
        expect(
          schema.safeParse({
            ...report,
            dom: { ...legacyDom, node_value_length_unit: "characters" },
          }).success,
        ).toBe(false);
      };
      check(result.json);
      const call = await cli.sharedMcpCall!();
      const mcp = await call(command.replaceAll("-", "_"), input);
      expect(mcp.isError).not.toBe(true);
      check(mcp.structuredContent);

      missingStrings = true;
      const partial = await call(command.replaceAll("-", "_"), input);
      expect(partial.isError).not.toBe(true);
      const report = schema.parse(
        parseEvidence(partial.structuredContent).normalized_result,
      );
      expect(report.dom).toEqual({
        node_value_length_unit: electron ? "utf8-bytes" : "utf16-code-units",
        total_nodes: 0,
        nodes: [],
      });
      expect(report.completeness.excluded).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            section: "dom",
            reason: "invalid_protocol_value",
          }),
        ]),
      );
    },
  );

cliTest(
  "compares only commensurable DOM lengths while retaining structural changes through CLI and MCP",
  async ({ cli }) => {
    const call = await cli.sharedMcpCall!();
    for (const [beforeUnit, afterUnit, length, variation, status] of [
      ["utf16-code-units", "utf16-code-units", 5, "none", "unchanged"],
      ["utf8-bytes", "utf8-bytes", 10, "none", "changed"],
      [undefined, undefined, 5, "none", "unknown"],
      [undefined, "utf16-code-units", 10, "none", "unknown"],
      ["utf16-code-units", "utf8-bytes", 5, "none", "unknown"],
      ["utf16-code-units", "utf8-bytes", 10, "none", "unknown"],
      [undefined, undefined, 5, "node", "changed"],
      ["utf16-code-units", "utf8-bytes", 10, "frame", "changed"],
      [undefined, undefined, 5, "empty", "unchanged"],
    ] as const) {
      const before = passiveNetworkCapture();
      before.dom = {
        total_nodes: 2,
        ...(beforeUnit === undefined
          ? {}
          : { node_value_length_unit: beforeUnit }),
        nodes: [
          {
            index: 0,
            parent_index: -1,
            node_type: 9,
            node_name: "#document",
            node_value_length: 0,
            attribute_names: [],
          },
          {
            index: 1,
            parent_index: 0,
            node_type: 3,
            node_name: "#text",
            node_value_length: 5,
            attribute_names: [],
          },
        ],
      };
      const after = structuredClone(before);
      if (afterUnit === undefined) delete after.dom.node_value_length_unit;
      else after.dom.node_value_length_unit = afterUnit;
      after.dom.nodes[1]!.node_value_length = length;
      if (variation === "node") {
        after.dom.nodes[1]!.node_type = 8;
        after.dom.nodes[1]!.node_name = "#comment";
      }
      if (variation === "frame")
        after.frames.push({
          frame_id: "frame",
          parent_frame_id: null,
          url: "https://app.example.test/other",
          origin: "https://app.example.test",
        });
      if (variation === "empty") {
        before.dom = { total_nodes: 0, nodes: [] };
        after.dom = { total_nodes: 0, nodes: [] };
      }
      const result = await cli.sharedCliRun!({
        arguments: [
          "compare-web-captures",
          JSON.stringify({ inspection: before }),
          JSON.stringify({ inspection: after }),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      const mcp = await call("compare_web_captures", {
        before: { inspection: after },
        after: { inspection: before },
      });
      expect(mcp.isError).not.toBe(true);
      const label = JSON.stringify({
        beforeUnit,
        afterUnit,
        length,
        variation,
      });
      for (const output of [result.json, mcp.structuredContent]) {
        const diff = webCaptureDiffSchema.parse(
          parseEvidence(output).normalized_result,
        );
        expect(diff.dimensions.dom_structure.status, label).toBe(status);
        if (status === "unknown")
          expect(diff.dimensions.dom_structure.reason).toContain("unit");
      }
    }
  },
);
