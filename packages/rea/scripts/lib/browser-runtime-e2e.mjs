import assert from "node:assert/strict";
import { spawn, execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";
import { CdpBrowserProvider } from "../../dist/browser/CdpBrowserProvider.js";
import { listBrowserTargetsInputSchema } from "../../dist/domain/browserObservation.js";
import { CdpConnection } from "../../dist/browser/CdpConnection.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { webExecutionSchema } from "../../dist/domain/webExecution.js";
import { webEventListenersSchema } from "../../dist/domain/webEventListeners.js";
import { startBrowserRuntimeSite } from "../fixtures/browser-runtime-site.mjs";
import { requireOrdinaryWindowsVerifierCaller } from "./windows-ordinary-user-verifier.mjs";
import { mcpTextValue } from "./mcp-verifier-results.mjs";
import { startRuntimeFixtureBrowser } from "./browser-runtime-fixture-lifecycle.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { verifyRuntimeTargetTermination } from "./browser-runtime-termination-e2e.mjs";
import { verifyRuntimeInvalidSelectors } from "./browser-runtime-selector-e2e.mjs";
import {
  createRuntimeIsolatedWorld,
  triggerRuntimeFixtureAction,
  isolatedFixtureUrl,
} from "./browser-runtime-world-e2e.mjs";

// Arming, progress delivery, isolated-world proof and the page action cross
// separate transports. Leave time for their round trips on shared CI runners;
// coverage can include a late action even after request collection has ended.
const executionObservationMs = 2_000;

/** Exercise native browser runtime attribution through public CLI and stdio MCP, including arming. */
export async function verifyBrowserRuntime(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  await requireOrdinaryWindowsVerifierCaller();
  await access(executable);
  const site = await startBrowserRuntimeSite();
  let fixture;
  let action;
  let client;
  return withVerifierCleanup(async () => {
    fixture = await startRuntimeFixtureBrowser(executable, site.origin);
    const endpoint = `http://127.0.0.1:${fixture.port}`;
    const targets = await new CdpBrowserProvider().listTargets(
      listBrowserTargetsInputSchema.parse({
        cdp_endpoint: endpoint,
        allowed_origins: [site.origin],
      }),
    );
    if (!targets.ok) throw targets.error;
    const target = targets.value.targets[0];
    assert.ok(target, "owned fixture page target missing");
    const pages = await (await fetch(`${endpoint}/json/list`)).json();
    const page = pages.find((candidate) => candidate.id === target.target_id);
    action = await CdpConnection.connect(
      page.webSocketDebuggerUrl,
      "inspect_web_page",
    );
    await ready(action);
    let isolatedContext = await createRuntimeIsolatedWorld(action);
    const env = {
      ...process.env,
      REA_LOG_LEVEL: "silent",
      HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
    };
    const input = { cdp_endpoint: endpoint, target_id: target.target_id };
    const cliListener = await promisify(execFile)(
      process.execPath,
      [
        entrypoint,
        "inspect-web-event-listeners",
        endpoint,
        target.target_id,
        "#run",
        "--json",
      ],
      { env, timeout: 40_000, maxBuffer: 64 * 1024 * 1024 },
    );
    const cliListenerProof = assertListeners(
      parseEvidence(JSON.parse(cliListener.stdout)),
      site,
    );
    const cliExecution = await executionCli(
      entrypoint,
      input,
      env,
      action,
      isolatedContext,
    );
    const cliProof = assertExecution(
      parseEvidence(JSON.parse(cliExecution)),
      site,
    );
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [entrypoint, "mcp"],
      env,
      stderr: "pipe",
    });
    client = new Client({ name: "web-runtime-real-e2e", version: "1" });
    await client.connect(transport);
    const invalidSelectors = await verifyRuntimeInvalidSelectors(
      client,
      entrypoint,
      input,
      env,
    );
    const listenerResponse = await client.callTool({
      name: "inspect_web_event_listeners",
      arguments: { ...input, selector: "#run" },
    });
    assert.notEqual(
      listenerResponse.isError,
      true,
      mcpTextValue(listenerResponse),
    );
    const mcpListenerProof = assertListeners(
      parseEvidence(JSON.parse(mcpTextValue(listenerResponse))),
      site,
    );
    const mcpProof = await executionMcp(
      client,
      input,
      action,
      site,
      isolatedContext,
      false,
    );
    assert.equal(cliProof.selected_sha256, mcpProof.selected_sha256);
    assert.equal(cliListenerProof.sha256, mcpListenerProof.sha256);
    await reloadFixture(action);
    isolatedContext = await createRuntimeIsolatedWorld(action);
    const freshMcpProof = await executionMcp(
      client,
      input,
      action,
      site,
      isolatedContext,
    );
    assert.equal(site.evidenceRequests(), 3);
    const termination = await verifyRuntimeTargetTermination(
      client,
      input,
      site.origin,
    );
    const stillOpen = await action.send("Runtime.evaluate", {
      expression: "Boolean(document.querySelector('#run'))",
      returnByValue: true,
    });
    assert.equal(
      stillOpen.result.value,
      true,
      "REA must preserve the externally owned page",
    );
    const location = await action.send("Runtime.evaluate", {
      expression: "location.href",
      returnByValue: true,
    });
    assert.equal(
      location.result.value,
      `${site.origin}/same-document?caller=value#fragment`,
    );
    return {
      product: target,
      cli: cliProof,
      mcp: mcpProof,
      listener: cliListenerProof,
      public_cases: 8,
      invalid_selectors: invalidSelectors,
      termination,
      fresh_mcp: freshMcpProof,
      page_remained_open: true,
    };
  }, [
    () => client?.close(),
    () => action?.close(),
    () => fixture?.close(),
    () => site.close(),
  ]);
}

async function executionMcp(
  client,
  input,
  action,
  site,
  isolatedContext,
  requireBlock = true,
) {
  let actionPromise;
  const response = await client.callTool(
    {
      name: "observe_web_execution",
      arguments: { ...input, observation_ms: executionObservationMs },
    },
    {
      timeout: 40_000,
      onprogress: (notification) => {
        if (
          actionPromise === undefined &&
          notification.message?.includes(
            "browser_execution: Browser execution observation armed",
          )
        ) {
          actionPromise = triggerRuntimeFixtureAction(action, isolatedContext);
          void actionPromise.catch(() => undefined);
        }
      },
    },
  );
  assert.ok(actionPromise, "MCP did not emit an actual armed notification");
  await actionPromise;
  assert.notEqual(response.isError, true, mcpTextValue(response));
  return assertExecution(
    parseEvidence(JSON.parse(mcpTextValue(response))),
    site,
    requireBlock,
  );
}

async function ready(connection) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const result = await connection.send("Runtime.evaluate", {
      expression:
        "typeof chosen === 'function' && typeof untouched === 'function'",
      returnByValue: true,
    });
    if (result.result.value === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("Runtime fixture sources did not load");
}

async function executionCli(entrypoint, input, env, action, isolatedContext) {
  const child = spawn(
    process.execPath,
    [
      entrypoint,
      "observe-web-execution",
      input.cdp_endpoint,
      input.target_id,
      "--observation-ms",
      String(executionObservationMs),
      "--json",
    ],
    { env, stdio: ["ignore", "pipe", "pipe"] },
  );
  let stdout = "";
  let stderr = "";
  let actionPromise;
  const timeout = setTimeout(() => child.kill("SIGTERM"), 40_000);
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
    if (actionPromise === undefined && stderr.includes('"completed":1')) {
      actionPromise = triggerRuntimeFixtureAction(action, isolatedContext);
      void actionPromise.catch(() => undefined);
    }
  });
  try {
    const [code] = await once(child, "close");
    assert.equal(
      code,
      0,
      `observe-web-execution exited ${String(code)} (signal ${String(child.signalCode)})\nstdout:\n${stdout}\nstderr:\n${stderr}`,
    );
    assert.ok(actionPromise, "CLI did not report an actual armed point");
    await actionPromise;
    return stdout;
  } finally {
    clearTimeout(timeout);
    if (child.exitCode === null && child.signalCode === null)
      child.kill("SIGTERM");
  }
}

function sourceByText(result, text) {
  const source = result.sources.find(
    (item) => item.source.state === "captured" && item.source.text === text,
  );
  assert.ok(source, "Exact independently known source text must be retained");
  assert.equal(
    source.source.sha256,
    createHash("sha256").update(text).digest("hex"),
  );
  assert.equal(source.source.utf16_units, text.length);
  assert.equal(source.source.utf8_bytes, Buffer.byteLength(text));
  return source;
}
function assertListeners(evidence, site) {
  const result = webEventListenersSchema.parse(evidence.normalized_result);
  assert.equal(
    result.listeners.length,
    1,
    "The selected node's child listener must not be attributed to the selected node",
  );
  const listener = result.listeners.find((item) => item.type === "click");
  assert.ok(listener);
  assert.equal(listener.passive, true);
  const source = sourceByText(result, site.sources.selected);
  assert.equal(listener.location.script_id, source.script_id);
  assert.equal(listener.location.source_association, "script_id");
  assert.equal(listener.execution, "unknown");
  return {
    sha256: source.source.sha256,
    line: listener.location.line_number,
    column: listener.location.column_number,
  };
}
function assertExecution(evidence, site, requireBlock = true) {
  const result = webExecutionSchema.parse(evidence.normalized_result);
  assert.ok(
    result.coverage.scripts.every(
      (item) => item.reported_url !== isolatedFixtureUrl,
    ),
  );
  assert.ok(
    result.sources.every(
      (item) =>
        item.url !== isolatedFixtureUrl || item.source.state !== "captured",
    ),
  );
  const selected = sourceByText(result, site.sources.selected);
  const other = sourceByText(result, site.sources.other);
  assert.equal(selected.url, other.url);
  assert.equal(selected.has_source_url, true);
  assert.equal(
    selected.url,
    `${site.origin.replace("http://", "http://declared:label@")}/same.js`,
  );
  assert.notEqual(selected.script_id, other.script_id);
  assert.ok(
    selected.source.utf8_bytes > selected.source.utf16_units,
    "Unicode oracle must distinguish UTF-8 bytes from UTF-16 units",
  );
  const coverage = result.coverage.scripts.find(
    (script) => script.script_id === selected.script_id,
  );
  const fn = coverage?.functions.find((item) => item.name === "chosen");
  assert.ok(
    fn,
    "Externally invoked callback must have precise function evidence",
  );
  assert.ok(fn.ranges.some((range) => range.count === 1));
  if (requireBlock)
    assert.equal(
      fn.is_block_coverage,
      true,
      "Fresh fixture function must supply block granularity",
    );
  if (fn.is_block_coverage)
    assert.ok(
      fn.ranges.some((range) => range.count === 0),
      `Unexecuted branch must remain zero within block coverage: ${JSON.stringify(fn)}`,
    );
  assert.equal(
    fn.ranges[0].start_offset,
    site.sources.selected.indexOf("function chosen"),
    "Coverage offsets must index the retained UTF-16 source, including the astral prefix",
  );
  for (const range of fn.ranges) {
    assert.equal(range.source_bounds, "verified");
    assert.ok(range.end_offset <= selected.source.utf16_units);
  }
  const request = result.requests.find((item) =>
    item.url.endsWith("/evidence?marker=chosen"),
  );
  assert.ok(
    request,
    `The selected request initiator must be retained: ${JSON.stringify({
      window: result.window,
      requests: result.requests.map((item) => item.url),
      excluded_requests: result.excluded_requests,
    })}`,
  );
  assert.ok(
    request.callsites.some(
      (site) =>
        site.script_id === selected.script_id &&
        site.source_association === "script_id",
    ),
  );
  assert.equal(request.causal_attribution, "unknown");
  assert.ok(
    request.callsites.some(
      (site) =>
        site.script_id === selected.script_id && site.url === selected.url,
    ),
  );
  assert.equal(result.script_inventory.coverage_absence, "unknown");
  assert.equal(result.instrumentation.cleanup, "confirmed");
  return {
    selected_sha256: selected.source.sha256,
    other_sha256: other.source.sha256,
    zero_branch: fn.is_block_coverage
      ? "observed-zero"
      : "unknown-function-only",
    granularity: fn.is_block_coverage ? "block" : "function",
    repeated_url_identity: true,
    same_document_navigation: true,
    declared_source_url_preserved: true,
    request_script_id: selected.script_id,
    isolated_execution_proved_and_excluded: true,
  };
}

async function reloadFixture(connection) {
  await connection.send("Page.enable");
  let dispose;
  const committed = new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Fixture reload did not commit")),
      5000,
    );
    const remove = connection.onEvent((event) => {
      if (
        event.method === "Page.frameNavigated" &&
        !event.params.frame?.parentId
      )
        resolve();
    });
    dispose = () => {
      clearTimeout(timer);
      remove();
    };
  });
  void committed.catch(() => undefined);
  try {
    await connection.send("Page.reload", { ignoreCache: true });
    await committed;
    await ready(connection);
  } finally {
    dispose();
  }
}
