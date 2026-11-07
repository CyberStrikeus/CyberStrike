import { writeFile } from "node:fs/promises";
import { join } from "node:path";

/** A source-only Electron application whose API values flow through aliases. */
export const electronApiAliasSources = {
  main: String.raw`
const { BrowserWindow } = require("electron");
const Win = BrowserWindow;
const electron = require("electron");
const ipc = electron.ipcMain;
new Win({ webPreferences: { preload: "./preload.cjs" } });
ipc.handle("alias:ping", (_event, payload) => payload);
function shadow(BrowserWindow, ipcMain) {
  new BrowserWindow({ webPreferences: { preload: "./not-real.cjs" } });
  ipcMain.handle("shadowed:ping", () => null);
}
const fakeIpc = { handle() {} };
fakeIpc.handle("lookalike:ping", () => null);
const nestedElectronExport = require("electron").notAnApi;
nestedElectronExport.ipcMain.handle("nested-lookalike:ping", () => null);
require("electron")["ipcMain.handle"]("dotted-lookalike:ping", () => null);
let reassigned = ipc;
reassigned = fakeIpc;
reassigned.handle("reassigned:ping", () => null);
`,
  preload: String.raw`
const { contextBridge, ipcRenderer } = require("electron");
const bridge = contextBridge;
const renderer = ipcRenderer;
bridge.exposeInMainWorld("api", {
  ping: (payload) => renderer.invoke("alias:ping", payload),
});
function shadow(contextBridge, ipcRenderer) {
  contextBridge.exposeInMainWorld("shadowed", {});
  ipcRenderer.invoke("shadowed:ping");
}
const fakeBridge = { exposeInMainWorld() {} };
fakeBridge.exposeInMainWorld("lookalike", {});
`,
} as const;

export const writeElectronApiAliasApplication = async (
  root: string,
): Promise<void> => {
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-electron-api-alias-fixture",
        version: "1.0.0",
        main: "main.cjs",
      }),
    ),
    writeFile(join(root, "main.cjs"), electronApiAliasSources.main),
    writeFile(join(root, "preload.cjs"), electronApiAliasSources.preload),
  ]);
};
