import { expect } from "vitest";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

cliTest.for(["CLI", "stdio MCP"] as const)(
  "retains a switch selection on Electron bridge paths through %s",
  async (surface, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-switch-");
    await writeFixtureFiles(root, {
      "package.json": JSON.stringify({
        name: "switch",
        version: "1",
        main: "main.js",
      }),
      "main.js": `const { BrowserWindow, ipcMain } = require("electron");
        ipcMain.handle("ping", () => "pong");
        new BrowserWindow({ webPreferences: { preload: "preload.js" } });`,
      "preload.js": `const { contextBridge, ipcRenderer } = require("electron");
        switch (process.platform) {
          case "win32":
            contextBridge.exposeInMainWorld("api", { ping: () => ipcRenderer.invoke("ping") });
        }`,
    });
    const result = await analyzeJavaScriptDirectory(surface, cli, root);
    const edges = result.graph.edges.filter(
      (edge) =>
        edge.evidence.extractor.operation === "trace-electron-wrapper-path",
    );
    expect(edges.length).toBeGreaterThan(0);
    for (const edge of edges)
      expect(edge.properties.conditions).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            expression: '((process.platform) === ("win32"))',
          }),
        ]),
      );
  },
);
