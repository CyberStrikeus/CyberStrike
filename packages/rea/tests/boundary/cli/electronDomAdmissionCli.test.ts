import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { expect } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { electronPageInspectionSchema } from "../../../src/domain/javascript/electronObservation.js";
import { startFakeCdpBrowser } from "../../fixtures/fakeCdpBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

const cases: ReadonlyArray<{
  name: string;
  parents: readonly number[];
  names?: readonly number[];
  secondDocument?: boolean;
  indices: readonly number[];
  invalid: number;
}> = [
  { name: "valid parent", parents: [-1, 0, 1], indices: [0, 1, 2], invalid: 0 },
  {
    name: "out-of-range parent",
    parents: [-1, 0, 99999],
    indices: [0, 1],
    invalid: 1,
  },
  { name: "self parent", parents: [-1, 0, 2], indices: [0, 1], invalid: 1 },
  { name: "parent cycle", parents: [-1, 2, 1], indices: [0], invalid: 2 },
  {
    name: "unknown name before a second document",
    parents: [-1, 0, 1],
    names: [1, 999, 3],
    secondDocument: true,
    indices: [0, 2, 3, 4, 5],
    invalid: 1,
  },
];

for (const scenario of cases)
  cliTest(
    `Electron DOM admission preserves source identities: ${scenario.name}`,
    async ({ cli, onTestFinished }) => {
      const root = await createTestTempDirectory("rea-electron-dom-admission-");
      const main = join(root, "index.html");
      await writeFile(main, "<html/>");
      const url = pathToFileURL(main).href;
      const document = (
        parents: readonly number[],
        names: readonly number[],
      ) => ({
        documentURL: 0,
        nodes: {
          nodeType: [9, 1, 1],
          nodeName: names,
          nodeValue: [-1, -1, 4],
          parentIndex: parents,
          attributes: [[], [], []],
        },
      });
      const browser = await startFakeCdpBrowser({
        electronFileUrl: url,
        commandResult: ({ method }) =>
          method === "DOMSnapshot.captureSnapshot"
            ? {
                strings: [url, "#document", "DIV", "SPAN", "😀"],
                documents: [
                  document(scenario.parents, scenario.names ?? [1, 2, 3]),
                  ...(scenario.secondDocument
                    ? [document([-1, 0, 1], [1, 2, 3])]
                    : []),
                ],
              }
            : undefined,
      });
      onTestFinished(() => browser.close());
      const output = await cli.run({
        arguments: [
          "inspect-electron-page",
          browser.endpoint,
          "electron-page",
          "--observation-ms",
          "0",
          "--json",
        ],
      });
      expect(output.exitCode, output.stderr).toBe(0);
      const inspection = electronPageInspectionSchema.parse(
        parseEvidence(output.json).normalized_result,
      );
      expect(inspection.dom.total_nodes).toBe(scenario.secondDocument ? 6 : 3);
      expect(inspection.dom.nodes.map(({ index }) => index)).toEqual(
        scenario.indices,
      );
      const excluded = inspection.completeness.excluded.filter(
        ({ section, reason }) =>
          section === "dom" && reason === "invalid_protocol_value",
      );
      expect(excluded).toEqual(
        scenario.invalid === 0
          ? []
          : [
              {
                section: "dom",
                reason: "invalid_protocol_value",
                count: scenario.invalid,
              },
            ],
      );
      if (scenario.secondDocument)
        expect(inspection.dom.nodes.at(-1)).toMatchObject({
          index: 5,
          parent_index: 4,
          node_value_length: 4,
        });
      if (scenario.invalid === 0)
        expect(
          inspection.dom.nodes.map(({ parent_index, node_value_length }) => [
            parent_index,
            node_value_length,
          ]),
        ).toEqual([
          [-1, 0],
          [0, 0],
          [1, 4],
        ]);
    },
  );
