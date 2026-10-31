import type { Page, Route } from "playwright-core";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";

import { browserScenarioSchema } from "../domain/browserScenario.js";
import type { BrowserScenarioAction } from "../domain/browserScenarioValues.js";
import { BrowserScenarioSecrets } from "./BrowserScenarioSecrets.js";
import { responsePointerValue } from "./BrowserScenarioResponseValues.js";
import { performPlaywrightScenarioAction } from "./PlaywrightScenarioActions.js";

const ORIGIN = "https://app.example.test";

const scenario = (actions: readonly unknown[], secrets: unknown[] = []) =>
  browserScenarioSchema.parse({
    browser: { mode: "launch", executable_path: "/opt/chromium/chrome" },
    start_url: { url: `${ORIGIN}/` },
    actions,
    storage: { cookies: [], local_storage: [], session_storage: [] },
    secrets,
    capture: {},
  });

const requestStep = (fields: Record<string, unknown>) => ({
  step_id: "create",
  action: "request",
  method: "POST",
  path: "/api/folders",
  ...fields,
});

const issues = (actions: readonly unknown[], secrets: unknown[] = []) => {
  const parsed = browserScenarioSchema.safeParse({
    browser: { mode: "launch", executable_path: "/opt/chromium/chrome" },
    start_url: { url: `${ORIGIN}/` },
    actions,
    storage: { cookies: [], local_storage: [], session_storage: [] },
    secrets,
    capture: {},
  });
  return parsed.success
    ? []
    : parsed.error.issues.map((issue) => issue.message);
};

describe("request step schema", () => {
  it("refuses repeated header names, User-Agent and line breaks in literal values or prefixes", () => {
    const literal = (value: string) => ({ source: "literal", value });
    expect(
      issues([
        requestStep({
          headers: [
            { name: "X-A", value: literal("one") },
            { name: "x-a", value: literal("two") },
          ],
        }),
      ]),
    ).toContainEqual(expect.stringContaining("more than once"));
    expect(
      issues([
        requestStep({
          headers: [{ name: "User-Agent", value: literal("agent") }],
        }),
      ]),
    ).toContainEqual(expect.stringContaining("cannot set"));
    expect(
      issues([requestStep({ expected_status: [200, 303] })]),
    ).toContainEqual(expect.stringContaining("3xx"));
    for (const header of [
      { name: "X-A", value: literal("a\r\nX-B: b") },
      { name: "X-A", value: literal("a"), prefix: "Bearer\n" },
    ])
      expect(issues([requestStep({ headers: [header] })])).toContainEqual(
        expect.stringContaining("line breaks"),
      );
  });

  it("accepts a declared secret as a request header value", () => {
    const parsed = scenario(
      [
        requestStep({
          headers: [
            {
              name: "Authorization",
              value: { source: "secret", secret_id: "token" },
              prefix: "Bearer ",
            },
          ],
        }),
      ],
      [{ secret_id: "token", environment_variable: "APP_TOKEN" }],
    );
    expect(parsed.actions[0]).toMatchObject({
      action: "request",
      headers: [
        {
          name: "Authorization",
          value: { source: "secret", secret_id: "token" },
          prefix: "Bearer ",
        },
      ],
    });
  });

  it("refuses paths that leave the start origin", () => {
    for (const path of [
      "//evil.test/x",
      "/\\evil.test/x",
      "https://evil.test/",
      "/\n/[bad]",
    ])
      expect(issues([requestStep({ path })]).length, path).toBeGreaterThan(0);
  });

  it("refuses a body on GET, a header fetch cannot set and an undeclared secret", () => {
    expect(
      issues([requestStep({ method: "GET", json: { a: 1 } })]),
    ).toContainEqual(expect.stringContaining("cannot send a body"));
    expect(
      issues([
        requestStep({
          headers: [
            { name: "Cookie", value: { source: "literal", value: "a=b" } },
          ],
        }),
      ]),
    ).toContainEqual(expect.stringContaining("cannot set this header"));
    expect(
      issues([
        requestStep({
          headers: [
            { name: "X-Key", value: { source: "secret", secret_id: "key" } },
          ],
        }),
      ]),
    ).toContainEqual(expect.stringContaining("not declared"));
  });
});

interface FakeFetch {
  readonly url: string;
  readonly init: RequestInit;
}

const fakePage = (options: {
  readonly url?: string;
  /** The origin the page reports when the request is sent, if it moved after the check. */
  readonly sendingOrigin?: string;
  readonly cookies?: readonly { name: string; value: string }[];
  readonly cookieDelayMs?: number;
  readonly evaluateDelayMs?: number;
  readonly storage?: Record<string, string>;
}) => {
  const url = options.url ?? `${ORIGIN}/dashboard`;
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => options.storage?.[key] ?? null,
  });
  vi.stubGlobal("location", {
    origin: options.sendingOrigin ?? new URL(url).origin,
  });
  return {
    on: vi.fn(),
    off: vi.fn(),
    route: async () => {},
    unroute: async () => {},
    url: () => url,
    context: () => ({
      cookies: async () => {
        if (options.cookieDelayMs !== undefined)
          await new Promise((resolve) =>
            setTimeout(resolve, options.cookieDelayMs),
          );
        return options.cookies ?? [];
      },
    }),
    evaluate: async <Arg, Result>(
      fn: (arg: Arg) => Result | Promise<Result>,
      arg: Arg,
    ): Promise<Result> => {
      if (options.evaluateDelayMs !== undefined)
        await new Promise((resolve) =>
          setTimeout(resolve, options.evaluateDelayMs),
        );
      return fn(arg);
    },
  } as unknown as Page;
};

const stubFetch = (status: number, bodies: readonly string[] = []) => {
  const calls: FakeFetch[] = [];
  vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(bodies[calls.length - 1] ?? "{}", { status });
  });
  return calls;
};

const perform = async (
  page: Page,
  action: BrowserScenarioAction,
  secrets: BrowserScenarioSecrets,
  signal?: AbortSignal,
) =>
  performPlaywrightScenarioAction({
    page,
    action,
    secrets,
    startOrigin: ORIGIN,
    signal,
  });

const resolved = (parsed: ReturnType<typeof scenario>, environment = {}) => {
  const secrets = BrowserScenarioSecrets.resolve(parsed, environment);
  if (!secrets.ok) throw secrets.error;
  return secrets.value;
};

describe("request step execution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends requests with same-origin credentials", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([requestStep({})]);
    await perform(fakePage({}), parsed.actions[0]!, resolved(parsed));
    expect(calls).toHaveLength(1);
    expect(calls[0]!.init.credentials).toBe("same-origin");
  });

  it("refuses to run off the start origin, and fails on an unexpected status or a missing cookie", async () => {
    stubFetch(403);
    const parsed = scenario([requestStep({ expected_status: [200, 201] })]);
    const action = parsed.actions[0]!;
    await expect(
      perform(
        fakePage({ url: "https://other.test/" }),
        action,
        resolved(parsed),
      ),
    ).rejects.toThrow("start origin");
    await expect(
      perform(fakePage({}), action, resolved(parsed)),
    ).rejects.toThrow("answered 403; expected 200 or 201");
    const withCookie = scenario([
      requestStep({
        headers: [{ name: "X-T", value: { source: "cookie", name: "absent" } }],
      }),
    ]);
    await expect(
      perform(fakePage({}), withCookie.actions[0]!, resolved(withCookie)),
    ).rejects.toThrow("cookie absent is not set");
  });

  it("completes on any status when none is expected and reports fetch errors", async () => {
    stubFetch(500);
    const parsed = scenario([requestStep({})]);
    await expect(
      perform(fakePage({}), parsed.actions[0]!, resolved(parsed)),
    ).resolves.toBeUndefined();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    await expect(
      perform(fakePage({}), parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("Failed to fetch");
  });
});

describe("request dispatch boundary", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends nothing when browser evaluation starts after the absolute deadline", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([requestStep({ timeout_ms: 5 })]);
    await expect(
      perform(
        fakePage({ evaluateDelayMs: 30 }),
        parsed.actions[0]!,
        resolved(parsed),
      ),
    ).rejects.toThrow("ran out of time");
    expect(calls).toEqual([]);
  });

  it("guards dispatch after cancellation while evaluation was queued, and removes its route", async () => {
    const parsed = scenario([requestStep({})]);
    const controller = new AbortController();
    const page = fakePage({});
    let gate: ((route: Route) => Promise<void>) | undefined;
    vi.spyOn(page, "route").mockImplementation(async (_match, handler) => {
      gate = handler as typeof gate;
      return {
        dispose: async () => undefined,
        [Symbol.asyncDispose]: async () => undefined,
      };
    });
    const unroute = vi.spyOn(page, "unroute");
    const sent = vi.fn();
    vi.spyOn(page, "evaluate").mockImplementation(async (fn, arg) => {
      controller.abort("abandoned while queued");
      return (fn as (arg: unknown) => unknown)(arg);
    });
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      if (gate === undefined) throw new Error("Missing dispatch owner");
      await gate({
        request: () => ({
          method: () => init.method,
          postData: () => init.body ?? null,
        }),
        fallback: sent,
        abort: async () => {
          throw new Error("aborted at dispatch");
        },
      } as unknown as Route);
      return new Response("{}", { status: 200 });
    });
    await expect(
      performPlaywrightScenarioAction({
        page,
        action: parsed.actions[0]!,
        secrets: resolved(parsed),
        startOrigin: ORIGIN,
        signal: controller.signal,
      }),
    ).rejects.toThrow("aborted at dispatch");
    expect(sent).not.toHaveBeenCalled();
    expect(unroute).toHaveBeenCalledOnce();
  });
});

describe("request route cleanup", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves the primary request failure when removing its route also fails", async () => {
    const parsed = scenario([requestStep({})]);
    const page = fakePage({});
    const primary = new Error("page.evaluate: Target page has been closed");
    const cleanup = new Error("page.unroute: Target page has been closed");
    vi.spyOn(page, "evaluate").mockRejectedValue(primary);
    const unroute = vi.spyOn(page, "unroute").mockRejectedValue(cleanup);
    const failure = await perform(
      page,
      parsed.actions[0]!,
      resolved(parsed),
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).cause).toBe(primary);
    expect((failure as AggregateError).errors).toEqual([primary, cleanup]);
    expect(unroute).toHaveBeenCalledOnce();
  });

  it("preserves an unsuccessful page response when removing its route fails", async () => {
    stubFetch(503);
    const parsed = scenario([requestStep({ expected_status: [200] })]);
    const page = fakePage({});
    const cleanup = new Error("route cleanup failed");
    vi.spyOn(page, "unroute").mockRejectedValue(cleanup);
    const failure = await perform(
      page,
      parsed.actions[0]!,
      resolved(parsed),
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(AggregateError);
    expect((failure as AggregateError).errors[0].message).toContain(
      "answered 503",
    );
    expect((failure as AggregateError).errors[1]).toBe(cleanup);
    expect((failure as AggregateError).cause).toBe(
      (failure as AggregateError).errors[0],
    );
  });

  it("publishes no saved values if route cleanup fails after a successful response", async () => {
    stubFetch(200, [JSON.stringify({ id: "created" })]);
    const parsed = scenario([
      requestStep({ save: [{ name: "id", json_pointer: "/id" }] }),
    ]);
    const page = fakePage({});
    const secrets = resolved(parsed);
    const save = vi.spyOn(secrets, "save");
    const ready = vi.spyOn(secrets, "markResponseSecretsReady");
    const cleanup = new Error("route cleanup failed");
    vi.spyOn(page, "unroute").mockRejectedValue(cleanup);
    await expect(perform(page, parsed.actions[0]!, secrets)).rejects.toBe(
      cleanup,
    );
    expect(save).not.toHaveBeenCalled();
    expect(ready).not.toHaveBeenCalled();
  });
});

describe("request page boundaries", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("refuses foreign-origin storage before reading its value", async () => {
    const calls = stubFetch(200);
    const read = vi.fn();
    const parsed = scenario([
      requestStep({
        headers: [
          {
            name: "Authorization",
            value: { source: "local_storage", key: "token" },
          },
        ],
      }),
    ]);
    const page = fakePage({ sendingOrigin: "https://other.test" });
    vi.stubGlobal("localStorage", { getItem: read });
    await expect(
      perform(page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("local storage");
    expect(read).not.toHaveBeenCalled();
    expect(calls).toEqual([]);
  });

  it("drains response chunks and releases the reader without materializing the body", async () => {
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: new Uint8Array(8) })
      .mockResolvedValueOnce({ done: true });
    const releaseLock = vi.fn();
    const arrayBuffer = vi.fn();
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      type: "basic",
      body: { getReader: () => ({ read, releaseLock }) },
      arrayBuffer,
    }));
    const parsed = scenario([requestStep({})]);
    await perform(fakePage({}), parsed.actions[0]!, resolved(parsed));
    expect(read).toHaveBeenCalledTimes(2);
    expect(releaseLock).toHaveBeenCalledOnce();
    expect(arrayBuffer).not.toHaveBeenCalled();
  });
});

describe("request step confinement", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("follows no redirect and sends nothing once the page has left the start origin", async () => {
    const calls: FakeFetch[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return {
        type: "opaqueredirect",
        status: 0,
        arrayBuffer: async () => new ArrayBuffer(0),
      };
    });
    const parsed = scenario([requestStep({})]);
    const onOpaqueRedirect = vi.fn();
    await expect(
      performPlaywrightScenarioAction({
        page: fakePage({}),
        action: parsed.actions[0]!,
        secrets: resolved(parsed),
        startOrigin: ORIGIN,
        onOpaqueRedirect,
      }),
    ).rejects.toThrow("request steps do not follow");
    expect(onOpaqueRedirect).toHaveBeenCalledOnce();
    expect(calls[0]!.init.redirect).toBe("manual");
    await expect(
      perform(
        fakePage({ sendingOrigin: "https://other.test" }),
        parsed.actions[0]!,
        resolved(parsed),
      ),
    ).rejects.toThrow("the page moved");
    expect(calls).toHaveLength(1);
  });

  it("sends nothing when its time runs out while header values are read, or the step is cancelled", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([
      requestStep({
        timeout_ms: 5,
        headers: [{ name: "X-T", value: { source: "cookie", name: "t" } }],
      }),
    ]);
    const cookies = [{ name: "t", value: "token-value-1" }];
    await expect(
      perform(
        fakePage({ cookies, cookieDelayMs: 30 }),
        parsed.actions[0]!,
        resolved(parsed),
      ),
    ).rejects.toThrow("ran out of time");
    const cancelled = new AbortController();
    cancelled.abort();
    await expect(
      performPlaywrightScenarioAction({
        page: fakePage({ cookies }),
        action: scenario([requestStep({})]).actions[0]!,
        secrets: resolved(parsed),
        startOrigin: ORIGIN,
        signal: cancelled.signal,
      }),
    ).rejects.toThrow("ran out of time");
    expect(calls).toEqual([]);
  });

  it("appends query entries after the path's literal query without re-encoding it", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([
      requestStep({
        path: "/api/items?flag&a=b%20c&s=x;y",
        query: [{ name: "q", value: { source: "literal", value: "a b" } }],
      }),
    ]);
    await perform(fakePage({}), parsed.actions[0]!, resolved(parsed));
    expect(calls[0]!.url).toBe(
      `${ORIGIN}/api/items?flag&a=b%20c&s=x;y&q=a%20b`,
    );
    for (const [path, sent] of [
      ["/api/items?", "/api/items?q=1"],
      ["/api/items#", "/api/items?q=1"],
      ["/api/items?a=1&", "/api/items?a=1&q=1"],
      ["/api/items?a=1#top", "/api/items?a=1&q=1"],
    ] as const) {
      const edge = scenario([
        requestStep({
          path,
          query: [{ name: "q", value: { source: "literal", value: "1" } }],
        }),
      ]);
      await perform(fakePage({}), edge.actions[0]!, resolved(edge));
      expect(calls.at(-1)!.url, path).toBe(`${ORIGIN}${sent}`);
    }
  });
});

describe("request page value admission", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("preserves exact local storage pointer values and refuses lossy numbers before dispatch", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([
      requestStep({
        headers: [
          {
            name: "X-Account",
            value: {
              source: "local_storage",
              key: "auth",
              json_pointer: "/id",
            },
          },
        ],
      }),
    ]);
    for (const literal of ["9007199254740993", "1e400", "-0"]) {
      await expect(
        perform(
          fakePage({ storage: { auth: `{"id":${literal}}` } }),
          parsed.actions[0]!,
          resolved(parsed),
        ),
      ).rejects.toThrow("cannot be read exactly");
    }
    expect(calls).toEqual([]);
    for (const [literal, expected] of [
      ["9007199254740991", "9007199254740991"],
      ['"9007199254740993"', "9007199254740993"],
      ["42", "42"],
    ]) {
      await perform(
        fakePage({
          storage: { auth: `{"id":${literal},"unselected":9007199254740993}` },
        }),
        parsed.actions[0]!,
        resolved(parsed),
      );
      expect(calls.at(-1)!.init.headers).toEqual([["X-Account", expected]]);
    }
  });

  it("refuses page values a header cannot carry, and stored values it cannot read", async () => {
    const calls = stubFetch(200);
    const header = (value: Record<string, unknown>) =>
      scenario([requestStep({ headers: [{ name: "X-T", value }] })]);
    const cookie = header({ source: "cookie", name: "t" });
    await expect(
      perform(
        fakePage({ cookies: [{ name: "t", value: "a\r\nX-B: b" }] }),
        cookie.actions[0]!,
        resolved(cookie),
      ),
    ).rejects.toThrow("cannot carry");
    for (const [storage, pointer, message] of [
      [{}, undefined, "local storage has no auth"],
      [{ auth: "not json" }, "/token", "is not JSON"],
      [{ auth: '{"other":1}' }, "/token", "no string or number at /token"],
    ] as const) {
      const stored = header({
        source: "local_storage",
        key: "auth",
        ...(pointer === undefined ? {} : { json_pointer: pointer }),
      });
      await expect(
        perform(fakePage({ storage }), stored.actions[0]!, resolved(stored)),
      ).rejects.toThrow(message);
    }
    expect(calls).toEqual([]);
    const numeric = header({
      source: "local_storage",
      key: "auth",
      json_pointer: "/org",
    });
    await perform(
      fakePage({ storage: { auth: '{"org":42}' } }),
      numeric.actions[0]!,
      resolved(numeric),
    );
    expect(calls[0]!.init.headers).toEqual([["X-T", "42"]]);
  });
});

describe("page value redaction", () => {
  const secrets = () => resolved(scenario([requestStep({})]));

  it("keeps every admitted value redacted, even under a repeated or colliding label", () => {
    const held = secrets();
    held.admitPageValue("s.x-a", "first-secret-AAAA");
    held.admitPageValue("s.x-a", "second-secret-BBBB");
    held.admitPageValue("a.b.c", "third-secret-CCCC");
    held.admitPageValue("a.b.c", "fourth-secret-DDDD");
    const text = held.redact(
      "first-secret-AAAA second-secret-BBBB third-secret-CCCC fourth-secret-DDDD",
    );
    for (const value of ["AAAA", "BBBB", "CCCC", "DDDD"])
      expect(text).not.toContain(value);
  });

  it("keeps a value's first marker when later steps read it again", () => {
    const held = secrets();
    held.admitPageValue("create-1.X-CSRFToken", "csrf-token-value");
    held.admitPageValue("create-2.X-CSRFToken", "csrf-token-value");
    expect(held.redact("csrf-token-value")).toBe(
      "[REDACTED:page:create-1.X-CSRFToken]",
    );
  });

  it("redacts the value fetch sends when the stored one has surrounding spaces", () => {
    const held = secrets();
    held.admitPageValue("s.X-Tok", " padded-token-4f9e2a\t");
    expect(held.redact("X-Tok: padded-token-4f9e2a")).not.toContain(
      "padded-token-4f9e2a",
    );
  });

  it("does not redact values too short to tell from ids and ports", () => {
    const held = secrets();
    held.admitPageValue("s.X-Org-Id", "1");
    held.admitPageValue("s.X-Port", "3000");
    const text = "http://127.0.0.1:3000/api/items/12?page=1";
    expect(held.redact(text)).toBe(text);
  });
});

const savedValue = (name: string) => ({ source: "saved", name });
const saveIdStep = (stepId: string, name: string) =>
  requestStep({
    step_id: stepId,
    save: [{ name, json_pointer: "/id" }],
  });
const clickSavingItem = (name: string) => ({
  step_id: "save-item",
  action: "click",
  locator: { kind: "role", role: "button", name: "Save" },
  save_response: {
    method: "POST",
    path: "/api/items",
    save: [{ name, json_pointer: "/id" }],
  },
});
const gotoStep = (url: string) => ({
  step_id: "open",
  action: "goto",
  destination: { url },
  wait_until: "load",
});

describe("saved value schema", () => {
  it("refuses a saved value no earlier step saves, wherever a step sends it", () => {
    const sendsItem = requestStep({
      step_id: "edit",
      method: "PUT",
      path: "/api/items/{saved:item}",
    });
    expect(issues([sendsItem])).toEqual([
      "Step edit sends saved value item, which no earlier step saves",
    ]);
    expect(issues([sendsItem, saveIdStep("create", "item")])).toContainEqual(
      expect.stringContaining("which no earlier step saves"),
    );
    expect(issues([saveIdStep("create", "item"), sendsItem])).toEqual([]);
    expect(issues([clickSavingItem("item"), sendsItem])).toEqual([]);
    for (const step of [
      gotoStep(`${ORIGIN}/items/{saved:item}`),
      gotoStep(`${ORIGIN}/items/%7Bsaved%3Aitem%7D`),
      requestStep({ path: "/api/items?parent={saved:item}" }),
      requestStep({ json: { list: [{ parent: "{saved:item}" }] } }),
      requestStep({ json: { note: "Copied from {saved:item}" } }),
      requestStep({ headers: [{ name: "X-Item", value: savedValue("item") }] }),
      requestStep({
        headers: [
          {
            name: "Authorization",
            value: {
              source: "basic_credentials",
              parts: [savedValue("item"), { source: "literal", value: "x" }],
            },
          },
        ],
      }),
    ])
      expect(issues([step]), JSON.stringify(step)).toContainEqual(
        expect.stringContaining("sends saved value item"),
      );
  });

  it("reads only `{saved:name}` as written in a JSON string, not its encoded spelling", () => {
    expect(
      issues([requestStep({ json: { note: "%7Bsaved:item%7D" } })]),
    ).toEqual([]);
  });

  it("sends other braces as written", () => {
    expect(
      issues([
        gotoStep(`${ORIGIN}/search/{q}`),
        requestStep({ path: "/api/items/{id}", json: { name: "{draft}" } }),
      ]),
    ).toEqual([]);
  });
});

describe("saved value schema: credentials and response paths", () => {
  it("refuses a literal Basic password, which Evidence would record as written", () => {
    const basic = (password: unknown) =>
      requestStep({
        headers: [
          {
            name: "Authorization",
            value: {
              source: "basic_credentials",
              parts: [{ source: "literal", value: "admin" }, password],
            },
          },
        ],
      });
    expect(
      issues([basic({ source: "literal", value: "hunter2" })]),
    ).toContainEqual(expect.stringContaining("not a literal"));
    expect(issues([basic({ source: "literal", value: "" })])).toEqual([]);
  });

  it("builds Basic credentials from page values and refuses undeclared secret parts", () => {
    const basic = (username: unknown, password: unknown) =>
      requestStep({
        headers: [
          {
            name: "Authorization",
            value: { source: "basic_credentials", parts: [username, password] },
            prefix: "Basic ",
          },
        ],
      });
    expect(
      issues([
        basic(
          { source: "local_storage", key: "user", json_pointer: "/name" },
          { source: "cookie", name: "pw" },
        ),
      ]),
    ).toEqual([]);
    expect(
      issues([
        basic(
          { source: "literal", value: "admin" },
          { source: "secret", secret_id: "password" },
        ),
      ]),
    ).toContainEqual(expect.stringContaining("not declared"));
    const literal = { source: "literal", value: "admin" };
    expect(
      issues([
        requestStep({
          headers: [
            {
              name: "Authorization",
              value: { source: "basic_credentials", parts: [literal] },
            },
          ],
        }),
      ]).length,
    ).toBeGreaterThan(0);
  });

  it("requires a save_response to name a same-origin path and something to save", () => {
    const click = (saveResponse: unknown) => ({
      ...clickSavingItem("item"),
      save_response: saveResponse,
    });
    for (const path of ["//evil.test/api", "api/items", "https://evil.test/"])
      expect(
        issues([
          click({
            method: "POST",
            path,
            save: [{ name: "item", json_pointer: "/id" }],
          }),
        ]).length,
        path,
      ).toBeGreaterThan(0);
    expect(
      issues([click({ method: "POST", path: "/api/items", save: [] })]).length,
    ).toBeGreaterThan(0);
  });
});

describe("saved value execution", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("sends saved ids in the path and body with their saved type, and a saved secret only redacted", async () => {
    const calls = stubFetch(200, [
      '{"id":42,"session":{"token":"session-token-9f3e"}}',
    ]);
    const parsed = scenario([
      requestStep({
        json: { title: "Scratch folder 1" },
        save: [
          { name: "folder", json_pointer: "/id" },
          { name: "token", json_pointer: "/session/token", secret: true },
        ],
      }),
      requestStep({
        step_id: "move",
        method: "PUT",
        path: "/api/folders/{saved:folder}",
        json: {
          title: "Moved",
          parent: "{saved:folder}",
          note: "Moved into {saved:folder}",
        },
        headers: [
          {
            name: "Authorization",
            value: { source: "saved", name: "token" },
            prefix: "Bearer ",
          },
        ],
      }),
    ]);
    const secrets = resolved(parsed);
    const page = fakePage({});
    for (const action of parsed.actions) await perform(page, action, secrets);
    expect(calls[1]).toEqual({
      url: `${ORIGIN}/api/folders/42`,
      init: expect.objectContaining({
        method: "PUT",
        headers: [
          ["Authorization", "Bearer session-token-9f3e"],
          ["content-type", "application/json"],
        ],
        body: '{"title":"Moved","parent":42,"note":"Moved into 42"}',
      }),
    });
    expect(secrets.redact("folder 42 with session-token-9f3e")).toBe(
      "folder 42 with [REDACTED:page:create.token]",
    );
  });
});

describe("saved value credentials and limits", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("redacts Basic credentials and secret saves however short", async () => {
    stubFetch(200, ['{"pin":"x7"}']);
    const parsed = scenario(
      [
        requestStep({
          headers: [
            {
              name: "X-Auth",
              value: {
                source: "basic_credentials",
                parts: [
                  { source: "secret", secret_id: "user" },
                  { source: "secret", secret_id: "password" },
                ],
              },
            },
          ],
          save: [{ name: "pin", json_pointer: "/pin", secret: true }],
        }),
      ],
      [
        { secret_id: "user", environment_variable: "APP_USER" },
        { secret_id: "password", environment_variable: "APP_PASSWORD" },
      ],
    );
    const secrets = resolved(parsed, { APP_USER: "a", APP_PASSWORD: "b" });
    await perform(fakePage({}), parsed.actions[0]!, secrets);
    const encoded = Buffer.from("a:b").toString("base64");
    const redacted = secrets.redact(`X-Auth: ${encoded} pin x7`);
    expect(redacted).not.toContain(encoded);
    expect(redacted).not.toContain("x7");
  });

  it("saves no integer JSON parsing would round, so no later step names another object", async () => {
    stubFetch(201, ['{"id":9007199254740993}']);
    const parsed = scenario([
      requestStep({ save: [{ name: "folder", json_pointer: "/id" }] }),
    ]);
    const secrets = resolved(parsed);
    await expect(
      perform(fakePage({}), parsed.actions[0]!, secrets),
    ).rejects.toThrow("cannot be saved exactly");
    expect(() => secrets.savedValue("folder")).toThrow();
  });

  it("sends a JSON string that spells a placeholder percent-encoded as written", async () => {
    const calls = stubFetch(200, ['{"id":7}']);
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      requestStep({
        step_id: "note",
        json: { note: "%7Bsaved:item%7D", id: "{saved:item}" },
      }),
    ]);
    const secrets = resolved(parsed);
    for (const action of parsed.actions)
      await perform(fakePage({}), action, secrets);
    expect(calls[1]!.init.body).toBe('{"note":"%7Bsaved:item%7D","id":7}');
  });

  it("stops reading a response to save from once it passes the limit", async () => {
    const chunk = new Uint8Array(3_000_000).fill(97);
    const read = vi
      .fn()
      .mockResolvedValueOnce({ done: false, value: chunk })
      .mockResolvedValueOnce({ done: false, value: chunk })
      .mockResolvedValueOnce({ done: false, value: chunk })
      .mockResolvedValueOnce({ done: true });
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal("fetch", async () => ({
      status: 200,
      type: "basic",
      body: { getReader: () => ({ read, cancel, releaseLock: vi.fn() }) },
    }));
    const parsed = scenario([
      requestStep({ save: [{ name: "folder", json_pointer: "/id" }] }),
    ]);
    await expect(
      perform(fakePage({}), parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("too large to save values from");
    expect(read).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledOnce();
  });

  it("fails a step whose response holds no value to save", async () => {
    stubFetch(200, ['{"items":[]}', "not json"]);
    const parsed = scenario([
      requestStep({ save: [{ name: "folder", json_pointer: "/id" }] }),
    ]);
    const secrets = resolved(parsed);
    await expect(
      perform(fakePage({}), parsed.actions[0]!, secrets),
    ).rejects.toThrow("no string or number at /id to save as folder");
    await expect(
      perform(fakePage({}), parsed.actions[0]!, secrets),
    ).rejects.toThrow("is not JSON");
    expect(() => secrets.savedValue("folder")).toThrow();
  });

  it("encodes Basic credentials read from local storage and a cookie, and redacts both parts", async () => {
    const calls = stubFetch(200);
    const parsed = scenario([
      requestStep({
        headers: [
          {
            name: "Authorization",
            value: {
              source: "basic_credentials",
              parts: [
                {
                  source: "local_storage",
                  key: "user",
                  json_pointer: "/name",
                },
                { source: "cookie", name: "api_key" },
              ],
            },
            prefix: "Basic ",
          },
        ],
      }),
    ]);
    const secrets = resolved(parsed);
    await perform(
      fakePage({
        cookies: [{ name: "api_key", value: "cookie-key-5d1c" }],
        storage: { user: JSON.stringify({ name: "operator-7" }) },
      }),
      parsed.actions[0]!,
      secrets,
    );
    const encoded = Buffer.from("operator-7:cookie-key-5d1c").toString(
      "base64",
    );
    expect(calls[0]!.init.headers).toEqual([
      ["Authorization", `Basic ${encoded}`],
    ]);
    const redacted = secrets.redact(`${encoded} operator-7 cookie-key-5d1c`);
    for (const value of [encoded, "operator-7", "cookie-key-5d1c"])
      expect(redacted).not.toContain(value);
  });
});

describe("saved response JSON pointers", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("does not coerce a terminal newline in an array index", () => {
    expect(responsePointerValue({ items: ["record-7"] }, "/items/0\n")).toBe(
      undefined,
    );
  });

  it.each(["length", "01", "-"])(
    "refuses the non-index array token %s",
    async (token) => {
      stubFetch(201, ['{"items":["record-7","record-8"]}']);
      const parsed = scenario([
        requestStep({
          save: [{ name: "item", json_pointer: `/items/${token}` }],
        }),
      ]);
      const secrets = resolved(parsed);
      await expect(
        perform(fakePage({}), parsed.actions[0]!, secrets),
      ).rejects.toThrow("has no string or number");
      expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    },
  );

  it.each([
    ["/items/0", "record-7"],
    ["/length", 12],
    ["/01", "object-key"],
    ["/a~1b/~0key", "escaped-key"],
  ])("preserves JSON member identity at %s", async (pointer, expected) => {
    stubFetch(201, [
      '{"items":["record-7"],"length":12,"01":"object-key","a/b":{"~key":"escaped-key"}}',
    ]);
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: pointer }] }),
    ]);
    const secrets = resolved(parsed);
    await perform(fakePage({}), parsed.actions[0]!, secrets);
    expect(secrets.savedValue("item")).toBe(expected);
  });
});

describe("saved numbers JSON cannot spell back", () => {
  it.each([
    ["0", 0],
    ["0.0", 0],
    ["1.5", 1.5],
    ["12.50", 12.5],
    ["1E2", 100],
    ["0.1", 0.1],
  ])(
    "preserves an equivalent JSON decimal spelling (%s)",
    async (number, kept) => {
      stubFetch(201, [`{"id":${number}}`]);
      const parsed = scenario([
        requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      ]);
      const secrets = resolved(parsed);
      await perform(fakePage({}), parsed.actions[0]!, secrets);
      expect(secrets.savedValue("item")).toBe(kept);
    },
  );
  it.each(["-0", "1e-400", "-1e-400", "1.0000000000000000001"])(
    "refuses a saved numeric identity that loses precision during parsing: %s",
    async (number) => {
      stubFetch(201, [`{"id":${number}}`]);
      const parsed = scenario([
        requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      ]);
      const secrets = resolved(parsed);
      await expect(
        perform(fakePage({}), parsed.actions[0]!, secrets),
      ).rejects.toThrow("cannot be saved exactly");
      expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    },
  );

  it("keeps an exact saved field when an unrelated response number is inexact", async () => {
    stubFetch(201, ['{"id":"record-7","unrelated":1e-400}']);
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
    ]);
    const secrets = resolved(parsed);
    await perform(fakePage({}), parsed.actions[0]!, secrets);
    expect(secrets.savedValue("item")).toBe("record-7");
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each(["1e400", "-1e400"])(
    "saves no number JSON cannot spell back (%s)",
    async (number) => {
      stubFetch(201, [`{"id":${number}}`]);
      const parsed = scenario([
        requestStep({ save: [{ name: "folder", json_pointer: "/id" }] }),
      ]);
      const secrets = resolved(parsed);
      await expect(
        perform(fakePage({}), parsed.actions[0]!, secrets),
      ).rejects.toThrow("not finite");
      expect(() => secrets.savedValue("folder")).toThrow();
    },
  );
});

describe("values a URL path or Basic header cannot carry", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("fails a Basic header whose username holds a colon, before sending it", async () => {
    const calls = stubFetch(200, ["{}"]);
    const parsed = scenario(
      [
        requestStep({
          headers: [
            {
              name: "Authorization",
              value: {
                source: "basic_credentials",
                parts: [
                  { source: "secret", secret_id: "user" },
                  { source: "secret", secret_id: "password" },
                ],
              },
            },
          ],
        }),
      ],
      [
        { secret_id: "user", environment_variable: "APP_USER" },
        { secret_id: "password", environment_variable: "APP_PASSWORD" },
      ],
    );
    const secrets = resolved(parsed, {
      APP_USER: "ops:admin",
      APP_PASSWORD: "b",
    });
    await expect(
      perform(fakePage({}), parsed.actions[0]!, secrets),
    ).rejects.toThrow("Basic username with a colon");
    expect(calls).toHaveLength(0);
  });

  it.each([".", ".."])(
    "fails a step whose saved %s fills a whole path segment, which the URL would drop",
    async (dots) => {
      const parsed = scenario([
        requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
        {
          step_id: "open",
          action: "goto",
          destination: { url: `${ORIGIN}/items/{saved:item}/edit` },
          wait_until: "load",
        },
        requestStep({ step_id: "edit", path: "/api/items/{saved:item}" }),
      ]);
      const secrets = resolved(parsed);
      secrets.save("create.item", "item", dots, false);
      const goto = vi.fn(async () => null);
      await expect(
        perform({ goto } as unknown as Page, parsed.actions[1]!, secrets),
      ).rejects.toThrow("dot segment");
      expect(goto).not.toHaveBeenCalled();
      await expect(
        perform(fakePage({}), parsed.actions[2]!, secrets),
      ).rejects.toThrow("dot segment");
    },
  );

  it.each([
    ["/api/items/{saved:item}.", `${ORIGIN}/items/{saved:item}.`],
    ["/api/items/%2e{saved:item}", `${ORIGIN}/items/%2E{saved:item}`],
    ["/safe\\{saved:item}.", `${ORIGIN}/safe\\{saved:item}.`],
    ["/safe\\%2e{saved:item}", `${ORIGIN}/safe\\%2e{saved:item}`],
  ])(
    "fails a step whose saved . and the text beside it make a dot segment (%s)",
    async (path, url) => {
      const parsed = scenario([
        requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
        {
          step_id: "open",
          action: "goto",
          destination: { url },
          wait_until: "load",
        },
        requestStep({ step_id: "edit", path }),
      ]);
      const secrets = resolved(parsed);
      secrets.save("create.item", "item", ".", false);
      const goto = vi.fn(async () => null);
      await expect(
        perform({ goto } as unknown as Page, parsed.actions[1]!, secrets),
      ).rejects.toThrow("dot segment");
      expect(goto).not.toHaveBeenCalled();
      await expect(
        perform(fakePage({}), parsed.actions[2]!, secrets),
      ).rejects.toThrow("dot segment");
    },
  );

  it("sends dots that are part of a segment or of the query", async () => {
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      {
        step_id: "open",
        action: "goto",
        destination: { url: `${ORIGIN}/items/v{saved:item}?at={saved:item}` },
        wait_until: "load",
      },
    ]);
    const secrets = resolved(parsed);
    secrets.save("create.item", "item", "..", false);
    const goto = vi.fn(async () => null);
    await perform({ goto } as unknown as Page, parsed.actions[1]!, secrets);
    expect(goto).toHaveBeenCalledWith(
      `${ORIGIN}/items/v..?at=..`,
      expect.anything(),
    );
  });
});

describe("bounded derived credentials", () => {
  it("refuses over-budget Unicode spellings before building encoded copies", () => {
    const secrets = resolved(scenario([requestStep({})]));
    const encode = vi.spyOn(globalThis, "encodeURIComponent");
    try {
      expect(() =>
        secrets.save("create.token", "token", "私".repeat(1_000_000), true),
      ).toThrow("more than 4000000 characters");
      expect(encode).not.toHaveBeenCalled();
      expect(() => secrets.savedValue("token")).toThrow(
        "No earlier step saved",
      );
    } finally {
      encode.mockRestore();
    }
  });
  it("charges distinct Basic credentials while admitting repeated identical spellings once", () => {
    const secrets = resolved(scenario([requestStep({})]));
    const password = "x".repeat(300_000);
    secrets.save("create.token", "token", password, false);
    const first = secrets.basicCredential("login.auth", "operator-0", password);
    for (let index = 0; index < 8; index++)
      expect(
        secrets.basicCredential("again.auth", "operator-0", password),
      ).toBe(first);
    expect(() => {
      for (let index = 1; index < 16; index++)
        secrets.basicCredential(
          `s${String(index)}.auth`,
          `operator-${String(index)}`,
          password,
        );
    }).toThrow("more than 4000000 characters");
    expect(secrets.savedValue("token")).toBe(password);
    expect(secrets.redact(first)).not.toContain(first);
  });

  it("refuses excessive base64 expansion before allocating the credential buffer", () => {
    const secrets = resolved(scenario([requestStep({})]));
    const allocate = vi.spyOn(Buffer, "allocUnsafe");
    try {
      expect(() =>
        secrets.basicCredential("login.auth", "u", "x".repeat(3_000_001)),
      ).toThrow("encoded form exceeds");
      expect(allocate).not.toHaveBeenCalled();
    } finally {
      allocate.mockRestore();
    }
  });
});

describe("saved value retention", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("charges repeated identical secret saves only for retained values", () => {
    const secrets = resolved(scenario([requestStep({})]));
    const token = "s".repeat(1_000_000);
    for (let index = 0; index < 8; index++)
      secrets.save(`step${String(index)}.token`, "token", token, true);
    expect(secrets.savedValue("token")).toBe(token);
    expect(secrets.redact(token)).not.toContain(token);
  });

  it("charges trimmed secret spellings before changing either saved or redaction state", () => {
    const secrets = resolved(scenario([requestStep({})]));
    secrets.save("seed.fill", "fill", "x".repeat(3_999_000), false);
    const trimmed = "a".repeat(198);
    expect(() =>
      secrets.save("step.padded", "padded", ` ${trimmed} `, true),
    ).toThrow("more than 4000000 characters of saved values");
    expect(() => secrets.savedValue("padded")).toThrow("No earlier step saved");
    expect(secrets.redact(trimmed)).toBe(trimmed);
    expect(String(secrets.savedValue("fill"))).toHaveLength(3_999_000);
  });

  it("refuses a new saved name that would keep more than the limit, before keeping it", () => {
    const secrets = resolved(scenario([requestStep({})]));
    secrets.save("a.first", "first", "x".repeat(3_000_000), false);
    expect(() =>
      secrets.save("b.second", "second", "y".repeat(1_500_000), false),
    ).toThrow("more than 4000000 characters of saved values");
    expect(() => secrets.savedValue("second")).toThrow("No earlier step saved");
    // A later save of the same name replaces its value rather than adding to it.
    secrets.save("c.first", "first", "z".repeat(3_500_000), false);
    expect(String(secrets.savedValue("first"))).toHaveLength(3_500_000);
  });

  it("counts the redaction spellings a secret save keeps", () => {
    const plain = resolved(scenario([requestStep({})]));
    plain.save("a.token", "token", "t".repeat(2_500_000), false);
    const secret = resolved(scenario([requestStep({})]));
    expect(() =>
      secret.save("a.token", "token", "t".repeat(2_500_000), true),
    ).toThrow("more than 4000000 characters of saved values");
  });

  it("fails the step that would save past the limit", async () => {
    stubFetch(201, [`{"id":"${"y".repeat(200_000)}"}`]);
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
    ]);
    const secrets = resolved(parsed);
    secrets.save("seed.big", "big", "x".repeat(3_900_000), false);
    await expect(
      perform(fakePage({}), parsed.actions[0]!, secrets),
    ).rejects.toThrow(
      "Step create: item cannot be saved: the scenario would keep more than",
    );
  });
});

describe("goto placeholders", () => {
  it("fills a goto destination's placeholders, percent-encoded", async () => {
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      {
        step_id: "open",
        action: "goto",
        destination: { url: `${ORIGIN}/items/{saved:item}/edit` },
        wait_until: "load",
      },
    ]);
    const secrets = resolved(parsed);
    secrets.save("create.item", "item", "a b/c", false);
    const goto = vi.fn(async () => null);
    await perform({ goto } as unknown as Page, parsed.actions[1]!, secrets);
    expect(goto).toHaveBeenCalledWith(
      `${ORIGIN}/items/a%20b%2Fc/edit`,
      expect.anything(),
    );
  });

  it("keeps a structured query value that spells a placeholder as written", async () => {
    const parsed = scenario([
      requestStep({ save: [{ name: "item", json_pointer: "/id" }] }),
      {
        step_id: "open",
        action: "goto",
        destination: {
          url: `${ORIGIN}/items/{saved:item}`,
          query: [
            {
              name: "note",
              value: { source: "literal", value: "{saved:item}" },
            },
          ],
        },
        wait_until: "load",
      },
    ]);
    const secrets = resolved(parsed);
    secrets.save("create.item", "item", "7", false);
    const goto = vi.fn(async () => null);
    await perform({ goto } as unknown as Page, parsed.actions[1]!, secrets);
    const [address] = goto.mock.calls[0] as unknown as [string];
    const url = new URL(address);
    expect(url.pathname).toBe("/items/7");
    expect(url.searchParams.get("note")).toBe("{saved:item}");
  });
});

interface FakeResponse {
  readonly method: string;
  readonly url: string;
  readonly status: number;
  readonly body: string;
  /** A request already running when the step began, such as an earlier autosave. */
  readonly earlier?: boolean;
  /** The body size the browser received, when it differs from the body's. */
  readonly size?: number;
  readonly encoding?: string;
  /** The Content-Length the response declares. */
  readonly length?: string;
  /** A body still arriving: the text resolves with it. */
  readonly late?: Promise<string>;
}

/**
 * A page whose click starts the given requests, emitting each that did not start earlier to request listeners, and
 * answers them in order; waitForResponse resolves with the first answer it names once the click acted.
 */
const uiPage = (responses: readonly FakeResponse[], clickFails = false) => {
  const order: string[] = [];
  const reads = { count: 0 };
  const listeners = new Set<(request: unknown) => void>();
  let acted: () => void = () => undefined;
  const clicked = new Promise<void>((resolve) => {
    acted = resolve;
  });
  const answers = responses.map((response) => {
    const request = {
      method: () => response.method,
      url: () => response.url,
      sizes: async () => ({
        responseBodySize: response.size ?? response.body.length,
      }),
    };
    return {
      response,
      request,
      answer: {
        request: () => request,
        url: () => response.url,
        status: () => response.status,
        headers: () => ({
          ...(response.encoding === undefined
            ? {}
            : { "content-encoding": response.encoding }),
          ...(response.length === undefined
            ? {}
            : { "content-length": response.length }),
        }),
        body: async () => {
          reads.count += 1;
          return Buffer.from(await (response.late ?? response.body));
        },
      },
    };
  });
  const page = {
    on: (_event: string, listener: (request: unknown) => void) =>
      listeners.add(listener),
    off: (_event: string, listener: (request: unknown) => void) =>
      listeners.delete(listener),
    getByRole: () => ({
      click: async () => {
        order.push("click");
        if (clickFails) throw new Error("Element is not attached");
        for (const { response, request } of answers)
          if (response.earlier !== true)
            for (const listener of listeners) listener(request);
        acted();
      },
    }),
    waitForResponse: async (
      names: (response: unknown) => boolean,
      options: { timeout?: number },
    ) => {
      order.push(`wait ${String(options.timeout)}`);
      await clicked;
      const found = answers.map(({ answer }) => answer).find(names);
      if (found === undefined) throw new Error("Timeout exceeded");
      return found;
    },
  } as unknown as Page;
  return { page, order, listeners, reads };
};

const clickSaving = (path: string) =>
  scenario([
    {
      step_id: "save-item",
      action: "click",
      timeout_ms: 5000,
      locator: { kind: "role", role: "button", name: "Save" },
      save_response: {
        method: "POST",
        path,
        save: [{ name: "item", json_pointer: "/id" }],
      },
    },
  ]);

describe("ambiguous saved response observations", () => {
  it("refuses an ambiguous poll and click request without choosing either identity", async () => {
    const parsed = clickSaving("/api/items");
    const secrets = resolved(parsed);
    const { page, listeners } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: '{"id":"poll"}',
      },
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: '{"id":"created"}',
      },
    ]);
    await expect(perform(page, parsed.actions[0]!, secrets)).rejects.toThrow(
      "ambiguous",
    );
    expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    expect(listeners.size).toBe(0);
  });

  it("refuses a second matching request observed while the selected body is pending", async () => {
    const parsed = clickSaving("/api/items");
    const secrets = resolved(parsed);
    let release!: (body: string) => void;
    const late = new Promise<string>((resolve) => {
      release = resolve;
    });
    const { page, listeners, reads } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: "",
        size: 30,
        late,
      },
    ]);
    const running = perform(page, parsed.actions[0]!, secrets);
    const rejected = expect(running).rejects.toThrow("ambiguous");
    await vi.waitFor(() => expect(reads.count).toBe(1));
    for (const listener of listeners)
      listener({ method: () => "POST", url: () => `${ORIGIN}/api/items` });
    release('{"id":"wrong-object"}');
    await rejected;
    expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    expect(listeners.size).toBe(0);
  });
});

describe("saving from a UI step's response", () => {
  it("waits before clicking, and saves from the response the step names", async () => {
    const parsed = clickSaving("/api/lists/{*}/items");
    const secrets = resolved(parsed);
    const { page, order } = uiPage([
      {
        method: "GET",
        url: `${ORIGIN}/api/lists/3/items`,
        status: 200,
        body: '{"id":"read"}',
      },
      {
        method: "POST",
        url: `https://other.test/api/lists/3/items`,
        status: 201,
        body: '{"id":"foreign"}',
      },
      {
        method: "POST",
        url: `${ORIGIN}/api/lists/3/4/items`,
        status: 201,
        body: '{"id":"deeper"}',
      },
      {
        method: "POST",
        url: `${ORIGIN}/api/lists/3/items?draft=1`,
        status: 201,
        body: '{"id":"item-7"}',
      },
    ]);
    await perform(page, parsed.actions[0]!, secrets);
    expect(order).toEqual(["wait 5000", "click"]);
    expect(secrets.savedValue("item")).toBe("item-7");
  });

  it("saves from a request the step started, not one already running, and matches an encoded path", async () => {
    const parsed = clickSaving("/api/lists/My List/items");
    const secrets = resolved(parsed);
    const { page, listeners } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/lists/My%20List/items`,
        status: 201,
        body: '{"id":"autosaved"}',
        earlier: true,
      },
      {
        method: "POST",
        url: `${ORIGIN}/api/lists/My%20List/items`,
        status: 201,
        body: '{"id":"item-8"}',
      },
    ]);
    await perform(page, parsed.actions[0]!, secrets);
    expect(secrets.savedValue("item")).toBe("item-8");
    expect(listeners.size).toBe(0);
  });

  it("refuses a response too large to save from without reading it", async () => {
    const parsed = clickSaving("/api/items");
    const { page, reads } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: '{"id":"x"}',
        size: 12_000_001,
      },
    ]);
    await expect(
      perform(page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("too large to save values from");
    expect(reads.count).toBe(0);
  });

  it.each([
    { encoding: "br", size: 32 },
    { encoding: "gzip, zstd", size: 32 },
    { encoding: "identity", size: 0 },
    { encoding: "gzip", size: 0 },
    { size: 0, length: "0" },
    { size: -1 },
    { size: Number.NaN },
  ])(
    "refuses unknown decoded UI response bounds before body allocation: %j",
    async (bounds) => {
      const parsed = clickSaving("/api/items");
      const secrets = resolved(parsed);
      const { page, reads, listeners } = uiPage([
        {
          method: "POST",
          url: `${ORIGIN}/api/items`,
          status: 201,
          body: '{"id":"record-7"}',
          ...bounds,
        },
      ]);
      await expect(perform(page, parsed.actions[0]!, secrets)).rejects.toThrow(
        "decoded response size",
      );
      expect(reads.count).toBe(0);
      expect(listeners.size).toBe(0);
      expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    },
  );

  it("stops watching requests when the step fails before its response", async () => {
    const parsed = clickSaving("/api/items");
    const { page, listeners } = uiPage([], true);
    await expect(
      perform(page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("Element is not attached");
    expect(listeners.size).toBe(0);
  });

  it("fails the step when no named response arrives or it is not 2xx", async () => {
    const parsed = clickSaving("/api/items");
    await expect(
      perform(uiPage([]).page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow(
      "no POST /api/items response arrived before the step's timeout",
    );
    await expect(
      perform(
        uiPage([
          {
            method: "POST",
            url: `${ORIGIN}/api/items`,
            status: 422,
            body: '{"id":"x"}',
          },
        ]).page,
        parsed.actions[0]!,
        resolved(parsed),
      ),
    ).rejects.toThrow(
      "answered 422; values are saved only from a 2xx response",
    );
  });
});

describe("saving from a compressed or cached UI response", () => {
  it.each([
    { encoding: "gzip", size: 32 },
    { encoding: "deflate", size: 32 },
    { encoding: "x-gzip", size: 32 },
    { size: 0, length: "17" },
    { encoding: "gzip", size: 0, length: "32" },
  ])(
    "saves from a response whose received size or declared length bounds its decoded size: %j",
    async (bounds) => {
      const parsed = clickSaving("/api/items");
      const secrets = resolved(parsed);
      const { page, reads } = uiPage([
        {
          method: "POST",
          url: `${ORIGIN}/api/items`,
          status: 201,
          body: '{"id":"record-7"}',
          ...bounds,
        },
      ]);
      await perform(page, parsed.actions[0]!, secrets);
      expect(secrets.savedValue("item")).toBe("record-7");
      expect(reads.count).toBe(1);
    },
  );

  it("refuses a compressed response that could decode past the limit without reading it", async () => {
    const parsed = clickSaving("/api/items");
    const { page, reads } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: '{"id":"x"}',
        encoding: "gzip",
        size: 12_000,
      },
    ]);
    await expect(
      perform(page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("could decode past the size limit");
    expect(reads.count).toBe(0);
  });
});

describe("saved response limits and deadlines", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const lateBody = () => {
    let arrive: (body: string) => void = () => undefined;
    const late = new Promise<string>((resolve) => {
      arrive = resolve;
    });
    return { late, arrive };
  };

  it("saves nothing from a body still arriving when the step's time runs out", async () => {
    vi.useFakeTimers();
    const parsed = clickSaving("/api/items");
    const secrets = resolved(parsed);
    const { late, arrive } = lateBody();
    const { page, listeners } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: "",
        size: Buffer.byteLength('{"id":"item-late"}'),
        late,
      },
    ]);
    const outcome = perform(page, parsed.actions[0]!, secrets).then(
      () => "saved",
      (cause: Error) => cause.message,
    );
    await vi.advanceTimersByTimeAsync(5001);
    arrive('{"id":"item-late"}');
    await expect(outcome).resolves.toContain(
      "ended before its saved response was read",
    );
    expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    expect(listeners.size).toBe(0);
  });

  it("saves nothing from a body still arriving when the step is cancelled", async () => {
    const parsed = clickSaving("/api/items");
    const secrets = resolved(parsed);
    const { late, arrive } = lateBody();
    const { page, listeners } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: "",
        size: Buffer.byteLength('{"id":"item-late"}'),
        late,
      },
    ]);
    const cancel = new AbortController();
    const outcome = perform(
      page,
      parsed.actions[0]!,
      secrets,
      cancel.signal,
    ).then(
      () => "saved",
      (cause: Error) => cause.message,
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    cancel.abort();
    arrive('{"id":"item-late"}');
    await expect(outcome).resolves.toContain(
      "ended before its saved response was read",
    );
    expect(() => secrets.savedValue("item")).toThrow("No earlier step saved");
    expect(listeners.size).toBe(0);
  });

  it("reads a response whose received bytes exceed the character limit but whose text is within it", async () => {
    const parsed = clickSaving("/api/items");
    const secrets = resolved(parsed);
    const { page } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: '{"id":"item-9"}',
        // Two million three-byte characters, as CJK text spells them in UTF-8.
        size: 6_000_000,
      },
    ]);
    await perform(page, parsed.actions[0]!, secrets);
    expect(secrets.savedValue("item")).toBe("item-9");
  });

  it("fails a response whose text is longer than the character limit", async () => {
    const parsed = clickSaving("/api/items");
    const { page, reads } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items`,
        status: 201,
        body: `{"id":"${"x".repeat(4_000_000)}"}`,
      },
    ]);
    await expect(
      perform(page, parsed.actions[0]!, resolved(parsed)),
    ).rejects.toThrow("too large to save values from");
    expect(reads.count).toBe(1);
  });
});

it.each(["array", "embedded", "headers"])(
  "refuses repeated large saved JSON values in %s before expansion or browser dispatch",
  async (kind) => {
    onTestFinished(() => {
      vi.unstubAllGlobals();
    });
    const parsed = scenario([
      requestStep({ save: [{ name: "large", json_pointer: "/value" }] }),
      requestStep({
        step_id: "expanded",
        headers:
          kind === "headers"
            ? Array.from({ length: 1000 }, (_, i) => ({
                name: `X-Repeated-${i}`,
                value: { source: "saved" as const, name: "large" },
              }))
            : [],
        json:
          kind === "headers"
            ? undefined
            : kind === "array"
              ? Array.from({ length: 1000 }, () => "{saved:large}")
              : "prefix" + "{saved:large}".repeat(1000),
      }),
    ]);
    const secrets = resolved(parsed);
    secrets.save("source.large", "large", "x".repeat(3_000_000), false);
    const page = { ...fakePage({}), evaluate: vi.fn() } as unknown as Page;
    await expect(perform(page, parsed.actions[1]!, secrets)).rejects.toThrow(
      "serialization allowance",
    );
    expect(page.evaluate).not.toHaveBeenCalled();
  },
);

it("refuses repeated saved URL expansion before browser navigation", async () => {
  const parsed = scenario([
    requestStep({ save: [{ name: "large", json_pointer: "/value" }] }),
    {
      step_id: "open",
      action: "goto",
      destination: { url: `${ORIGIN}/` + "{saved:large}".repeat(1000) },
      wait_until: "load",
    },
  ]);
  const secrets = resolved(parsed);
  secrets.save("source.large", "large", "x".repeat(3_000_000), false);
  const goto = vi.fn();
  await expect(
    perform({ goto } as unknown as Page, parsed.actions[1]!, secrets),
  ).rejects.toThrow("serialization allowance");
  expect(goto).not.toHaveBeenCalled();
});

it.each([
  "/api\\items/{*}",
  "/api/unused/../items/{*}",
  "/api/unused/%2e%2e/items/{*}",
])(
  "normalizes the entire observed response path %s before matching",
  async (path) => {
    const parsed = clickSaving(path);
    const { page } = uiPage([
      {
        method: "POST",
        url: `${ORIGIN}/api/items/42`,
        status: 201,
        body: '{"id":"42"}',
      },
    ]);
    const secrets = resolved(parsed);
    await perform(page, parsed.actions[0]!, secrets);
    expect(secrets.savedValue("item")).toBe("42");
  },
);

it("keeps literal encoded wildcard text distinct from observed-response wildcard segments", async () => {
  const parsed = clickSaving("/api/%7B*%7D");
  const { page } = uiPage([
    {
      method: "POST",
      url: `${ORIGIN}/api/other`,
      status: 201,
      body: '{"id":"42"}',
    },
  ]);
  await expect(
    perform(page, parsed.actions[0]!, resolved(parsed)),
  ).rejects.toThrow("no POST");
});

it("normalizes wildcard paths without colliding with literal marker-like segments", async () => {
  const parsed = clickSaving("/~rea-wildcard~/items/{*}");
  const { page } = uiPage([
    {
      method: "POST",
      url: `${ORIGIN}/~rea-wildcard~/items/42`,
      status: 201,
      body: '{"id":"42"}',
    },
  ]);
  const secrets = resolved(parsed);
  await perform(page, parsed.actions[0]!, secrets);
  expect(secrets.savedValue("item")).toBe("42");
});

it("redacts a saved secret as a parsed URL query spells it", () => {
  const secrets = resolved(scenario([requestStep({})]));
  secrets.save("create.token", "token", "ab'cd~ef", true);
  const sent = new URL(
    `${ORIGIN}/api/items?token=${encodeURIComponent("ab'cd~ef")}`,
  ).href;
  expect(sent).toContain("ab%27cd~ef");
  expect(secrets.redact(sent)).toBe(
    `${ORIGIN}/api/items?token=[REDACTED:page:create.token]`,
  );
});
