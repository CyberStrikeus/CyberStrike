import { expect, it, vi } from "vitest";
import { browserScenarioSchema } from "../../domain/browserScenario.js";
import { resolveScenarioSecrets } from "../../../tests/fixtures/browserScenarioSecrets.js";
import {
  captureNetworkBody,
  captureNetworkHeaders,
} from "./PlaywrightNetworkContent.js";

const scenario = browserScenarioSchema.parse({
  browser: { mode: "launch", executable_path: "/fixture/chrome" },
  start_url: { url: "https://example.test" },
  actions: [{ step_id: "done", action: "wait_for_timeout", duration_ms: 1 }],
  secrets: [{ secret_id: "declared", environment_variable: "SECRET" }],
});
const secrets = resolveScenarioSecrets(scenario, { SECRET: "x" });
const options = {
  timeoutMs: 100,
  maxBodyBytes: 4,
  maxBodyAllocationBytes: 1024 * 1024,
  maxHeaderAllocationBytes: 16384,
  maxMetadataAllocationBytes: 4096,
};
const source = {
  headers: () => ({ "content-type": "text/plain" }),
  headersArray: async () => [],
};

it("enforces the retained body byte limit after secret expansion", async () => {
  expect(
    await captureNetworkBody(
      async () => Buffer.from("xxxx"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "unavailable",
    reason: "body-size-limit",
    limit_bytes: 4,
  });
  expect(
    await captureNetworkBody(
      async () => Buffer.from("safe"),
      "response",
      source,
      secrets,
      options,
    ),
  ).toMatchObject({
    state: "captured",
    bytes: 4,
    content: Buffer.from("safe").toString("base64"),
  });
});

it("charges discarded credential header values only for their retained projection", async () => {
  const read = async (name: string) =>
    captureNetworkHeaders(
      {
        headers: () => ({}),
        headersArray: async () => [
          { name, value: "v".repeat(50_000) },
          { name: "X-Observed", value: "ordinary" },
        ],
      },
      secrets,
      options,
    );
  expect(await read("Cookie")).toMatchObject({
    state: "captured",
    items: [
      { name: "Cookie", value: null, redacted: true },
      { name: "X-Observed", value: "ordinary", redacted: false },
    ],
  });
  expect(await read("X-Retained")).toMatchObject({ state: "unavailable" });
});

it("redacts later JSON spellings of saved secrets without reserializing unmarked facts", async () => {
  const held = resolveScenarioSecrets(scenario, { SECRET: "declared-value" });
  held.save("login.token", "token", "source-token", true);
  held.save("login.code", "code", 1000, true);
  const body = '{ "token":"\\u0073ource-token", "code":1e3, "unknown":1e-400 }';
  const captured = await captureNetworkBody(
    async () => Buffer.from(body),
    "response",
    {
      headers: () => ({
        "content-type": "application/problem+json; charset=utf-8",
      }),
      headersArray: async () => [],
    },
    held,
    { ...options, maxBodyBytes: 4096 },
  );
  if (captured.state !== "captured") throw new Error("Expected captured JSON");
  const text = Buffer.from(captured.content, "base64").toString();
  expect(text).not.toMatch(/0073|source-token|1e3/u);
  expect(text).toContain('"unknown":1e-400');
  expect(text).toContain('{ "token":');
  expect(JSON.parse(text)).toMatchObject({
    token: "[REDACTED:page:login.token]",
    code: "[REDACTED:page:login.code]",
  });
});

it("keeps an empty JSON-labelled response as observed empty bytes", async () => {
  const captured = await captureNetworkBody(
    async () => Buffer.alloc(0),
    "response",
    {
      headers: () => ({ "content-type": "application/json" }),
      headersArray: async () => [],
    },
    secrets,
    options,
  );
  expect(captured).toMatchObject({ state: "captured", bytes: 0, content: "" });
});

it("checks the JSON decoding budget before invoking its decoder", async () => {
  const held = resolveScenarioSecrets(scenario, { SECRET: "declared-value" });
  const decode = vi.spyOn(held, "redactJsonBody");
  const captured = await captureNetworkBody(
    async () => Buffer.from('{"value":"untouched"}'),
    "response",
    {
      headers: () => ({ "content-type": "application/json" }),
      headersArray: async () => [],
    },
    held,
    { ...options, maxBodyBytes: 4096, maxBodyAllocationBytes: 1 },
  );
  expect(captured).toMatchObject({
    state: "unavailable",
    reason: "body-allocation-limit",
  });
  expect(decode).not.toHaveBeenCalled();
});

it.each(['{"token":"private-token-729d"}', 'A","B'])(
  "withholds JSON when an explicitly declared secret spans tokens: %s",
  async (secret) => {
    const held = resolveScenarioSecrets(scenario, { SECRET: secret });
    const body = secret.startsWith("{") ? secret : '{"x":"A","B":"C"}';
    const captured = await captureNetworkBody(
      async () => Buffer.from(body),
      "request",
      {
        headers: () => ({ "content-type": "application/json" }),
        headersArray: async () => [],
      },
      held,
      { ...options, maxBodyBytes: 4096 },
    );
    expect(captured).toMatchObject({
      state: "unavailable",
      reason: "body-read-failed",
    });
    expect(JSON.stringify(captured)).not.toContain(secret);
  },
);
