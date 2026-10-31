import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/** Write a source-owned Electron boundary fixture; none of its code is executed. */
export const writeElectronBoundaryFixture = async (
  root: string,
): Promise<void> => {
  await Promise.all([
    mkdir(join(root, "renderer"), { recursive: true }),
    mkdir(join(root, "utility"), { recursive: true }),
    mkdir(join(root, "native"), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "rea-electron-boundary-fixture",
        version: "1.0.0",
        main: "main.js",
        renderer: "renderer/index.html",
      }),
    ),
    writeFile(join(root, "main.js"), MAIN_SOURCE),
    writeFile(join(root, "preload.js"), PRELOAD_SOURCE),
    writeFile(join(root, "renderer", "renderer.js"), RENDERER_SOURCE),
    writeFile(
      join(root, "renderer", "index.html"),
      "<script src='./renderer.js'></script>",
    ),
    writeFile(join(root, "utility", "worker.js"), UTILITY_SOURCE),
    writeFile(join(root, "native", "addon.node"), Buffer.from([0, 1, 2, 3])),
  ]);
};

const MAIN_SOURCE = String.raw`
const path = require("node:path");
const { BrowserWindow, ipcMain, utilityProcess } = require("electron");
const { read, write: nativeWrite } = require("./native/addon.node");

new BrowserWindow({
  width: 900,
  webPreferences: {
    preload: path.join(__dirname, "preload.js"),
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    webSecurity: false,
  },
});
new BrowserWindow({
  webPreferences: {
    nodeIntegration: false,
    contextIsolation: true,
    sandbox: true,
  },
});
new BrowserWindow(windowOptions);

ipcMain.handle("rea:read", async (event, key) => {
  if (!event.senderFrame.url.startsWith("file://")) throw new Error("denied");
  return read(key);
});
ipcMain.on("rea:write", (event, value) => {
  if (event.sender.getURL() !== "file://fixture/index.html") return;
  nativeWrite(value);
});
ipcMain.handle("rea:ambiguous", async () => 1);
ipcMain.handle("rea:ambiguous", async () => 2);
ipcMain.handle(dynamicChannel, dynamicHandler);

utilityProcess.fork("./utility/worker.js", [], { serviceName: "fixture-db" });
module.exports.nativeRead = require("./native/addon.node").read;

globalThis.__rea_electron_fixture_executed = true;
throw new Error("Electron boundary fixture must never execute");
`;

const PRELOAD_SOURCE = String.raw`
const { contextBridge, ipcRenderer } = require("electron");
const { read, write } = require("./native/addon.node");

contextBridge.exposeInMainWorld("reaApi", {
  read: (key) => ipcRenderer.invoke("rea:read", key),
  nested: {
    write: (value) => ipcRenderer.send("rea:write", value),
  },
  nativeRead: read,
  nativeWrite: write,
});
contextBridge.exposeInMainWorld(dynamicApiKey, dynamicApi);
ipcRenderer.on("rea:event", (_event, value) => console.log(value));
ipcRenderer.invoke("rea:ambiguous");
ipcRenderer.invoke("rea:missing");
ipcRenderer.invoke(dynamicChannel);
`;

const RENDERER_SOURCE = String.raw`
const { ipcRenderer } = require("electron");
ipcRenderer.invoke("rea:read", "renderer-key");
ipcRenderer.send("rea:write", "renderer-value");
ipcRenderer.on("rea:event", (_event, value) => console.log(value));
`;

const UTILITY_SOURCE = String.raw`
const addon = require("../native/addon.node");
module.exports = addon;
`;
