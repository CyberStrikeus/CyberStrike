import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { reconstructJavaScriptArtifact } from "../../../support/javascriptApplicationScope.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { parseJavaScriptApplicationGraph } from "../../../../src/domain/javascript/javascriptApplicationGraph.js";

const PRELOAD = '{ preload: "./preload.js", sandbox: true }';
const EXPLICIT = `webPreferences: ${PRELOAD}`;

describe("Electron option keys in reconstructed application graphs", () => {
  it.each([
    ["computed binding", `[webPreferences]: ${PRELOAD}`],
    ["later spread", `${EXPLICIT}, ...options`],
    ["later computed key", `${EXPLICIT}, [getKey()]: null`],
    ["later accessor", `${EXPLICIT}, get webPreferences() { return null; }`],
    ["later duplicate", `${EXPLICIT}, webPreferences: null`],
  ])(
    "does not associate a BrowserWindow preload from %s",
    async (_, options) => {
      const result = await reconstructSource(`
      const webPreferences = "title";
      new BrowserWindow({ ${options} });
    `);
      const windows = result.graph.nodes.filter(
        ({ kind }) => kind === "browser-window",
      );
      expect(windows).toHaveLength(1);
      const observation = windows[0]?.observations[0];
      expect(observation).toMatchObject({
        properties: {
          options_status: "object-literal",
          web_preferences_status: "dynamic",
          web_preferences: [],
          preload_path: null,
          preload_resolution_context: null,
        },
        evidence: {
          state: "observed",
          confidence: "exact",
          coverage: { status: "partial" },
        },
      });
      expect(result.electron_summary.preload_entrypoints).toBe(0);
      expect(result.electron_summary.explicit_web_preferences).toBe(0);

      // A nested literal cannot bypass the unresolved options owner.
      expect(
        result.graph.nodes.filter(({ kind }) => kind === "electron-preload"),
      ).toEqual([]);
      expect(windowPreloadNodes(result)).toEqual([]);
      expect(
        result.graph.edges.filter(
          (edge) =>
            edge.source_node_id === windows[0]?.node_id &&
            edge.relation === "loads",
        ),
      ).toEqual([]);
      expect(result.graph.edges).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "maps_to",
            evidence: expect.objectContaining({
              location: observation?.evidence.location,
            }),
          }),
        ]),
      );
    },
  );

  it.each([
    ["plain key", EXPLICIT],
    ["quoted key", `"webPreferences": ${PRELOAD}`],
    ["computed literal", `["webPreferences"]: ${PRELOAD}`],
    ["later explicit key", `...options, [getKey()]: null, ${EXPLICIT}`],
    ["last duplicate key", `webPreferences: null, ${EXPLICIT}`],
  ])(
    "retains the BrowserWindow preload association for %s",
    async (_, options) => {
      const result = await reconstructSource(
        `new BrowserWindow({ ${options} });`,
      );
      const preloads = windowPreloadNodes(result);
      expect(preloads).toHaveLength(1);
      expect(result.electron_summary.preload_entrypoints).toBe(1);
      expect(result.electron_summary.explicit_web_preferences).toBe(2);
      expect(result.graph.edges).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            relation: "loads",
            target_node_id: preloads[0]?.node_id,
            evidence: expect.objectContaining({
              state: "inferred",
              confidence: "high",
              extractor: expect.objectContaining({
                operation: "associate-browser-window-preload",
              }),
              coverage: expect.objectContaining({ status: "complete" }),
            }),
          }),
          expect.objectContaining({
            relation: "maps_to",
            source_node_id: preloads[0]?.node_id,
            properties: expect.objectContaining({
              resolved_path: "preload.js",
            }),
          }),
        ]),
      );
    },
  );

  it.each([
    ["-0", { status: "dynamic", value: null, expression: "-0" }],
    ["-0.0", { status: "dynamic", value: null, expression: "-0.0" }],
    ["-1e999", { status: "dynamic", value: null, expression: "-1e999" }],
    ["-1", { status: "literal", value: -1, expression: null }],
  ] as const)(
    "preserves the JSON representation of BrowserWindow preference %s",
    async (expression, value) => {
      const result = await reconstructSource(
        `new BrowserWindow({ webPreferences: { zoomFactor: ${expression} } });`,
      );
      const graph: unknown = JSON.parse(JSON.stringify(result.graph));
      const transported = parseJavaScriptApplicationGraph(graph);
      const window = transported.nodes.find(
        ({ kind }) => kind === "browser-window",
      );
      expect(window?.observations[0]?.properties.web_preferences).toEqual([
        { name: "zoomFactor", value },
      ]);
    },
  );
});

describe("Electron utility-process options in reconstructed application graphs", () => {
  // Electron's fork(modulePath[, args][, options]) treats a non-array object in
  // the args slot as the options and then ignores the third argument.
  it.each([
    ["second-slot options", `{ serviceName: "gpu" }`, "gpu", "complete"],
    ["explicit argv", `[], { serviceName: "gpu" }`, "gpu", "complete"],
    ["undefined argv", `undefined, { serviceName: "gpu" }`, "gpu", "complete"],
    ["null argv", `null, { serviceName: "gpu" }`, "gpu", "complete"],
    ["void argv", `void 0, { serviceName: "gpu" }`, "gpu", "complete"],
    ["const argv", `argv, { serviceName: "gpu" }`, "gpu", "complete"],
    ["wrapped options", `({ serviceName: "gpu" })`, "gpu", "complete"],
    [
      "ignored third",
      `{ serviceName: "gpu" }, { serviceName: "x" }`,
      "gpu",
      "complete",
    ],
    ["omitted options", "", null, "complete"],
    ["options without name", `{ stdio: "pipe" }`, null, "complete"],
    ["nullish options", `[], null`, null, "complete"],
    ["nullish name", `{ serviceName: undefined }`, null, "complete"],
    ["identifier options", "options", null, "partial"],
    ["spread arguments", "...forkArguments", null, "partial"],
    ["spread options", "[], ...forkArguments", null, "partial"],
    ["unproven argv", `makeArgv(), { serviceName: "x" }`, null, "partial"],
    ["computed key", `{ [key]: "x" }`, null, "partial"],
    ["computed key after argv", `[], { [key]: "x" }`, null, "partial"],
    [
      "shadowed undefined argv",
      `undefined, { serviceName: "x" }`,
      null,
      "partial",
      "function launch(undefined) { %s }",
    ],
  ] as const)(
    "selects utility-process options from %s",
    async (_, args, serviceName, coverage, scope: string = "%s") => {
      const call = `utilityProcess.fork("./worker.js"${args === "" ? "" : `, ${args}`});`;
      const result = await reconstructSource(`
      const argv = ["--gpu"];
      const key = "serviceName";
      ${scope.replace("%s", call)}
    `);
      const utilities = result.graph.nodes.filter(
        ({ kind }) => kind === "electron-utility",
      );
      expect(utilities).toHaveLength(1);
      // Observation order follows content identity, so select by operation.
      const fork = utilities[0]?.observations.find(
        ({ evidence }) =>
          evidence.extractor.operation === "observe-utility-process-fork",
      );
      expect(fork).toMatchObject({
        label: serviceName ?? "./worker.js",
        properties: { service_name: serviceName, module_path: "./worker.js" },
        evidence: { confidence: "exact", coverage: { status: coverage } },
      });
    },
  );
});

type Reconstruction = Awaited<ReturnType<typeof reconstructJavaScriptArtifact>>;

const windowPreloadNodes = (result: Reconstruction) =>
  result.graph.nodes.filter(
    (node) =>
      node.kind === "electron-preload" &&
      node.observations.some(
        ({ properties }) =>
          properties.mechanism === "BrowserWindow:webPreferences.preload",
      ),
  );

const reconstructSource = async (source: string): Promise<Reconstruction> => {
  const root = await createTestTempDirectory("rea-electron-option-keys-");
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ main: "main.js", type: "module" }),
    ),
    writeFile(
      join(root, "main.js"),
      `${source}\nimport { BrowserWindow, utilityProcess } from "electron";\n`,
    ),
    writeFile(join(root, "preload.js"), "void 0;"),
    writeFile(join(root, "worker.js"), "void 0;"),
  ]);
  return reconstructJavaScriptArtifact({ input_path: root });
};
