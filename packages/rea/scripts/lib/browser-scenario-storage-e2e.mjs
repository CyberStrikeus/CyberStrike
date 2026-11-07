import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { createBrowserScenarioProvider } from "../../dist/composition/browserScenario.js";
import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import {
  runScenarioCli,
  scenarioProfiles,
} from "./browser-scenario-verifier.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

const scenarioFor = (browser, origin) =>
  browserScenarioSchema.parse({
    browser,
    start_url: { url: `${origin}/storage-main` },
    actions: [
      {
        step_id: "frame-ready",
        action: "wait_for",
        locator: { kind: "css", selector: "#frame-report[data-ready='true']" },
        state: "attached",
        timeout_ms: 10_000,
      },
      {
        step_id: "top-level-partition",
        action: "goto",
        destination: {
          url: `${origin.replace("127.0.0.1", "localhost")}/storage-top`,
        },
        wait_until: "load",
      },
      {
        step_id: "return-to-origin",
        action: "goto",
        destination: { url: `${origin}/storage-main` },
        wait_until: "load",
      },
    ],
    storage: {
      local_storage: [
        {
          origin,
          entries: [
            {
              name: "rea_storage_probe",
              value: { source: "literal", value: "main-initial" },
            },
            {
              name: "rea_storage_remove",
              value: { source: "literal", value: "main-remove-seed" },
            },
          ],
        },
        {
          origin: origin.replace("127.0.0.1", "localhost"),
          entries: [
            {
              name: "rea_storage_probe",
              value: { source: "literal", value: "frame-initial" },
            },
            {
              name: "rea_storage_remove",
              value: { source: "literal", value: "frame-remove-seed" },
            },
          ],
        },
      ],
      session_storage: [
        {
          origin,
          entries: [
            {
              name: "rea_storage_probe",
              value: { source: "literal", value: "main-session-initial" },
            },
            {
              name: "rea_storage_empty",
              value: { source: "literal", value: "main-empty-seed" },
            },
          ],
        },
        {
          origin: origin.replace("127.0.0.1", "localhost"),
          entries: [
            {
              name: "rea_storage_probe",
              value: { source: "literal", value: "frame-session-initial" },
            },
            {
              name: "rea_storage_empty",
              value: { source: "literal", value: "frame-empty-seed" },
            },
          ],
        },
      ],
    },
    capture: { after_each_step: ["dom"], at_end: ["dom"] },
  });

const raceWithTimeout = (operation, timeoutMs, onTimeout = () => undefined) => {
  const controller = new AbortController();
  return Promise.race([
    operation,
    delay(timeoutMs, undefined, { signal: controller.signal }).then(onTimeout),
  ]).finally(() => controller.abort());
};

const storagePage = (kind, port) => {
  if (kind === "main")
    return `<!doctype html><html><body><pre id="main-report"></pre><pre id="frame-report"></pre><iframe src="http://localhost:${port}/storage-frame"></iframe><script>
      const state = { local: localStorage.getItem("rea_storage_probe"), session: sessionStorage.getItem("rea_storage_probe"), removed: localStorage.getItem("rea_storage_remove"), empty: sessionStorage.getItem("rea_storage_empty") };
      document.querySelector("#main-report").textContent = JSON.stringify(state);
      localStorage.setItem("rea_storage_probe", "main-updated");
      sessionStorage.setItem("rea_storage_probe", "main-session-updated");
      localStorage.removeItem("rea_storage_remove");
      sessionStorage.setItem("rea_storage_empty", "");
      addEventListener("message", (event) => {
        if (event.data?.kind !== "rea-storage-frame") return;
        const report = document.querySelector("#frame-report");
        report.textContent = JSON.stringify(event.data.state);
        report.dataset.ready = "true";
      });
    </script></body></html>`;
  if (kind === "frame")
    return `<!doctype html><html><body><pre id="frame-state"></pre><script>
      const state = { local: localStorage.getItem("rea_storage_probe"), session: sessionStorage.getItem("rea_storage_probe"), removed: localStorage.getItem("rea_storage_remove"), empty: sessionStorage.getItem("rea_storage_empty") };
      document.querySelector("#frame-state").textContent = JSON.stringify(state);
      localStorage.setItem("rea_storage_probe", "frame-updated");
      sessionStorage.setItem("rea_storage_probe", "frame-session-updated");
      localStorage.removeItem("rea_storage_remove");
      sessionStorage.setItem("rea_storage_empty", "");
      parent.postMessage({ kind: "rea-storage-frame", state }, "*");
    </script></body></html>`;
  if (kind === "debugger")
    return `<!doctype html><html><body><pre id="debugger-state"></pre><script>
      window.reaDebuggerBefore = true;
      debugger;
      window.reaDebuggerAfter = true;
      document.querySelector("#debugger-state").textContent = String(window.reaDebuggerAfter);
    </script></body></html>`;
  return `<!doctype html><html><body><pre id="top-report"></pre><script>
    const state = { local: localStorage.getItem("rea_storage_probe"), session: sessionStorage.getItem("rea_storage_probe"), removed: localStorage.getItem("rea_storage_remove"), empty: sessionStorage.getItem("rea_storage_empty") };
    document.querySelector("#top-report").textContent = JSON.stringify(state);
    localStorage.setItem("rea_storage_probe", "top-updated");
    sessionStorage.setItem("rea_storage_probe", "top-session-updated");
  </script></body></html>`;
};

const startStorageSite = async () => {
  let port = 0;
  const server = createServer((request, response) => {
    const path = new URL(request.url ?? "/", "http://127.0.0.1").pathname;
    const kind =
      path === "/storage-main"
        ? "main"
        : path === "/storage-frame"
          ? "frame"
          : path === "/storage-debugger"
            ? "debugger"
            : path === "/storage-top"
              ? "top"
              : undefined;
    if (kind === undefined) {
      response.writeHead(404).end();
      return;
    }
    response.setHeader("content-type", "text/html; charset=utf-8");
    response.end(storagePage(kind, port));
  });
  server.listen(0, "::");
  await once(server, "listening");
  port = server.address().port;
  return {
    origin: `http://127.0.0.1:${port}`,
    close: async () => {
      server.close();
      // Chrome can leave speculative TCP connections without an HTTP request;
      // server.close() alone waits indefinitely for those owned sockets.
      server.closeAllConnections();
      await once(server, "close");
    },
  };
};

const domText = (step) => {
  assert.equal(step.artifacts.dom.state, "captured");
  return step.artifacts.dom.value.text;
};

const assertContainsState = (text, id, expected) => {
  const match = new RegExp(`<pre id="${id}"[^>]*>(.*?)</pre>`, "su").exec(text);
  assert.ok(match, `Captured DOM omitted #${id}: ${text}`);
  assert.deepEqual(JSON.parse(match[1]), expected);
};

/** Verify one-time local/session storage initialization on a real Chromium. */
export async function verifyScenarioStorage({
  executable,
  endpoint,
  targetId,
}) {
  const site = await startStorageSite();
  return withVerifierCleanup(async () => {
    await verifyLaunchStorage(executable, site.origin);
    await verifyConnectedStorage(endpoint, targetId, site.origin);
    return {
      mocked: false,
      launch: true,
      connect: true,
      oopifInitialization: true,
      firstInlineScriptSeeded: true,
      updatesAndDeletesPersistAcrossNavigation: true,
      newScenarioGetsFreshSeed: true,
      externalTargetSurvives: true,
      cancellationCleanup: true,
    };
  }, [() => site.close()]);
}

const verifyLaunchStorage = async (executable, origin) => {
  const scenario = scenarioFor(
    { mode: "launch", executable_path: executable },
    origin,
  );
  const profilesBefore = await scenarioProfiles();
  const result = await runScenarioCli(scenario);
  const capture = result.normalized_result;
  assert.ok(capture, "Launch-mode storage scenario returned no result");
  assertLaunchStorageStates(capture);
  assert.equal(capture.browser.cleanup, "terminated-owned-process");
  const profilesAfter = await scenarioProfiles();
  assert.ok([...profilesAfter].every((profile) => profilesBefore.has(profile)));

  const freshScenario = browserScenarioSchema.parse({
    ...scenario,
    actions: [scenario.actions[0]],
  });
  const fresh = await createBrowserScenarioProvider(
    process.env,
  ).captureScenario(freshScenario);
  assert.equal(fresh.ok, true);
  if (!fresh.ok) throw fresh.error;
  assertContainsState(domText(fresh.value.steps[0]), "main-report", {
    local: "main-initial",
    session: "main-session-initial",
    removed: "main-remove-seed",
    empty: "main-empty-seed",
  });
};

const assertLaunchStorageStates = (capture) => {
  assertContainsState(domText(capture.steps[0]), "main-report", {
    local: "main-initial",
    session: "main-session-initial",
    removed: "main-remove-seed",
    empty: "main-empty-seed",
  });
  assertContainsState(domText(capture.steps[1]), "frame-report", {
    local: "frame-initial",
    session: "frame-session-initial",
    removed: "frame-remove-seed",
    empty: "frame-empty-seed",
  });
  assertContainsState(domText(capture.steps[2]), "top-report", {
    local: "frame-updated",
    session: "frame-session-updated",
    removed: null,
    empty: "",
  });
  assertContainsState(domText(capture.steps[3]), "main-report", {
    local: "main-updated",
    session: "main-session-updated",
    removed: null,
    empty: "",
  });
  assertContainsState(domText(capture.steps[3]), "frame-report", {
    local: "top-updated",
    session: "top-session-updated",
    removed: null,
    empty: "",
  });
};

const verifyConnectedStorage = async (endpoint, targetId, origin) => {
  const scenario = scenarioFor(
    { mode: "connect", cdp_endpoint: endpoint, target_id: targetId },
    origin,
  );
  const targets = await (
    await fetch(`${endpoint}/json/list`, { signal: AbortSignal.timeout(2_000) })
  ).json();
  const target = targets.find(({ id }) => id === targetId);
  assert.ok(target, "External browser target is missing");
  const observer = await CdpConnection.connect(
    target.webSocketDebuggerUrl,
    "capture_browser_scenario",
  );
  return withVerifierCleanup(async () => {
    await assertStorageKeyPartition(observer, origin);
    const result = await runScenarioCli(scenario);
    const capture = result.normalized_result;
    assert.ok(capture, "Connect-mode storage scenario returned no result");
    assertContainsState(domText(capture.steps[0]), "main-report", {
      local: "main-initial",
      session: "main-session-initial",
      removed: "main-remove-seed",
      empty: "main-empty-seed",
    });
    assert.equal(capture.browser.cleanup, "disconnected-external");
    await verifyCallerDebuggerPause(observer, origin, scenario);
    await verifyCancelledStorage(observer, endpoint, targetId, scenario);
  }, [() => restoreTarget(observer, target.url), () => observer.close()]);
};

const assertStorageKeyPartition = async (connection, origin) => {
  const attachedSessions = new Set();
  const unsubscribe = connection.onEvent((event) => {
    if (
      event.method === "Target.attachedToTarget" &&
      typeof event.params === "object" &&
      event.params !== null &&
      "sessionId" in event.params &&
      typeof event.params.sessionId === "string" &&
      "targetInfo" in event.params &&
      typeof event.params.targetInfo === "object" &&
      event.params.targetInfo !== null &&
      "type" in event.params.targetInfo &&
      event.params.targetInfo.type === "iframe"
    )
      attachedSessions.add(event.params.sessionId);
  });
  await connection.send("Page.enable");
  await connection.send("Target.setAutoAttach", {
    autoAttach: true,
    waitForDebuggerOnStart: false,
    flatten: true,
  });
  return withVerifierCleanup(async () => {
    const start = await connection.send("Runtime.evaluate", {
      expression: "performance.timeOrigin",
      returnByValue: true,
    });
    await connection.send("Page.navigate", {
      url: `${origin}/storage-main`,
    });
    await waitForPagePath(connection, "/storage-main", start.result.value);

    let childSession;
    let childFrameId;
    const deadline = Date.now() + 10_000;
    while (Date.now() < deadline && childFrameId === undefined) {
      for (const sessionId of attachedSessions) {
        try {
          const tree = await connection.send(
            "Page.getFrameTree",
            {},
            sessionId,
          );
          const frame = tree.frameTree?.frame;
          if (
            typeof frame?.id === "string" &&
            frame.url ===
              `${origin.replace("127.0.0.1", "localhost")}/storage-frame`
          ) {
            childSession = sessionId;
            childFrameId = frame.id;
            break;
          }
        } catch {
          // The iframe may detach between target discovery and frame inspection.
        }
      }
      if (childFrameId === undefined) await delay(25);
    }
    assert.ok(
      childSession && childFrameId,
      "Storage fixture OOPIF was not attached",
    );
    const child = await connection.send(
      "Storage.getStorageKey",
      { frameId: childFrameId },
      childSession,
    );
    const rootTree = await connection.send("Page.getFrameTree");
    const beforeRoot = await connection.send("Storage.getStorageKey", {
      frameId: rootTree.frameTree.frame.id,
    });
    await connection.send("Page.navigate", {
      url: `${origin.replace("127.0.0.1", "localhost")}/storage-top`,
    });
    await waitForPagePath(connection, "/storage-top", start.result.value);
    const afterTree = await connection.send("Page.getFrameTree");
    const topLevel = await connection.send("Storage.getStorageKey", {
      frameId: afterTree.frameTree.frame.id,
    });
    assert.notEqual(
      child.storageKey,
      topLevel.storageKey,
      `Chrome did not expose distinct partition keys: child=${JSON.stringify(child)} top=${JSON.stringify(topLevel)} rootBefore=${JSON.stringify(beforeRoot)}`,
    );
  }, [
    () => unsubscribe(),
    () =>
      connection.send("Target.setAutoAttach", {
        autoAttach: false,
        waitForDebuggerOnStart: false,
        flatten: true,
      }),
  ]);
};

const waitForPagePath = async (connection, path, priorTimeOrigin) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await connection.send("Runtime.evaluate", {
      expression: `JSON.stringify({ path: location.pathname, time: performance.timeOrigin })`,
      returnByValue: true,
    });
    const current = JSON.parse(result.result.value);
    if (current.path === path && current.time !== priorTimeOrigin) return;
    await delay(25);
  }
  throw new Error(`External browser did not navigate to ${path}`);
};

const verifyCallerDebuggerPause = async (caller, origin, scenario) => {
  await caller.send("Runtime.enable");
  await caller.send("Debugger.enable");
  const controller = new AbortController();
  const debuggerUrl = `${origin}/storage-debugger`;
  const scripts = new Map();
  const protocolTrace = [];
  let pauseObserved = false;
  let resolvePaused;
  const paused = new Promise((resolve) => {
    resolvePaused = (callFrameId) => {
      pauseObserved = true;
      resolve(callFrameId);
    };
  });
  const unsubscribe = caller.onEvent((event) => {
    if (event.method === "Debugger.scriptParsed") {
      const params = event.params;
      if (
        typeof params === "object" &&
        params !== null &&
        "scriptId" in params &&
        typeof params.scriptId === "string" &&
        "url" in params &&
        typeof params.url === "string"
      )
        scripts.set(params.scriptId, params.url);
      if (
        typeof params === "object" &&
        params !== null &&
        "url" in params &&
        typeof params.url === "string" &&
        params.url.includes("storage")
      )
        protocolTrace.push({ method: event.method, url: params.url });
    } else if (event.method === "Debugger.paused") {
      const params = event.params;
      const callFrames =
        typeof params === "object" && params !== null && "callFrames" in params
          ? params.callFrames
          : undefined;
      const frame = Array.isArray(callFrames) ? callFrames[0] : undefined;
      const scriptId =
        typeof frame === "object" && frame !== null && "location" in frame
          ? frame.location?.scriptId
          : undefined;
      protocolTrace.push({
        method: event.method,
        url: typeof scriptId === "string" ? scripts.get(scriptId) : undefined,
        reason:
          typeof params === "object" && params !== null && "reason" in params
            ? params.reason
            : undefined,
      });
      if (
        typeof frame === "object" &&
        frame !== null &&
        typeof frame.callFrameId === "string" &&
        typeof scriptId === "string" &&
        scripts.get(scriptId) === debuggerUrl
      )
        resolvePaused(frame.callFrameId);
    }
  });
  const debuggerScenario = browserScenarioSchema.parse({
    ...scenario,
    start_url: { url: debuggerUrl },
    actions: [
      { step_id: "after-debugger", action: "wait_for_timeout", duration_ms: 1 },
    ],
  });
  let settled = false;
  const provider = createBrowserScenarioProvider(process.env);
  const pending = provider
    .captureScenario(debuggerScenario, { signal: controller.signal })
    .finally(() => {
      settled = true;
      unsubscribe();
    });
  return withVerifierCleanup(async () => {
    try {
      const callFrameId = await raceWithTimeout(paused, 10_000, () => {
        throw new Error(
          `Caller debugger pause was not observed at ${debuggerUrl}; settled=${String(settled)} events=${JSON.stringify(protocolTrace)}`,
        );
      });
      const pausedState = await caller.send("Debugger.evaluateOnCallFrame", {
        callFrameId,
        expression: "window.reaDebuggerAfter === true",
        returnByValue: true,
      });
      assert.equal(
        pausedState.result.value,
        false,
        "Caller-owned debugger frame resumed before the caller inspected it",
      );
      await delay(100);
      assert.equal(
        settled,
        false,
        "Storage observer resumed a caller-owned debugger pause",
      );
      await caller.send("Debugger.resume");
      pauseObserved = false;
      const result = await pending;
      if (!result.ok) throw result.error;
      const debuggerState = await caller.send("Runtime.evaluate", {
        expression: "window.reaDebuggerAfter === true",
        returnByValue: true,
      });
      assert.equal(debuggerState.result.value, true);
    } catch (cause) {
      if (!pauseObserved) controller.abort(cause);
      else await caller.send("Debugger.resume").catch(() => undefined);
      const completion = await raceWithTimeout(
        pending.catch((pendingCause) => ({ ok: false, error: pendingCause })),
        5_000,
      );
      if (completion === undefined)
        throw new Error("Capture remained pending after cancellation", {
          cause,
        });
      const completionError =
        typeof completion === "object" &&
        completion !== null &&
        "error" in completion
          ? completion.error
          : typeof completion === "object" &&
              completion !== null &&
              "ok" in completion &&
              completion.ok === false
            ? completion.error
            : undefined;
      const completionDetail =
        completionError === undefined
          ? "capture did not report an error"
          : (() => {
              const causes = [];
              let current = completionError;
              for (
                let depth = 0;
                depth < 4 && current !== undefined;
                depth += 1
              ) {
                causes.push({
                  name: current.name,
                  tag: current._tag,
                  reason: current.reason,
                  message: current.message,
                });
                current = current.cause;
              }
              return JSON.stringify(causes);
            })();
      throw new Error(`${String(cause)}; capture=${completionDetail}`, {
        cause,
      });
    }
  }, [
    () => unsubscribe(),
    () => caller.send("Debugger.disable"),
    () => provider.close(),
  ]);
};

const verifyCancelledStorage = async (
  observer,
  endpoint,
  targetId,
  scenario,
) => {
  const controller = new AbortController();
  const cancelledScenario = browserScenarioSchema.parse({
    ...scenario,
    actions: [
      {
        step_id: "cancelled-wait",
        action: "wait_for",
        locator: { kind: "css", selector: "#never-storage-ready" },
        state: "visible",
        timeout_ms: 30_000,
      },
    ],
  });
  const priorDocument = await observer.send("Runtime.evaluate", {
    expression: "performance.timeOrigin",
    returnByValue: true,
  });
  const provider = createBrowserScenarioProvider(process.env);
  const pending = provider.captureScenario(cancelledScenario, {
    signal: controller.signal,
  });
  return withVerifierCleanup(async () => {
    await waitForNewDocument(
      observer,
      "/storage-main",
      priorDocument.result.value,
    );
    const state = await observer.send("Runtime.evaluate", {
      expression:
        "JSON.parse(document.querySelector('#main-report').textContent)",
      returnByValue: true,
    });
    assert.deepEqual(state.result.value, {
      local: "main-initial",
      session: "main-session-initial",
      removed: "main-remove-seed",
      empty: "main-empty-seed",
    });
    controller.abort(new Error("cancel storage seed scenario"));
    const result = await pending;
    if (result.ok)
      assert.ok(
        result.value.steps.some(({ status }) => status === "cancelled"),
        "Cancellation unexpectedly completed every scenario step",
      );
    else assert.equal(result.error._tag, "AnalysisCancelledError");
    const targets = await (await fetch(`${endpoint}/json/list`)).json();
    assert.ok(
      targets.some(({ id }) => id === targetId),
      "Cancelled connect-mode storage cleanup closed the external target",
    );
  }, [
    () => controller.abort(new Error("cancel failed storage verification")),
    () => provider.close(),
  ]);
};

const waitForNewDocument = async (connection, path, priorTimeOrigin) => {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await connection.send("Runtime.evaluate", {
      expression: `JSON.stringify({ path: location.pathname, time: performance.timeOrigin, state: document.querySelector('#main-report')?.textContent })`,
      returnByValue: true,
    });
    const current = JSON.parse(result.result.value);
    if (
      current.path === path &&
      current.time !== priorTimeOrigin &&
      current.state !== undefined
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`External browser did not navigate to ${path}`);
};

const restoreTarget = async (connection, url) => {
  const loaded = new Set();
  let loaderId;
  let resolveLoaded;
  const load = new Promise((resolve) => {
    resolveLoaded = resolve;
  });
  const unsubscribe = connection.onEvent((event) => {
    if (
      event.method !== "Page.lifecycleEvent" ||
      event.params?.name !== "load" ||
      typeof event.params.loaderId !== "string"
    )
      return;
    loaded.add(event.params.loaderId);
    if (event.params.loaderId === loaderId) resolveLoaded();
  });
  try {
    await connection.send("Page.setLifecycleEventsEnabled", { enabled: true });
    const navigation = await connection.send("Page.navigate", { url });
    assert.equal(navigation.errorText, undefined);
    assert.equal(typeof navigation.loaderId, "string");
    loaderId = navigation.loaderId;
    // A URL changes at commit, before old child frames have been retired.
    // Do not hand the shared page to the next verifier until this load ends.
    if (!loaded.has(loaderId))
      await raceWithTimeout(load, 10_000, () => {
        throw new Error(
          "External browser did not finish restoring its document",
        );
      });
  } finally {
    unsubscribe();
    await connection.send("Page.setLifecycleEventsEnabled", { enabled: false });
  }
};
