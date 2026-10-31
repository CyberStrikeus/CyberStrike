import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { requireMcpToolError } from "./mcp-verifier-results.mjs";

const execute = promisify(execFile);

const duplicateOriginStorage = (origin) => ({
  local_storage: [
    {
      origin,
      entries: [
        {
          name: "rea-first-seed",
          value: {
            source: "literal",
            value: "first",
          },
        },
      ],
    },
    {
      origin,
      entries: [
        {
          name: "rea-second-seed",
          value: {
            source: "literal",
            value: "second",
          },
        },
        {
          name: "rea-secret-seed",
          value: { source: "secret", secret_id: "verifier_storage" },
        },
      ],
    },
  ],
});

/** Build the source-owned full-capture browser scenario. */
export function browserScenario(browser, origin) {
  return browserScenarioSchema.parse({
    browser,
    start_url: {
      url: `${origin}/app`,
      query: [
        {
          name: "scenario_token",
          value: { source: "secret", secret_id: "verifier_url" },
        },
      ],
    },
    environment: {
      viewport: { width: 1_280, height: 720, device_scale_factor: 1.25 },
      locale: "en-US",
      timezone: "UTC",
      color_scheme: "light",
      reduced_motion: "reduce",
    },
    actions: [
      {
        step_id: "ready",
        action: "wait_for",
        locator: {
          kind: "role",
          role: "button",
          name: "ax-private-label-value",
        },
        state: "visible",
      },
      {
        step_id: "verify",
        action: "click",
        locator: {
          kind: "role",
          role: "button",
          name: "ax-private-label-value",
        },
      },
    ],
    storage: duplicateOriginStorage(origin),
    secrets: [
      {
        secret_id: "verifier_url",
        environment_variable: "REA_BROWSER_VERIFIER_URL",
      },
      {
        secret_id: "verifier_storage",
        environment_variable: "REA_BROWSER_VERIFIER_SECRET",
      },
    ],
    capture: {
      after_each_step: [
        "screenshot",
        "dom",
        "accessibility",
        "url",
        "history",
        "storage",
      ],
      at_end: [
        "screenshot",
        "dom",
        "accessibility",
        "url",
        "history",
        "storage",
      ],
      events: [
        "console",
        "page-errors",
        "network",
        "websockets",
        "frames",
        "workers",
        "popups",
        "downloads",
      ],
    },
  });
}

/** Run scenario capture through the public one-shot CLI. */
export async function runScenarioCli(scenario) {
  const { stdout } = await execute(
    process.execPath,
    [
      "scripts/rea.mjs",
      "capture-browser-scenario",
      JSON.stringify(scenario),
      "--json",
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 64 * 1_024 * 1_024,
    },
  );
  return JSON.parse(stdout);
}

/** Verify failed real navigation retains observations through both public adapters. */
export async function verifyScenarioFailureEvidence(executable, origin) {
  const scenario = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: executable },
    start_url: { url: `${origin}/failed-navigation` },
    actions: [
      { step_id: "unused", action: "wait_for_timeout", duration_ms: 1 },
    ],
    capture: { events: ["network"] },
  });
  const profilesBefore = await scenarioProfiles();
  let cliFailure;
  try {
    await runScenarioCli(scenario);
    assert.fail("The fixture must fail before initial navigation completes");
  } catch (cause) {
    assert.equal(typeof cause.stdout, "string");
    cliFailure = JSON.parse(cause.stdout);
  }
  assertFailedNavigation(cliFailure, scenario.start_url.url);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [fileURLToPath(new URL("../rea.mjs", import.meta.url)), "mcp"],
    env: process.env,
    stderr: "pipe",
  });
  const client = new Client({
    name: "browser-scenario-failure-e2e",
    version: "1",
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({
      name: "capture_browser_scenario",
      arguments: scenario,
    });
    assert.equal(result.isError, true);
    assertFailedNavigation(requireMcpToolError(result), scenario.start_url.url);
  } finally {
    await client.close();
    await transport.close();
  }
  const profilesAfter = await scenarioProfiles();
  assert.ok([...profilesAfter].every((profile) => profilesBefore.has(profile)));
  return {
    mocked: false,
    cli: true,
    stdio_mcp: true,
    failed_navigation_events_retained: true,
    profile_cleanup: true,
  };
}

const assertFailedNavigation = (error, requestedUrl) => {
  assert.equal(error?.code, "execution_failure");
  const observation = error.details?.partial_observation;
  assert.equal(observation?.kind, "browser-scenario-observation");
  assert.equal(observation.capture.browser.cleanup, "terminated-owned-process");
  assert.deepEqual(observation.capture.steps, []);
  assert.ok(
    observation.capture.events.items.some(
      (event) =>
        event.kind === "request-failed" && event.url.url === requestedUrl,
    ),
  );
};

/** Snapshot provider-owned profile names for cleanup comparison. */
export async function scenarioProfiles() {
  return new Set(
    (await readdir(tmpdir())).filter((entry) =>
      entry.startsWith("rea-browser-scenario-"),
    ),
  );
}

/** Assert full real-browser scenario evidence and cleanup prerequisites. */
export function assertScenarioCapture(capture) {
  if (
    capture.steps.length !== 3 ||
    capture.steps.some(({ status }) => status !== "completed")
  )
    throw new Error("Scenario launch did not complete every declared step");
  const final = capture.steps.at(-1);
  if (
    final === undefined ||
    Object.entries(final.artifacts).some(
      ([kind, { state }]) => kind !== "screenshot" && state !== "captured",
    )
  )
    throw new Error(
      `Scenario launch did not capture every requested artifact: ${JSON.stringify(final?.artifacts ?? null)}`,
    );
  for (const step of capture.steps)
    assert.ok(
      step.artifacts.screenshot.state === "missing" &&
        step.artifacts.screenshot.reason.includes("sensitive"),
      "Sensitive scenario screenshots must be withheld from its first step",
    );
  const storageNames =
    final.artifacts.storage.state === "captured"
      ? final.artifacts.storage.value.local_storage.map(({ name }) => name)
      : [];
  if (
    !storageNames.includes("rea-first-seed") ||
    !storageNames.includes("rea-second-seed")
  )
    throw new Error("Scenario launch did not retain duplicate-origin seeds");
  const secretSeed =
    final.artifacts.storage.state === "captured"
      ? final.artifacts.storage.value.local_storage.find(
          ({ name }) => name === "rea-secret-seed",
        )
      : undefined;
  if (secretSeed?.value_state !== "redacted-secret")
    throw new Error("Scenario launch did not redact its declared secret seed");
  const finalUrl =
    final.artifacts.url.state === "captured"
      ? final.artifacts.url.value.url
      : "";
  if (!finalUrl.includes("[REDACTED:verifier_url]"))
    throw new Error("Scenario launch did not redact its declared URL secret");
  const stepUrl = capture.steps
    .map(({ after_url }) => after_url)
    .find(({ url }) => url.includes("[REDACTED:verifier_url]"));
  if (stepUrl?.redacted !== true)
    throw new Error(
      "Scenario step URL did not report declared-secret redaction",
    );
  const eventUrl = capture.events.items
    .filter((event) => "url" in event && event.url !== null)
    .map((event) => event.url)
    .find(({ url }) => url.includes("[REDACTED:verifier_url]"));
  if (eventUrl?.redacted !== true)
    throw new Error(
      "Scenario event URL did not report declared-secret redaction",
    );
  const unfinished = capture.events.items.filter(
    ({ kind }) => kind === "request-unfinished",
  );
  // This fixture polls continuously. A request crossing the capture cutoff
  // makes later activity unknown even when no response body was selected.
  const expectedMissing = [
    ...(unfinished.length === 0 ? [] : ["events"]),
    "screenshot",
  ].sort();
  if (
    capture.events.items.length === 0 ||
    capture.completeness.equality_eligible !== false ||
    JSON.stringify(capture.completeness.missing_sections) !==
      JSON.stringify(expectedMissing) ||
    capture.completeness.truncated_sections.length !== 0
  )
    throw new Error(
      `Scenario launch completeness disagrees with its capture cutoff: ${JSON.stringify({ completeness: capture.completeness, unfinished })}`,
    );
}
