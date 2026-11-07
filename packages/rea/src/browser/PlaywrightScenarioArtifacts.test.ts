import { expect, it, vi } from "vitest";
import type { BrowserContext, Page } from "playwright-core";

import { browserScenarioSchema } from "../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../tests/fixtures/browserScenarioSecrets.js";
import { capturePlaywrightStepArtifacts } from "./PlaywrightScenarioArtifacts.js";

const scenario = browserScenarioSchema.parse({
  browser: {
    mode: "launch",
    executable_path: "/opt/chromium",
  },
  start_url: { url: "https://app.example.test/" },
  actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
});
const secrets = resolveScenarioSecrets(scenario, {});

it("returns a complete requested text artifact beyond the former inline ceiling", async () => {
  const page = {
    url: () => "https://app.example.test/",
    content: () => Promise.resolve("x".repeat(16 * 1_024 * 1_024 + 1)),
  } as unknown as Page;

  const result = await capturePlaywrightStepArtifacts({
    context: {} as BrowserContext,
    page,
    secrets,
    requested: new Set(["dom"]),
  });
  expect(result.dom).toMatchObject({
    state: "captured",
    value: { bytes: 16 * 1_024 * 1_024 + 1 },
  });
});

it("redacts declared secrets from current and historical URL artifacts", async () => {
  const secretValue = "rea browser+verifier";
  const scenarioWithSecretUrl = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: {
      url: "https://app.example.test/",
      query: [
        {
          name: "token",
          value: { source: "secret", secret_id: "url_token" },
        },
      ],
    },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    secrets: [
      {
        secret_id: "url_token",
        environment_variable: "REA_URL_TOKEN",
      },
    ],
    capture: { at_end: ["url", "history"] },
  });
  const scenarioSecrets = resolveScenarioSecrets(scenarioWithSecretUrl, {
    REA_URL_TOKEN: secretValue,
  });
  const query = new URLSearchParams([["token", secretValue]]).toString();
  const url = `https://app.example.test/?${query}#${encodeURIComponent(secretValue)}`;
  const page = {
    url: () => url,
    evaluate: async () => ({
      length: 1,
      navigation_entries: [{ type: "navigate", name: url }],
    }),
  } as unknown as Page;

  const result = await capturePlaywrightStepArtifacts({
    context: {} as BrowserContext,
    page,
    secrets: scenarioSecrets,
    requested: new Set(["url", "history"]),
  });

  expect(
    JSON.stringify({ url: result.url, history: result.history }),
  ).not.toContain(secretValue);
  expect(result.url).toMatchObject({
    state: "captured",
    value: {
      redacted: true,
      url: "https://app.example.test/?token=[REDACTED:url_token]#[REDACTED:url_token]",
    },
  });
  expect(result.history).toMatchObject({
    state: "captured",
    value: {
      current_url: {
        redacted: true,
        url: "https://app.example.test/?token=[REDACTED:url_token]#[REDACTED:url_token]",
      },
      navigation_entries: [
        {
          name: {
            redacted: true,
            url: "https://app.example.test/?token=[REDACTED:url_token]#[REDACTED:url_token]",
          },
        },
      ],
    },
  });
});

it("redacts a declared secret used as a cookie or storage name", async () => {
  const secretValue = "session-token";
  const scenarioWithSecret = browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium" },
    start_url: { url: "https://app.example.test/" },
    actions: [{ step_id: "wait", action: "wait_for_timeout", duration_ms: 1 }],
    secrets: [
      { secret_id: "storage_key", environment_variable: "REA_STORAGE_KEY" },
    ],
  });
  const scenarioSecrets = resolveScenarioSecrets(scenarioWithSecret, {
    REA_STORAGE_KEY: secretValue,
  });
  const page = {
    url: () => "https://app.example.test/",
    evaluate: async () => ({
      local_storage: [[secretValue, "kept-value"]],
      session_storage: [["theme", secretValue]],
    }),
  } as unknown as Page;
  const context = {
    cookies: async () => [
      {
        name: secretValue,
        value: "ordinary",
        domain: "app.example.test",
        path: "/",
        secure: true,
        httpOnly: false,
        sameSite: "Lax" as const,
      },
    ],
  } as unknown as BrowserContext;

  const result = await capturePlaywrightStepArtifacts({
    context,
    page,
    secrets: scenarioSecrets,
    requested: new Set(["storage"]),
  });

  expect(JSON.stringify(result.storage)).not.toContain(secretValue);
  expect(result.storage).toMatchObject({
    state: "captured",
    value: {
      cookies: [{ name: "[REDACTED:storage_key]", value_state: "hashed" }],
      local_storage: [
        { name: "[REDACTED:storage_key]", value_state: "hashed" },
      ],
      session_storage: [
        { name: "theme", value_state: "redacted-secret", value_sha256: null },
      ],
    },
  });
});

it.each(["declared", "saved"])(
  "withholds selected screenshots with %s sensitive values before requesting pixels",
  async (kind) => {
    const selected = browserScenarioSchema.parse({
      ...scenario,
      secrets:
        kind === "declared"
          ? [{ secret_id: "token", environment_variable: "TOKEN" }]
          : [],
    });
    const protectedSecrets = resolveScenarioSecrets(
      selected,
      kind === "declared" ? { TOKEN: "pixel-token-729a" } : {},
    );
    if (kind === "saved")
      protectedSecrets.save(
        "response.token",
        "token",
        "pixel-token-729a",
        true,
      );
    const screenshot = vi.fn(async () => Buffer.from("private pixels"));
    const result = await capturePlaywrightStepArtifacts({
      page: { screenshot } as unknown as Page,
      context: {} as BrowserContext,
      secrets: protectedSecrets,
      requested: new Set(["screenshot"]),
    });
    expect(result.screenshot).toMatchObject({
      state: "missing",
      reason: expect.stringContaining("sensitive"),
    });
    expect(screenshot).not.toHaveBeenCalled();
  },
);

it.each(["request", "click", "press"])(
  "withholds pixels from the first capture when a future %s response is marked sensitive",
  async (action) => {
    const save = [{ name: "token", json_pointer: "/token", secret: true }];
    const selected = browserScenarioSchema.parse({
      ...scenario,
      actions: [
        action === "request"
          ? {
              step_id: "request",
              action,
              method: "POST",
              path: "/api/items",
              save,
            }
          : {
              step_id: "ui",
              action,
              locator: { kind: "css", selector: "#save" },
              ...(action === "press" ? { key: "Enter" } : {}),
              save_response: { method: "POST", path: "/api/items", save },
            },
      ],
    });
    const screenshot = vi.fn(async () => Buffer.from("private pixels"));
    const result = await capturePlaywrightStepArtifacts({
      page: { screenshot } as unknown as Page,
      context: {} as BrowserContext,
      secrets: resolveScenarioSecrets(selected, {}),
      requested: new Set(["screenshot"]),
    });
    expect(result.screenshot).toMatchObject({
      state: "missing",
      reason: expect.stringContaining("sensitive"),
    });
    expect(screenshot).not.toHaveBeenCalled();
  },
);

it.each(["cookie", "local_storage", "basic_credentials"])(
  "withholds pixels before planned %s authentication values are read",
  async (source) => {
    const value =
      source === "basic_credentials"
        ? {
            source,
            parts: [
              { source: "literal", value: "user" },
              { source: "cookie", name: "password" },
            ],
          }
        : source === "local_storage"
          ? { source, key: "session" }
          : { source, name: "session" };
    const selected = browserScenarioSchema.parse({
      ...scenario,
      actions: [
        {
          step_id: "request",
          action: "request",
          method: "POST",
          path: "/api/items",
          headers: [{ name: "Authorization", value }],
        },
      ],
    });
    const screenshot = vi.fn(async () => Buffer.from("private pixels"));
    const result = await capturePlaywrightStepArtifacts({
      page: { screenshot } as unknown as Page,
      context: {} as BrowserContext,
      secrets: resolveScenarioSecrets(selected, {}),
      requested: new Set(["screenshot"]),
    });
    expect(result.screenshot).toMatchObject({ state: "missing" });
    expect(screenshot).not.toHaveBeenCalled();
  },
);

it("preserves requested pixels when saved response values are not marked sensitive", async () => {
  const selected = browserScenarioSchema.parse({
    ...scenario,
    actions: [
      {
        step_id: "request",
        action: "request",
        method: "POST",
        path: "/api/items",
        save: [{ name: "id", json_pointer: "/id", secret: false }],
      },
    ],
  });
  const pixels = Buffer.from("public pixels");
  const screenshot = vi.fn(async () => pixels);
  const result = await capturePlaywrightStepArtifacts({
    page: { screenshot } as unknown as Page,
    context: {} as BrowserContext,
    secrets: resolveScenarioSecrets(selected, {}),
    requested: new Set(["screenshot"]),
  });
  expect(result.screenshot).toMatchObject({
    state: "captured",
    value: { data_base64: pixels.toString("base64") },
  });
  expect(screenshot).toHaveBeenCalledTimes(1);
});
