import { expect } from "vitest";

import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { analyzeJavaScriptDirectory } from "../../support/cli/javascriptApplication.js";
import { writeFixtureFiles } from "../../support/javascriptApplicationFixture.js";

const window = `const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");
const win = new BrowserWindow({ webPreferences: { preload: path.join(__dirname, "preload.js") } });`;
const sends = `const { ipcRenderer } = require("electron");
ipcRenderer.send("app:log", 1);
ipcRenderer.invoke("app:get");`;

const cases = [
  {
    // An unresolved channel may receive app:log; it never handles invoke.
    shape: "a directly registered computed channel",
    main: `ipcMain.on(process.env.CHANNEL, () => {});
ipcMain.handle("app:get", () => 1);`,
    preload: sends,
    pairing: { paired: 1, ambiguous: 1, unpaired: 0 },
  },
  {
    shape: "a wrapper with one computed call site",
    main: `function register(channel, handler) { ipcMain.on(channel, handler); }
register("app:log", () => {});
register(process.env.CHANNEL, () => {});`,
    preload: sends,
    pairing: { paired: 0, ambiguous: 1, unpaired: 1 },
  },
  {
    // Importers of the wrapper can register channels this file never names.
    shape: "an exported wrapper",
    main: `function register(channel, handler) { ipcMain.on(channel, handler); }
register("other", () => {});
module.exports = register;`,
    preload: sends,
    pairing: { paired: 0, ambiguous: 1, unpaired: 1 },
  },
  {
    // Every call site supplies a literal; the guarded one competes only for
    // its own channel, so app:log still pairs with its finding.
    shape: "a wrapper whose call sites are all literal",
    main: `function register(channel, handler) { ipcMain.on(channel, handler); }
register("app:log", () => {});
if (process.env.EXTRA) register("other", () => {});`,
    preload: sends,
    pairing: { paired: 1, ambiguous: 0, unpaired: 1 },
  },
  {
    // A guarded registration has no IPC finding, yet it may receive app:log.
    shape: "a guarded wrapper registration",
    main: `function register(channel, handler) { ipcMain.on(channel, handler); }
if (process.env.EXTRA) register("app:log", () => {});`,
    preload: sends,
    pairing: { paired: 0, ambiguous: 1, unpaired: 1 },
  },
  {
    // The guarded registration competes with the direct handler on app:log.
    shape: "a guarded wrapper registration and a direct handler",
    main: `function register(channel, handler) { ipcMain.on(channel, handler); }
if (process.env.EXTRA) register("app:log", () => {});
ipcMain.on("app:log", () => {});`,
    preload: sends,
    pairing: { paired: 0, ambiguous: 1, unpaired: 1 },
  },
  {
    // A renderer listener and a main-to-renderer send receive no renderer sends.
    shape: "computed channels in other directions",
    main: `ipcMain.on("app:log", () => {});
win.webContents.send(process.env.CHANNEL, 1);`,
    preload: `const { ipcRenderer } = require("electron");
ipcRenderer.on(process.env.CHANNEL, () => {});
ipcRenderer.send("app:log", 1);`,
    pairing: { paired: 1, ambiguous: 0, unpaired: 0 },
  },
] as const;

for (const surface of ["CLI", "stdio MCP"] as const)
  cliTest.for(cases)(
    `keeps literal sends unknown beside $shape through ${surface}`,
    async ({ main, preload, pairing }, { cli }) => {
      const root = await createTestTempDirectory("rea-electron-dynamic-ipc-");
      await writeFixtureFiles(root, {
        "package.json": JSON.stringify({
          name: "dynamic-ipc",
          version: "1.0.0",
          main: "main.js",
        }),
        "main.js": `${window}\n${main}`,
        "preload.js": preload,
      });
      const { summary } = await analyzeJavaScriptDirectory(surface, cli, root);
      expect(summary.ipc).toMatchObject({
        paired_renderer_transmissions: pairing.paired,
        ambiguous_renderer_transmissions: pairing.ambiguous,
        unpaired_literal_renderer_transmissions: pairing.unpaired,
      });
    },
  );
