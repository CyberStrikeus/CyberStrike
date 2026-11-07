import { requireMcpToolError } from "../../lib/mcp-verifier-results.mjs";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import Ajv2020 from "ajv/dist/2020.js";

import {
  cleanupOwnedProcessGroup,
  readProcessRunId,
} from "../../../dist/process/ProcessOwnership.js";

const execute = promisify(execFile);

/** Exercise public Electron tools and cancellation using a real owned application. */
export async function verifyElectronToolContracts({
  executable,
  repositoryRoot,
}) {
  const root = await realpath(
    await mkdtemp(join(tmpdir(), "rea-electron-e2e-")),
  );
  const main = join(root, "main.cjs");
  const preload = join(root, "preload.cjs");
  const ready = join(root, "ready");
  const entrypoint = join(repositoryRoot, "scripts", "rea.mjs");
  const runId = randomUUID();
  await writeFile(
    main,
    `const electron = require("electron");
const path = require("node:path");
const { app, BrowserWindow, ipcMain } = electron;
const Window = BrowserWindow;
const mainIpc = ipcMain;
app.whenReady().then(() => {
  const window = new Window({
    webPreferences: { preload: path.join(__dirname, "preload.cjs") },
  });
  window.loadFile("renderer.html");
  require("node:fs").writeFileSync(${JSON.stringify(ready)}, "ready");
});
mainIpc.handle("fixture:echo", (_event, value) => ({ value }));`,
  );
  await writeFile(
    join(root, "renderer.html"),
    `<!doctype html>
<button id="run">Run</button>
<output id="result"></output>
<script src="renderer.js"></script>`,
  );
  await writeFile(
    preload,
    `const electron = require("electron");
const { contextBridge, ipcRenderer } = electron;
const bridge = contextBridge;
const rendererIpc = ipcRenderer;
bridge.exposeInMainWorld("fixture", {
  echo: (value) => rendererIpc.invoke("fixture:echo", value),
});`,
  );
  await writeFile(
    join(root, "renderer.js"),
    `document.querySelector("#run").addEventListener("click", async () => {
  const result = await window.fixture.echo("renderer");
  document.querySelector("#result").textContent = result.value;
});`,
  );
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [entrypoint, "mcp"],
    env: {
      ...Object.fromEntries(
        ["DISPLAY", "XAUTHORITY", "WAYLAND_DISPLAY"].flatMap((name) =>
          process.env[name] === undefined ? [] : [[name, process.env[name]]],
        ),
      ),
      PATH: process.env.PATH,
      REA_LOG_LEVEL: "silent",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured/hopper",
    },
    stderr: "pipe",
  });
  const client = new Client({ name: "electron-real-e2e", version: "1" });
  let serverStderr = "";
  transport.stderr?.on("data", (chunk) => {
    serverStderr += chunk.toString();
  });
  let application;
  let stderr = "";
  try {
    await readProcessRunId(process.pid);
    application = spawn(
      executable,
      [
        "--remote-debugging-address=127.0.0.1",
        "--remote-debugging-port=0",
        `--user-data-dir=${join(root, "profile")}`,
        main,
      ],
      {
        cwd: root,
        env: { ...process.env, REA_PROCESS_RUN_ID: runId },
        detached: true,
        stdio: ["ignore", "ignore", "pipe"],
      },
    );
    application.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    const endpoint = await waitForEndpoint(application, () => stderr);
    await client.connect(transport);
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validators = new Map(
      (await client.listTools()).tools.map((tool) => {
        ajv.compile(tool.inputSchema);
        return [
          tool.name,
          tool.outputSchema
            ? (tool.outputSchema.$id && ajv.getSchema(tool.outputSchema.$id)) ||
              ajv.compile(tool.outputSchema)
            : undefined,
        ];
      }),
    );
    const call = async (name, arguments_) => {
      console.log(`PROBE ${name}`);
      const result = await client.callTool(
        { name, arguments: arguments_ },
        { timeout: 150_000 },
      );
      assert.notEqual(result.isError, true, JSON.stringify(result));
      const validate = validators.get(name);
      assert.ok(
        validate?.(result.structuredContent),
        JSON.stringify(validate?.errors),
      );
      return result.structuredContent;
    };
    let targets;
    for (let attempt = 0; attempt < 30; attempt++) {
      targets = await call("list_electron_targets", { cdp_endpoint: endpoint });
      if (targets.normalized_result.targets.length > 0) break;
      await pause(100);
    }
    const target = targets.normalized_result.targets.find(
      (item) => item.file_path === join(root, "renderer.html"),
    );
    assert.ok(target, JSON.stringify(targets));
    const page = await call("inspect_electron_page", {
      cdp_endpoint: endpoint,
      target_id: target.target_id,
      include_script_sources: true,
      observation_ms: 50,
    });
    assert.ok(
      page.normalized_result.scripts.items.some(
        (script) =>
          script.file_path === join(root, "renderer.js") &&
          script.source.included,
      ),
    );
    const staticAnalysis = await call("analyze_javascript_application", {
      input_path: root,
    });
    assert.equal(staticAnalysis.normalized_result.summary.browser_windows, 1);
    assert.equal(
      staticAnalysis.normalized_result.summary.preload_entrypoints,
      1,
    );
    assert.equal(
      staticAnalysis.normalized_result.summary.context_bridge_apis,
      1,
    );
    assert.equal(staticAnalysis.normalized_result.summary.ipc.main_handlers, 1);
    assert.equal(
      staticAnalysis.normalized_result.summary.ipc.renderer_transmissions,
      1,
    );
    assert.equal(
      staticAnalysis.normalized_result.summary.ipc
        .paired_renderer_transmissions,
      1,
    );
    const reconciled = await call("reconcile_javascript_runtime", {
      static_layers: [
        {
          analysis: staticAnalysis,
          runtime_mappings: [{ kind: "file-root", root }],
        },
      ],
      runtime_observations: [page],
    });
    assert.ok(reconciled.normalized_result.runtime_captures.length > 0);
    const cli = await execute(
      process.execPath,
      [
        entrypoint,
        "inspect-electron-page",
        endpoint,
        target.target_id,
        "--include-script-sources",
        "--json",
      ],
      {
        env: { ...process.env, REA_LOG_LEVEL: "silent" },
        timeout: 60_000,
        maxBuffer: 32 * 1024 * 1024,
      },
    );
    assert.equal(
      JSON.parse(cli.stdout).normalized_result.target.file_path,
      target.file_path,
    );
    const input = {
      executable_path: executable,
      application_path: main,
      application_root: root,
      actions: [{ step_id: "ipc", kind: "click", selector: "#run" }],
    };
    const active = await client.callTool(
      { name: "capture_electron_scenario", arguments: input },
      { timeout: 150_000 },
    );
    const activeError = active.isError
      ? requireMcpToolError(active)
      : undefined;
    if (activeError !== undefined)
      assert.equal(
        activeError.code,
        "cleanup_incomplete",
        JSON.stringify(activeError),
      );
    const capture =
      activeError === undefined
        ? active.structuredContent.normalized_result
        : activeError.details?.partial_observation?.capture;
    assert.ok(capture, JSON.stringify(activeError ?? active));
    if (activeError !== undefined) {
      assert.equal(capture.application.cleanup, "unverified");
    } else {
      assert.ok(
        validators.get("capture_electron_scenario")(active.structuredContent),
      );
      assert.equal(capture.application.cleanup, "terminated-owned-process");
    }
    assert.equal(capture.actions[0].status, "completed");
    assert.ok(
      capture.ipc.events.some(
        ({ kind, channel }) =>
          kind === "main-handler-invocation" && channel === "fixture:echo",
      ),
      JSON.stringify(capture.ipc),
    );
    assert.equal(
      capture.coverage.status,
      "partial_attach",
      JSON.stringify(capture),
    );
    assert.ok(
      capture.timeline.events.some(
        (event) =>
          event.kind === "window-lifecycle" && event.event === "created",
      ),
    );
    await client.ping();
    console.log(
      `PASS live Electron CLI/MCP discovery, inspection, reconciliation, and active observations; active cleanup=${capture.application.cleanup}`,
    );
    if (process.platform !== "win32")
      await verifyCancellation({ input, ready, entrypoint, root });
  } catch (cause) {
    throw new Error(
      `Electron public-tool verification failed: ${cause.message}\nMCP stderr:\n${serverStderr}`,
      { cause },
    );
  } finally {
    await client.close();
    await transport.close();
    if (application?.pid) {
      const cleanup = await cleanupOwnedProcessGroup({
        runId,
        leaderPid: application.pid,
        processGroupId: application.pid,
        expectedParentPid: process.pid,
        expectedCommand: executable,
      });
      assert.equal(cleanup.cleaned, true, JSON.stringify(cleanup));
    }
    await rm(root, { recursive: true, force: true });
  }
}

const pause = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitForEndpoint(application, diagnostics) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u.exec(
      diagnostics(),
    );
    if (match) return `http://127.0.0.1:${match[1]}`;
    assert.equal(application.exitCode, null, diagnostics());
    await pause(100);
  }
  throw new Error(
    `Electron did not expose a loopback endpoint: ${diagnostics()}`,
  );
}

async function verifyCancellation({ input, ready, entrypoint, root }) {
  await rm(ready, { force: true });
  const child = spawn(
    process.execPath,
    [
      entrypoint,
      "capture-electron-scenario",
      JSON.stringify({
        ...input,
        actions: [{ step_id: "wait", kind: "wait", duration_ms: 30_000 }],
      }),
      "--json",
    ],
    {
      cwd: root,
      env: { ...process.env, REA_LOG_LEVEL: "silent" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  let ownership;
  try {
    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      const table = (
        await execute("ps", ["-eo", "pid=,ppid=,pgid=,args="], {
          timeout: 5_000,
          maxBuffer: 2 * 1024 * 1024,
        })
      ).stdout;
      for (const row of table.split("\n")) {
        const entry = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/u.exec(row);
        if (
          entry &&
          Number(entry[2]) === child.pid &&
          entry[4].includes(input.application_path)
        ) {
          const runId = await readProcessRunId(Number(entry[1]));
          assert.ok(runId, "Electron child lacked its ownership token");
          ownership = {
            runId,
            leaderPid: Number(entry[1]),
            processGroupId: Number(entry[3]),
          };
        }
      }
      if (ownership) {
        try {
          await access(ready);
          break;
        } catch {
          /* wait for actual fixture readiness */
        }
      }
      assert.equal(child.exitCode, null, `${stdout}\n${stderr}`);
      await pause(100);
    }
    assert.ok(ownership, "CLI did not acquire an owned Electron application");
    await access(ready);
    // The fixture's readiness precedes Playwright's Inspector acquisition;
    // interrupt the long action rather than its separate startup boundary.
    await pause(1_000);
    child.kill("SIGTERM");
    let timer;
    const result = await Promise.race([
      exited,
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Electron CLI cancellation timed out")),
          15_000,
        );
      }),
    ]).finally(() => clearTimeout(timer));
    assert.equal(result.code, 143, `${stdout}\n${stderr}`);
    assert.equal(result.signal, null);
    const error = JSON.parse(stdout);
    assert.ok(["cancelled", "cleanup_incomplete"].includes(error.code), stdout);
    assert.equal(error.category, "cancelled", stdout);
    assert.doesNotMatch(error.message, /rea doctor/u);
    assert.equal(
      error.details?.partial_observation?.kind,
      "electron-active-observation",
      stdout,
    );
    assert.ok(
      error.details.partial_observation.capture.actions.some(
        (action) => action.status === "cancelled",
      ),
    );
    assert.throws(() => process.kill(-ownership.processGroupId, 0), {
      code: "ESRCH",
    });
    console.log(
      `PASS real Electron CLI SIGTERM, retained cancelled actions, and owned group termination; reported code=${error.code}`,
    );
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill("SIGTERM");
      await exited;
    }
    if (ownership) {
      const cleanup = await cleanupOwnedProcessGroup(ownership);
      assert.equal(cleanup.cleaned, true, JSON.stringify(cleanup));
    }
  }
}
