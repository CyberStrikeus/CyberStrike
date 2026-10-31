import { copyFile, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { afterEach, expect, it } from "vitest";

import { electronActiveTimelineEventSchema } from "../../../src/domain/javascript/electronActiveObservation.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const temporary: string[] = [];

const electronModuleSource = `const { EventEmitter } = require("node:events");
const app = new EventEmitter();
app.isReady = () => true;
app.relaunch = () => undefined;
app.setAsDefaultProtocolClient = () => true;
app.setLoginItemSettings = () => undefined;
app.moveToApplicationsFolder = () => {
  throw new Error("moveToApplicationsFolder must not run");
};
const ipcMain = new EventEmitter();
ipcMain.handlers = new Map();
ipcMain.handle = (channel, listener) => ipcMain.handlers.set(channel, listener);
const ipcRenderer = {
  send: () => undefined,
  sendSync: () => "ok",
  invoke: () => Promise.resolve("ok"),
  postMessage: () => undefined,
};
class WebContents extends EventEmitter {
  constructor() {
    super();
    this.id = 12;
  }
  loadFile() { return Promise.resolve(); }
  loadURL() { return Promise.resolve(); }
  loadDataURL() { return Promise.resolve(); }
  send() { return undefined; }
  postMessage() { return undefined; }
  setWindowOpenHandler(handler) { this.windowOpenHandler = handler; return undefined; }
}
class BrowserWindow extends EventEmitter {
  constructor(options) {
    super();
    this.id = 3;
    this.webContents = new WebContents();
    this.options = options;
    this.webContents.getLastWebPreferences = () => options.webPreferences;
    app.emit("browser-window-created", {}, this);
  }
}
const utilityProcess = {
  fork: () => {
    const child = new EventEmitter();
    child.pid = 44;
    child.postMessage = () => undefined;
    return child;
  },
};
globalThis.__nativeShellCalls = [];
const shell = {
  openExternal: () => Promise.resolve(),
  openPath: () => Promise.resolve(),
  trashItem: (path) => require("node:fs/promises").unlink(path),
  showItemInFolder: (path) => { globalThis.__nativeShellCalls.push(["showItemInFolder", path]); },
  writeShortcutLink: (path) => { globalThis.__nativeShellCalls.push(["writeShortcutLink", path]); return true; },
};
const createSession = () => {
  const value = new EventEmitter();
  value.setPermissionRequestHandler = () => undefined;
  value.setPermissionCheckHandler = () => undefined;
  value.setCertificateVerifyProc = () => undefined;
  return value;
};
const session = createSession();
const customSession = createSession();
const contextBridge = {
  exposeInMainWorld: () => undefined,
  exposeInIsolatedWorld: () => undefined,
};
module.exports = {
  app,
  get BrowserWindow() { return BrowserWindow; },
  contextBridge,
  ipcMain,
  ipcRenderer,
  session: {
    defaultSession: session,
    fromPartition: () => customSession,
  },
  shell,
  utilityProcess,
};
`;

const activeCaptureSource = `(async () => {
const electron = require("electron");
const window = new electron.BrowserWindow({ webPreferences: { preload: "/approved/preload.js" } });
const channel = "x".repeat(2048);
electron.ipcMain.handle(channel, async () => ({ ok: true }));
await electron.ipcMain.handlers.get(channel)({ sender: { id: 9 }, senderFrame: { routingId: 7 } }, ...Array.from({ length: 40 }, () => ({ value: true })));
window.webContents.send("main-to-renderer", { value: true });
window.webContents.emit("render-process-gone", { reason: "crashed" });
const longEventName = "l".repeat(2048);
window.webContents.emit(longEventName);
const utility = electron.utilityProcess.fork("utility.js");
utility.emit("message", { data: { value: true } });
utility.postMessage({ value: true });
electron.session.defaultSession.emit("will-download", window.webContents, { cancel() {} });
electron.session.fromPartition("persist:custom").emit("will-download", window.webContents, { cancel() {} });
const defaultPopupDecision = window.webContents.windowOpenHandler({ url: "https://default-popup.invalid" });
window.webContents.setWindowOpenHandler(() => ({ action: "allow" }));
const popupDecision = window.webContents.windowOpenHandler({ url: "https://popup.invalid" });
electron.shell.openExternal("https://example.invalid").catch(() => undefined);
electron.app.relaunch();
const moveResult = electron.app.moveToApplicationsFolder({
  conflictHandler: () => {
    throw new Error("conflictHandler must not run");
  },
});
electron.contextBridge.exposeInMainWorld("api", { value: true });
window.webContents.loadURL("https://example.invalid").catch(() => undefined);
for (let index = 0; index < 6000; index++) electron.app.relaunch();
electron.ipcRenderer.send("x".repeat(9 * 1024 * 1024));
electron.app.emit("r".repeat(9 * 1024 * 1024));
const manyArguments = Array(30_000).fill(true);
for (let index = 0; index < 8; index++) electron.ipcRenderer.send("shape-budget", ...manyArguments);
try { process.dlopen({}, "/missing/native.node"); } catch {}
const firstSnapshot = globalThis.__reaElectronActiveSnapshot();
const firstIpc = firstSnapshot.events.find((event) => event.kind === "main-handler-invocation");
if (firstIpc) { firstIpc.channel = "mutated"; firstIpc.argument_shapes.push("mutated"); }
firstSnapshot.events.length = 0;
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({ snapshot, default_popup_decision: defaultPopupDecision, popup_decision: popupDecision, move_result: moveResult }) + "\\n");
})();
`;

afterEach(async () => {
  await Promise.all(
    temporary
      .splice(0)
      .map(async (path) => rm(path, { force: true, recursive: true })),
  );
});

it("retains active hook evidence within its event-retention budget", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "exercise.cjs");
  await writeFile(script, activeCaptureSource);
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(
    execution.stdout.trim().split("\n").at(-1) ?? "null",
  ) as {
    readonly default_popup_decision: { readonly action: string };
    readonly popup_decision: { readonly action: string };
    readonly move_result: boolean;
    readonly snapshot: {
      readonly hook_error: boolean;
      readonly events: readonly Record<string, unknown>[];
      readonly observed: number;
      readonly retained: number;
      readonly dropped: number;
      readonly dropped_ipc: number;
      readonly dropped_runtime: number;
      readonly retention_budget_bytes: number;
    };
  };
  const { snapshot } = result;
  expect(
    electronActiveTimelineEventSchema.array().parse(snapshot.events),
  ).toHaveLength(snapshot.retained);

  expect(snapshot.hook_error).toBe(false);
  expect(snapshot.events).toHaveLength(snapshot.retained);
  expect(snapshot.observed).toBe(snapshot.retained + snapshot.dropped);
  expect(snapshot.observed).toBeGreaterThan(5_000);
  expect(snapshot.dropped_ipc).toBeGreaterThanOrEqual(2);
  expect(snapshot.dropped_runtime).toBe(1);
  expect(snapshot.dropped).toBe(
    snapshot.dropped_ipc + snapshot.dropped_runtime,
  );
  expect(
    snapshot.events.some(
      (event) =>
        event.kind === "ipc-renderer-send" &&
        Array.isArray(event.argument_shapes) &&
        event.argument_shapes.length === 30_000,
    ),
  ).toBe(true);
  expect(
    Buffer.byteLength(JSON.stringify(snapshot), "utf8"),
  ).toBeLessThanOrEqual(snapshot.retention_budget_bytes);
  const sequences = snapshot.events.map((event) => event.sequence as number);
  expect(sequences).toEqual([...sequences].sort((left, right) => left - right));
  expect(snapshot.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ kind: "window-lifecycle", event: "created" }),
      expect.objectContaining({ kind: "preload", event: "configured" }),
      expect.objectContaining({ kind: "shell-attempt", phase: "blocked" }),
      expect.objectContaining({
        kind: "app-lifecycle",
        event: "moveToApplicationsFolder",
        phase: "blocked",
        argument_shapes: ["object"],
        error: true,
      }),
      expect.objectContaining({
        kind: "updater",
        event: "relaunch",
        phase: "blocked",
      }),
      expect.objectContaining({ kind: "native-addon" }),
      expect.objectContaining({ kind: "popup-attempt", phase: "blocked" }),
    ]),
  );
  expect(result.default_popup_decision).toEqual({ action: "deny" });
  expect(result.popup_decision).toEqual({ action: "deny" });
  expect(result.move_result).toBe(false);
  expect(
    snapshot.events.filter(
      (event) => event.kind === "download" && event.phase === "blocked",
    ),
  ).toHaveLength(2);
  const ipc = snapshot.events.find(
    (event) => event.kind === "main-handler-invocation",
  );
  expect(ipc).toMatchObject({
    correlation_id: expect.stringMatching(/^capture:\d+:\d+$/u),
    direction: "renderer-to-main",
    sender: "webContents:9",
    frame: "frame:7",
  });
  expect(ipc?.channel).toBe("x".repeat(2_048));
  expect(ipc?.argument_shapes).toHaveLength(40);
  expect(snapshot.events).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        kind: "web-contents-lifecycle",
        event: "l".repeat(2048),
      }),
    ]),
  );
});

it("blocks synchronous shell effects with their native return contracts and retains argument shapes only", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-shell-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "shell.cjs");
  await writeFile(
    script,
    `const { shell } = require("electron");
const revealed = shell.showItemInFolder("/host/secret-folder/file.txt");
const written = shell.writeShortcutLink("C:\\\\Users\\\\host\\\\app.lnk", "create", { target: "C:\\\\payload.exe" });
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  revealed: revealed === undefined ? "undefined" : revealed,
  written,
  native_calls: globalThis.__nativeShellCalls,
  snapshot,
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout.trim()) as {
    readonly revealed: string;
    readonly written: boolean;
    readonly native_calls: readonly unknown[];
    readonly snapshot: {
      readonly hook_error: boolean;
      readonly events: readonly Record<string, unknown>[];
    };
  };
  expect(result.revealed).toBe("undefined");
  expect(result.written).toBe(false);
  expect(result.native_calls).toEqual([]);
  expect(result.snapshot.hook_error).toBe(false);
  const attempts = result.snapshot.events.filter(
    (event) => event.kind === "shell-attempt",
  );
  expect(attempts).toEqual([
    expect.objectContaining({
      event: "showItemInFolder",
      phase: "blocked",
      argument_shapes: ["string"],
    }),
    expect.objectContaining({
      event: "writeShortcutLink",
      phase: "blocked",
      argument_shapes: ["string", "string", "object"],
    }),
  ]);
  expect(JSON.stringify(result.snapshot)).not.toContain("secret-folder");
  expect(JSON.stringify(result.snapshot)).not.toContain("payload.exe");
  electronActiveTimelineEventSchema.array().parse(result.snapshot.events);
});

it("blocks trashItem asynchronously, records the attempt, and preserves the selected file", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-trash-");
  temporary.push(root);
  await writeElectronFixture(root);
  const selected = join(root, "retained.txt");
  await writeFile(selected, "must remain");
  const script = join(root, "trash.cjs");
  await writeFile(
    script,
    `const { shell } = require("electron");
const result = shell.trashItem(${JSON.stringify(selected)});
const promise = result instanceof Promise;
result.then(
  () => { throw new Error("trashItem unexpectedly succeeded"); },
  error => process.stdout.write(JSON.stringify({ promise, message: error.message, snapshot: globalThis.__reaElectronActiveSnapshot() }) + "\\n"),
);
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout.trim());
  expect(result.promise).toBe(true);
  expect(result.message).toBe("External shell effects are blocked");
  expect(await readFile(selected, "utf8")).toBe("must remain");
  expect(result.snapshot.events).toContainEqual(
    expect.objectContaining({
      kind: "shell-attempt",
      event: "trashItem",
      phase: "blocked",
      argument_shapes: ["string"],
      error: true,
    }),
  );
  expect(JSON.stringify(result.snapshot)).not.toContain(selected);
});

it("classifies a dropped browser preload as preload configuration at capture", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-browser-preload-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "browser-preload.cjs");
  await writeFile(
    script,
    `Object.defineProperty(process, "type", { value: "browser" });
const electron = require("electron");
new electron.BrowserWindow({ webPreferences: { preload: "p".repeat(6 * 1024 * 1024) } });
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify(snapshot) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const snapshot = JSON.parse(
    execution.stdout.trim().split("\n").at(-1) ?? "null",
  ) as {
    readonly dropped_event_families: readonly {
      readonly family: string;
      readonly count: number;
    }[];
    readonly dropped_event_roles: readonly {
      readonly role: string;
      readonly count: number;
    }[];
  };
  expect(snapshot.dropped_event_families).toContainEqual({
    family: "preload-configuration",
    count: 1,
  });
  expect(snapshot.dropped_event_roles).toContainEqual({
    role: "browser",
    count: 1,
  });
});

it("removes observed ipcMain listeners through their original function", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-removal-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-removal.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
let calls = 0;
const listener = () => { calls += 1; };
ipcMain.on("repeated", listener);
ipcMain.on("repeated", listener);
ipcMain.removeListener("repeated", listener);
const repeatedAfterFirstRemoval = ipcMain.listenerCount("repeated");
ipcMain.off("repeated", listener);
ipcMain.once("pending-once", listener);
ipcMain.removeListener("pending-once", listener);
ipcMain.on("fired-once", listener);
ipcMain.once("fired-once", listener);
ipcMain.emit("fired-once", event);
ipcMain.removeListener("fired-once", listener);
ipcMain.emit("repeated", event);
ipcMain.emit("pending-once", event);
ipcMain.emit("fired-once", event);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  calls,
  repeated_after_first_removal: repeatedAfterFirstRemoval,
  listeners: ["repeated", "pending-once", "fired-once"].map((channel) => ipcMain.listenerCount(channel)),
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    calls: 2,
    repeated_after_first_removal: 1,
    listeners: [0, 0, 0],
    invocations: ["fired-once", "fired-once"],
  });
});

it("removes the newest matching ipcMain registration across unpatched aliases", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-aliases-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-aliases.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const order = [];
const f = () => { order.push("f"); };
const g = () => { order.push("g"); };
ipcMain.on("mixed", f);
ipcMain.on("mixed", g);
ipcMain.addListener("mixed", f);
ipcMain.removeListener("mixed", f);
ipcMain.emit("mixed", event);
let onceCalls = 0;
const fn = () => { onceCalls += 1; };
ipcMain.once("once-then-add", fn);
ipcMain.addListener("once-then-add", fn);
ipcMain.removeListener("once-then-add", fn);
ipcMain.emit("once-then-add", event);
ipcMain.emit("once-then-add", event);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  order,
  once_calls: onceCalls,
  listeners: ["mixed", "once-then-add"].map((channel) => ipcMain.listenerCount(channel)),
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    order: ["f", "g"],
    once_calls: 1,
    listeners: [2, 0],
    invocations: ["mixed", "mixed", "once-then-add"],
  });
});

it("records ipcMain listeners registered by a newListener callback during once", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-nested-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-nested.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
let nestedCalls = 0;
ipcMain.addListener("newListener", (channel) => {
  if (channel === "outer") ipcMain.on("nested", () => { nestedCalls += 1; });
});
ipcMain.once("outer", () => undefined);
ipcMain.emit("nested", event);
ipcMain.emit("outer", event);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  nested_calls: nestedCalls,
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    nested_calls: 1,
    invocations: ["nested", "outer"],
  });
});

it("keeps removal working after many fired ipcMain once registrations", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-repeat-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-repeat.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
let calls = 0;
const listener = () => { calls += 1; };
for (let index = 0; index < 200; index += 1) {
  ipcMain.once("repeated-once", listener);
  ipcMain.emit("repeated-once", event);
}
const afterOnce = ipcMain.rawListeners("repeated-once").length;
ipcMain.on("repeated-once", listener);
ipcMain.removeListener("repeated-once", listener);
ipcMain.emit("repeated-once", event);
process.stdout.write(JSON.stringify({
  calls,
  after_once: afterOnce,
  listeners: ipcMain.listenerCount("repeated-once"),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    calls: 200,
    after_once: 0,
    listeners: 0,
  });
});

it("removes the newest registration of an ipcMain listener that has its own listener property", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-wrapped-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-wrapped.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const order = [];
const f = () => { order.push("f"); };
f.listener = () => { order.push("inner"); };
const g = () => { order.push("g"); };
ipcMain.on("wrapped", f);
ipcMain.on("wrapped", g);
ipcMain.addListener("wrapped", f);
ipcMain.removeListener("wrapped", f);
ipcMain.emit("wrapped", event);
process.stdout.write(JSON.stringify({
  order,
  listeners: ipcMain.listenerCount("wrapped"),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    order: ["f", "g"],
    listeners: 2,
  });
});

it("reports original ipcMain listeners to newListener and removeListener observers", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-meta-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-meta.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const channels = new Set(["on", "removed-once", "fired-once"]);
const added = [];
const removed = [];
ipcMain.addListener("newListener", (channel, listener) => { if (channels.has(channel)) added.push([channel, listener]); });
ipcMain.addListener("removeListener", (channel, listener) => { if (channels.has(channel)) removed.push([channel, listener]); });
const onListener = () => undefined;
const removedOnce = () => undefined;
let firedCalls = 0;
const firedOnce = () => { firedCalls += 1; };
ipcMain.on("on", onListener);
ipcMain.removeListener("on", onListener);
ipcMain.once("removed-once", removedOnce);
ipcMain.removeListener("removed-once", removedOnce);
ipcMain.once("fired-once", firedOnce);
ipcMain.emit("fired-once", event);
ipcMain.emit("fired-once", event);
const expected = [["on", onListener], ["removed-once", removedOnce], ["fired-once", firedOnce]];
const same = (actual) => actual.length === expected.length &&
  actual.every(([channel, listener], index) => channel === expected[index][0] && listener === expected[index][1]);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  added_originals: same(added),
  removed_originals: same(removed),
  fired_calls: firedCalls,
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    added_originals: true,
    removed_originals: true,
    fired_calls: 1,
    invocations: ["fired-once"],
  });
});

it("registers and removes ipcMain once listeners through decorators installed after the hook", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-decor-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-decorators.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const seen = [];
const hookedOn = ipcMain.on;
const hookedRemoveListener = ipcMain.removeListener;
ipcMain.on = function decoratedOn(channel, listener) {
  if (channel === "decorated") seen.push("on");
  return hookedOn.call(this, channel, listener);
};
ipcMain.removeListener = function decoratedRemoveListener(channel, listener) {
  if (channel === "decorated") seen.push("removeListener");
  return hookedRemoveListener.call(this, channel, listener);
};
let calls = 0;
const listener = () => { calls += 1; };
const returned = ipcMain.once("decorated", listener);
const registered = ipcMain.listenerCount("decorated", listener);
ipcMain.emit("decorated", event);
ipcMain.emit("decorated", event);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  seen,
  returns_emitter: returned === ipcMain,
  registered,
  remaining: ipcMain.listenerCount("decorated"),
  calls,
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    seen: ["on", "removeListener"],
    returns_emitter: true,
    registered: 1,
    remaining: 0,
    calls: 1,
    invocations: ["decorated"],
  });
});

it("keeps hooked ipcMain listener semantics identical to an unhooked EventEmitter", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-diff-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-differential.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const scenario = (emitter) => {
  const log = [];
  const names = new Map();
  const named = (name) => {
    const listener = () => { log.push("call:" + name); };
    names.set(listener, name);
    return listener;
  };
  const label = (listener) => names.get(listener) ?? "unknown";
  emitter.on("newListener", (channel, listener) => {
    if (channel === "ch") log.push("new:" + label(listener));
  });
  emitter.on("removeListener", (channel, listener) => {
    if (channel === "ch") log.push("remove:" + label(listener));
  });
  const [a, b, c, d] = ["a", "b", "c", "d"].map(named);
  const state = () => {
    log.push("count:" + emitter.listenerCount("ch") + ":" + [a, b, c, d].map((listener) => emitter.listenerCount("ch", listener)).join(","));
    log.push("listeners:" + emitter.listeners("ch").map(label).join(","));
    log.push("raw:" + emitter.rawListeners("ch").map((listener) => label(listener.listener ?? listener)).join(","));
  };
  emitter.on("ch", a);
  emitter.once("ch", b);
  emitter.on("ch", c);
  emitter.addListener("ch", a);
  emitter.once("ch", d);
  emitter.prependListener("ch", c);
  emitter.prependOnceListener("ch", d);
  state();
  emitter.removeListener("ch", a);
  state();
  emitter.emit("ch", event);
  state();
  emitter.off("ch", c);
  emitter.once("ch", b);
  emitter.removeListener("ch", b);
  emitter.once("ch", d);
  state();
  emitter.emit("ch", event);
  state();
  emitter.off("ch", c);
  // An app function's own listener property is not a hook wrapper.
  const e = named("e");
  e.listener = c;
  emitter.on("ch", a);
  emitter.on("ch", c);
  emitter.prependOnceListener("ch", d);
  emitter.prependListener("ch", e);
  emitter.on("ch", a);
  state();
  emitter.removeAllListeners("ch");
  state();
  emitter.on("ch", b);
  emitter.on("ch", c);
  emitter.removeAllListeners();
  state();
  return log;
};
process.stdout.write(JSON.stringify({
  plain: scenario(new EventEmitter()),
  hooked: scenario(ipcMain),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: string[];
    hooked: string[];
  };
  expect(plain).not.toContain("new:unknown");
  expect(hooked).toEqual(plain);
});

it("keeps a replacement registered by a removeListener observer during ipcMain removeAllListeners", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-replace-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-replacement.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
const scenario = (emitter) => {
  const log = [];
  const names = new Map();
  const named = (name) => {
    const listener = () => { log.push("call:" + name); };
    names.set(listener, name);
    return listener;
  };
  // A wrapper is labelled by the listener its .listener names.
  const label = (listener) =>
    names.get(listener) ??
    (names.has(listener.listener) ? "wrapper(" + names.get(listener.listener) + ")" : "unknown");
  const [a, b, c, replacement] = ["a", "b", "c", "replacement"].map(named);
  let replaced = false;
  emitter.on("removeListener", (channel, listener) => {
    if (channel !== "ch") return;
    log.push("remove:" + label(listener));
    if (replaced) return;
    replaced = true;
    emitter.on("ch", replacement);
  });
  emitter.on("ch", a);
  emitter.once("ch", b);
  emitter.on("ch", c);
  const returned = emitter.removeAllListeners("ch");
  log.push("returns_emitter:" + (returned === emitter));
  log.push("listeners:" + emitter.listeners("ch").map(label).join(","));
  emitter.emit("ch", event);
  emitter.removeAllListeners();
  log.push("cleared:" + emitter.listenerCount("ch") + ":" + emitter.listenerCount("removeListener"));
  return log;
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  plain,
  hooked,
  // The hooked removeListener observer records its own invocations.
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation" && item.channel === "ch").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked, invocations } = JSON.parse(execution.stdout) as {
    plain: string[];
    hooked: string[];
    invocations: string[];
  };
  expect(plain).toEqual([
    "remove:c",
    "remove:wrapper(b)",
    "remove:a",
    "returns_emitter:true",
    "listeners:replacement",
    "call:replacement",
    "remove:replacement",
    "cleared:0:0",
  ]);
  expect(hooked).toEqual(plain);
  expect(invocations).toEqual(["ch"]);
});

it("keeps ipcMain once self-removal through an on decorator that wraps the hook", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-wrap-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-wrapping-decorator.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const event = { sender: { id: 9 }, senderFrame: { routingId: 7 } };
// Installed after the hook: wraps each listener and names it via .listener.
const decorate = (emitter) => {
  const decoratedOn = emitter.on;
  emitter.on = function wrappingOn(channel, listener) {
    const layer = function decoratedListener(...args) {
      return listener.apply(this, args);
    };
    layer.listener = listener;
    return decoratedOn.call(this, channel, layer);
  };
};
const scenario = (emitter) => {
  decorate(emitter);
  let calls = 0;
  const listener = () => { calls += 1; };
  const returned = emitter.once("decorated", listener);
  const registered = emitter.listenerCount("decorated");
  emitter.emit("decorated", event);
  const afterFirst = emitter.listenerCount("decorated");
  emitter.emit("decorated", event);
  emitter.once("decorated", listener);
  emitter.emit("decorated", event);
  return {
    returns_emitter: returned === emitter,
    registered,
    after_first: afterFirst,
    remaining: emitter.listenerCount("decorated"),
    raw: emitter.rawListeners("decorated").length,
    calls,
  };
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
process.stdout.write(JSON.stringify({
  plain,
  hooked,
  invocations: snapshot.events.filter((item) => item.kind === "main-event-invocation").map((item) => item.channel),
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked, invocations } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
    invocations: string[];
  };
  expect(plain).toEqual({
    returns_emitter: true,
    registered: 1,
    after_first: 0,
    remaining: 0,
    raw: 0,
    calls: 2,
  });
  expect(hooked).toEqual(plain);
  expect(invocations).toEqual(["decorated", "decorated"]);
});

it.each(["stable", "replaced", "readonly", "getter", "proxy"])(
  "normalizes raw ipcMain on entries before %s removal decorators",
  async (mode) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-ipc-remove-decorator-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-removal-decorator.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = (emitter) => {
  const seen = [];
  const onListener = () => undefined;
  const onceListener = () => undefined;
  const nativeRemove = emitter.removeListener;
  const decorate = (name) => function removalDecorator(channel, listener) {
    if (this !== emitter) throw new Error("decorator receiver changed");
    if (channel === "ch") {
      const label = listener === onListener ? "on" :
        listener.listener === onceListener ? "once" : "unknown";
      seen.push(name + ":" + label);
      if (label === "unknown") throw new Error("unexpected recording wrapper");
    }
    return nativeRemove.call(this, channel, listener);
  };
  emitter.on("removeListener", (channel) => {
    if (${JSON.stringify(mode)} === "replaced" && channel === "ch")
      emitter.removeListener = decorate("replacement");
  });
  emitter.on("ch", onListener);
  emitter.once("ch", onceListener);
  emitter.removeListener = decorate("first");
  if (${JSON.stringify(mode)} === "readonly") Object.defineProperty(emitter, "removeListener", {
    value: emitter.removeListener, writable: false, configurable: false,
  });
  if (${JSON.stringify(mode)} === "getter") Object.defineProperty(emitter, "removeListener", {
    get() {
      if (this !== emitter) throw new Error("getter receiver changed");
      return decorate("first");
    },
  });
  if (${JSON.stringify(mode)} === "proxy") emitter.removeListener = new Proxy(emitter.removeListener, {
    get() { throw new Error("decorator metadata must not be read"); },
  });
  let failure = null;
  let returnsEmitter = false;
  try { returnsEmitter = emitter.removeAllListeners("ch") === emitter; }
  catch (cause) { failure = cause.message; }
  return { seen, returns_emitter: returnsEmitter, remaining: emitter.listenerCount("ch"), failure };
};
process.stdout.write(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }) + "\\n");
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked } = JSON.parse(execution.stdout) as {
      plain: Record<string, unknown>;
      hooked: Record<string, unknown>;
    };
    expect(plain).toEqual({
      seen: [
        "first:once",
        `${mode === "replaced" ? "replacement" : "first"}:on`,
      ],
      returns_emitter: true,
      remaining: 0,
      failure: null,
    });
    expect(hooked).toEqual(plain);
  },
);

it("preserves native removal before mutated raw listener metadata throws", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-ipc-mutated-metadata-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-mutated-listener-metadata.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = (emitter) => {
  const marker = new Error("application metadata failure");
  let reads = 0;
  emitter.on("removeListener", () => undefined);
  emitter.on("ch", () => undefined);
  Object.defineProperty(emitter.rawListeners("ch")[0], "listener", { get() {
    reads += 1;
    throw marker;
  }});
  let failure;
  try { emitter.removeAllListeners("ch"); } catch (cause) { failure = cause; }
  return { reads, remaining: emitter.listenerCount("ch"), error_preserved: failure === marker };
};
process.stdout.write(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  expect(plain).toEqual({ reads: 1, remaining: 0, error_preserved: true });
  expect(hooked).toEqual(plain);
});

it("matches native once dispatch and retains only established invocations", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-native-once-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "electron-once-runtime.mjs");
  await copyFile(
    fileURLToPath(
      new URL(
        "../../../tests/support/analysis-efficiency/electron-once-runtime.mjs",
        import.meta.url,
      ),
    ),
    script,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    cases: number;
    disagreements: number;
    rows: readonly {
      mode: string;
      native: Record<string, unknown>;
      hooked: Record<string, unknown> & { body_calls: number };
      observation: readonly { kind: string; event: string | null }[];
    }[];
  };
  expect(result.cases).toBe(39);
  expect(result.disagreements).toBe(0);
  for (const row of result.rows) {
    expect(row.hooked, row.mode).toEqual(row.native);
    const invocations = row.observation.filter(
      (event) => event.kind === "main-event-invocation",
    );
    if (
      row.mode === "inherited-listener-setter" ||
      row.mode === "on-getter-listener-setter" ||
      row.mode.startsWith("on-getter-native-alias")
    ) {
      expect(invocations).toEqual([]);
      expect(row.observation).toEqual([
        {
          kind: "ipc-observation-gap",
          event: "once-metadata",
          error: row.mode === "on-getter-native-alias-throws",
        },
      ]);
    } else {
      expect(invocations.length, row.mode).toBe(row.hooked.body_calls);
      if (row.hooked.body_calls === 0)
        expect(
          row.observation.some((event) => event.kind === "ipc-observation-gap"),
          row.mode,
        ).toBe(true);
      if (row.mode.includes("non-callable") && row.hooked.body_calls === 0)
        expect(row.observation, row.mode).toEqual([
          expect.objectContaining({
            kind: "ipc-observation-gap",
            error: true,
          }),
        ]);
    }
  }
});

it.each(["single-on", "multiple-on", "empty-once", "event-once"])(
  "preserves native callable method reads during %s dispatch",
  async (mode) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-ipc-dispatch-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-native-dispatch.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const mode = ${JSON.stringify(mode)};
const scenario = (emitter) => {
  const calls = [];
  const reads = [];
  const listener = new Proxy(function() { calls.push("first"); }, {
    get(target, key, receiver) {
      if (key === "apply" || key === "call") {
        reads.push(key);
        throw new Error("application invocation metadata");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  if (mode.endsWith("once")) emitter.once("ch", listener);
  else emitter.on("ch", listener);
  if (mode === "multiple-on") emitter.on("ch", () => calls.push("second"));
  let failure = null;
  try {
    if (mode === "empty-once") emitter.emit("ch");
    else emitter.emit("ch", { sender: { id: 9 } });
  } catch (cause) { failure = cause.message; }
  return { calls, reads, failure, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked } = JSON.parse(execution.stdout) as {
      plain: Record<string, unknown>;
      hooked: Record<string, unknown>;
    };
    // The native dependency owns whether it consults call/apply. Compare the
    // complete trace rather than requiring one pinned Node implementation.
    expect(plain.remaining).toBe(
      mode === "multiple-on" ? 2 : mode === "single-on" ? 1 : 0,
    );
    expect(hooked).toEqual(plain);
  },
);

it.each([
  "arguments",
  "array-like",
  "null",
  "undefined",
  "missing",
  "primitive",
])("preserves raw callback apply with %s argument lists", async (mode) => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-apply-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-apply.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const mode = ${JSON.stringify(mode)};
const scenario = (emitter) => {
  let calls = 0, reads = 0, correctReceiver = false, arity = null;
  const event = { sender: { id: 9 } };
  let first = null;
  emitter.on("ch", function(...args) {
    calls++; correctReceiver = this === emitter; arity = args.length;
    first = args.length ? args[0] === event : null;
  });
  const listener = emitter.rawListeners("ch")[0];
  let list;
  if (mode === "arguments") list = (function() { return arguments; })(event, 42);
  if (mode === "array-like") list = { length: 2, get 0() { reads++; return event; }, 1: 42 };
  if (mode === "null") list = null;
  if (mode === "primitive") list = 42;
  let typeError = false;
  try {
    if (mode === "missing") listener.apply(emitter);
    else listener.apply(emitter, list);
  } catch (cause) { typeError = cause instanceof TypeError; }
  return { calls, reads, correctReceiver, arity, first, typeError };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  const populated = mode === "arguments" || mode === "array-like";
  expect(plain).toEqual({
    calls: mode === "primitive" ? 0 : 1,
    reads: mode === "array-like" ? 1 : 0,
    correctReceiver: mode !== "primitive",
    arity: mode === "primitive" ? null : populated ? 2 : 0,
    first: populated ? true : null,
    typeError: mode === "primitive",
  });
  expect(hooked).toEqual(plain);
});

it("preserves the native once argument-list object passed to custom apply", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-ipc-once-args-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-once-arguments.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = (emitter) => {
  const event = { sender: { id: 9 } };
  let calls = 0, argumentObject = false, correctReceiver = false;
  const listener = function(value) { calls++; correctReceiver = this === emitter && value === event; };
  listener.apply = function(receiver, list) {
    argumentObject = Object.prototype.toString.call(list) === "[object Arguments]";
    if (!argumentObject) throw new Error("once changed argument-list identity");
    return Reflect.apply(Function.prototype.apply, this, [receiver, list]);
  };
  emitter.once("ch", listener);
  let failure = null;
  try { emitter.emit("ch", event); } catch (cause) { failure = cause.message; }
  return { calls, argumentObject, correctReceiver, failure, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  expect(plain).toEqual({
    calls: 1,
    // Newer runtimes bypass custom apply entirely. If native calls it, the
    // callback's guard still requires its exact Arguments representation.
    argumentObject: expect.any(Boolean),
    correctReceiver: true,
    failure: null,
    remaining: 0,
  });
  expect(hooked).toEqual(plain);
});

it.each([
  "function-setter",
  "function-readonly",
  "object-setter",
  "object-readonly",
])("owns on-wrapper metadata despite inherited %s properties", async (mode) => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-ipc-prototype-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-inherited-listener.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const mode = ${JSON.stringify(mode)};
const scenario = (emitter) => {
  const prototype = mode.startsWith("function") ? Function.prototype : Object.prototype;
  const prior = Object.getOwnPropertyDescriptor(prototype, "listener");
  let calls = 0, writes = 0, failure = null;
  Object.defineProperty(prototype, "listener", mode.endsWith("setter") ? {
    configurable: true, set() { writes++; throw new Error("inherited metadata write"); },
  } : { configurable: true, writable: false, value: undefined });
  try {
    emitter.on("ch", () => { calls++; });
    emitter.emit("ch", { sender: { id: 9 } });
  } catch (cause) { failure = cause.message; }
  finally {
    if (prior) Object.defineProperty(prototype, "listener", prior);
    else delete prototype.listener;
  }
  return { calls, writes, failure, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  expect(plain).toEqual({ calls: 1, writes: 0, failure: null, remaining: 1 });
  expect(hooked).toEqual(plain);
});

it.each(["on", "multiple-on", "once"])(
  "records %s invocations without consulting application Array species",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-ipc-species-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-array-species.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const kind = ${JSON.stringify(kind)};
let retainedUnderSpecies = 0;
const scenario = (emitter) => {
  let calls = 0, reads = 0, failure = null;
  emitter[kind === "once" ? "once" : "on"]("ch", () => { calls++; });
  if (kind === "multiple-on") emitter.on("ch", () => { calls++; });
  const prior = Object.getOwnPropertyDescriptor(Array, Symbol.species);
  Object.defineProperty(Array, Symbol.species, { configurable: true, get() {
    reads++; throw new Error("application array species");
  }});
  try {
    emitter.emit("ch", { sender: { id: 9 } }, 42);
    if (emitter === ipcMain) {
      for (const event of globalThis.__reaElectronActiveSnapshot().events)
        if (event.kind === "main-event-invocation") retainedUnderSpecies++;
    }
  }
  catch (cause) { failure = cause.message; }
  finally { Object.defineProperty(Array, Symbol.species, prior); }
  return { calls, reads, failure };
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
const invocations = globalThis.__reaElectronActiveSnapshot().events.filter(e => e.kind === "main-event-invocation").length;
console.log(JSON.stringify({ plain, hooked, invocations, retainedUnderSpecies }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked, invocations, retainedUnderSpecies } = JSON.parse(
      execution.stdout,
    ) as {
      plain: Record<string, unknown>;
      hooked: Record<string, unknown>;
      invocations: number;
      retainedUnderSpecies: number;
    };
    const expected = kind === "multiple-on" ? 2 : 1;
    expect(plain).toEqual({ calls: expected, reads: 0, failure: null });
    expect(hooked).toEqual(plain);
    expect(invocations).toBe(expected);
    expect(retainedUnderSpecies).toBe(expected);
  },
);

it.each(["array", "arguments", "array-like", "null"])(
  "preserves opaque custom apply inputs for raw %s lists",
  async (mode) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-custom-apply-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-custom-apply.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const mode = ${JSON.stringify(mode)};
const scenario = (emitter) => {
  let calls = 0, reads = 0, exact = false, methodThis = false, arity = null;
  const token = {};
  const listener = function(...args) { calls++; arity = args.length; return token; };
  let list = [42, 43];
  if (mode === "arguments") list = (function() { return arguments; })(42, 43);
  if (mode === "array-like") list = { length: 2, get 0() { reads++; return 42; }, 1: 43 };
  if (mode === "null") list = null;
  listener.apply = function(receiver, input) {
    exact = input === list;
    methodThis = this === listener;
    if (!exact) throw new Error("custom apply input was replaced");
    return Reflect.apply(listener, receiver, input ?? []);
  };
  emitter.on("ch", listener);
  let returned = false, failure = null;
  try { returned = emitter.rawListeners("ch")[0].apply(emitter, list) === token; }
  catch (cause) { failure = cause.message; }
  return { calls, reads, exact, methodThis, arity, returned, failure };
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked,
  invocations: snapshot.events.filter(e => e.kind === "main-event-invocation").length,
  gaps: snapshot.events.filter(e => e.kind === "ipc-observation-gap").map(e => ({channel: e.channel, event: e.event})) }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked, invocations, gaps } = JSON.parse(
      execution.stdout,
    ) as {
      plain: Record<string, unknown>;
      hooked: Record<string, unknown>;
      invocations: number;
      gaps: unknown[];
    };
    expect(plain).toEqual({
      calls: 1,
      reads: mode === "array-like" ? 1 : 0,
      exact: true,
      methodThis: true,
      arity: mode === "null" ? 0 : 2,
      returned: true,
      failure: null,
    });
    expect(hooked).toEqual(plain);
    expect(invocations).toBe(0);
    expect(gaps).toEqual([{ channel: "ch", event: "custom-apply" }]);
  },
);

it.each([false, true])(
  "preserves a borrowed raw apply method's receiver (custom: %s)",
  async (custom) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-borrowed-apply-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-borrowed-apply.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = (emitter) => {
  let originalCalls = 0, borrowedCalls = 0, sameList = false;
  const token = {}, list = [42, 43];
  const listener = function() { originalCalls++; };
  const other = function(...args) { borrowedCalls++; return args[0] === 42 && args[1] === 43 ? token : null; };
  if (${JSON.stringify(custom)}) listener.apply = function(receiver, input) {
    sameList = input === list;
    return Reflect.apply(this, receiver, input);
  };
  emitter.on("ch", listener);
  const returned = emitter.rawListeners("ch")[0].apply.call(other, emitter, list) === token;
  return { originalCalls, borrowedCalls, sameList, returned };
};
const plain = scenario(new EventEmitter()), hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked,
  invocations: snapshot.events.filter(e => e.kind === "main-event-invocation").length }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked, invocations } = JSON.parse(execution.stdout);
    expect(plain).toEqual({
      originalCalls: 0,
      borrowedCalls: 1,
      sameList: custom,
      returned: true,
    });
    expect(hooked).toEqual(plain);
    expect(invocations).toBe(0);
  },
);

it("uses the captured Array.isArray intrinsic while selecting a native listener entry", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-captured-array-is-array-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "captured-array-is-array.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = function original() {};
  const marker = function marker() {};
  const foreign = function foreign() {};
  emitter.on("ch", listener);
  emitter.on("ch", marker);
  emitter.rawListeners("ch")[0].listener = foreign;
  const originalIsArray = Array.isArray;
  let failure = null;
  Array.isArray = () => { throw new Error("late application Array.isArray"); };
  try { emitter.removeListener("ch", listener); }
  catch (cause) { failure = cause.message; }
  finally { Array.isArray = originalIsArray; }
  return { failure, remaining: emitter.listenerCount("ch"), eventNames: emitter.eventNames() };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    failure: null,
    remaining: 1,
    eventNames: ["ch"],
  });
});

it.each([
  "defineProperty",
  "getOwnPropertyDescriptor",
  "getPrototypeOf",
  "create",
  "get",
  "set",
  "Set",
  "Proxy",
  "WeakMap.has",
  "WeakMap.get",
  "WeakMap.set",
  "Set.has",
  "Set.add",
])(
  "keeps listener registration and removal independent of late %s replacement",
  async (method) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-late-intrinsic-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-late-intrinsic.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const specification = ${JSON.stringify(method)};
const [constructor, member] = specification.split(".");
const method = member ?? specification;
const owner = member !== undefined ? globalThis[constructor].prototype
  : method === "Set" || method === "Proxy" ? globalThis
  : method === "get" || method === "set" ? Reflect : Object;
const original = owner[method];
const emitter = new EventEmitter();
const scenario = (target) => {
  const seen = [];
  let failure = null;
  try {
    const onListener = () => seen.push("on");
    target.on("ch", onListener);
    target.once("one", () => seen.push("once"));
    target.on("removeListener", () => {});
    target.emit("ch", null, 42);
    target.emit("one", null, 43);
    target.emit("one", null, 44);
    target.removeAllListeners();
  } catch (cause) { failure = cause.message; }
  return { seen, failure, remaining: target.eventNames().length };
};
owner[method] = function() { throw new Error("late application intrinsic replacement"); };
let plain, hooked;
try { plain = scenario(emitter); hooked = scenario(ipcMain); }
finally { owner[method] = original; }
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked,
  invocations: snapshot.events.filter(e => e.kind === "main-event-invocation" && (e.channel === "ch" || e.channel === "one")).length }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked, invocations } = JSON.parse(execution.stdout);
    expect(plain).toEqual({
      seen: ["on", "once"],
      failure: null,
      remaining: 0,
    });
    expect(hooked).toEqual(plain);
    expect(invocations).toBe(2);
  },
);

it.each([
  {
    mode: "data",
    depth: 16,
    prototypeDepth: 0,
    once: true,
    gaps: 0,
    remaining: 1,
  },
  {
    mode: "data",
    depth: 17,
    prototypeDepth: 0,
    once: true,
    gaps: 1,
    remaining: 1,
  },
  {
    mode: "accessor",
    depth: 1,
    prototypeDepth: 0,
    once: true,
    gaps: 1,
    remaining: 0,
  },
  {
    mode: "proxy",
    depth: 1,
    prototypeDepth: 0,
    once: true,
    gaps: 1,
    remaining: 0,
  },
  {
    mode: "data",
    depth: 17,
    prototypeDepth: 0,
    once: false,
    gaps: 1,
    remaining: 1,
  },
  {
    mode: "inherited-data",
    depth: 1,
    prototypeDepth: 1,
    once: true,
    gaps: 0,
    remaining: 0,
  },
  {
    mode: "inherited-accessor",
    depth: 1,
    prototypeDepth: 1,
    once: true,
    gaps: 1,
    remaining: 0,
  },
  {
    mode: "inherited-proxy",
    depth: 1,
    prototypeDepth: 1,
    once: true,
    gaps: 1,
    remaining: 0,
  },
  {
    mode: "inherited-data",
    depth: 1,
    prototypeDepth: 16,
    once: true,
    gaps: 0,
    remaining: 0,
  },
  {
    mode: "inherited-data",
    depth: 1,
    prototypeDepth: 17,
    once: true,
    gaps: 1,
    remaining: 0,
  },
])(
  "preserves native dispatch for $mode chains (depth $depth, prototype $prototypeDepth, once $once)",
  async ({ mode, depth, prototypeDepth, once, gaps, remaining }) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-chain-coverage-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-chain-coverage.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const mode = ${JSON.stringify(mode)}, once = ${JSON.stringify(once)};
const scenario = (target) => {
  let calls = 0, reads = 0;
  for (let index = 0; index < ${depth}; index++) {
    const previous = target.on;
    target.on = function(channel, listener) {
      let outer = function(...args) { return Reflect.apply(listener, this, args); };
      if (mode.startsWith("inherited-")) {
        let prototype = Object.create(Function.prototype);
        Object.defineProperty(prototype, "listener", mode === "inherited-accessor"
          ? { get() { reads++; return listener; } } : { value: listener });
        if (mode === "inherited-proxy") prototype = new Proxy(prototype, {
          getOwnPropertyDescriptor() { throw new Error("prototype metadata reflection"); },
          getPrototypeOf() { throw new Error("prototype traversal reflection"); }
        });
        for (let index = 1; index < ${prototypeDepth}; index++) prototype = Object.create(prototype);
        Object.setPrototypeOf(outer, prototype);
      }
      else if (mode === "accessor") Object.defineProperty(outer, "listener", { get() { reads++; return listener; } });
      else outer.listener = listener;
      if (mode === "proxy") outer = new Proxy(outer, {
        getOwnPropertyDescriptor() { throw new Error("application metadata reflection"); }
      });
      return Reflect.apply(previous, this, [channel, outer]);
    };
  }
  target[once ? "once" : "on"]("ch", () => calls++);
  target.emit("ch", null, 42); target.emit("ch", null, 43);
  return { calls, reads, remaining: target.listenerCount("ch") };
};
const plain = scenario(new EventEmitter()), hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked,
  invocations: snapshot.events.filter(e => e.kind === "main-event-invocation").length,
  gaps: snapshot.events.filter(e => e.kind === "ipc-observation-gap").map(e => ({event: e.event, channel: e.channel})) }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const result = JSON.parse(execution.stdout);
    expect(result.plain).toEqual({
      calls: once ? 1 : 2,
      reads: mode.endsWith("accessor") ? 1 : 0,
      remaining,
    });
    expect(result.hooked).toEqual(result.plain);
    expect(result.invocations).toBe(once ? 1 : 0);
    expect(result.gaps).toEqual(
      Array.from({ length: gaps }, () => ({
        event: "listener-chain",
        channel: "ch",
      })),
    );
  },
);

it.each(["array", "map"])(
  "snapshots retained state without application %s iterators",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-snapshot-iterator-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-snapshot-iterator.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
let calls = 0, reads = 0, failure = null, snapshot;
ipcMain.on("ch", () => { calls++; });
ipcMain.emit("ch", { sender: { id: 9 } }, 42);
const prototype = ${JSON.stringify(kind)} === "array" ? Array.prototype : Map.prototype;
const prior = Object.getOwnPropertyDescriptor(prototype, Symbol.iterator);
Object.defineProperty(prototype, Symbol.iterator, { configurable: true, value() {
  reads++; throw new Error("application iterator observed retained state");
}});
try { snapshot = globalThis.__reaElectronActiveSnapshot(); }
catch (cause) { failure = cause.message; }
finally { Object.defineProperty(prototype, Symbol.iterator, prior); }
const copied = snapshot?.events.find(e => e.kind === "main-event-invocation");
if (copied) { copied.channel = "changed"; copied.argument_shapes[0] = "changed"; }
const retained = globalThis.__reaElectronActiveSnapshot().events.find(e => e.kind === "main-event-invocation");
console.log(JSON.stringify({ calls, reads, failure, copied: !!copied, retained: {channel: retained.channel, shapes: retained.argument_shapes} }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    expect(JSON.parse(execution.stdout)).toEqual({
      calls: 1,
      reads: 0,
      failure: null,
      copied: true,
      retained: { channel: "ch", shapes: ["number"] },
    });
  },
);

it("invokes handle callbacks without reading callable method properties", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-callable-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-callable-properties.cjs");
  await writeFile(
    script,
    `"use strict";
const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = async (emitter, observed) => {
  let calls = 0;
  let reads = 0;
  let correctReceiver = false;
  let arity = null;
  const listener = new Proxy(function(...args) {
    calls += 1;
    correctReceiver = this === undefined;
    arity = args.length;
  }, { get(target, key, receiver) {
    if (key === "call" || key === "apply") {
      reads += 1;
      throw new Error("callable metadata must not be read");
    }
    return Reflect.get(target, key, receiver);
  }});
  const event = { sender: { id: 9 } };
  let failure = null;
  try {
    if (observed) {
      emitter.handle("ch", listener);
      const handler = emitter.handlers.get("ch");
      await handler(event, 42);
    } else {
      await listener(event, 42);
    }
  } catch (cause) { failure = cause.message; }
  return { calls, reads, correct_receiver: correctReceiver, arity, failure };
};
(async () => {
  process.stdout.write(JSON.stringify({ plain: await scenario(new EventEmitter(), false),
    hooked: await scenario(ipcMain, true) }) + "\\n");
})();
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  expect(plain).toEqual({
    calls: 1,
    reads: 0,
    correct_receiver: true,
    arity: 2,
    failure: null,
  });
  expect(hooked).toEqual(plain);
});

it("keeps native removal traversal when an ipcMain observer prepends a listener", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ipc-prepend-");
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "ipc-prepend-during-removal.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const scenario = (emitter) => {
  const calls = [];
  const removed = [];
  const a = () => calls.push("a");
  const b = () => calls.push("b");
  const c = () => calls.push("c");
  const replacement = () => calls.push("replacement");
  const names = new Map([[a, "a"], [b, "b"], [c, "c"], [replacement, "replacement"]]);
  let inserted = false;
  emitter.on("removeListener", (channel, listener) => {
    if (channel !== "ch") return;
    removed.push(names.get(listener) ?? "unknown");
    if (!inserted) {
      inserted = true;
      emitter.prependListener("ch", replacement);
    }
  });
  emitter.on("ch", a);
  emitter.on("ch", b);
  emitter.on("ch", c);
  emitter.removeAllListeners("ch");
  const remaining = emitter.listeners("ch").map((listener) => names.get(listener));
  emitter.emit("ch", { sender: { id: 9 } });
  return { removed, remaining, calls };
};
process.stdout.write(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const { plain, hooked } = JSON.parse(execution.stdout) as {
    plain: Record<string, unknown>;
    hooked: Record<string, unknown>;
  };
  expect(hooked).toEqual(plain);
});

it.each(["accessor", "proxy"])(
  "does not evaluate %s listener metadata while classifying ipcMain wrappers",
  async (kind) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-ipc-accessor-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "ipc-listener-accessor.cjs");
    await writeFile(
      script,
      `const { ipcMain } = require("electron");
const { EventEmitter } = require("node:events");
const event = { sender: { id: 9 } };
const scenario = (emitter) => {
  let reads = 0;
  let calls = 0;
  let listener = () => { calls += 1; };
  const inspectMetadata = () => {
    reads += 1;
    throw new Error("listener metadata must not run during registration");
  };
  if (${JSON.stringify(kind)} === "accessor") {
    Object.defineProperty(listener, "listener", { get: inspectMetadata });
  } else {
    listener = new Proxy(listener, {
      getOwnPropertyDescriptor: inspectMetadata,
      get(target, key, receiver) {
        if (key === "listener") return inspectMetadata();
        return Reflect.get(target, key, receiver);
      },
    });
  }
  let failure = null;
  let registered = 0;
  try {
    emitter.on("accessor", listener);
    emitter.emit("accessor", event);
    registered = emitter.listenerCount("accessor");
    emitter.removeAllListeners("accessor");
  } catch (cause) { failure = cause.message; }
  return { reads, calls, registered, failure };
};
process.stdout.write(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain) }) + "\\n");
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const { plain, hooked } = JSON.parse(execution.stdout) as {
      plain: Record<string, unknown>;
      hooked: Record<string, unknown>;
    };
    expect(plain).toEqual({ reads: 0, calls: 1, registered: 1, failure: null });
    expect(hooked).toEqual(plain);
  },
);

it("isolates hook and exercise from ancestor Electron packages", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-ancestor-");
  temporary.push(root);
  await writeElectronFixture(root, 'module.exports = "/ambient/Electron";');
  const ambientHook = await stageHook(join(root, "producer", "scripts"));
  expect(createRequire(ambientHook)("electron")).toBe("/ambient/Electron");

  const fixture = join(root, "fixture");
  await writeElectronFixture(fixture);
  const script = join(fixture, "exercise.cjs");
  await writeFile(
    script,
    `const { BrowserWindow } = require("electron");
const window = new BrowserWindow({ webPreferences: {} });
process.stdout.write(JSON.stringify({
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error,
  window_open_handler: typeof window.webContents.windowOpenHandler,
}) + "\\n");
`,
  );
  const result = await runNode(script, fixture, ambientHook);
  expect(result.code, result.stderr).toBe(0);
  expect(JSON.parse(result.stdout)).toEqual({
    hook_error: false,
    window_open_handler: "function",
  });
});

it("does not read an application rawListeners accessor during hook setup", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-raw-listeners-accessor-",
  );
  temporary.push(root);
  const source = electronModuleSource.replace(
    "const ipcMain = new EventEmitter();",
    `const ipcMain = new EventEmitter();
let rawListenersReads = 0;
Object.defineProperty(ipcMain, "rawListeners", { configurable: true, get() {
  rawListenersReads++;
  throw new Error("application rawListeners getter");
}});
globalThis.__rawListenersReads = () => rawListenersReads;`,
  );
  await writeElectronFixture(root, source);
  const script = join(root, "raw-listeners-accessor.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
let calls = 0;
ipcMain.on("ch", () => calls++);
ipcMain.emit("ch");
ipcMain.removeAllListeners("ch");
console.log(JSON.stringify({ calls, reads: globalThis.__rawListenersReads(),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    calls: 1,
    reads: 0,
    hook_error: false,
  });
});

it("leaves an accessor removal method untouched and suppresses uncertain invocation evidence", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-method-accessor-",
  );
  temporary.push(root);
  const source = electronModuleSource.replace(
    "const ipcMain = new EventEmitter();",
    `const ipcMain = new EventEmitter();
let removeListenerReads = 0;
Object.defineProperty(ipcMain, "removeListener", { configurable: true, get() {
  removeListenerReads++;
  return EventEmitter.prototype.removeListener;
}});
globalThis.__removeListenerReads = () => removeListenerReads;`,
  );
  await writeElectronFixture(root, source);
  const script = join(root, "removal-method-accessor.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const listener = function original() {};
ipcMain.on("ch", listener);
ipcMain.emit("ch");
ipcMain.removeAllListeners("ch");
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ reads: globalThis.__removeListenerReads(),
  invocations: snapshot.events.filter((event) => event.kind === "main-event-invocation"),
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap"),
  remaining: ipcMain.listenerCount("ch"), hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly reads: number;
    readonly invocations: readonly unknown[];
    readonly gaps: readonly {
      readonly event: string;
      readonly channel: string | null;
    }[];
    readonly remaining: number;
    readonly hook_error: boolean;
  };
  expect(result).toMatchObject({
    reads: 0,
    invocations: [],
    remaining: 0,
    hook_error: false,
  });
  expect(result.gaps).toEqual([
    expect.objectContaining({ event: "listener-registration", channel: "ch" }),
  ]);
});

it("preserves native last-registration order when the last raw listener link is mutated", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-mutated-lifo-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-mutated-lifo.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const calls = [];
  const listener = () => calls.push("listener");
  const marker = () => calls.push("marker");
  const foreign = () => calls.push("foreign");
  const nativeRemove = emitter.removeListener;
  let removals = 0;
  let failure = null;
  emitter.on("removeListener", () => {});
  emitter.on("ch", listener);
  emitter.on("ch", marker);
  emitter.on("ch", listener);
  emitter.rawListeners("ch").at(-1).listener = foreign;
  emitter.removeListener = function(channel, candidate) {
    if (channel === "ch" && ++removals === 2)
      throw new Error("second callback removal rejected");
    return Reflect.apply(nativeRemove, this, arguments);
  };
  try { emitter.removeAllListeners("ch"); } catch (cause) { failure = cause.message; }
  emitter.removeListener = nativeRemove;
  calls.length = 0;
  emitter.emit("ch");
  return { failure, removals, remaining: emitter.listenerCount("ch"), calls };
};
process.stdout.write(JSON.stringify({
  plain: scenario(new EventEmitter()),
  hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error,
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(
    execution.stdout.trim().split("\n").at(-1) ?? "null",
  ) as {
    readonly plain: {
      readonly failure: string;
      readonly removals: number;
      readonly remaining: number;
      readonly calls: readonly string[];
    };
    readonly hooked: {
      readonly failure: string;
      readonly removals: number;
      readonly remaining: number;
      readonly calls: readonly string[];
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    failure: "second callback removal rejected",
    removals: 2,
    remaining: 2,
    calls: ["listener", "marker"],
  });
});

it("lets a later data listener link win over an earlier owned callback", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-later-data-link-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-later-data-link.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const calls = [];
  const original = function original() { calls.push("original"); };
  const later = function later() { calls.push("later"); };
  const removed = [];
  emitter.on("removeListener", (_channel, callback) => removed.push(callback === original ? "original" : callback === later ? "later" : "other"));
  emitter.on("ch", original);
  emitter.on("ch", later);
  emitter.rawListeners("ch")[1].listener = original;
  emitter.removeListener("ch", original);
  return { remaining: emitter.listenerCount("ch"), removed,
    originalStillRegistered: emitter.listeners("ch").includes(original),
    laterStillRegistered: emitter.listeners("ch").includes(later) };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: {
      readonly remaining: number;
      readonly removed: readonly string[];
      readonly originalStillRegistered: boolean;
      readonly laterStillRegistered: boolean;
    };
    readonly hooked: {
      readonly remaining: number;
      readonly removed: readonly string[];
      readonly originalStillRegistered: boolean;
      readonly laterStillRegistered: boolean;
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    remaining: 1,
    removed: ["original"],
    originalStillRegistered: true,
    laterStillRegistered: false,
  });
});

it("normalizes a later raw link to an earlier owned registration", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-owned-link-chain-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-owned-link-chain.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const calls = [];
  const original = function original() { calls.push("original"); };
  const later = function later() { calls.push("later"); };
  const foreign = function foreign() {};
  const removed = [];
  emitter.on("removeListener", (_channel, callback) => removed.push(callback === original ? "original" : callback === later ? "later" : "other"));
  emitter.on("ch", original);
  emitter.on("ch", later);
  const first = emitter.rawListeners("ch")[0];
  const second = emitter.rawListeners("ch")[1];
  first.listener = foreign;
  second.listener = first;
  emitter.removeListener("ch", original);
  emitter.emit("ch");
  return { remaining: emitter.listenerCount("ch"), removed, calls };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: {
      readonly remaining: number;
      readonly removed: readonly string[];
      readonly calls: readonly string[];
    };
    readonly hooked: {
      readonly remaining: number;
      readonly removed: readonly string[];
      readonly calls: readonly string[];
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    remaining: 1,
    removed: ["original"],
    calls: ["original"],
  });
});

it("preserves native direct-removal cleanup with throwing listener metadata", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-accessor-gap-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-accessor-gap.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const marker = new Error("listener metadata getter");
let reads = 0;
const listener = function original() {};
ipcMain.on("ch", listener);
Object.defineProperty(ipcMain.rawListeners("ch")[0], "listener", { get() {
  reads++;
  throw marker;
}});
let failure;
try { ipcMain.removeListener("ch", listener); } catch (cause) { failure = cause; }
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ reads, sameFailure: failure === marker,
  remaining: ipcMain.listenerCount("ch"),
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap"),
  hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly reads: number;
    readonly sameFailure: boolean;
    readonly remaining: number;
    readonly gaps: readonly Record<string, unknown>[];
    readonly hook_error: boolean;
  };
  // Pinned Node24.18 removes the exact callback without reading its public
  // metadata when no removeListener observer is registered.
  expect(result).toMatchObject({
    reads: 0,
    sameFailure: false,
    remaining: 0,
    hook_error: false,
  });
  expect(result.gaps).toEqual([]);
});

it("forwards native direct-removal bookkeeping to the real emitter", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-bookkeeping-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-bookkeeping.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = function original() {};
  const foreign = function foreign() {};
  const payloads = [];
  emitter.on("removeListener", (_channel, callback) => payloads.push(callback === foreign ? "foreign" : callback === listener ? "original" : "other"));
  emitter.on("ch", listener);
  emitter.rawListeners("ch")[0].listener = foreign;
  emitter.removeListener("ch", listener);
  const afterRemoval = { eventCount: emitter._eventsCount, names: emitter.eventNames().map(String) };
  emitter.on("after", () => {});
  const afterRegister = { eventCount: emitter._eventsCount, names: emitter.eventNames().map(String) };
  return { payloads, afterRemoval, afterRegister };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: {
      readonly payloads: readonly string[];
      readonly afterRemoval: {
        readonly eventCount: number;
        readonly names: readonly string[];
      };
      readonly afterRegister: {
        readonly eventCount: number;
        readonly names: readonly string[];
      };
    };
    readonly hooked: {
      readonly payloads: readonly string[];
      readonly afterRemoval: {
        readonly eventCount: number;
        readonly names: readonly string[];
      };
      readonly afterRegister: {
        readonly eventCount: number;
        readonly names: readonly string[];
      };
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    payloads: ["foreign"],
    afterRemoval: { eventCount: 1, names: ["removeListener"] },
    afterRegister: { eventCount: 2, names: ["removeListener", "after"] },
  });
});

it.each([1, 2] as const)(
  "preserves owned listener accessor meta-event behavior with %s registration(s)",
  async (registrationCount) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-removal-meta-accessor-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "removal-meta-accessor.cjs");
    await writeFile(
      script,
      `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const registrationCount = ${JSON.stringify(registrationCount)};
const scenario = (emitter) => {
  const stages = [];
  const listener = function original() {};
  const marker = function marker() {};
  let reads = 0;
  emitter.on("removeListener", (channel, callback) => {
    stages.push({ kind: "meta", channel, callbackIsOriginal: callback === listener,
      callbackIsMarker: callback === marker, remaining: emitter.listenerCount("ch") });
  });
  for (let index = 0; index < registrationCount; index++) emitter.on("ch", listener);
  if (registrationCount === 2) emitter.on("ch", marker);
  Object.defineProperty(emitter.rawListeners("ch")[0], "listener", { configurable: true, get() {
    reads++;
    stages.push({ kind: "getter" });
    return listener;
  }});
  let failure = null;
  try { emitter.removeListener("ch", listener); } catch (cause) { failure = cause.message; }
  return { reads, failure, remaining: emitter.listenerCount("ch"), stages };
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
console.log(JSON.stringify({ plain, hooked,
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const result = JSON.parse(execution.stdout) as {
      readonly plain: {
        readonly reads: number;
        readonly failure: string | null;
        readonly remaining: number;
        readonly stages: readonly Record<string, unknown>[];
      };
      readonly hooked: {
        readonly reads: number;
        readonly failure: string | null;
        readonly remaining: number;
        readonly stages: readonly Record<string, unknown>[];
      };
      readonly hook_error: boolean;
    };
    expect(result.hook_error).toBe(false);
    expect(result.hooked).toEqual(result.plain);
    expect(result.plain.reads).toBe(registrationCount === 1 ? 1 : 0);
    expect(result.plain.failure).toBeNull();
    expect(result.plain.stages[0]).toMatchObject(
      registrationCount === 1 ? { kind: "getter" } : { kind: "meta" },
    );
    expect(result.plain.stages.at(-1)).toMatchObject({
      kind: "meta",
      channel: "ch",
      callbackIsOriginal: true,
      remaining: registrationCount === 1 ? 0 : 2,
    });
  },
);

it("keeps listener ownership when native function prototype metadata changes", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-wrapper-constructor-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "wrapper-constructor.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = function original() {};
  const foreign = function foreign() {};
  emitter.on("ch", listener);
  const entry = emitter.rawListeners("ch")[0];
  const constructor = entry.prototype.constructor;
  const constructorIsPublicEntry = constructor === entry;
  constructor.listener = foreign;
  emitter.removeListener("ch", listener);
  return { constructorIsPublicEntry, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    constructorIsPublicEntry: true,
    remaining: 0,
  });
});

it("matches native custom inspection that mutates the raw listener", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-inspect-mutation-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-inspect-mutation.cjs");
  await writeFile(
    script,
    `const { inspect } = require("node:util");
const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = function original() {};
  const foreign = function foreign() {};
  emitter.on("ch", listener);
  const raw = emitter.rawListeners("ch")[0];
  let inspectorReceiverIsRaw = false;
  raw[inspect.custom] = function() {
    inspectorReceiverIsRaw = this === raw;
    this.listener = foreign;
    return "listener inspected";
  };
  const description = inspect(raw, { showProxy: true });
  emitter.removeListener("ch", listener);
  return { inspectorReceiverIsRaw, description,
    remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    inspectorReceiverIsRaw: true,
    description: "listener inspected",
    remaining: 0,
  });
});

it("normalizes an earlier raw owner in a later removal meta payload", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-owned-meta-link-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-owned-meta-link.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const original = function original() {};
  const later = function later() {};
  const payloads = [];
  emitter.on("removeListener", (_channel, callback) => payloads.push(
    callback === original ? "original" : callback === later ? "later" : "other"));
  emitter.on("ch", original);
  const firstRaw = emitter.rawListeners("ch")[0];
  emitter.removeListener("ch", original);
  emitter.on("ch", later);
  emitter.rawListeners("ch")[0].listener = firstRaw;
  emitter.removeListener("ch", original);
  return { payloads, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    payloads: ["original", "original"],
    remaining: 0,
  });
});

it("preserves the native argument that proves a chained removal match", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-chain-argument-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-chain-argument.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const calls = [];
  const original = function original() { calls.push("original"); };
  const g = function g() { calls.push("g"); };
  const h = function h() { calls.push("h"); };
  const removed = [];
  emitter.on("removeListener", (_channel, callback) => removed.push(
    callback === original ? "original" : callback === g ? "g" : callback === h ? "h" : "other"));
  emitter.on("ch", original);
  const firstRaw = emitter.rawListeners("ch")[0];
  g.listener = firstRaw;
  emitter.on("ch", g);
  h.listener = g;
  emitter.on("ch", h);
  emitter.removeListener("ch", original);
  emitter.emit("ch");
  return { remaining: emitter.listenerCount("ch"), removed, calls };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    remaining: 2,
    removed: ["original"],
    calls: ["original", "h"],
  });
});

it("falls back to native errors for a revoked listener-array proxy", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-revoked-listener-array-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "revoked-listener-array.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = function original() {};
  const marker = function marker() {};
  emitter.on("ch", listener);
  emitter.on("ch", marker);
  const entry = emitter.rawListeners("ch")[0];
  entry.listener = function foreign() {};
  const revocable = Proxy.revocable(emitter._events.ch, {});
  emitter._events.ch = revocable.proxy;
  revocable.revoke();
  let failure = null;
  try { emitter.removeListener("ch", listener); } catch (cause) { failure = { name: cause.name, message: cause.message }; }
  return failure;
};
const plain = scenario(new EventEmitter());
const hooked = scenario(ipcMain);
console.log(JSON.stringify({ plain, hooked,
  gaps: globalThis.__reaElectronActiveSnapshot().events.filter((event) => event.kind === "ipc-observation-gap"),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: { readonly name: string; readonly message: string };
    readonly hooked: { readonly name: string; readonly message: string };
    readonly gaps: readonly {
      readonly event: string;
      readonly target: string;
    }[];
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.gaps).toContainEqual(
    expect.objectContaining({
      event: "listener-removal",
      target: "ipcMain.removeListener",
    }),
  );
});

it("records a gap when an opaque later registration blocks ownership ordering", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-opaque-gap-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-opaque-gap.cjs");
  await writeFile(
    script,
    `const { ipcMain } = require("electron");
const listener = function original() {};
const opaque = function opaque() {};
ipcMain.on("ch", listener);
ipcMain.on("ch", opaque);
ipcMain.rawListeners("ch")[0].listener = listener;
Object.defineProperty(ipcMain.rawListeners("ch")[1], "listener", { get() { return undefined; } });
ipcMain.removeListener("ch", listener);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ remaining: ipcMain.listenerCount("ch"),
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap"),
  hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly remaining: number;
    readonly gaps: readonly {
      readonly event: string;
      readonly channel: string | null;
    }[];
    readonly hook_error: boolean;
  };
  expect(result.remaining).toBe(1);
  expect(result.gaps).toContainEqual(
    expect.objectContaining({
      kind: "ipc-observation-gap",
      event: "listener-removal",
      phase: "observed",
      channel: "ch",
      target: "ipcMain.removeListener",
      process_type: "main",
      error: false,
    }),
  );
  expect(result.hook_error).toBe(false);
});

it("preserves pre-hook removeListener decorator receiver and callback identity", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-preinstalled-removal-decorator-",
  );
  temporary.push(root);
  const source = electronModuleSource.replace(
    "const ipcMain = new EventEmitter();",
    `const ipcMain = new EventEmitter();
globalThis.__preHookRemovalCalls = [];
const originalRemoveListener = EventEmitter.prototype.removeListener;
ipcMain.removeListener = function(channel, callback) {
  globalThis.__preHookRemovalCalls.push({
    receiverIsEmitter: this === ipcMain,
    callback,
  });
  return Reflect.apply(originalRemoveListener, this, arguments);
};`,
  );
  await writeElectronFixture(root, source);
  const script = join(root, "preinstalled-removal-decorator.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const observations = globalThis.__preHookRemovalCalls;
const decorate = (emitter) => {
  const native = EventEmitter.prototype.removeListener;
  emitter.removeListener = function(channel, callback) {
    observations.push({ receiverIsEmitter: this === emitter, callback });
    return Reflect.apply(native, this, arguments);
  };
  return emitter;
};
const scenario = (emitter) => {
  const start = observations.length;
  const original = function original() {};
  emitter.on("ch", original);
  emitter.rawListeners("ch")[0].listener = () => {};
  emitter.removeListener("ch", original);
  return {
    remaining: emitter.listenerCount("ch"),
    forwarded: observations.slice(start).map(({ receiverIsEmitter, callback }) => ({
      receiverIsEmitter, callbackIsOriginal: callback === original,
    })),
  };
};
const plain = scenario(decorate(new EventEmitter()));
const hooked = scenario(ipcMain);
console.log(JSON.stringify({ plain: plain.remaining, hooked: hooked.remaining,
  observations: [...plain.forwarded, ...hooked.forwarded],
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: number;
    readonly hooked: number;
    readonly observations: readonly {
      readonly receiverIsEmitter: boolean;
      readonly callbackIsOriginal: boolean;
    }[];
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.plain).toBe(0);
  expect(result.hooked).toBe(0);
  expect(result.observations).toEqual([
    { receiverIsEmitter: true, callbackIsOriginal: true },
    { receiverIsEmitter: true, callbackIsOriginal: true },
  ]);
});

it("forwards pre-hook on and once decorators exact registrations with an explicit gap", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-preinstalled-registration-decorators-",
  );
  temporary.push(root);
  const source = electronModuleSource.replace(
    "const ipcMain = new EventEmitter();",
    `const ipcMain = new EventEmitter();
globalThis.__preHookRegistrationCalls = [];
const install = (emitter) => {
  const nativeOn = EventEmitter.prototype.on;
  const nativeOnce = EventEmitter.prototype.once;
  emitter.on = function(channel, callback) {
    globalThis.__preHookRegistrationCalls.push({
      method: "on", receiverIsEmitter: this === emitter, callback,
    });
    return Reflect.apply(nativeOn, this, arguments);
  };
  emitter.once = function(channel, callback) {
    globalThis.__preHookRegistrationCalls.push({
      method: "once", receiverIsEmitter: this === emitter, callback,
    });
    return Reflect.apply(nativeOnce, this, arguments);
  };
};
install(ipcMain);`,
  );
  await writeElectronFixture(root, source);
  const script = join(root, "preinstalled-registration-decorators.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const observations = globalThis.__preHookRegistrationCalls;
const decorate = (emitter) => {
  const nativeOn = EventEmitter.prototype.on;
  const nativeOnce = EventEmitter.prototype.once;
  emitter.on = function(channel, callback) {
    observations.push({ method: "on", receiverIsEmitter: this === emitter, callback });
    return Reflect.apply(nativeOn, this, arguments);
  };
  emitter.once = function(channel, callback) {
    observations.push({ method: "once", receiverIsEmitter: this === emitter, callback });
    return Reflect.apply(nativeOnce, this, arguments);
  };
  return emitter;
};
const scenario = (emitter) => {
  const start = observations.length;
  const calls = [];
  const ordinary = function ordinary() { calls.push("ordinary"); };
  const oneShot = function oneShot() { calls.push("oneShot"); };
  emitter.on("ch", ordinary);
  emitter.once("ch", oneShot);
  emitter.emit("ch");
  emitter.removeAllListeners("ch");
  return {
    calls,
    forwarded: observations.slice(start).map(({ method, receiverIsEmitter, callback }) => ({
      method, receiverIsEmitter,
      callbackIdentity: callback === ordinary ? "ordinary" : callback === oneShot ? "oneShot" :
        Object.getOwnPropertyDescriptor(callback, "listener")?.value === oneShot ? "onceWrapper" : "unexpected",
    })),
  };
};
const plain = scenario(decorate(new EventEmitter()));
const hooked = scenario(ipcMain);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain: plain.calls, hooked: hooked.calls,
  observations: [...plain.forwarded, ...hooked.forwarded],
  calls: snapshot.events.filter((event) => event.kind === "main-event-invocation"),
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap"),
  hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: readonly string[];
    readonly hooked: readonly string[];
    readonly observations: readonly {
      readonly method: string;
      readonly receiverIsEmitter: boolean;
      readonly callbackIdentity: string;
    }[];
    readonly calls: readonly unknown[];
    readonly gaps: readonly {
      readonly event: string;
      readonly channel: string | null;
    }[];
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.plain).toEqual(["ordinary", "oneShot"]);
  expect(result.hooked).toEqual(result.plain);
  expect(result.observations).toEqual([
    { method: "on", receiverIsEmitter: true, callbackIdentity: "ordinary" },
    { method: "once", receiverIsEmitter: true, callbackIdentity: "oneShot" },
    {
      method: "on",
      receiverIsEmitter: true,
      callbackIdentity: "onceWrapper",
    },
    { method: "on", receiverIsEmitter: true, callbackIdentity: "ordinary" },
    { method: "once", receiverIsEmitter: true, callbackIdentity: "oneShot" },
    {
      method: "on",
      receiverIsEmitter: true,
      callbackIdentity: "onceWrapper",
    },
  ]);
  expect(result.calls).toEqual([]);
  expect(
    result.gaps.filter((gap) => gap.event === "listener-registration"),
  ).toHaveLength(2);
  expect(result.gaps.map((gap) => gap.channel)).toEqual(["ch", "ch"]);
});

it("forwards borrowed on and once registrations without attributing calls to ipcMain", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-borrowed-registration-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "borrowed-registration.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (hooked) => {
  const target = new EventEmitter();
  const registrations = [];
  const calls = [];
  const originalOn = hooked ? ipcMain.on : EventEmitter.prototype.on;
  const originalOnce = hooked ? ipcMain.once : EventEmitter.prototype.once;
  const onListener = function onListener() { calls.push("on"); };
  const onceListener = function onceListener() { calls.push("once"); };
  const foreign = function foreign() {};
  EventEmitter.prototype.on.call(target, "newListener", (channel, callback) => {
    if (channel === "on") registrations.push(callback === onListener);
    if (channel === "once") registrations.push(callback === onceListener);
  });
  Reflect.apply(originalOn, target, ["on", onListener]);
  target.rawListeners("on")[0].listener = foreign;
  target.removeListener("on", onListener);
  target.emit("on");
  Reflect.apply(originalOnce, target, ["once", onceListener]);
  target.rawListeners("once")[0].listener = foreign;
  target.removeListener("once", onceListener);
  target.emit("once");
  return { registrations, calls, remaining: target.eventNames().map(String) };
};
const plain = scenario(false);
const hooked = scenario(true);
const invalid = (method, target) => {
  try { Reflect.apply(target[method], null, ["invalid", () => {}]); return null; }
  catch (cause) { return { name: cause.name, message: cause.message }; }
};
const failures = { plain: {}, hooked: {} };
for (const method of ["on", "once"]) {
  failures.plain[method] = invalid(method, EventEmitter.prototype);
  failures.hooked[method] = invalid(method, ipcMain);
}
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked, failures,
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap").map((event) => ({
    channel: event.channel, event: event.event, target: event.target, error: event.error,
  })),
  invocations: snapshot.events.filter((event) => event.kind === "main-event-invocation").length,
  hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    registrations: [true, true],
    calls: ["once"],
    remaining: ["newListener"],
  });
  expect(result.failures.hooked).toEqual(result.failures.plain);
  expect(result.failures.plain.on.name).toBe("TypeError");
  expect(result.failures.plain.once.name).toBe("TypeError");
  expect(result.gaps).toEqual([
    {
      channel: "on",
      event: "listener-registration",
      target: "ipcMain.on",
      error: false,
    },
    {
      channel: "once",
      event: "listener-registration",
      target: "ipcMain.once",
      error: false,
    },
    {
      channel: "invalid",
      event: "listener-registration",
      target: "ipcMain.on",
      error: true,
    },
    {
      channel: "invalid",
      event: "listener-registration",
      target: "ipcMain.once",
      error: true,
    },
  ]);
  expect(result.invocations).toBe(0);
});

it("does not inspect object event channels while recording registration gaps", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-object-channel-gap-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "object-channel-gap.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (hooked) => {
  const target = new EventEmitter();
  const effects = [];
  const channel = {
    [Symbol.toPrimitive](hint) { effects.push("coerce:" + hint); return "object-channel"; },
    get toJSON() { effects.push("get:toJSON"); throw new Error("unexpected channel serialization"); },
  };
  const listener = function original() {};
  const registration = hooked ? ipcMain.on : EventEmitter.prototype.on;
  Reflect.apply(registration, target, [channel, listener]);
  return { effects, eventNames: target.eventNames() };
};
const plain = scenario(false);
const hooked = scenario(true);
const snapshot = globalThis.__reaElectronActiveSnapshot();
console.log(JSON.stringify({ plain, hooked,
  gaps: snapshot.events.filter((event) => event.kind === "ipc-observation-gap").map((event) => ({
    channel: event.channel, event: event.event, target: event.target,
  })), hook_error: snapshot.hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout);
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain.effects).toEqual(["coerce:string", "coerce:string"]);
  expect(result.plain.eventNames).toEqual(["object-channel"]);
  expect(result.gaps).toEqual([
    { channel: null, event: "listener-registration", target: "ipcMain.on" },
  ]);
});

it("preserves borrowed removeAllListeners callback identity", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-borrowed-remove-all-identity-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "borrowed-remove-all-identity.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const publicListener = (() => {
  const listener = function original() {};
  ipcMain.on("source", listener);
  return ipcMain.rawListeners("source")[0];
})();
const makeForeignEmitter = () => {
  const emitter = new EventEmitter();
  const received = [];
  emitter.on("removeListener", () => {});
  emitter.on("ch", publicListener);
  const nativeRemove = EventEmitter.prototype.removeListener;
  emitter.removeListener = function(channel, callback) {
    if (channel === "ch") {
      received.push(callback);
      if (callback !== publicListener) throw new Error("wrong removal callback");
    }
    return Reflect.apply(nativeRemove, this, arguments);
  };
  return { emitter, received };
};
const control = makeForeignEmitter();
const borrowed = makeForeignEmitter();
EventEmitter.prototype.removeAllListeners.call(control.emitter, "ch");
let failure = null;
try { Reflect.apply(ipcMain.removeAllListeners, borrowed.emitter, ["ch"]); }
catch (cause) { failure = cause.message; }
console.log(JSON.stringify({
  controlReceivedPublic: control.received.length === 1 && control.received[0] === publicListener,
  borrowedReceivedPublic: borrowed.received.length === 1 && borrowed.received[0] === publicListener,
  controlRemaining: control.emitter.listenerCount("ch"),
  borrowedRemaining: borrowed.emitter.listenerCount("ch"),
  failure,
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error,
}));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  expect(JSON.parse(execution.stdout)).toEqual({
    controlReceivedPublic: true,
    borrowedReceivedPublic: true,
    controlRemaining: 0,
    borrowedRemaining: 0,
    failure: null,
    hook_error: false,
  });
});

it("does not coerce object channels before native listener removal", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-object-channel-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "object-channel.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  let conversions = 0;
  const listener = () => {};
  emitter.on("ch", listener);
  const rawListener = emitter.rawListeners("ch")[0];
  rawListener.listener = () => {};
  rawListener.listener = listener;
  const channel = { [Symbol.toPrimitive]() { conversions++; return "ch"; } };
  emitter.removeListener(channel, listener);
  return { conversions, remaining: emitter.listenerCount("ch") };
};
console.log(JSON.stringify({ plain: scenario(new EventEmitter()), hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: {
      readonly conversions: number;
      readonly remaining: number;
    };
    readonly hooked: {
      readonly conversions: number;
      readonly remaining: number;
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({ conversions: 1, remaining: 0 });
});

it("removes observed ipcMain registrations after the public listener link is deleted", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-removal-deleted-link-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "removal-deleted-link.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter) => {
  const listener = () => {};
  const removed = [];
  const nativeRemove = emitter.removeListener;
  let seenOriginal = false;
  emitter.on("removeListener", (_channel, callback) => removed.push(callback === listener));
  emitter.on("ch", listener);
  delete emitter.rawListeners("ch")[0].listener;
  emitter.removeListener = function(channel, callback) {
    if (channel === "ch") seenOriginal = callback === listener;
    return Reflect.apply(nativeRemove, this, arguments);
  };
  emitter.removeAllListeners("ch");
  emitter.removeListener = nativeRemove;
  return { seenOriginal, remaining: emitter.listenerCount("ch"), removed };
};
process.stdout.write(JSON.stringify({
  plain: scenario(new EventEmitter()),
  hooked: scenario(ipcMain),
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error,
}) + "\\n");
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(
    execution.stdout.trim().split("\n").at(-1) ?? "null",
  ) as {
    readonly plain: {
      readonly seenOriginal: boolean;
      readonly remaining: number;
      readonly removed: readonly boolean[];
    };
    readonly hooked: {
      readonly seenOriginal: boolean;
      readonly remaining: number;
      readonly removed: readonly boolean[];
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    seenOriginal: true,
    remaining: 0,
    removed: [true],
  });
});

it("passes canonical owned callbacks through post-hook removeAll decorators despite accessor metadata", async () => {
  const root = await createTestTempDirectory(
    "rea-electron-hook-remove-all-decorator-accessor-",
  );
  temporary.push(root);
  await writeElectronFixture(root);
  const script = join(root, "remove-all-decorator-accessor.cjs");
  await writeFile(
    script,
    `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const scenario = (emitter, hooked) => {
  const listener = function original() {};
  const removals = [];
  let reads = 0;
  emitter.on("removeListener", () => {});
  emitter.on("ch", listener);
  Object.defineProperty(emitter.rawListeners("ch")[0], "listener", { configurable: true, get() {
    reads++;
    throw new Error("metadata getter");
  }});
  const capturedRemove = hooked ? emitter.removeListener : EventEmitter.prototype.removeListener;
  emitter.removeListener = function(channel, callback) {
    if (channel === "ch") {
      removals.push({ receiverIsEmitter: this === emitter, callbackIsOriginal: callback === listener });
      if (callback !== listener) throw new Error("decorator received noncanonical callback");
    }
    return Reflect.apply(capturedRemove, this, arguments);
  };
  let failure = null;
  try { emitter.removeAllListeners("ch"); } catch (cause) { failure = cause.message; }
  return { reads, failure, remaining: emitter.listenerCount("ch"), removals };
};
const plain = scenario(new EventEmitter(), false);
const hooked = scenario(ipcMain, true);
console.log(JSON.stringify({ plain, hooked,
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error }));
`,
  );
  const execution = await runNode(script, root);
  expect(execution.code, execution.stderr).toBe(0);
  const result = JSON.parse(execution.stdout) as {
    readonly plain: {
      readonly reads: number;
      readonly failure: string | null;
      readonly remaining: number;
      readonly removals: readonly {
        readonly receiverIsEmitter: boolean;
        readonly callbackIsOriginal: boolean;
      }[];
    };
    readonly hooked: {
      readonly reads: number;
      readonly failure: string | null;
      readonly remaining: number;
      readonly removals: readonly {
        readonly receiverIsEmitter: boolean;
        readonly callbackIsOriginal: boolean;
      }[];
    };
    readonly hook_error: boolean;
  };
  expect(result.hook_error).toBe(false);
  expect(result.hooked).toEqual(result.plain);
  expect(result.plain).toEqual({
    reads: 1,
    failure: "metadata getter",
    remaining: 0,
    removals: [{ receiverIsEmitter: true, callbackIsOriginal: true }],
  });
});

it.each(["removeListener", "off"] as const)(
  "preserves direct %s cleanup for changed and deleted raw listener links",
  async (method) => {
    const root = await createTestTempDirectory(
      "rea-electron-hook-removal-direct-link-",
    );
    temporary.push(root);
    await writeElectronFixture(root);
    const script = join(root, "removal-direct-link.cjs");
    await writeFile(
      script,
      `const { EventEmitter } = require("node:events");
const { ipcMain } = require("electron");
const method = ${JSON.stringify(method)};
const scenario = (emitter, deletion) => {
  const listener = () => {};
  emitter.on("ch", listener);
  const entry = emitter.rawListeners("ch")[0];
  if (deletion) delete entry.listener;
  else entry.listener = () => {};
  const returned = emitter[method]("ch", listener);
  return { remaining: emitter.listenerCount("ch"), returnedEmitter: returned === emitter };
};
const outcomes = {};
for (const deletion of [false, true]) {
  const plain = new EventEmitter();
  outcomes[deletion ? "deleted" : "changed"] = {
    plain: scenario(plain, deletion),
    hooked: scenario(ipcMain, deletion),
  };
  ipcMain.removeAllListeners();
}
process.stdout.write(JSON.stringify({
  outcomes,
  hook_error: globalThis.__reaElectronActiveSnapshot().hook_error,
}) + "\\n");
`,
    );
    const execution = await runNode(script, root);
    expect(execution.code, execution.stderr).toBe(0);
    const result = JSON.parse(
      execution.stdout.trim().split("\n").at(-1) ?? "null",
    ) as {
      readonly outcomes: Record<
        string,
        {
          readonly plain: {
            readonly remaining: number;
            readonly returnedEmitter: boolean;
          };
          readonly hooked: {
            readonly remaining: number;
            readonly returnedEmitter: boolean;
          };
        }
      >;
      readonly hook_error: boolean;
    };
    expect(result.hook_error).toBe(false);
    expect(result.outcomes.changed?.hooked).toEqual(
      result.outcomes.changed?.plain,
    );
    expect(result.outcomes.deleted?.hooked).toEqual(
      result.outcomes.deleted?.plain,
    );
    expect(result.outcomes).toEqual({
      changed: {
        plain: { remaining: 0, returnedEmitter: true },
        hooked: { remaining: 0, returnedEmitter: true },
      },
      deleted: {
        plain: { remaining: 0, returnedEmitter: true },
        hooked: { remaining: 0, returnedEmitter: true },
      },
    });
  },
);

it("preserves fatal process termination after recording uncaught exceptions", async () => {
  const root = await createTestTempDirectory("rea-electron-hook-fatal-");
  temporary.push(root);
  await writeElectronFixture(
    root,
    'throw new Error("controlled Electron unavailable");',
  );
  const script = join(root, "fatal.cjs");
  await writeFile(
    script,
    'process.stdout.write(String(globalThis.__reaElectronActiveSnapshot().hook_error) + "\\n");\nthrow new Error("fatal-hook-secret");\n',
  );
  const result = await runNode(script, root);

  expect(result.code).not.toBe(0);
  expect(result.stdout.trim()).toBe("true");
  expect(result.stderr).toContain("fatal-hook-secret");
});

const writeElectronFixture = async (
  root: string,
  source = electronModuleSource,
) => {
  const directory = join(root, "node_modules", "electron");
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, "package.json"),
    JSON.stringify({ name: "electron", main: "index.cjs" }),
  );
  await writeFile(join(directory, "index.cjs"), source);
};

const stageHook = async (
  root: string,
  source = fileURLToPath(
    new URL("../../../scripts/electron-active-hook.cjs", import.meta.url),
  ),
) => {
  await mkdir(root, { recursive: true });
  const hook = join(root, "electron-active-hook.cjs");
  await Promise.all([
    copyFile(source, hook),
    copyFile(
      join(dirname(source), "electron-active-hook-boundaries.cjs"),
      join(root, "electron-active-hook-boundaries.cjs"),
    ),
  ]);
  return hook;
};

const runNode = async (
  script: string,
  root: string,
  sourceHook?: string,
): Promise<{
  readonly code: number | null;
  readonly stdout: string;
  readonly stderr: string;
}> => {
  const hook = await stageHook(root, sourceHook);
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-r", hook, script], {
      cwd: root,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", reject);
    child.once("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
      }),
    );
  });
};
