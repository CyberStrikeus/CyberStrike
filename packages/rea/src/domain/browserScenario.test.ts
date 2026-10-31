import { expect, it } from "vitest";

import { browserScenarioSchema } from "./browserScenario.js";
import { browserScenarioActionSchema } from "./browserScenarioValues.js";

const requestAction = (path: string, name = "X-Trace") => ({
  step_id: "request",
  action: "request",
  method: "GET",
  path,
  headers: [{ name, value: { source: "literal", value: "selected" } }],
});

it("preserves same-origin request path spelling and rejects network-path prefixes", () => {
  for (const path of ["/", "/api?x=a%2Fb", "/api//item", "/a\\b"]) {
    expect(
      browserScenarioActionSchema.parse(requestAction(path)),
    ).toMatchObject({
      path,
    });
  }
  for (const path of [
    "",
    "relative",
    "//other.test",
    "/\\other.test",
    "https://other.test/",
  ])
    expect(
      browserScenarioActionSchema.safeParse(requestAction(path)).success,
      path,
    ).toBe(false);
});

it("keeps HTTP token characters and forbidden-header policy distinct", () => {
  const punctuation = new Set("!#$%&'*+-.^_`|~");
  for (let code = 0; code < 128; code += 1) {
    const name = String.fromCharCode(code);
    const isToken =
      (code >= 48 && code <= 57) ||
      (code >= 65 && code <= 90) ||
      (code >= 97 && code <= 122) ||
      punctuation.has(name);
    expect(
      browserScenarioActionSchema.safeParse(requestAction("/api", name))
        .success,
      JSON.stringify(name),
    ).toBe(isToken);
  }
  const name = "X-Trace|Id-";
  expect(
    browserScenarioActionSchema.parse(requestAction("/api", name)),
  ).toMatchObject({
    headers: [{ name, value: { source: "literal", value: "selected" } }],
  });
  for (const name of ["", "é", "Host", "cookie", "Proxy-Trace", "Sec-Trace"])
    expect(
      browserScenarioActionSchema.safeParse(requestAction("/api", name))
        .success,
      name,
    ).toBe(false);
});

it("accepts large action, secret, and storage selections", () => {
  const actions = Array.from({ length: 129 }, (_, index) => ({
    step_id: `fill_${index}`,
    action: "fill",
    locator: { kind: "css", selector: "#field" },
    value: { source: "secret", secret_id: `secret_${index}` },
  }));
  const secrets = Array.from({ length: actions.length }, (_, index) => ({
    secret_id: `secret_${index}`,
    environment_variable: `SECRET_${index}`,
  }));
  const cookies = Array.from({ length: 129 }, (_, index) => ({
    name: `cookie_${index}`,
    value: { source: "literal", value: "value" },
    destination: { url: "https://app.example.test/" },
    http_only: false,
    secure: true,
    same_site: "Lax",
  }));
  const storageEntries = Array.from({ length: 129 }, (_, index) => ({
    name: `entry_${index}`,
    value: { source: "literal", value: "value" },
  }));

  const result = browserScenarioSchema.parse({
    browser: {
      mode: "launch",
      executable_path: "/opt/chromium",
    },
    start_url: { url: "https://app.example.test/" },
    actions,
    secrets,
    storage: {
      cookies,
      local_storage: [
        { origin: "https://app.example.test", entries: storageEntries },
      ],
      session_storage: [
        { origin: "https://app.example.test", entries: storageEntries },
      ],
    },
  });

  expect(result.actions).toHaveLength(129);
  expect(result.secrets).toHaveLength(129);
  expect(result.storage.cookies).toHaveLength(129);
  expect(result.storage.local_storage[0]?.entries).toHaveLength(129);
  expect(result.storage.session_storage[0]?.entries).toHaveLength(129);
});

it("does not require duplicate origin scope declarations", () => {
  const scenario = browserScenarioSchema.parse({
    browser: {
      mode: "launch",
      executable_path: "/opt/chromium/chrome",
    },
    start_url: { url: "https://app.example.test/" },
    actions: [
      {
        step_id: "navigate",
        action: "goto",
        destination: { url: "https://other.example.test/" },
        wait_until: "load",
      },
    ],
    storage: {
      local_storage: [
        {
          origin: "https://storage.example.test",
          entries: [
            { name: "theme", value: { source: "literal", value: "dark" } },
          ],
        },
      ],
    },
  });

  expect(scenario.actions[0]).toMatchObject({
    destination: { url: "https://other.example.test/" },
  });
  expect(scenario.storage.local_storage[0]?.origin).toBe(
    "https://storage.example.test",
  );
});

it("accepts caller-selected safe capture limits and rejects invalid bounds", () => {
  const base = {
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
  };
  expect(
    browserScenarioSchema.parse({
      ...base,
      capture: {
        limits: { max_total_event_allocation_bytes: 32 * 1024 * 1024 },
      },
    }).capture.limits,
  ).toMatchObject({
    max_events: 10_000,
    max_event_allocation_bytes: 4 * 1024 * 1024,
    max_total_event_allocation_bytes: 32 * 1024 * 1024,
    max_network_body_bytes: 64 * 1024,
  });
  for (const invalid of [0, Number.MAX_SAFE_INTEGER + 1, Number.NaN])
    expect(
      browserScenarioSchema.safeParse({
        ...base,
        capture: { limits: { max_events: invalid } },
      }).success,
    ).toBe(false);
});

it("accepts complete browser inputs beyond former string length caps", () => {
  const longValue = "value".repeat(20_000);
  const longToken = "a".repeat(70_000);
  const longEnvironmentVariable = "SECRET_A".repeat(10_000);
  const longPath = `/app/${"segment".repeat(3_000)}`;
  const result = browserScenarioSchema.parse({
    browser: {
      mode: "launch",
      executable_path: longPath,
    },
    start_url: { url: `https://app.example.test${longPath}` },
    secrets: [
      {
        secret_id: longToken,
        environment_variable: longEnvironmentVariable,
      },
    ],
    actions: [
      {
        step_id: longToken,
        action: "fill",
        locator: { kind: "css", selector: `#${longValue}` },
        value: { source: "secret", secret_id: longToken },
      },
    ],
    storage: {
      cookies: [
        {
          name: longToken,
          value: {
            source: "literal",
            value: longValue,
          },
          destination: { url: "https://app.example.test/" },
          http_only: false,
          secure: true,
          same_site: "Lax",
        },
      ],
    },
  });

  expect(result.actions[0]?.step_id).toBe(longToken);
  expect(
    result.actions[0]?.action === "fill" &&
      result.actions[0].value.source === "secret"
      ? result.actions[0].value.secret_id
      : undefined,
  ).toBe(longToken);
  expect(result.storage.cookies[0]?.name).toBe(longToken);
  expect(result.secrets[0]?.environment_variable).toBe(longEnvironmentVariable);
});

it("accepts caller-selected viewport sizes and click counts without ceilings", () => {
  const input = {
    browser: {
      mode: "launch",
      executable_path: "/opt/chromium",
    },
    start_url: { url: "https://app.example.test/" },
    environment: {
      viewport: { width: 20_000, height: 10_000, device_scale_factor: 8 },
    },
    actions: [
      {
        step_id: "many-clicks",
        action: "click",
        locator: { kind: "css", selector: "#item" },
        click_count: 4,
      },
    ],
  };

  const parsed = browserScenarioSchema.parse(input);
  expect(parsed.environment.viewport).toEqual({
    width: 20_000,
    height: 10_000,
    device_scale_factor: 8,
  });
  expect(parsed.actions[0]).toMatchObject({ click_count: 4 });
});

it("refuses an action step id that the provider reserves for the initial state", () => {
  const scenario = (secondStepId: string) => ({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [
      { step_id: "open", action: "wait_for_timeout", duration_ms: 10 },
      { step_id: secondStepId, action: "wait_for_timeout", duration_ms: 10 },
    ],
  });

  expect(() => browserScenarioSchema.parse(scenario("scenario_start"))).toThrow(
    /reserved/u,
  );
  const rejected = browserScenarioSchema.safeParse(scenario("scenario_start"));
  expect(rejected.success).toBe(false);
  expect(rejected.error?.issues[0]?.path).toEqual(["actions", 1, "step_id"]);
  // Only the exact identity is reserved; a similar caller id stays valid.
  expect(
    browserScenarioSchema.parse(scenario("scenario_start_2")).actions,
  ).toHaveLength(2);
});

it.each([
  {
    field: "duration_ms",
    action: { action: "wait_for_timeout", duration_ms: 2_147_483_648 },
  },
  {
    field: "timeout_ms",
    action: {
      action: "wait_for",
      locator: { kind: "css", selector: "#btn" },
      state: "visible",
      timeout_ms: 2_147_483_648,
    },
  },
])("rejects $field at its precise owning field", ({ field, action }) => {
  const parsed = browserScenarioSchema.safeParse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "overflow", ...action }],
  });
  if (parsed.success)
    throw new Error("Expected unrepresentable timer rejection");
  expect(parsed.error.issues).toMatchObject([
    { code: "too_big", maximum: 2_147_483_647, path: ["actions", 0, field] },
  ]);
});

it("preserves the largest representable timers and an omitted action deadline", () => {
  const parsed = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [
      {
        step_id: "max-wait",
        action: "wait_for_timeout",
        duration_ms: 2_147_483_647,
      },
      {
        step_id: "max-deadline",
        action: "wait_for",
        locator: { kind: "css", selector: "#btn" },
        state: "visible",
        timeout_ms: 2_147_483_647,
      },
      {
        step_id: "unbounded",
        action: "wait_for",
        locator: { kind: "css", selector: "#btn" },
        state: "visible",
      },
    ],
  });
  expect(parsed.actions[0]).toMatchObject({ duration_ms: 2_147_483_647 });
  expect(parsed.actions[1]).toMatchObject({ timeout_ms: 2_147_483_647 });
  expect(parsed.actions[2]).not.toHaveProperty("timeout_ms");
});
