import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";
import { resolveScenarioSecrets } from "../../tests/fixtures/browserScenarioSecrets.js";
import { browserScenarioSchema } from "../domain/browserScenario.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "../domain/browserScenarioCaptureLimits.js";

const secret = (secret_id: string) => ({ source: "secret", secret_id });
const literal = (value: string) => ({
  source: "literal",
  value,
});

const baseScenario = () => ({
  browser: {
    mode: "launch",
    executable_path: "/opt/chromium/chrome",
  },
  start_url: {
    url: "https://app.example.test/",
    query: [{ name: "token", value: secret("session") }],
  },
  actions: [
    {
      step_id: "login",
      action: "fill",
      locator: { kind: "test_id", value: "password" },
      value: secret("login_input"),
    },
    {
      step_id: "submit",
      action: "click",
      locator: {
        kind: "role",
        role: "button",
        name: "Sign in",
      },
    },
    {
      step_id: "dashboard",
      action: "goto",
      destination: { url: "https://app.example.test/dashboard" },
      wait_until: "load",
    },
  ],
  storage: {
    cookies: [
      {
        name: "sid",
        value: secret("cookie"),
        destination: { url: "https://app.example.test/" },
        http_only: true,
        secure: true,
        same_site: "Lax",
      },
    ],
    local_storage: [
      {
        origin: "https://app.example.test",
        entries: [{ name: "theme", value: literal("dark") }],
      },
    ],
  },
  secrets: [
    {
      secret_id: "session",
      environment_variable: "REA_TEST_SESSION",
    },
    {
      secret_id: "login_input",
      environment_variable: "REA_TEST_PASSWORD",
    },
    {
      secret_id: "cookie",
      environment_variable: "REA_TEST_COOKIE",
    },
  ],
  capture: {
    after_each_step: ["screenshot", "url", "accessibility"],
    at_end: ["dom", "storage"],
    events: ["console", "page-errors", "network", "websockets"],
  },
});

describe("browser scenario secret redaction", () => {
  it("matches percent-escape hex case without case-folding raw secrets", () => {
    const secrets = resolveScenarioSecrets(
      browserScenarioSchema.parse(baseScenario()),
      {
        REA_TEST_SESSION: "a/b?",
        REA_TEST_PASSWORD: "password",
        REA_TEST_COOKIE: "cookie",
      },
    );

    expect(secrets.redact("logged a%2fb%3f, a%2Fb%3F and a%2fb%3F")).toBe(
      "logged [REDACTED:session], [REDACTED:session] and [REDACTED:session]",
    );
    expect(secrets.redact("raw A/B? remains case-sensitive")).toBe(
      "raw A/B? remains case-sensitive",
    );
    expect(
      Buffer.compare(
        secrets.redactBytes(
          Buffer.concat([
            Buffer.from([0xff, 0]),
            Buffer.from("a%2fb%3F"),
            Buffer.from([0x80]),
          ]),
        ),
        Buffer.concat([
          Buffer.from([0xff, 0]),
          Buffer.from("[REDACTED:session]"),
          Buffer.from([0x80]),
        ]),
      ),
    ).toBe(0);
    expect(
      secrets.sanitizeUrl("https://app.example.test/?token=a%2fb%3F").url,
    ).toBe("https://app.example.test/?token=[REDACTED:session]");
    expect(secrets.fingerprint("stored a%2fb%3F")).toEqual({
      value_state: "redacted-secret",
      value_sha256: null,
    });
  });
  it("does not resolve inherited environment properties as secret values", () => {
    const scenario = browserScenarioSchema.parse(baseScenario());
    const environment = Object.assign(
      { REA_TEST_PASSWORD: "password", REA_TEST_COOKIE: "cookie" },
      Object.create({ REA_TEST_SESSION: "session" }) as object,
    );
    expect(BrowserScenarioSecrets.resolve(scenario, environment)).toMatchObject(
      {
        ok: false,
        error: {
          _tag: "AnalysisInputError",
          issues: [
            {
              path: ["secrets", 0, "environment_variable"],
              expected: {
                environment_variable: "REA_TEST_SESSION",
                secret_id: "session",
              },
            },
          ],
        },
      },
    );
  });
});

describe("storage value fingerprint encoding", () => {
  const secrets = resolveScenarioSecrets(
    browserScenarioSchema.parse(baseScenario()),
    {
      REA_TEST_SESSION: "declared-session",
      REA_TEST_PASSWORD: "declared-password",
      REA_TEST_COOKIE: "declared-cookie",
    },
  );

  it.each(["", "ordinary", "\u0000", "\u0620", "\ufffd", "\ud83d\ude00"])(
    "preserves the UTF-8 digest of well-formed %j",
    (value) => {
      expect(secrets.fingerprint(value)).toEqual({
        value_state: "hashed",
        value_sha256: createHash("sha256").update(value).digest("hex"),
      });
    },
  );

  it.each([
    ["\ud800", "\ud801"],
    ["\ud800", "\ufffd"],
    ["\ud801", "\ufffd"],
    ["\udc00", "\ufffd"],
    ["prefix\ud800suffix", "prefix\ud801suffix"],
    ["\ud800\ud801", "\ud801\ud800"],
    ["\udc00\ud800", "\ud800\udc00"],
    // Bare UTF-16LE fallback would alias the UTF-8 bytes 00 d8 a0 00.
    ["\ud800\u00a0", "\u0000\u0620\u0000"],
  ])("distinguishes code-unit values %j and %j", (left, right) => {
    expect(secrets.fingerprint(left).value_sha256).not.toBe(
      secrets.fingerprint(right).value_sha256,
    );
  });

  it("fixes the v2 fallback byte contract to raw FF followed by UTF-16LE", () => {
    expect(secrets.fingerprint(String.fromCharCode(0xd800, 0x00a0))).toEqual({
      value_state: "hashed",
      value_sha256: createHash("sha256")
        .update(Buffer.from([0xff, 0x00, 0xd8, 0xa0, 0x00]))
        .digest("hex"),
    });
  });

  it("redacts a declared secret before encoding an unpaired suffix", () => {
    expect(secrets.fingerprint("declared-session\ud800")).toEqual({
      value_state: "redacted-secret",
      value_sha256: null,
    });
  });
});

describe("browserScenarioSchema", () => {
  it("accepts and normalizes a declared scenario", () => {
    const parsed = browserScenarioSchema.parse(baseScenario());
    expect(parsed.browser).toMatchObject({ mode: "launch", headless: true });
    expect(parsed.environment).toMatchObject({
      viewport: { width: 1_280, height: 720, device_scale_factor: 1 },
      locale: "en-US",
      timezone: "UTC",
      color_scheme: "light",
      reduced_motion: "reduce",
      service_workers: "block",
    });
    expect(parsed.capture).toEqual({
      limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
      network: {
        request_body: false,
        response_body: false,
        header_values: false,
      },
      after_each_step: ["screenshot", "url", "accessibility"],
      at_end: ["dom", "storage"],
      events: ["console", "page-errors", "network", "websockets"],
    });
    expect(parsed.capture.limits).toEqual(
      DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    );
  });

  it("allows callers to choose visible browsers and service workers", () => {
    const parsed = browserScenarioSchema.parse({
      ...baseScenario(),
      browser: { ...baseScenario().browser, headless: false },
      environment: { service_workers: "allow" },
    });
    expect(parsed.browser).toMatchObject({ headless: false });
    expect(parsed.environment.service_workers).toBe("allow");
  });

  it("accepts caller selected action timeouts without a fixed ceiling", () => {
    const input = baseScenario();
    input.actions[0] = { ...input.actions[0], timeout_ms: 120_000 } as never;
    input.actions[1] = {
      step_id: "pause",
      action: "wait_for_timeout",
      duration_ms: 120_001,
    } as never;
    const actions = browserScenarioSchema.parse(input).actions;
    expect(actions[0]).toMatchObject({ timeout_ms: 120_000 });
    expect(actions[1]).toMatchObject({ duration_ms: 120_001 });
  });

  it("does not accept the removed provider timeout configuration", () => {
    expect(
      browserScenarioSchema.safeParse({
        ...baseScenario(),
        limits: { max_duration_ms: 1 },
      }).success,
    ).toBe(false);
  });

  it("redacts overlapping secrets longest-first", () => {
    const scenario = browserScenarioSchema.parse(baseScenario());
    const secrets = resolveScenarioSecrets(scenario, {
      REA_TEST_SESSION: "prefix",
      REA_TEST_PASSWORD: "prefix-suffix",
      REA_TEST_COOKIE: "cookie",
    });
    expect(secrets.redact("prefix-suffix")).toBe("[REDACTED:login_input]");
  });

  it("does not leave a declared secret inside its redaction marker", () => {
    const secrets = resolveScenarioSecrets(
      browserScenarioSchema.parse({
        ...baseScenario(),
        secrets: [
          ...baseScenario().secrets,
          {
            secret_id: "password",
            environment_variable: "REA_TEST_SHORT_PASSWORD",
          },
        ],
      }),
      {
        REA_TEST_SESSION: "prefix",
        REA_TEST_PASSWORD: "prefix-suffix",
        REA_TEST_COOKIE: "cookie",
        REA_TEST_SHORT_PASSWORD: "pass",
      },
    );
    expect(secrets.redact("seen pass in the page")).toBe(
      "seen [REDACTED] in the page",
    );

    const bytes = resolveScenarioSecrets(
      browserScenarioSchema.parse({
        ...baseScenario(),
        secrets: [
          ...baseScenario().secrets,
          {
            secret_id: "password",
            environment_variable: "REA_TEST_LONG_SECRET",
          },
          { secret_id: "pin", environment_variable: "REA_TEST_PIN" },
        ],
      }),
      {
        REA_TEST_SESSION: "prefix",
        REA_TEST_PASSWORD: "prefix-suffix",
        REA_TEST_COOKIE: "cookie",
        REA_TEST_LONG_SECRET: "session-secret-value",
        REA_TEST_PIN: "pass",
      },
    ).redactBytes(Buffer.from("body session-secret-value tail"));
    expect(bytes.toString("utf8")).toBe("body [REDACTED] tail");
    expect(bytes.includes(Buffer.from("pass"))).toBe(false);
  });

  it("rejects unsupported actions", () => {
    const scenario = baseScenario();
    scenario.actions = [
      {
        step_id: "script",
        action: "evaluate",
        expression: "document.cookie",
      } as never,
    ];
    expect(browserScenarioSchema.safeParse(scenario).success).toBe(false);
  });

  it("accepts explicitly selected navigation and storage origins without an allowlist", () => {
    const scenario = baseScenario();
    scenario.actions[2] = {
      ...scenario.actions[2],
      destination: { url: "https://other.example.test/" },
    } as never;
    scenario.storage.local_storage[0]!.origin = "https://storage.example.test";
    expect(browserScenarioSchema.safeParse(scenario).success).toBe(true);
  });
});

describe("browserScenarioSchema secret declarations", () => {
  it("rejects missing and duplicate secret declarations but accepts redaction-only declarations", () => {
    const missing = baseScenario();
    missing.secrets = missing.secrets.filter(
      ({ secret_id }) => secret_id !== "login_input",
    );
    expect(browserScenarioSchema.safeParse(missing).success).toBe(false);

    const duplicate = baseScenario();
    duplicate.secrets.push({ ...duplicate.secrets[0]! });
    expect(browserScenarioSchema.safeParse(duplicate).success).toBe(false);

    const unused = baseScenario();
    const redactionOnly = {
      secret_id: "unused",
      environment_variable: "rea.test-unused",
    };
    unused.secrets.push(redactionOnly);
    expect(browserScenarioSchema.safeParse(unused).success).toBe(true);

    redactionOnly.environment_variable = "INVALID=NAME";
    expect(browserScenarioSchema.safeParse(unused).success).toBe(false);
    redactionOnly.environment_variable = "INVALID\0NAME";
    expect(browserScenarioSchema.safeParse(unused).success).toBe(false);
  });

  it("rejects removed replay and origin policy options", () => {
    for (const legacyField of [
      { request_replay: { mode: "disabled" } },
      { allowed_origins: ["https://app.example.test"] },
    ])
      expect(
        browserScenarioSchema.safeParse({
          ...baseScenario(),
          ...legacyField,
        }).success,
      ).toBe(false);
  });

  it("rejects raw secret-shaped action values", () => {
    const scenario = baseScenario();
    scenario.actions[0] = {
      ...scenario.actions[0],
      value: "literal-input",
    } as never;
    expect(browserScenarioSchema.safeParse(scenario).success).toBe(false);
  });

  it("preserves inline URL queries and fragments but rejects userinfo", () => {
    const credentialedUrl = new URL("https://app.example.test/");
    credentialedUrl.username = String.fromCodePoint(120);
    const invalid = baseScenario();
    invalid.start_url.url = credentialedUrl.href;
    expect(browserScenarioSchema.safeParse(invalid).success).toBe(false);

    const scenario = baseScenario();
    scenario.start_url.url = "https://app.example.test/?q=one&q=two#section";
    scenario.start_url.query = [];
    scenario.secrets = scenario.secrets.filter(
      ({ secret_id }) => secret_id !== "session",
    );
    const parsed = browserScenarioSchema.parse(scenario);
    expect(parsed.start_url.url).toBe(
      "https://app.example.test/?q=one&q=two#section",
    );
  });

  it("derives external ownership from CDP connection mode", () => {
    const scenario = {
      ...baseScenario(),
      browser: {
        mode: "connect",
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page-1",
      },
    };
    expect(browserScenarioSchema.safeParse(scenario).success).toBe(true);

    expect(
      browserScenarioSchema.safeParse({
        ...scenario,
        browser: { ...scenario.browser, cleanup: "close-browser" },
      }).success,
    ).toBe(false);
  });
});
