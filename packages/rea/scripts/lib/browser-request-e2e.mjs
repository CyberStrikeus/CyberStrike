import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

import { browserScenarioSchema } from "../../dist/domain/browserScenario.js";
import { browserScenarioCaptureSchema } from "../../dist/domain/browserScenarioCapture.js";
import { parseEvidence } from "../../dist/domain/evidence.js";
import { performScenarioRequest } from "../../dist/browser/PlaywrightScenarioRequest.js";
import { BrowserScenarioSecrets } from "../../dist/browser/BrowserScenarioSecrets.js";
import { PrivateRuntimeRoot } from "../../dist/process/PrivateRuntimeRoot.js";
import {
  requestFixtureCsrf,
  requestFixtureToken,
  startBrowserRequestSite,
} from "../fixtures/browser-request-site.mjs";
import { withVerifierCleanup } from "./verifier-cleanup.mjs";
import { createPackageVerifierCommands } from "./verify-package-commands.mjs";

const authenticated = [
  { name: "X-CSRFToken", value: { source: "cookie", name: "csrftoken" } },
  {
    name: "Authorization",
    value: { source: "local_storage", key: "auth", json_pointer: "/token" },
    prefix: "Bearer ",
  },
];

const read = (step_id, path) => ({
  step_id,
  action: "request",
  method: "GET",
  path,
  expected_status: [200],
});

const write = (step_id, method, path, { json, status }) => ({
  step_id,
  action: "request",
  method,
  path,
  headers: authenticated,
  ...(json === undefined ? {} : { json }),
  expected_status: [status],
});

const pause = (step_id) => ({
  step_id,
  action: "wait_for_timeout",
  duration_ms: 1100,
});

/** A recording that writes two scratch items and reads each write back at once, as an environment needs. */
const writeSession = (executable, origin) =>
  browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: executable },
    start_url: { url: `${origin}/` },
    actions: [
      {
        step_id: "ready",
        action: "wait_for",
        locator: { kind: "css", selector: "#ready" },
        state: "visible",
        timeout_ms: 10_000,
      },
      read("list-1", "/api/items"),
      read("list-2", "/api/items"),
      read("item-1", "/api/items/1"),
      {
        ...write("create-1", "POST", "/api/items", {
          json: { title: "Scratch item 1" },
          status: 201,
        }),
        query: [{ name: "org", value: { source: "literal", value: "1" } }],
      },
      read("created-1", "/api/items/3"),
      read("list-created-1", "/api/items"),
      write("create-2", "POST", "/api/items", {
        json: { title: "Scratch item 2" },
        status: 201,
      }),
      read("created-2", "/api/items/4"),
      read("list-created-2", "/api/items"),
      pause("settle-creates"),
      write("update-1", "PUT", "/api/items/3", {
        json: { title: "Scratch item 1 renamed", done: true },
        status: 200,
      }),
      read("updated-1", "/api/items/3"),
      read("list-updated-1", "/api/items"),
      write("update-2", "PUT", "/api/items/4", {
        json: { title: "Scratch item 2 renamed", done: false },
        status: 200,
      }),
      read("updated-2", "/api/items/4"),
      read("list-updated-2", "/api/items"),
      write("delete-1", "DELETE", "/api/items/3", { status: 204 }),
      { ...read("deleted-1", "/api/items/3"), expected_status: [404] },
      read("list-deleted-1", "/api/items"),
      write("delete-2", "DELETE", "/api/items/4", { status: 204 }),
      { ...read("deleted-2", "/api/items/4"), expected_status: [404] },
      read("list-deleted-2", "/api/items"),
      read("session", "/api/session"),
    ],
    capture: {
      at_end: ["url"],
      network: { request_body: true, response_body: true, header_values: true },
    },
  });

/** Run the CLI under the owner, which stops it and every browser it launched on timeout or failure. */
const cliOf = (commands, entrypoint) => async (args, maxBuffer) =>
  (
    await commands.exec(process.execPath, [entrypoint, ...args, "--json"], {
      env: {
        ...process.env,
        REA_LOG_LEVEL: "silent",
        HOPPER_LAUNCHER_PATH: "/rea-unconfigured-provider/hopper",
      },
      timeout: 120_000,
      maxBuffer,
    })
  ).stdout;

const captureOf = async (cli, scenario, maxBuffer) => {
  const stdout = await cli(
    ["capture-browser-scenario", JSON.stringify(scenario)],
    maxBuffer,
  );
  const evidence = parseEvidence(JSON.parse(stdout));
  return {
    stdout,
    evidence,
    capture: browserScenarioCaptureSchema.parse(evidence.normalized_result),
  };
};

/** Every request step completed and sent exactly its own request. */
const assertRequestsAttributed = (scenario, capture) => {
  const steps = capture.steps.filter(
    (step) => step.step_id !== "scenario_start",
  );
  assert.equal(steps.length, scenario.actions.length);
  for (const step of steps)
    assert.equal(step.status, "completed", JSON.stringify(step));
  const requests = capture.events.items.filter(
    (event) => event.kind === "request",
  );
  scenario.actions.forEach((action, index) => {
    if (action.action !== "request") return;
    const stepIndex = capture.steps.findIndex(
      (step) => step.step_id === action.step_id,
    );
    assert.equal(capture.steps[stepIndex].action, "request");
    const sent = requests.filter(
      (event) =>
        event.step_index === stepIndex &&
        event.method === action.method &&
        new URL(event.url.url).pathname === action.path,
    );
    assert.equal(sent.length, 1, `step ${String(index)} ${action.step_id}`);
  });
};

/** The CSRF cookie and stored token reached the server but no record keeps them. */
const assertPageValuesRedacted = (evidence, capture) => {
  // Bodies are base64 in the Evidence, so decode them before looking for the values.
  const contents = capture.events.items.filter(
    (event) => event.kind === "network-content",
  );
  const bodies = contents
    .filter((event) => event.body.state === "captured")
    .map((event) => Buffer.from(event.body.content, "base64").toString());
  const headerValues = contents.flatMap((event) =>
    event.headers.state === "captured"
      ? event.headers.items.map((item) => item.value ?? "")
      : [],
  );
  const retained = [JSON.stringify(evidence), ...bodies, ...headerValues];
  for (const value of [requestFixtureCsrf, requestFixtureToken])
    assert.ok(
      retained.every((text) => !text.includes(value)),
      `${value} was retained`,
    );
  assert.ok(
    headerValues.some((value) =>
      value.includes("[REDACTED:page:create-1.X-CSRFToken]"),
    ),
    "the CSRF header was not recorded redacted",
  );
  assert.ok(
    bodies.some(
      (body) =>
        body.includes('"token"') && body.includes("[REDACTED:page:create-1."),
    ),
    "the session response was not recorded redacted",
  );
  assert.ok(
    capture.limitations.some((line) => line.startsWith("Request steps sent")),
  );
};

/** A status outside expected_status fails the step and cancels the rest; a redirect to another origin is not followed. */
const assertUnexpectedStatusFails = async (cli, scenario, site) => {
  const failing = browserScenarioSchema.parse({
    ...scenario,
    actions: [
      write("delete-missing", "DELETE", "/api/items/999", { status: 204 }),
      read("after", "/api/items"),
    ],
  });
  const { capture } = await captureOf(cli, failing, 16 * 1024 * 1024);
  const missing = capture.steps.find(
    ({ step_id }) => step_id === "delete-missing",
  );
  assert.equal(missing.status, "failed");
  assert.match(missing.error ?? "", /answered 404; expected 204/u);
  assert.equal(
    capture.steps.find(({ step_id }) => step_id === "after").status,
    "cancelled",
  );
  const redirected = browserScenarioSchema.parse({
    ...scenario,
    actions: [read("elsewhere", "/api/elsewhere")],
  });
  const followed = await captureOf(cli, redirected, 16 * 1024 * 1024);
  const step = followed.capture.steps.find(
    ({ step_id }) => step_id === "elsewhere",
  );
  assert.equal(step.status, "failed");
  assert.match(step.error ?? "", /request steps do not follow/u);
  // Chrome reports the redirected request and aborts it; the other origin must never receive it.
  assert.ok(
    site.hosts.every((line) => !line.startsWith("localhost")),
    "a request step followed a redirect to another origin",
  );
};

/** A genuinely busy page must not dispatch a write after its deadline or host cancellation. */
const assertQueuedWritesStopped = async (executable, site) => {
  const browser = await chromium.launch({
    executablePath: executable,
    headless: true,
  });
  try {
    const page = await browser.newPage({ serviceWorkers: "block" });
    await page.goto(site.origin);
    for (const cancelled of [false, true]) {
      const scenario = browserScenarioSchema.parse({
        ...writeSession(executable, site.origin),
        actions: [
          {
            ...write("queued", "POST", "/api/items", {
              json: { title: "must not be created" },
              status: 201,
            }),
            headers: [
              {
                name: "X-CSRFToken",
                value: { source: "literal", value: requestFixtureCsrf },
              },
              {
                name: "Authorization",
                value: {
                  source: "literal",
                  value: `Bearer ${requestFixtureToken}`,
                },
              },
            ],
            timeout_ms: cancelled ? 5000 : 50,
          },
        ],
      });
      const secrets = BrowserScenarioSecrets.resolve(scenario, {});
      if (!secrets.ok) throw secrets.error;
      // A preceding evaluation monopolizes the page thread while Node can
      // still cancel. Its protocol request is queued before the request step.
      const busy = page.evaluate(() => {
        const until = Date.now() + 300;
        while (Date.now() < until) {}
      });
      const controller = new AbortController();
      const before = site.writes.length;
      const request = performScenarioRequest({
        page,
        action: scenario.actions[0],
        secrets: secrets.value,
        startOrigin: site.origin,
        signal: controller.signal,
      });
      const outcome = request.then(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      const timer = cancelled
        ? setTimeout(() => controller.abort("queued request cancelled"), 30)
        : undefined;
      try {
        const result = await outcome;
        assert.equal(result.ok, false, "queued write unexpectedly completed");
        assert.equal(
          site.writes.length,
          before,
          "the server received a late write",
        );
        await busy;
      } finally {
        if (timer !== undefined) clearTimeout(timer);
      }
    }
  } finally {
    await browser.close();
  }
};

/**
 * Record a write session through request steps in a real browser, then build
 * an environment from it: every request lands in its own step, the page's
 * CSRF cookie and stored token authenticate the writes and never reach the
 * Evidence, and the build serves the recorded writes.
 */
export async function verifyBrowserRequestSteps(
  executable,
  entrypoint = fileURLToPath(new URL("../rea.mjs", import.meta.url)),
) {
  const site = await startBrowserRequestSite();
  let root;
  let commands;
  const proof = async () => {
    root = await PrivateRuntimeRoot.create({ prefix: "rea-request-e2e-" });
    commands = await createPackageVerifierCommands({ workspace: root });
    const cli = cliOf(commands, entrypoint);
    const scenario = writeSession(executable, site.origin);
    const { stdout, evidence, capture } = await captureOf(
      cli,
      scenario,
      64 * 1024 * 1024,
    );
    assertRequestsAttributed(scenario, capture);
    assert.equal(site.writes.length, 6);
    assert.ok(site.writes.every(({ csrf, bearer }) => csrf && bearer));
    assert.deepEqual(site.writes[0], {
      method: "POST",
      path: "/api/items",
      query: "?org=1",
      body: { title: "Scratch item 1" },
      contentType: "application/json",
      cookie: true,
      csrf: true,
      bearer: true,
    });
    assertPageValuesRedacted(evidence, capture);

    const capturePath = join(root.path, "items.capture.json");
    await writeFile(capturePath, stdout);
    const built = JSON.parse(
      await cli(
        ["environment-build", capturePath, join(root.path, "env")],
        16 * 1024 * 1024,
      ),
    );
    assert.equal(built.status, "built");
    assert.equal(built.name, "items");
    const served = built.coverage.writes.served.map(({ tool }) => tool).sort();
    assert.deepEqual(
      served,
      ["delete_items_by_id", "post_items", "put_items_by_id"],
      JSON.stringify(built.coverage),
    );

    await assertUnexpectedStatusFails(cli, scenario, site);
    await assertQueuedWritesStopped(executable, site);
    return {
      request_steps: scenario.actions.filter(
        ({ action }) => action === "request",
      ).length,
      authenticated_writes: site.writes.length,
      served_writes: served,
      tool_count: built.tool_count,
      queued_writes_refused: 2,
    };
  };
  // The owner stops its commands' processes before removing the root; a failed stop keeps the root and is reported.
  return withVerifierCleanup(proof, [
    () => (commands === undefined ? root?.close() : commands.close()),
    () => site.close(),
  ]);
}
