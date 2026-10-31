import { expect, it } from "vitest";

import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

it.each([
  ["webContents", "window.webContents.ipc"],
  ["main frame", "window.webContents.mainFrame.ipc"],
] as const)(
  "retains a proven %s IPC handler beside the global control",
  (_, receiver) => {
    const analysis = analyzeJavaScriptStaticSource(`
    const { BrowserWindow, ipcMain } = require("electron");
    const window = new BrowserWindow();
    ipcMain.handle("global-control", () => "global");
    ${receiver}.handle("scoped-channel", () => "scoped");
  `);
    expect(analysis.parse_error_count).toBe(0);
    expect(analysis.electron.browser_windows).toHaveLength(1);
    expect(analysis.electron.ipc).toContainEqual(
      expect.objectContaining({
        side: "main",
        operation: "handle",
        channel: "global-control",
        handler_kind: "inline-function",
      }),
    );
    expect(analysis.electron.ipc).toContainEqual(
      expect.objectContaining({
        side: "main",
        operation: "handle",
        channel: "scoped-channel",
        handler_kind: "inline-function",
      }),
    );
  },
);

it("does not label lookalike or shadowed receivers as Electron IPC", () => {
  const analysis = analyzeJavaScriptStaticSource(`
    const { BrowserWindow, ipcMain } = require("electron");
    ipcMain.handle("global-control", () => "global");
    const fake = { webContents: { ipc: { handle() {} } } };
    fake.webContents.ipc.handle("fake", () => {});
    function shadow(BrowserWindow) {
      const window = new BrowserWindow();
      window.webContents.ipc.handle("shadowed", () => {});
    }
  `);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.electron.ipc.map(({ channel }) => channel)).toEqual([
    "global-control",
  ]);
});

it.each([
  [
    'const contents = window.webContents; contents.ipc.handle("same", () => {});',
    "web-contents",
  ],
  [
    'const frame = window.webContents.mainFrame; frame.ipc.handle("same", () => {});',
    "main-frame",
  ],
  [
    'const contents = window.webContents; const frame = contents.mainFrame; const ipc = frame.ipc; ipc.handle("same", () => {});',
    "main-frame",
  ],
])("retains a proven scoped alias: %s", (call, kind) => {
  const findings =
    analyzeJavaScriptStaticSource(`const { BrowserWindow } = require("electron");
    const window = new BrowserWindow(); ${call}`).electron.ipc;
  expect(findings).toHaveLength(1);
  expect(findings[0]?.receiver).toEqual({
    kind,
    owner_location: {
      start: { line: 2, column: 19 },
      end: { line: 2, column: 38 },
    },
  });
});

it("keeps the shared owner's conservative omission after an aliased receiver call", () => {
  const findings =
    analyzeJavaScriptStaticSource(`const { BrowserWindow } = require("electron");
    const window = new BrowserWindow();
    const ipc = window.webContents.mainFrame.ipc;
    ipc.handle("first", () => {});
    window.webContents.mainFrame.ipc.on("after-escape", () => {});`).electron
      .ipc;
  expect(findings.map(({ channel }) => channel)).toEqual(["first"]);
});

it.each([
  "window.webContents = replacement;",
  "window.webContents.ipc = replacement;",
  "window.webContents.ipc.handle = replacement;",
  "const alias = window; alias.webContents.ipc.handle = replacement;",
  "const contents = window.webContents; contents.ipc = replacement;",
  "BrowserWindow.prototype.webContents = replacement;",
])("omits a mutated receiver: %s", (mutation) => {
  const analysis = analyzeJavaScriptStaticSource(`
    const { BrowserWindow } = require("electron");
    const window = new BrowserWindow();
    ${mutation}
    window.webContents.ipc.handle("changed", () => {});
  `);
  expect(analysis.parse_error_count).toBe(0);
  expect(analysis.electron.ipc).toEqual([]);
});

it.each(["webContents.ipc", "webContents.mainFrame.ipc"])(
  "does not split one dotted member key into receiver segments: %s",
  (key) => {
    expect(
      analyzeJavaScriptStaticSource(`const {BrowserWindow} = require("electron");
    const window = new BrowserWindow(); window[${JSON.stringify(key)}].handle("fake", () => {});`)
        .electron.ipc,
    ).toEqual([]);
  },
);
