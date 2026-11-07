import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";
import { z } from "zod";

import { javascriptApplicationAnalysisResultSchema } from "../../../src/domain/javascript/javascriptApplicationAnalysis.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for([
  {
    shape: "one constant-channel send",
    preload: `const PING = "ping";
      contextBridge.exposeInMainWorld("api",{sendPing:()=>ipcRenderer.send(PING)});`,
    counts: { operations: 2, renderer_transmissions: 1 },
    dynamic: 0,
  },
  {
    shape: "two constant-channel sends",
    preload: `const PING = "ping";
      contextBridge.exposeInMainWorld("api",{
        sendPing:()=>ipcRenderer.send(PING),
        sendAgain:()=>ipcRenderer.send(PING),
      });`,
    counts: { operations: 3, renderer_transmissions: 2 },
    dynamic: 0,
  },
  {
    // The helper parameter stays unresolved beside the one resolved candidate.
    shape: "a helper-forwarded channel",
    preload: `const forward = (ch, v) => ipcRenderer.send(ch, v);
      contextBridge.exposeInMainWorld("api",{forwarded:()=>forward("ping")});`,
    counts: { operations: 3, renderer_transmissions: 2 },
    dynamic: 1,
  },
])(
  "counts each renderer IPC observation once for $shape",
  async ({ preload, counts, dynamic }, { cli }) => {
    const root = await createTestTempDirectory("rea-electron-ipc-constant-");
    await Promise.all([
      writeFile(
        join(root, "package.json"),
        JSON.stringify({
          name: "ipc-const",
          version: "1.0.0",
          main: "main.js",
        }),
      ),
      writeFile(
        join(root, "main.js"),
        `const {app,BrowserWindow,ipcMain}=require("electron");
         ipcMain.on("ping",()=>{});
         app.whenReady().then(()=>new BrowserWindow({webPreferences:{preload:"./preload.js"}}));`,
      ),
      writeFile(
        join(root, "preload.js"),
        `const {contextBridge,ipcRenderer}=require("electron");
         ${preload}`,
      ),
      writeFile(join(root, "index.html"), "<!doctype html><html></html>\n"),
    ]);

    const response = await cli.run({
      arguments: ["analyze-javascript-application", root, "--json"],
    });
    expect(response.exitCode, response.stderr).toBe(0);
    const { normalized_result: application } = z
      .object({ normalized_result: javascriptApplicationAnalysisResultSchema })
      .parse(response.json);
    expect(application.summary.ipc).toMatchObject({
      ...counts,
      dynamic_channel_operations: dynamic,
    });
  },
);
