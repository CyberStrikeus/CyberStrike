import { once } from "node:events";
import { createServer } from "node:http";

import { expect, it } from "vitest";

import { fetchWebSourceMaps } from "../../../src/browser/WebSourceMapFetcher.js";
import { fetchWebSourceMapsOk } from "../../fixtures/fetchWebSourceMapsOk.js";
import {
  analyzeWebBundleInputSchema,
  webSourceMapsSchema,
} from "../../../src/domain/webBundleAnalysis.js";
import { WEB_SOURCE_MAP_LIMITS } from "../../../src/domain/webSourceLocation.js";

it.each([
  { status: 300, followsRedirect: false },
  { status: 304, followsRedirect: false },
  { status: 305, followsRedirect: false },
  { status: 306, followsRedirect: false },
  { status: 301, followsRedirect: true },
  { status: 302, followsRedirect: true },
  { status: 303, followsRedirect: true },
  { status: 307, followsRedirect: true },
  { status: 308, followsRedirect: true },
])(
  "follows HTTP $status with Location only when it is a redirect status",
  async ({ status, followsRedirect }) => {
    const calls: string[] = [];
    const server = createServer((request, response) => {
      const path = request.url ?? "";
      calls.push(path);
      if (path === "/delivered.map") {
        response.writeHead(200, { "content-type": "application/json" }).end(
          JSON.stringify({
            version: 3,
            names: [],
            sources: ["original.js"],
            mappings: "AAAA",
          }),
        );
        return;
      }
      response.writeHead(status, { location: "/delivered.map" }).end();
    });
    try {
      const listening = once(server, "listening");
      server.listen(0, "127.0.0.1");
      await listening;
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected TCP listener");
      const origin = `http://127.0.0.1:${String(address.port)}`;
      const input = analyzeWebBundleInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "selected-page",
        allowed_origins: [origin],
        fetch_source_maps: true,
      });
      const url = `${origin}/${String(status)}`;
      const result = await fetchWebSourceMapsOk(
        [
          {
            scriptKey: `scr_${"1".repeat(64)}`,
            declaredUrl: url,
            fetchUrl: url,
          },
        ],
        input,
      );

      expect(calls).toEqual(
        followsRedirect
          ? [`/${String(status)}`, "/delivered.map"]
          : [`/${String(status)}`],
      );
      expect(result.items[0]?.status).toBe(
        followsRedirect ? "included" : "fetch_failed",
      );
      expect(result.items[0]).toMatchObject({
        declared_url: url,
        effective_url: followsRedirect ? `${origin}/delivered.map` : url,
      });
      if (!followsRedirect)
        expect(result.items[0]?.limitation).toBe(
          `Source-map server returned HTTP ${String(status)}.`,
        );
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) =>
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          ),
        );
    }
  },
);

it("keeps the declared URL and reports malformed redirect Location evidence", async () => {
  const declaredUrl = "https://app.example.test/declared.map";
  const input = analyzeWebBundleInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "selected-page",
    allowed_origins: ["https://app.example.test"],
    fetch_source_maps: true,
  });
  const result = await fetchWebSourceMapsOk(
    [
      {
        scriptKey: `scr_${"1".repeat(64)}`,
        declaredUrl,
        fetchUrl: declaredUrl,
      },
    ],
    input,
    undefined,
    {
      fetch: () =>
        Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location: "http://[invalid" },
          }),
        ),
    },
  );

  expect(result.items[0]).toMatchObject({
    status: "fetch_failed",
    declared_url: declaredUrl,
    effective_url: declaredUrl,
    limitation: expect.stringContaining("invalid Location URL"),
  });
  expect(result.items[0]?.limitation).toContain(declaredUrl);
  expect(result.items[0]?.limitation).toContain("http://[invalid");
});

it.each(["invalid JSON", "invalid UTF-8", "HTTP failure", "response limit"])(
  "retains a redirected response URL for %s",
  async (failure) => {
    const origin = "https://app.example.test";
    const declaredUrl = `${origin}/declared.map`;
    const fetchedUrl = `${origin}/maps/current.map?token=source-value#fragment`;
    const result = await fetchWebSourceMapsOk(
      [{ scriptKey: "script", declaredUrl, fetchUrl: declaredUrl }],
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page",
        allowed_origins: [origin],
        fetch_source_maps: true,
      }),
      undefined,
      {
        ...(failure === "response limit" ? { maxResponseBytes: 1 } : {}),
        fetch: (url) =>
          Promise.resolve(
            String(url) === declaredUrl
              ? new Response(null, {
                  status: 302,
                  headers: { location: fetchedUrl },
                })
              : new Response(
                  failure === "invalid UTF-8"
                    ? Uint8Array.from([0xff])
                    : "not-json",
                  { status: failure === "HTTP failure" ? 503 : 200 },
                ),
          ),
      },
    );
    expect(result.items[0]).toMatchObject({
      declared_url: declaredUrl,
      effective_url: fetchedUrl,
      status:
        failure === "invalid JSON" || failure === "invalid UTF-8"
          ? "invalid"
          : "fetch_failed",
      artifact: null,
    });
    const item = result.items[0];
    if (item === undefined) throw new Error("Expected a fetched map result");
    const legacyItem = { ...item };
    delete legacyItem.effective_url;
    const legacy = webSourceMapsSchema.parse({
      ...result,
      items: [legacyItem],
    });
    expect(legacy.items[0]).not.toHaveProperty("effective_url");
  },
);

it.each([
  { cancellationFails: false, reason: null, abortDuringCleanup: false },
  {
    cancellationFails: true,
    reason: new Error("fixture cancel failure"),
    abortDuringCleanup: false,
  },
  { cancellationFails: true, reason: undefined, abortDuringCleanup: false },
  {
    cancellationFails: true,
    reason: new Error("cleanup failed before caller abort"),
    abortDuringCleanup: true,
  },
])(
  "reserves a fetched URL before reading an over-cap response; cancellation failure=$cancellationFails, caller abort=$abortDuringCleanup",
  async ({ cancellationFails, reason, abortDuringCleanup }) => {
    const origin = "https://app.example.test";
    const fetchedUrl = `${origin}/${"u".repeat(WEB_SOURCE_MAP_LIMITS.outputBytes)}`;
    let cancelled = false;
    let read = false;
    const controller = new AbortController();
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          read = true;
          controller.enqueue(
            new TextEncoder().encode(
              '{"version":3,"sources":[],"names":[],"mappings":""}',
            ),
          );
          controller.close();
        },
        cancel() {
          cancelled = true;
          if (abortDuringCleanup)
            controller.abort({ requested: "stop during response cleanup" });
          if (cancellationFails) throw reason;
        },
      },
      { highWaterMark: 0 },
    );
    const pending = fetchWebSourceMaps(
      [
        {
          scriptKey: "script",
          declaredUrl: `${origin}/declared.map`,
          fetchUrl: fetchedUrl,
        },
      ],
      analyzeWebBundleInputSchema.parse({
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: "page",
        allowed_origins: [origin],
        fetch_source_maps: true,
      }),
      controller.signal,
      { fetch: () => Promise.resolve(new Response(body)) },
    );
    if (cancellationFails) {
      const result = await pending;
      expect(result).toMatchObject({
        ok: false,
        error: {
          _tag: "AnalysisResourceConstraintError",
          message: expect.stringContaining("Expanded source-map evidence"),
          cleanupIncomplete: true,
          cleanupResources: ["source-map-response"],
          cause: expect.objectContaining({
            errors: expect.arrayContaining([reason]),
          }),
        },
      });
    } else {
      await expect(pending).resolves.toMatchObject({
        ok: true,
        value: {
          status: "unavailable",
          requested: 1,
          processed: 0,
          items: [],
          limitation: expect.stringContaining("1 requested map"),
        },
      });
    }
    expect(cancelled).toBe(true);
    expect(read).toBe(false);
  },
);

it("charges complete escaped redirect errors and cancels every discarded response", async () => {
  const origin = "https://app.example.test";
  const location = `http://[${'\\"'.repeat(3_000)}`;
  const request = {
    scriptKey: "script",
    declaredUrl: `${origin}/map`,
    fetchUrl: `${origin}/map`,
  };
  const input = analyzeWebBundleInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    target_id: "page",
    allowed_origins: [origin],
    fetch_source_maps: true,
  });
  let calls = 0;
  let cancelled = 0;
  const host = {
    fetch: () => {
      calls += 1;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel() {
              cancelled += 1;
            },
          }),
          { status: 302, headers: { location } },
        ),
      );
    },
  };
  const control = await fetchWebSourceMapsOk([request], input, undefined, host);
  expect(control.items[0]?.limitation).toContain(JSON.stringify(location));
  expect(control.items[0]?.limitation?.length).toBeGreaterThan(512);
  const result = await fetchWebSourceMapsOk(
    Array.from({ length: 1_500 }, () => request),
    input,
    undefined,
    host,
  );
  expect(result).toMatchObject({ status: "unavailable", requested: 1_500 });
  expect(result.processed).toBe(result.items.length);
  expect(result.processed).toBeLessThan(result.requested);
  expect(result.limitation).toContain("unknown");
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
    WEB_SOURCE_MAP_LIMITS.outputBytes,
  );
  expect(calls).toBeLessThan(1_501);
  expect(cancelled).toBe(calls);
});
