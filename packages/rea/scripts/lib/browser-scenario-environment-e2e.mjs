import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { CdpCommandRejection } from "../../dist/browser/CdpCommandRejection.js";
import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { createBrowserScenarioProvider } from "../../dist/composition/browserScenario.js";
import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { AnalysisCancelledError } from "../../dist/domain/analysisErrorCore.js";
import { runScenarioCli } from "./browser-scenario-verifier.mjs";
import { requireMcpEvidenceResult } from "./mcp-verifier-results.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";

const expected = {
  timezone: "Pacific/Honolulu",
  locale: "fr-FR",
  dpr: 2,
  width: 900,
  height: 600,
};
const alternate = {
  timezone: "UTC",
  locale: "en-US",
  dpr: 1,
  width: 700,
  height: 500,
};
const environmentExpression = `{
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  locale: Intl.DateTimeFormat().resolvedOptions().locale,
  dpr: devicePixelRatio, width: innerWidth, height: innerHeight
}`;
const expression = `JSON.stringify(${environmentExpression})`;
const scenarioSnapshotExpression = `JSON.stringify({
  timeOrigin: performance.timeOrigin,
  environment: ${environmentExpression},
  run: document.body?.dataset.run ?? null
})`;

const isNavigationTransitionRejection = (cause) =>
  cause instanceof CdpCommandRejection &&
  cause.command === "Runtime.evaluate" &&
  cause.code === -32_000 &&
  cause.reportedMessage === "Inspected target navigated or closed";

const environmentScenario = ({ endpoint, targetId, origin, values, run }) =>
  browserScenarioSchema.parse({
    browser: { mode: "connect", cdp_endpoint: endpoint, target_id: targetId },
    start_url: {
      url: `${origin}/scenario-environment${run === undefined ? "" : `?run=${run}`}`,
    },
    environment: {
      locale: values.locale,
      timezone: values.timezone,
      viewport: {
        width: values.width,
        height: values.height,
        device_scale_factor: values.dpr,
      },
    },
    actions:
      run === undefined
        ? [
            {
              step_id: "refresh",
              action: "click",
              locator: { kind: "css", selector: "#refresh-environment" },
            },
          ]
        : [
            {
              step_id: `gate_${run}`,
              action: "wait_for",
              locator: { kind: "css", selector: `#release-${run}` },
              state: "attached",
              timeout_ms: 30_000,
            },
            {
              step_id: `refresh_${run}`,
              action: "click",
              locator: { kind: "css", selector: "#refresh-environment" },
            },
          ],
    capture: { after_each_step: ["dom"], at_end: ["dom"] },
  });

const assertCapture = (capture, values = expected) => {
  assert.equal(capture.browser.cleanup, "disconnected-external");
  for (const step of capture.steps) {
    assert.equal(step.artifacts.dom.state, "captured");
    const text = step.artifacts.dom.value.text;
    const observed = /<pre id="environment">([^<]+)<\/pre>/u.exec(text);
    assert.ok(observed, "DOM omitted the page's actual environment values");
    assert.deepEqual(JSON.parse(observed[1]), values);
  }
};

const assertCallerLanguage = (capture, baseline) => {
  assert.ok(
    capture.limitations.some((value) =>
      value.includes("Attached locale fr-FR applies to Intl formatting only"),
    ),
    "Attached capture must identify its page/request language limitation",
  );
  for (const step of capture.steps) {
    const text = step.artifacts.dom.value.text;
    const observed = /<pre id="language">([^<]+)<\/pre>/u.exec(text);
    assert.ok(
      observed,
      "DOM omitted the navigator/request language observations",
    );
    assert.deepEqual(JSON.parse(observed[1]), baseline);
  }
};

/** Verify actual attached-page emulation and restoration across scenario outcomes. */
export async function verifyScenarioEnvironment(endpoint, targetId, origin) {
  const languageExpression = `(async () => JSON.stringify({
    language: navigator.language, languages: [...navigator.languages],
    request_language: await (await fetch(
      ${JSON.stringify(`${origin}/scenario-request-language`)}, { cache: "no-store" }
    )).json()
  }))()`;
  const targets = await (await fetch(`${endpoint}/json/list`)).json();
  const target = targets.find(({ id }) => id === targetId);
  assert.ok(target, "External fixture target is missing");
  const connection = await CdpConnection.connect(
    target.webSocketDebuggerUrl,
    "capture_browser_scenario",
  );
  const readEnvironment = async (expressionToRead = expression) => {
    const value = await connection.send("Runtime.evaluate", {
      expression: expressionToRead,
      returnByValue: true,
      awaitPromise: true,
    });
    assert.equal(value.result.type, "string");
    return JSON.parse(value.result.value);
  };
  const provider = createBrowserScenarioProvider(process.env);
  let unselected;
  let unselectedTarget;
  return withVerifierCleanup(async () => {
    // The fixture owns this extra page. A scenario selecting targetId must not
    // initialize Playwright defaults on another caller-owned page.
    const created = await connection.send("Target.createTarget", {
      url: "about:blank",
    });
    unselectedTarget = created.targetId;
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    const other = pages.find(({ id }) => id === unselectedTarget);
    assert.ok(other, "Owned unselected fixture page is missing");
    unselected = await CdpConnection.connect(
      other.webSocketDebuggerUrl,
      "capture_browser_scenario",
    );
    const pageIds = pages
      .filter(({ type }) => type === "page")
      .map(({ id }) => id)
      .sort();
    await unselected.send("Emulation.setEmulatedMedia", {
      features: [{ name: "prefers-color-scheme", value: "dark" }],
    });
    const assertUnselectedState = async () => {
      const observed = await unselected.send("Runtime.evaluate", {
        expression: "matchMedia('(prefers-color-scheme: dark)').matches",
        returnByValue: true,
      });
      assert.equal(
        observed.result.value,
        true,
        "Scenario attachment changed media on an unselected page",
      );
    };
    await assertUnselectedState();
    // Settle the selected tab's actual layout before taking the restoration
    // baseline, then leave it in the background for the scenario's actions.
    await connection.send("Target.activateTarget", { targetId });
    await connection.send("Runtime.evaluate", {
      expression:
        "new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))",
      awaitPromise: true,
    });
    const baseline = await readEnvironment();
    const callerLanguage = await readEnvironment(languageExpression);
    await connection.send("Target.activateTarget", {
      targetId: unselectedTarget,
    });
    const scenario = environmentScenario({
      endpoint,
      targetId,
      origin,
      values: expected,
    });
    const assertRestored = async () => {
      assert.deepEqual(await readEnvironment(), baseline);
      assert.deepEqual(
        await readEnvironment(languageExpression),
        callerLanguage,
      );
      const remaining = await (await fetch(`${endpoint}/json/list`)).json();
      assert.ok(remaining.some(({ id }) => id === targetId));
      assert.deepEqual(
        remaining
          .filter(({ type }) => type === "page")
          .map(({ id }) => id)
          .sort(),
        pageIds,
        "Scenario attachment changed the caller's page inventory",
      );
    };
    const cliCapture = (await runScenarioCli(scenario)).normalized_result;
    assertCapture(cliCapture);
    assertCallerLanguage(cliCapture, callerLanguage);
    await assertRestored();
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
      env: process.env,
      stderr: "pipe",
    });
    const client = new Client({
      name: "browser-environment-e2e",
      version: "1",
    });
    await withVerifierCleanup(async () => {
      await client.connect(transport);
      const definition = (await client.listTools()).tools.find(
        ({ name }) => name === "capture_browser_scenario",
      );
      assert.ok(definition, "Scenario tool is absent from the current catalog");
      const mcpCapture = requireMcpEvidenceResult(
        await client.callTool(
          { name: "capture_browser_scenario", arguments: scenario },
          { toolDefinition: definition },
        ),
        "capture_browser_scenario",
      );
      assertCapture(mcpCapture);
      assertCallerLanguage(mcpCapture, callerLanguage);
      await verifyConcurrentMcpCapture({
        client,
        definition,
        connection,
        endpoint,
        targetId,
        origin,
        assertRestored,
        assertUnselectedState,
      });
    }, [() => client.close(), () => transport.close()]);
    await assertRestored();
    const initializationFailure = await provider.captureScenario({
      ...scenario,
      environment: { ...scenario.environment, timezone: "REA/Invalid" },
    });
    assert.equal(initializationFailure.ok, false);
    await assertRestored();
    const waiting = browserScenarioSchema.parse({
      ...scenario,
      actions: [
        {
          step_id: "missing",
          action: "wait_for",
          locator: { kind: "css", selector: "#missing-environment-element" },
          state: "visible",
          timeout_ms: 100,
        },
      ],
    });
    const actionFailure = await provider.captureScenario(waiting);
    assert.equal(actionFailure.ok, true);
    assertCapture(actionFailure.value);
    assert.equal(actionFailure.value.steps.at(-1).status, "failed");
    await assertRestored();
    await verifyCancelledEnvironment(provider, connection, waiting);
    await assertRestored();
    return {
      mocked: false,
      cli: true,
      stdio_mcp: true,
      observed: expected,
      restored: baseline,
      caller_language_preserved: callerLanguage,
      attached_locale_limitation: true,
      initialization_failure_cleanup: true,
      action_failure_cleanup: true,
      cancellation_cleanup: true,
      external_target_preserved: true,
      unselected_page_media_preserved: true,
    };
  }, [
    () => provider.close(),
    () => unselected?.close(),
    async () => {
      if (unselectedTarget !== undefined)
        assert.equal(
          (
            await connection.send("Target.closeTarget", {
              targetId: unselectedTarget,
            })
          ).success,
          true,
          "Owned unselected fixture page was not released",
        );
    },
    () => connection.close(),
  ]);
}

const verifyConcurrentMcpCapture = async ({
  client,
  definition,
  connection,
  endpoint,
  targetId,
  origin,
  assertRestored,
  assertUnselectedState,
}) => {
  const firstScenario = environmentScenario({
    endpoint,
    targetId,
    origin,
    values: expected,
    run: "A",
  });
  const secondScenario = environmentScenario({
    endpoint,
    targetId,
    origin,
    values: alternate,
    run: "B",
  });
  const firstCancellation = new AbortController();
  const secondCancellation = new AbortController();
  const cancellation = new AbortController();
  const pendingCalls = [];
  const callTool = (arguments_, signal) => {
    const pending = client.callTool(
      { name: "capture_browser_scenario", arguments: arguments_ },
      { signal, timeout: 60_000, toolDefinition: definition },
    );
    void pending.catch(() => {});
    pendingCalls.push(pending);
    return pending;
  };

  try {
    const first = callTool(firstScenario, firstCancellation.signal);
    await waitForEnvironment(connection, expected, "A");
    await assertUnselectedState();

    const second = callTool(secondScenario, secondCancellation.signal);
    await client.ping();
    const firstSnapshot = await readScenarioSnapshot(connection);
    assert.deepEqual(firstSnapshot.environment, expected);
    assert.equal(firstSnapshot.run, "A");

    const cancelled = callTool(
      environmentScenario({
        endpoint,
        targetId,
        origin,
        values: alternate,
        run: "C",
      }),
      cancellation.signal,
    );
    await client.ping();
    cancellation.abort(new Error("cancel queued browser scenario"));
    await assert.rejects(cancelled, /cancel queued browser scenario/u);
    const queuedSnapshot = await readScenarioSnapshot(connection);
    assert.deepEqual(queuedSnapshot.environment, expected);
    assert.equal(queuedSnapshot.run, "A");

    await releaseScenario(connection);
    assertCapture(
      requireMcpEvidenceResult(await first, "capture_browser_scenario"),
      expected,
    );

    await waitForEnvironment(connection, alternate, "B");
    await releaseScenario(connection);
    assertCapture(
      requireMcpEvidenceResult(await second, "capture_browser_scenario"),
      alternate,
    );
    await client.ping();
    await assertRestored();
  } finally {
    firstCancellation.abort();
    secondCancellation.abort();
    cancellation.abort();
    await releaseScenario(connection).catch(() => undefined);
    await Promise.allSettled(pendingCalls);
  }
};

const waitForEnvironment = async (connection, expectedValues, run) => {
  await waitForScenarioSnapshot(
    connection,
    (snapshot) =>
      JSON.stringify(snapshot.environment) === JSON.stringify(expectedValues) &&
      snapshot.run === run,
    `Scenario ${run} never reached its page-controlled gate`,
  );
};

const waitForScenarioSnapshot = async (connection, accept, message) => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10_000);
  let lastTransitionRejection;
  try {
    while (!controller.signal.aborted) {
      try {
        const snapshot = await readScenarioSnapshot(
          connection,
          controller.signal,
        );
        if (controller.signal.aborted) break;
        if (accept(snapshot)) return;
      } catch (cause) {
        if (
          controller.signal.aborted &&
          cause instanceof AnalysisCancelledError
        )
          break;
        if (!isNavigationTransitionRejection(cause)) throw cause;
        lastTransitionRejection = cause;
      }
      await delay(25);
    }
    throw new Error(message, {
      cause: lastTransitionRejection ?? controller.signal.reason,
    });
  } finally {
    clearTimeout(timer);
  }
};

const readScenarioSnapshot = async (connection, signal) => {
  const value = await connection.send(
    "Runtime.evaluate",
    { expression: scenarioSnapshotExpression, returnByValue: true },
    undefined,
    signal,
  );
  assert.equal(value.result.type, "string");
  return JSON.parse(value.result.value);
};

const releaseScenario = async (connection) => {
  await connection.send("Runtime.evaluate", {
    expression: "window.releaseScenario()",
    returnByValue: true,
  });
};

export async function verifyCancelledEnvironment(
  provider,
  connection,
  scenario,
) {
  const controller = new AbortController();
  const priorSnapshot = await readScenarioSnapshot(connection);
  const pending = provider.captureScenario(
    { ...scenario, actions: [{ ...scenario.actions[0], timeout_ms: 30_000 }] },
    { signal: controller.signal },
  );
  const settlement = Promise.allSettled([pending]);
  try {
    await waitForScenarioSnapshot(
      connection,
      (snapshot) =>
        snapshot.timeOrigin !== priorSnapshot.timeOrigin &&
        JSON.stringify(snapshot.environment) === JSON.stringify(expected),
      "Scenario never applied emulation",
    );
    await delay(100);
  } finally {
    controller.abort();
    await settlement;
  }
  const cancelled = await pending;
  if (!cancelled.ok) {
    if (!(cancelled.error instanceof AnalysisCancelledError))
      throw cancelled.error;
    assert.equal(cancelled.error.cleanupIncomplete, false);
  } else {
    assert.ok(
      cancelled.value.steps.some(({ status }) => status === "cancelled"),
      "Cancellation unexpectedly completed every action",
    );
    assert.equal(cancelled.value.browser.cleanup, "disconnected-external");
  }
}
