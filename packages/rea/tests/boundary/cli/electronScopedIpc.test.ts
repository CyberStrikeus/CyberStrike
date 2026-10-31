import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "preserves scoped IPC allocations without global dispatch pairing through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-scoped-ipc-");
    const copy = `const {BrowserWindow}=require("electron"); const window=new BrowserWindow(); window.webContents.ipc.handle("copied",()=>{});`;
    await writeFixtureFiles(root, {
      "copy-one.cjs": copy,
      "copy-two.cjs": copy,
      "main.cjs": `const { BrowserWindow, ipcMain } = require("electron");
        const first = new BrowserWindow();
        const second = new BrowserWindow();
        first.webContents.mainFrame.ipc.handle("shared", () => "first");
        second.webContents.mainFrame.ipc.handle("shared", () => "second");
        ipcMain.handle("shared", () => "global");
        const dynamicWindow = new BrowserWindow();
        dynamicWindow.webContents.ipc.handle(dynamicChannel, () => "dynamic");
        ipcMain.handle("dynamic-shadow", () => "global");
        const fake = { webContents: { ipc: { handle() {} } } };
        fake.webContents.ipc.handle("fake", () => {});`,
      "preload.cjs": `const { ipcRenderer } = require("electron");
        ipcRenderer.invoke("shared");
        ipcRenderer.invoke("dynamic-shadow");`,
    });
    const application = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(application.statistics.parse_failures).toBe(0);
    expect(application.summary.ipc).toMatchObject({
      operations: 9,
      main_handlers: 7,
      renderer_transmissions: 2,
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 2,
    });
    const channels = application.graph.nodes.filter(
      ({ kind }) => kind === "ipc-channel",
    );
    const copies = application.graph.nodes.filter(
      ({ kind, observations }) =>
        kind === "ipc-handler" &&
        observations.some(({ properties }) => properties.channel === "copied"),
    );
    expect(copies).toHaveLength(2);
    expect(
      channels.filter(({ observations }) =>
        observations.some(({ properties }) => properties.channel === "copied"),
      ),
    ).toHaveLength(2);
    const shared = channels.filter(({ observations }) =>
      observations.some(({ properties }) => properties.channel === "shared"),
    );
    expect(shared).toHaveLength(3);
    const scoped = shared.filter(({ observations }) =>
      observations.some(({ properties }) => properties.receiver !== undefined),
    );
    expect(scoped).toHaveLength(2);
    const owners = scoped.flatMap(({ observations }) =>
      observations.map(({ properties }) => properties.receiver),
    );
    expect(new Set(owners.map((owner) => JSON.stringify(owner))).size).toBe(2);
    expect(
      channels.some(({ observations }) =>
        observations.some(({ properties }) => properties.channel === "fake"),
      ),
    ).toBe(false);
    expect(
      application.graph.edges.filter(
        ({ evidence }) =>
          evidence.extractor.operation === "pair-ipc-literal-channel",
      ),
    ).toEqual([]);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "does not uniquely pair a renderer with exactly one scoped literal handler through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-single-scoped-ipc-");
    await writeFixtureFiles(root, {
      "main.cjs": `const { BrowserWindow } = require("electron");
        const window = new BrowserWindow();
        window.webContents.mainFrame.ipc.handle("only-scoped", () => "result");`,
      "preload.cjs": `const { ipcRenderer } = require("electron");
        ipcRenderer.invoke("only-scoped");`,
    });
    const application = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(application.summary.ipc).toMatchObject({
      operations: 2,
      main_handlers: 1,
      renderer_transmissions: 1,
      dynamic_channel_operations: 0,
      paired_renderer_transmissions: 0,
      ambiguous_renderer_transmissions: 1,
    });
    const handlers = application.graph.nodes.filter(
      ({ kind }) => kind === "ipc-handler",
    );
    expect(handlers).toHaveLength(1);
    expect(handlers[0]?.observations[0]?.properties.receiver).toMatchObject({
      kind: "main-frame",
    });
    expect(
      application.graph.edges.filter(
        ({ evidence }) =>
          evidence.extractor.operation === "pair-ipc-literal-channel",
      ),
    ).toEqual([]);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "pairs literal IPC within proven application owners through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-application-ipc-");
    await writeFixtureFiles(root, {
      "a/package.json": JSON.stringify({ name: "a", main: "main.cjs" }),
      "a/main.cjs": `const { ipcMain, clipboard } = require("electron");
        ipcMain.handle("shared", (event, value) => clipboard.writeText(value));`,
      "a/preload.cjs": `const { ipcRenderer, contextBridge } = require("electron");
        contextBridge.exposeInMainWorld("api", { read: (value) => ipcRenderer.invoke("shared", value) });`,
      "b/package.json": JSON.stringify({ name: "b", main: "main.cjs" }),
      "b/main.cjs": `const { ipcMain, clipboard } = require("electron");
        ipcMain.handle("shared", (event, value) => clipboard.writeText(value));`,
      "b/preload.cjs": `const { ipcRenderer, contextBridge } = require("electron");
        contextBridge.exposeInMainWorld("api", { read: (value) => ipcRenderer.invoke("shared", value) });`,
    });
    const application = await analyzeJavaScriptDirectory(surface, cli, root);
    expect(application.summary.ipc).toMatchObject({
      operations: 4,
      paired_renderer_transmissions: 2,
      ambiguous_renderer_transmissions: 0,
    });
    const pairs = application.graph.edges.filter(
      ({ evidence }) =>
        evidence.extractor.operation === "pair-ipc-literal-channel",
    );
    const joins = application.graph.edges.filter(
      ({ evidence }) =>
        evidence.extractor.operation === "join-electron-wrapper-paths",
    );
    expect(joins).toHaveLength(2);
    expect(
      new Set(joins.map(({ target_node_id }) => target_node_id)).size,
    ).toBe(2);
    const nodes = new Map(
      application.graph.nodes.map((node) => [node.node_id, node]),
    );
    for (const join of joins) {
      const target = nodes.get(join.target_node_id);
      expect(target?.observations).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            evidence: expect.objectContaining({
              location: expect.objectContaining({
                available: true,
                value: expect.objectContaining({
                  source: join.properties.handler_path,
                }),
              }),
            }),
          }),
        ]),
      );
    }
    expect(pairs).toHaveLength(2);
    expect(
      new Set(pairs.map(({ target_node_id }) => target_node_id)).size,
    ).toBe(2);
    expect(
      application.graph.nodes.filter(({ kind }) => kind === "ipc-handler"),
    ).toHaveLength(2);
    for (const edge of pairs) {
      expect(edge.evidence.location.available).toBe(true);
      const location = edge.evidence.location;
      if (!location.available || location.value.kind !== "source-range")
        throw new Error("IPC pairing omitted its authored source location");
      expect(edge.properties.handler_path).toBe(
        location.value.source.startsWith("a/") ? "a/main.cjs" : "b/main.cjs",
      );
    }
    expect(
      application.graph.nodes.filter(({ kind }) => kind === "ipc-channel"),
    ).toHaveLength(2);
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains unknown IPC applicability across distinct or shared application owners through %s",
  async (surface, { cli }) => {
    for (const sharedSource of [false, true]) {
      const root = await createTestTempDirectory(
        "rea-unknown-application-ipc-",
      );
      await writeFixtureFiles(root, {
        "a/package.json": JSON.stringify({ name: "a", main: "main.cjs" }),
        "a/main.cjs": sharedSource
          ? `require("../shared.cjs");`
          : `module.exports = {};`,
        "b/package.json": JSON.stringify({ name: "b", main: "main.cjs" }),
        "b/main.cjs": `const { ipcMain } = require("electron");
          ${sharedSource ? 'require("../shared.cjs");' : ""}
          ipcMain.handle("shared", () => "result");`,
        [sharedSource ? "shared.cjs" : "a/preload.cjs"]:
          `const { ipcRenderer } = require("electron"); ipcRenderer.invoke("shared");`,
      });
      const application = await analyzeJavaScriptDirectory(surface, cli, root);
      expect(application.summary.ipc).toMatchObject({
        operations: 2,
        paired_renderer_transmissions: 0,
        ambiguous_renderer_transmissions: 1,
        unpaired_literal_renderer_transmissions: 0,
      });
      expect(
        application.graph.edges.filter(({ evidence }) =>
          ["pair-ipc-literal-channel", "join-electron-wrapper-paths"].includes(
            evidence.extractor.operation,
          ),
        ),
      ).toEqual([]);
      expect(
        application.graph.nodes.filter(({ kind }) => kind === "ipc-handler"),
      ).toHaveLength(1);
    }
  },
);

cliTest.for(["CLI", "stdio MCP"] as const)(
  "keeps unexamined external package effects unknown without obscuring builtins through %s",
  async (surface, { cli }) => {
    for (const [label, extra, expected] of [
      ["builtins", `require("node:path");`, "paired"],
      ["external", `require("unobserved-package");`, "ambiguous"],
      ["dynamic", `require(unknownName);`, "ambiguous"],
      ["native", `require("./addon.node");`, "ambiguous"],
    ] as const) {
      const root = await createTestTempDirectory("rea-external-ipc-owner-");
      await writeFixtureFiles(root, {
        "package.json": JSON.stringify({ name: "app", main: "main.cjs" }),
        "main.cjs": `const {ipcMain}=require("electron"); ${extra} ipcMain.handle("known",()=>1);`,
        "preload.cjs": `const {ipcRenderer}=require("electron"); ipcRenderer.invoke("known");`,
        ...(label === "native" ? { "addon.node": "fixture" } : {}),
      });
      const application = await analyzeJavaScriptDirectory(surface, cli, root);
      expect(application.summary.ipc, label).toMatchObject({
        paired_renderer_transmissions: expected === "paired" ? 1 : 0,
        ambiguous_renderer_transmissions: expected === "ambiguous" ? 1 : 0,
      });
    }
  },
);
