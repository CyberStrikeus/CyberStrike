import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it } from "vitest";

import { canonicalJson } from "../../../../src/domain/comparisonSemantics.js";
import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";
import { javascriptApplicationAnalysisResultSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { parseJavaScriptSource } from "../../../../src/domain/javascript/javascriptSourceParser.js";
import { analyzeJavaScriptApplication } from "../../../support/javascriptApplicationScope.js";

type ApplicationAnalysis = ReturnType<
  typeof javascriptApplicationAnalysisResultSchema.parse
>;

const analyzeFiles = async (
  files: ReadonlyMap<string, string>,
): Promise<ApplicationAnalysis> => {
  const root = await createTestTempDirectory("rea-typescript-application-");
  await Promise.all(
    [...files].map(([path, source]) => writeFile(join(root, path), source)),
  );
  const result = await analyzeJavaScriptApplication({
    input_path: root,
    format: "directory",
  });
  if (!result.ok) throw result.error;
  const analysis = javascriptApplicationAnalysisResultSchema.parse(
    result.value.normalized_result,
  );
  return javascriptApplicationAnalysisResultSchema.parse(
    JSON.parse(canonicalJson(analysis, "TypeScript application analysis")),
  );
};

it.each(["types.d.ts", "types.d.mts", "types.d.cts"])(
  "keeps valid ambient declarations complete in %s",
  async (path) => {
    const source = "export const value: number;\n";
    const analysis = await analyzeFiles(new Map([[path, source]]));

    expect(analysis.graph.coverage.status).toBe("complete");
    expect(parseJavaScriptSource(source, path)?.errors).toEqual([]);
  },
);

it("retains the missing-initializer diagnostic for ordinary TypeScript", () => {
  const errors = parseJavaScriptSource(
    "export const value: number;",
    "types.ts",
  )?.errors;
  expect(errors?.map(({ message }) => message)).toContain(
    "Missing initializer in const declaration. (1:26)",
  );
});

it("keeps CommonJS TypeScript angle-bracket assertions complete", async () => {
  const source = "export const value = <number>42;\n";
  const analysis = await analyzeFiles(new Map([["app.cts", source]]));

  expect(analysis.graph.coverage.status).toBe("complete");
  expect(parseJavaScriptSource(source, "app.cts")?.errors).toEqual([]);
});

it("retains exported constant evidence through a type-only satisfies expression", async () => {
  const analysis = await analyzeFiles(
    new Map([["app.ts", 'export const value = "ready" satisfies string;\n']]),
  );

  expect(
    analysis.semantic_graph.nodes.filter(
      ({ kind, properties }) =>
        kind === "literal" && properties.value === "ready",
    ),
  ).toHaveLength(1);
});

it("resolves erased wrappers through the composed application graph", async () => {
  const source = `
    import * as dependencyModule from "./dependency.ts";
    const dependency = dependencyModule["value" as const] satisfies number;
    export { dependency };
    function render<T>() { return "ready"; }
    export const specialized = render<string> satisfies () => string;
    specialized();
  `;
  const analysis = await analyzeFiles(
    new Map([
      ["app.mts", source],
      ["dependency.ts", "export const value = 1;\n"],
    ]),
  );

  expect(analysis.graph.edges).toContainEqual(
    expect.objectContaining({
      relation: "imports",
      properties: expect.objectContaining({
        specifier: "./dependency.ts",
        imported_path: ["value"],
        resolved_path: "dependency.ts",
        resolution_status: "resolved",
      }),
    }),
  );
  expect(analysis.semantic_graph.relations).toContainEqual(
    expect.objectContaining({ relation: "calls", resolution: "resolved" }),
  );
  expect(
    analysis.graph.nodes.flatMap(({ observations }) => observations),
  ).toContainEqual(
    expect.objectContaining({
      properties: expect.objectContaining({
        semantic_role: "export-return-shapes",
        exported_name: "specialized",
        static_return_shapes: expect.arrayContaining([
          expect.objectContaining({
            value_status: "literal",
            fields: expect.arrayContaining([
              expect.objectContaining({ path: "", value: "ready" }),
            ]),
          }),
        ]),
      }),
    }),
  );
  expect(parseJavaScriptSource(source, "app.mts")?.errors).toEqual([]);
});

it.each([
  {
    name: "earlier",
    source: 'export const target = () => "ready", result = target();',
    resolved: true,
  },
  {
    name: "later",
    source: 'export const result = target(), target = () => "ready";',
    resolved: false,
  },
])(
  "orders $name exported declarator reads in the composed application graph",
  async ({ source, resolved }) => {
    const analysis = await analyzeFiles(new Map([["app.mts", source]]));
    const calls = analysis.semantic_graph.relations.filter(
      ({ relation }) => relation === "calls",
    );
    if (resolved) {
      expect(calls).toEqual([
        expect.objectContaining({ resolution: "resolved" }),
      ]);
    } else {
      expect(calls.some(({ resolution }) => resolution === "resolved")).toBe(
        false,
      );
      expect(analysis.semantic_graph.unknowns).toContainEqual(
        expect.objectContaining({
          relation_kinds: expect.arrayContaining(["calls"]),
        }),
      );
    }
  },
);

it.each([
  {
    name: "path-value wrappers",
    plain: ['"./preload.js"', '"./worker.js"', '"kept"'],
    wrapped: [
      '("./preload.js" as const)',
      '("./worker.js" as const)',
      '("kept" as const)',
    ],
    preloadPath: "./preload.js",
    workerPath: "./worker.js",
    context: "module-specifier",
  },
  {
    name: "path-call target wrappers",
    plain: [
      'path.join(__dirname, "preload.js")',
      'fileURLToPath(new URL("./worker.js", import.meta.url))',
      '"kept"',
    ],
    wrapped: [
      '(path.join as typeof path.join)(__dirname, "preload.js")',
      '(fileURLToPath as typeof fileURLToPath)(new (URL as typeof URL)("./worker.js", import.meta.url))',
      '("kept" as const)',
    ],
    preloadPath: "preload.js",
    workerPath: "./worker.js",
    context: "filesystem-expression",
  },
])(
  "retains Electron entrypoint facts through erased TypeScript $name",
  async ({
    plain: plainExpressions,
    wrapped: wrappedExpressions,
    preloadPath,
    workerPath,
    context,
  }) => {
    const applications: ApplicationAnalysis[] = [];
    for (const [preload, worker, serviceName] of [
      plainExpressions,
      wrappedExpressions,
    ]) {
      applications.push(
        await analyzeFiles(
          new Map([
            ["package.json", '{"main":"input.ts","type":"commonjs"}'],
            [
              "input.ts",
              `const { BrowserWindow, utilityProcess } = require("electron");
             const path = require("node:path");
             const { fileURLToPath } = require("node:url");
             new BrowserWindow({ webPreferences: { preload: ${preload} } });
             utilityProcess.fork(${worker}, [], { serviceName: ${serviceName} });`,
            ],
            ["preload.js", "void 'preload';\n"],
            ["worker.js", "void 'worker';\n"],
          ]),
        ),
      );
    }

    const entrypointFacts = (analysis: ApplicationAnalysis) => {
      const nodes = new Map(
        analysis.graph.nodes.map((node) => [node.node_id, node]),
      );
      const windows = analysis.graph.nodes.filter(
        ({ kind }) => kind === "browser-window",
      );
      const utilities = analysis.graph.nodes.filter(
        ({ kind }) => kind === "electron-utility",
      );
      const windowIds = new Set(windows.map(({ node_id }) => node_id));
      const preloadLoads = analysis.graph.edges.filter(
        ({ source_node_id, relation }) =>
          windowIds.has(source_node_id) && relation === "loads",
      );
      const entrypointIds = new Set([
        ...preloadLoads.map(({ target_node_id }) => target_node_id),
        ...utilities.map(({ node_id }) => node_id),
      ]);
      // Several provenance edges can identify the same entrypoint asset.
      const assetMappings = new Map(
        analysis.graph.edges
          .filter(
            ({ source_node_id, relation }) =>
              entrypointIds.has(source_node_id) && relation === "maps_to",
          )
          .map(({ source_node_id, target_node_id, properties }) => {
            const identity = [
              nodes.get(source_node_id)?.kind,
              properties.resolved_path,
              properties.resolution_status,
              nodes
                .get(target_node_id)
                ?.observations.find(
                  ({ properties: target }) => typeof target.path === "string",
                )?.properties.path,
            ];
            return [
              canonicalJson(identity, "Electron entrypoint asset identity"),
              identity,
            ] as const;
          }),
      );
      return {
        summary: analysis.summary,
        windows: windows.flatMap(({ observations }) =>
          observations.map(({ properties }) => properties),
        ),
        utilities: utilities.flatMap(({ observations }) =>
          observations
            .filter(
              ({ evidence }) =>
                evidence.extractor.operation === "observe-utility-process-fork",
            )
            .map(({ properties }) => properties),
        ),
        preloadLoads: preloadLoads.map(({ properties }) => properties),
        assetMappings: [...assetMappings]
          .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
          .map(([, identity]) => identity),
      };
    };

    const [plain, wrapped] = applications.map(entrypointFacts);
    expect(plain).toMatchObject({
      summary: {
        browser_windows: 1,
        explicit_web_preferences: 1,
        preload_entrypoints: 1,
        utility_processes: 1,
        resolved_utility_entrypoints: 1,
      },
      windows: [
        {
          source_path: "input.ts",
          options_status: "object-literal",
          web_preferences_status: "object-literal",
          web_preferences: [
            {
              name: "preload",
              value: {
                status: "literal",
                value: preloadPath,
                expression: null,
              },
            },
          ],
          preload_path: preloadPath,
          preload_resolution_context: context,
          absence_means_default: false,
        },
      ],
      utilities: [
        {
          module_path: workerPath,
          module_resolution_context: context,
          module_expression: null,
          service_name: "kept",
        },
      ],
      preloadLoads: [
        {
          declared_path: preloadPath,
          resolution_context: context,
          resolved_path: "preload.js",
          resolution_status: "resolved",
          limitations: [],
        },
      ],
      assetMappings: [
        ["electron-preload", "preload.js", "resolved", "preload.js"],
        ["electron-utility", "worker.js", "resolved", "worker.js"],
      ],
    });
    expect(wrapped).toEqual(plain);
  },
);

it("applies TypeScript .mts ambiguity rules while retaining unambiguous generics", () => {
  expect(
    parseJavaScriptSource(
      "export const identity = <T,>(value: T) => value;",
      "app.mts",
    )?.errors,
  ).toEqual([]);
  expect(
    parseJavaScriptSource(
      "export const identity = <T>(value: T) => value;",
      "app.mts",
    )?.errors.map(({ reasonCode }) => reasonCode),
  ).toContain("ReservedArrowTypeParam");
  expect(parseJavaScriptSource("const value = <Widget />;", "app.mts")).toBe(
    null,
  );
});
