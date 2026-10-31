import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../../fixtures/temporaryDirectory.js";

import {
  analyzeJavaScriptApplication,
  reconstructJavaScriptArtifact,
} from "../../../support/javascriptApplicationScope.js";
import { parseEvidence } from "../../../../src/domain/evidence.js";
import { parseJavaScriptApplicationGraph } from "../../../../src/domain/javascript/javascriptApplicationGraph.js";
import { analyzeJavaScriptApplicationInputSchema } from "../../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { writeElectronBoundaryFixture } from "../../../fixtures/electronBoundaryApplication.js";

describe("static Electron application analysis", () => {
  it("accepts relative paths and rejects caller-selected analysis bounds", () => {
    expect(
      analyzeJavaScriptApplicationInputSchema.safeParse({
        input_path: "relative/app.asar",
      }).success,
    ).toBe(true);
    expect(
      analyzeJavaScriptApplicationInputSchema.safeParse({
        input_path: "/tmp/app.asar",
        limits: { max_findings: 200_000 },
      }).success,
    ).toBe(false);
  });

  it("maps windows, preload, contextBridge, IPC, validations, utility, and native boundaries without execution", async () => {
    const root = await fixtureDirectory();
    Reflect.deleteProperty(globalThis, "__rea_electron_fixture_executed");

    const first = await reconstructJavaScriptArtifact({ input_path: root });
    const second = await reconstructJavaScriptArtifact({ input_path: root });
    const graph = parseJavaScriptApplicationGraph(first.graph);

    expect(
      Reflect.get(globalThis, "__rea_electron_fixture_executed"),
    ).toBeUndefined();
    expect(first.graph).toEqual(second.graph);
    expectElectronSummary(first);
    expectElectronRoles(graph);
    expectElectronBoundaries(graph);
  });

  it("analyzes the selected local application directory directly", async () => {
    const root = await fixtureDirectory();

    const result = await analyzeJavaScriptApplication({
      input_path: root,
    });

    if (!result.ok) throw result.error;
    const evidence = parseEvidence(result.value);
    expect(evidence).toMatchObject({
      operation: "analyze_javascript_application",
      predicate_type: "rea.javascript-application-analysis",
      provider: { id: "rea-javascript-application" },
      authority: "shipped-artifact",
      confidence: "derived",
      subject: { local_path: root, format: "directory" },
      normalized_result: {
        input_path: root,
        summary: { browser_windows: 3 },
      },
    });
  });

  it(
    "keeps Electron runtime entrypoints on their declared filenames",
    exactRuntimeEntrypointFixture,
  );

  it("keeps computed identifier member keys unknown", async () => {
    const root = await computedMemberFixtureDirectory();

    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const graph = parseJavaScriptApplicationGraph(result.graph);
    const nativeBindings = graph.nodes.filter(
      (node) => node.kind === "native-export",
    );

    expect(result.electron_summary).toMatchObject({
      sender_validation_observations: 0,
      native_addon_bindings: 1,
      resolved_native_addon_bindings: 1,
    });
    expect(nativeBindings).toMatchObject([
      {
        observations: [
          {
            properties: {
              requested_members: [],
              namespace_access: false,
              dynamic_member_access: true,
              native_export_verification: "not-performed",
            },
          },
        ],
      },
    ]);
  });

  it("maps Electron boundaries through bundler-renamed bindings", async () => {
    const root = await renamedBindingFixtureDirectory();

    const result = await reconstructJavaScriptArtifact({ input_path: root });
    const graph = parseJavaScriptApplicationGraph(result.graph);
    const handledChannels = graph.nodes.flatMap(({ kind, observations }) =>
      kind === "ipc-handler"
        ? observations.flatMap(({ properties }) =>
            properties.side === "main" ? [properties.channel] : [],
          )
        : [],
    );

    expect(result.electron_summary).toMatchObject({
      browser_windows: 1,
      context_bridge_apis: 1,
      exposed_api_members: 2,
      ipc: {
        main_handlers: 2,
        paired_renderer_transmissions: 2,
        unpaired_literal_renderer_transmissions: 0,
      },
      utility_processes: 1,
    });
    expect(handledChannels.sort()).toEqual(["rea:read", "rea:write"]);
  });

  it("maps unchanged var and let require aliases while excluding reassigned bindings", async () => {
    const root = await requireAliasFixtureDirectory();

    const result = await reconstructJavaScriptArtifact({ input_path: root });

    expect(result.electron_summary.ipc).toMatchObject({
      main_handlers: 2,
      paired_renderer_transmissions: 2,
      unpaired_literal_renderer_transmissions: 0,
    });
  });

  it("returns a tagged cancellation without executing application code", async () => {
    const root = await fixtureDirectory();
    const controller = new AbortController();
    controller.abort();
    Reflect.deleteProperty(globalThis, "__rea_electron_fixture_executed");

    const result = await analyzeJavaScriptApplication(
      { input_path: root },
      { signal: controller.signal },
    );

    expect(result).toMatchObject({
      ok: false,
      error: { _tag: "ArtifactOperationError", reason: "cancelled" },
    });
    expect(
      Reflect.get(globalThis, "__rea_electron_fixture_executed"),
    ).toBeUndefined();
  });
});

describe("native addon association", () => {
  it.each([
    { native: false, associations: [] },
    {
      native: true,
      associations: [{ source: "native-addon", resolved: "addon.node" }],
    },
  ])(
    "associates a requested binding only with a resolved native addon (exact addon.node: $native)",
    async ({ native, associations }) => {
      const root = await createTestTempDirectory("rea-electron-addon-kind-");
      await Promise.all([
        writeFile(
          join(root, "main.js"),
          'const addon = require("./addon.node");\nvoid addon;\n',
        ),
        writeFile(
          join(root, "addon.node.js"),
          "module.exports = { requested: true };\n",
        ),
        ...(native
          ? [writeFile(join(root, "addon.node"), Buffer.from([0, 1, 2, 3]))]
          : []),
      ]);

      const result = await reconstructJavaScriptArtifact({ input_path: root });
      const graph = parseJavaScriptApplicationGraph(result.graph);
      const nodes = new Map(graph.nodes.map((node) => [node.node_id, node]));

      expect(result.electron_summary).toMatchObject({
        native_addon_bindings: 1,
        resolved_native_addon_bindings: native ? 1 : 0,
      });
      expect(
        graph.nodes.filter(({ kind }) => kind === "native-export"),
      ).toHaveLength(1);
      expect(
        graph.edges
          .filter(
            (edge) =>
              edge.evidence.extractor.operation ===
              "associate-native-addon-requested-exports",
          )
          .map((edge) => ({
            source: nodes.get(edge.source_node_id)?.kind,
            resolved: edge.properties.resolved_path,
          })),
      ).toEqual(associations);
    },
  );
});

const exactRuntimeEntrypointFixture = async (): Promise<void> => {
  const root = await createTestTempDirectory("rea-electron-exact-entrypoints-");
  await mkdir(join(root, "renderer/page"), { recursive: true });
  await Promise.all([
    writeFile(
      join(root, "main.cjs"),
      String.raw`
const { BrowserWindow, utilityProcess } = require("electron");
const path = require("node:path");
new BrowserWindow({ webPreferences: { preload: "./entry" } });
new BrowserWindow().loadURL("file:///renderer/index.html");
new BrowserWindow().loadURL("renderer/bare.html");
new BrowserWindow().loadURL("#home");
new BrowserWindow().loadURL("");
new BrowserWindow().loadURL("./renderer/other.html?theme=dark#home");
new BrowserWindow().loadURL("./renderer/missing.html");
new BrowserWindow().loadFile("./renderer/page");
new BrowserWindow({ webPreferences: { preload: path.join(__dirname, "preload") } });
new BrowserWindow({ webPreferences: { preload: "./explicit-preload.js" } });
utilityProcess.fork("./worker");
utilityProcess.fork("./worker#v1.js");
utilityProcess.fork("./service.js");
`,
    ),
    writeFile(join(root, "entry.html"), "<title>sibling</title>"),
    writeFile(join(root, "preload.html"), "<title>sibling</title>"),
    writeFile(join(root, "worker.js"), "module.exports = {};"),
    writeFile(join(root, "renderer/index.html"), "<title>renderer</title>"),
    writeFile(
      join(root, "renderer/bare.html"),
      "<title>bare renderer URL</title>",
    ),
    writeFile(join(root, "renderer/other.html"), "<title>other</title>"),
    writeFile(join(root, "renderer/missing.html.js"), "module.exports = {};"),
    writeFile(
      join(root, "renderer/page/index.html"),
      "<title>directory</title>",
    ),
    writeFile(join(root, "explicit-preload.js"), "module.exports = {};"),
    writeFile(join(root, "service.js"), "module.exports = {};"),
  ]);

  const result = await reconstructJavaScriptArtifact({ input_path: root });
  const graph = parseJavaScriptApplicationGraph(result.graph);
  expectSuffixOnlyRenderersUnresolved(graph);
  expectExactRendererPaths(graph);
  const roles = graph.nodes.filter(({ kind }) => kind === "electron-preload");
  const roleByDeclaration = new Map(
    roles.map((role) => [role.observations[0]?.properties.declared_path, role]),
  );

  expect(result.electron_summary.resolved_utility_entrypoints).toBe(2);
  for (const [declaredPath, candidatePath] of [
    ["./entry", "entry"],
    ["preload", "preload"],
  ]) {
    const role = roleByDeclaration.get(declaredPath);
    expect(role?.observations[0]?.properties).toMatchObject({
      declared_path: declaredPath,
      resolved_path: null,
      resolution_status: "not-found",
      candidate_path: candidatePath,
      limitations: [
        expect.stringContaining(
          "extension and directory fallback were not attempted",
        ),
      ],
    });
    expect(
      graph.edges.some(
        (edge) =>
          edge.source_node_id === role?.node_id && edge.relation === "maps_to",
      ),
    ).toBe(false);
  }
  expect(
    roleByDeclaration.get("./explicit-preload.js")?.observations[0]?.properties,
  ).toMatchObject({
    resolved_path: "explicit-preload.js",
    resolution_status: "resolved",
  });

  const utilityLaunches = graph.edges.filter(
    (edge) =>
      edge.evidence.extractor.operation === "map-utility-process-launch",
  );
  const resolvedWorker = utilityLaunches.find(
    (edge) => edge.properties.declared_path === "./worker",
  );
  expect(resolvedWorker?.evidence).toMatchObject({
    authority: "static-relationship-inference",
    state: "inferred",
    limitations: expect.arrayContaining([
      "Static syntax does not prove that this relationship executes at runtime.",
    ]),
  });
  expect(utilityLaunches).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        properties: expect.objectContaining({
          declared_path: "./worker",
          resolved_path: "worker.js",
          resolution_status: "resolved",
        }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          declared_path: "./worker#v1.js",
          resolved_path: null,
          resolution_status: "not-found",
        }),
      }),
      expect.objectContaining({
        properties: expect.objectContaining({
          declared_path: "./service.js",
          resolved_path: "service.js",
          resolution_status: "resolved",
        }),
      }),
    ]),
  );
  expect(
    graph.edges.some(
      (edge) =>
        edge.evidence.extractor.operation ===
          "resolve-utility-process-entrypoint" &&
        edge.properties.resolved_path === "worker.html",
    ),
  ).toBe(false);
};

type Reconstruction = Awaited<ReturnType<typeof reconstructJavaScriptArtifact>>;
type ApplicationGraph = ReturnType<typeof parseJavaScriptApplicationGraph>;

const expectSuffixOnlyRenderersUnresolved = (graph: ApplicationGraph): void => {
  const renderers = new Map(
    graph.nodes
      .filter(({ kind }) => kind === "electron-renderer")
      .map((renderer) => [
        renderer.observations[0]?.properties.declared_path,
        renderer,
      ]),
  );
  expect(
    renderers.get("file:///renderer/index.html")?.observations[0]?.properties,
  ).toMatchObject({
    resolved_path: "renderer/index.html",
    resolution_status: "resolved",
  });
  for (const declaredPath of [
    "./renderer/other.html?theme=dark#home",
    "renderer/bare.html",
    "./renderer/missing.html",
    "#home",
    "",
  ]) {
    const renderer = renderers.get(declaredPath);
    expect(renderer?.observations[0]?.properties).toMatchObject({
      resolved_path: null,
      resolution_status: "unavailable",
    });
    expect(renderer?.observations[0]?.properties.limitations).toEqual(
      expect.arrayContaining([
        expect.stringContaining("requires a URL protocol"),
      ]),
    );
    expect(
      graph.edges.some(
        (edge) =>
          edge.source_node_id === renderer?.node_id &&
          edge.relation === "maps_to",
      ),
    ).toBe(false);
  }
};

const expectExactRendererPaths = (graph: ApplicationGraph): void => {
  const renderers = new Map(
    graph.nodes
      .filter(({ kind }) => kind === "electron-renderer")
      .map((renderer) => [
        renderer.observations[0]?.properties.declared_path,
        renderer,
      ]),
  );
  for (const [declaredPath, candidatePath] of [
    ["./renderer/page", "renderer/page"],
  ]) {
    const renderer = renderers.get(declaredPath);
    expect(renderer?.observations[0]?.properties).toMatchObject({
      resolved_path: null,
      resolution_status: "not-found",
      candidate_path: candidatePath,
    });
    expect(
      graph.edges.some(
        (edge) =>
          edge.source_node_id === renderer?.node_id &&
          edge.relation === "maps_to",
      ),
    ).toBe(false);
  }
};

const expectElectronSummary = (result: Reconstruction): void => {
  expect(result.electron_summary).toMatchObject({
    browser_windows: 3,
    explicit_web_preferences: 8,
    preload_entrypoints: 1,
    context_bridge_apis: 2,
    exposed_api_members: 5,
    ipc: {
      literal_channels: 5,
      dynamic_channel_operations: 2,
      // Retained module gaps leave preload/renderer application ownership unknown.
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 7,
      unpaired_literal_renderer_transmissions: 0,
    },
    sender_validation_observations: 2,
    utility_processes: 1,
    resolved_utility_entrypoints: 1,
    native_addon_bindings: 4,
    resolved_native_addon_bindings: 4,
  });
};

const expectElectronRoles = (graph: ApplicationGraph): void => {
  expect(graph.nodes.map(({ kind }) => kind)).toEqual(
    expect.arrayContaining([
      "browser-window",
      "electron-preload",
      "context-bridge-api",
      "ipc-channel",
      "ipc-handler",
      "electron-utility",
      "native-addon",
      "native-export",
    ]),
  );
  const roles = graph.nodes.filter(({ kind }) =>
    ["electron-main", "electron-preload", "electron-renderer"].includes(kind),
  );
  expect(roles.length).toBeGreaterThanOrEqual(3);
  for (const role of roles) {
    for (const observation of role.observations)
      expect(observation.properties).toMatchObject({
        declared_path: expect.any(String),
        resolution_context: expect.stringMatching(
          /^(package-entrypoint|filesystem-expression|module-specifier|html-reference)$/u,
        ),
        resolution_status: expect.stringMatching(
          /^(resolved|not-found|unavailable|external|rejected)$/u,
        ),
        limitations: expect.any(Array),
      });
    if (
      role.observations.some(
        ({ properties }) => properties.resolution_status === "resolved",
      )
    )
      expect(
        graph.edges.some(
          (edge) =>
            edge.source_node_id === role.node_id && edge.relation === "maps_to",
        ),
      ).toBe(true);
  }
  const dirnamePreload = roles.find(
    ({ kind, observations }) =>
      kind === "electron-preload" &&
      observations.some(
        ({ properties }) =>
          properties.declared_path === "preload.js" &&
          properties.resolution_context === "filesystem-expression",
      ),
  );
  expect(dirnamePreload?.observations[0]?.properties).toMatchObject({
    declared_path: "preload.js",
    resolution_context: "filesystem-expression",
    resolved_path: "preload.js",
    resolution_status: "resolved",
    limitations: [],
  });
};

const expectElectronBoundaries = (graph: ApplicationGraph): void => {
  expect(graph.nodes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "browser-window",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              preload_path: "preload.js",
              absence_means_default: false,
              web_preferences: expect.arrayContaining([
                expect.objectContaining({
                  name: "nodeIntegration",
                  value: expect.objectContaining({
                    status: "literal",
                    value: true,
                  }),
                }),
              ]),
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "browser-window",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              web_preferences: expect.arrayContaining([
                expect.objectContaining({
                  name: "nodeIntegration",
                  value: expect.objectContaining({
                    status: "literal",
                    value: false,
                  }),
                }),
                expect.objectContaining({
                  name: "contextIsolation",
                  value: expect.objectContaining({
                    status: "literal",
                    value: true,
                  }),
                }),
              ]),
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "context-bridge-api",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              api_key: "reaApi",
              members: expect.arrayContaining([
                "nested",
                "nested.write",
                "read",
              ]),
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "ipc-handler",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              fact_kind: "sender-validation-candidate",
              enforcement: "unknown",
            }),
          }),
        ]),
      }),
      expect.objectContaining({
        kind: "native-export",
        observations: expect.arrayContaining([
          expect.objectContaining({
            properties: expect.objectContaining({
              native_export_verification: "not-performed",
            }),
          }),
        ]),
      }),
    ]),
  );
  const pairingEdges = graph.edges.filter(
    ({ properties }) =>
      properties.pairing_basis === "unique-exact-literal-channel",
  );
  expect(pairingEdges).toHaveLength(0);
  expect(graph.limitations.join(" ")).toMatch(/dynamic IPC|ambiguous/iu);
};

const fixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-boundaries-");
  await writeElectronBoundaryFixture(root);
  return root;
};

const requireAliasFixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-require-aliases-");
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-electron-require-aliases",
        main: "main.cjs",
      }),
    ),
    writeFile(
      join(root, "main.cjs"),
      String.raw`
var { ipcMain: main } = require("electron");
let listener = require("electron/main").ipcMain;
main.handle("rea:read", async () => "value");
listener.on("rea:write", () => undefined);

let replaced = require("electron").ipcMain;
replaced = { handle() {} };
replaced.handle("rea:reassigned", () => undefined);

var assignedLater;
assignedLater.handle("rea:before-assignment", () => undefined);
assignedLater = require("electron").ipcMain;

if (globalThis.registerIpc) {
  var conditional = require("electron").ipcMain;
}
conditional.handle("rea:conditional", () => undefined);
`,
    ),
    writeFile(
      join(root, "preload.cjs"),
      String.raw`
const { ipcRenderer } = require("electron");
ipcRenderer.invoke("rea:read");
ipcRenderer.send("rea:write", "value");
`,
    ),
  ]);
  return root;
};

const renamedBindingFixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-renamed-");
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({ name: "rea-electron-renamed", main: "main.mjs" }),
    ),
    // Bundlers rename colliding imports, e.g. esbuild's ipcMain2.
    writeFile(
      join(root, "main.mjs"),
      String.raw`
import { BrowserWindow as BrowserWindow2, ipcMain as ipcMain2 } from "electron";
import { ipcMain as ipcMain3, utilityProcess as utility } from "electron/main";

new BrowserWindow2({ webPreferences: { preload: "./preload.cjs" } });
ipcMain2.handle("rea:read", async () => "value");
ipcMain3.on("rea:write", () => undefined);
utility.fork("./worker.js");
function register(ipcMain2) {
  ipcMain2.handle("rea:shadowed", async () => "local");
}
export { register };
`,
    ),
    writeFile(
      join(root, "preload.cjs"),
      String.raw`
const { contextBridge: bridge, ipcRenderer: ipc } = require("electron");
bridge.exposeInMainWorld("reaApi", {
  read: () => ipc.invoke("rea:read"),
  write: (value) => ipc.send("rea:write", value),
});
`,
    ),
    writeFile(join(root, "worker.js"), "module.exports = {};"),
  ]);
  return root;
};

const computedMemberFixtureDirectory = async (): Promise<string> => {
  const root = await createTestTempDirectory("rea-electron-computed-members-");
  await mkdir(join(root, "native"));
  await Promise.all([
    writeFile(
      join(root, "main.js"),
      String.raw`
const member = "read";
const selected = require("./native/addon.node")[member];
const startsWith = "includes";
function validate(event) {
  return event.senderFrame.url[startsWith]("file://");
}
module.exports = { selected, validate };
`,
    ),
    writeFile(join(root, "native", "addon.node"), Buffer.from([0, 1, 2, 3])),
  ]);
  return root;
};
