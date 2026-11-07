import { createHash } from "node:crypto";
import { createServer } from "node:http";

import { describe, expect, it } from "vitest";

import { withVerifierCleanup } from "../../../scripts/lib/verifier-cleanup.mjs";
import { awaitAcknowledgement } from "../../fixtures/lifecycleAcknowledgement.js";
import { fetchWebSourceMaps } from "../../../src/browser/WebSourceMapFetcher.js";
import { fetchWebSourceMapsOk } from "../../fixtures/fetchWebSourceMapsOk.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import {
  analyzeWebBundleInputSchema,
  webSourceMapsSchema,
  type WebSourceMaps,
} from "../../../src/domain/webBundleAnalysis.js";

const origin = "https://app.example.test";
const request = {
  scriptKey: `scr_${"1".repeat(64)}`,
  declaredUrl: `${origin}/assets/app.js.map?token=secret&v=2#source-map`,
  fetchUrl: `${origin}/assets/app.js.map?token=secret`,
};

const expectInvalidSourceMaps = (value: unknown): void => {
  expect(webSourceMapsSchema.safeParse(value).success).toBe(false);
};

const expectInvalidIncludedSourceMaps = (result: WebSourceMaps): void => {
  expectInvalidSourceMaps({
    ...result,
    items: [{ ...result.items[0], artifact: null }],
  });
  expectInvalidSourceMaps({ ...result, status: "unavailable" });
};

it.each(["regular", "indexed"])(
  "retains declaration identity for duplicate source URLs in HTTP %s maps",
  async (format) => {
    const contents = [
      null,
      'import "./shared.js"; import "./shared.js"; import "./first.js";',
      'import "./shared.js"; import "./second.js";',
    ];
    const leaf = (sourcesContent: (string | null)[]) => ({
      version: 3,
      sources: sourcesContent.map(() => "same.ts"),
      sourcesContent,
      names: [],
      mappings: "",
    });
    const map =
      format === "regular"
        ? leaf(contents)
        : {
            version: 3,
            sections: contents.map((content, line) => ({
              offset: { line, column: 0 },
              map: leaf([content]),
            })),
          };
    const server = createServer((_incoming, response) => {
      response.setHeader("content-type", "application/source-map+json");
      response.end(JSON.stringify(map));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const url = `${localOrigin}/app.js.map`;
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl: url, declaredUrl: url }],
        input({ allowed_origins: [localOrigin] }),
      );
      const item = result.items[0];
      if (item?.status !== "included") throw new Error("map not included");
      expect(item.limitation).toBeNull();
      expect(
        item.original_sources.map((source) => ({
          declaration_index: source.declaration_index,
          source_index: source.source_index,
          source: source.source,
          text: source.artifact?.text ?? null,
        })),
      ).toEqual(
        contents.map((text, declaration_index) => ({
          declaration_index,
          source_index: format === "regular" ? declaration_index : 0,
          source: `${localOrigin}/same.ts`,
          text,
        })),
      );
      expect(item.original_module_edges).toEqual(
        [
          [1, "./shared.js"],
          [1, "./first.js"],
          [2, "./shared.js"],
          [2, "./second.js"],
        ].map(([declaration_index, specifier]) => ({
          declaration_index,
          from_source: `${localOrigin}/same.ts`,
          kind: "static_import",
          specifier,
          resolved_source: new URL(String(specifier), url).href,
        })),
      );
      expect(webSourceMapsSchema.parse(result)).toEqual(result);
      const historical = {
        ...result,
        items: [
          {
            ...item,
            original_module_edges: item.original_module_edges.map(
              ({ declaration_index: _index, ...edge }) => edge,
            ),
          },
        ],
      };
      expect(webSourceMapsSchema.parse(historical)).toEqual(historical);
      expectInvalidSourceMaps({
        ...result,
        items: [
          {
            ...item,
            original_module_edges: [
              {
                ...item.original_module_edges[0],
                declaration_index: -1,
              },
            ],
          },
        ],
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  },
);

it.each(["regular", "indexed"])(
  "collects an HTTP %s source map with omitted names without accepting invalid names",
  async (format) => {
    const leaf = {
      version: 3,
      sources: ["src/main.ts"],
      sourcesContent: ["import './dependency.ts';"],
      mappings: "AAAA",
    };
    const texts = [
      leaf,
      { ...leaf, names: [] },
      { ...leaf, names: null },
      { ...leaf, names: 42 },
      { ...leaf, names: [42] },
      { ...leaf, mappings: "AAAAA" },
    ].map((map) =>
      JSON.stringify(
        format === "indexed"
          ? {
              version: 3,
              sections: [{ offset: { line: 2, column: 5 }, map }],
            }
          : map,
      ),
    );
    const server = createServer((incoming, response) => {
      response.setHeader("content-type", "application/source-map+json");
      response.end(texts[Number(incoming.url?.slice(1))]);
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const result = await fetchWebSourceMapsOk(
        texts.map((_, index) => ({
          ...request,
          fetchUrl: `${localOrigin}/${index}`,
          declaredUrl: `${localOrigin}/${index}`,
        })),
        input({ allowed_origins: [localOrigin] }),
      );
      expect(result.items.map(({ status }) => status)).toEqual([
        "included",
        "included",
        "invalid",
        "invalid",
        "invalid",
        "invalid",
      ]);
      for (const [index, text] of texts.slice(0, 2).entries())
        expect(result.items[index]).toMatchObject({
          artifact: {
            text,
            bytes: Buffer.byteLength(text),
            sha256: createHash("sha256").update(text).digest("hex"),
          },
          original_sources: [{ source: `${localOrigin}/src/main.ts` }],
          mappings: [
            {
              generated_line: format === "indexed" ? 3 : 1,
              generated_column: format === "indexed" ? 5 : 0,
              source: `${localOrigin}/src/main.ts`,
              original_line: 1,
              original_column: 0,
              name: null,
            },
          ],
          original_module_edges: [
            {
              from_source: `${localOrigin}/src/main.ts`,
              resolved_source: `${localOrigin}/src/dependency.ts`,
            },
          ],
        });
      for (const item of result.items.slice(2))
        expect(item).toMatchObject({
          artifact: null,
          mappings: [],
          original_sources: [],
        });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  },
);

it("parses ECMA-426 HTTP source-map prefixes while retaining exact response evidence", async () => {
  const map = JSON.stringify({
    version: 3,
    names: [],
    sources: ["src/main.ts"],
    sourcesContent: ["import './dependency.ts';"],
    mappings: "AAAA",
  });
  const prefix = ")]}'transport prefix";
  const texts = [
    map,
    `\uFEFF${prefix}\n${map}`,
    `${prefix}\n${map}`,
    `${prefix}\r\n${map}`,
    `${prefix}\r${map}`,
    `${prefix}${map}`,
    `${prefix}\n{`,
  ];
  const server = createServer((incoming, response) => {
    const index = Number(incoming.url?.slice(1));
    response.setHeader("content-type", "application/source-map+json");
    response.end(texts[index]);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new TypeError("Expected a TCP listener address");
    const localOrigin = `http://127.0.0.1:${String(address.port)}`;
    const result = await fetchWebSourceMapsOk(
      texts.map((_, index) => ({
        ...request,
        fetchUrl: `${localOrigin}/${index}`,
        declaredUrl: `${localOrigin}/${index}`,
      })),
      input({ allowed_origins: [localOrigin] }),
    );
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "included",
      "included",
      "included",
      "included",
      "invalid",
      "invalid",
    ]);
    for (const [index, text] of texts.slice(0, 5).entries())
      expect(result.items[index]).toMatchObject({
        artifact: {
          text,
          bytes: Buffer.byteLength(text),
          sha256: createHash("sha256").update(text).digest("hex"),
        },
        original_sources: [{ source: `${localOrigin}/src/main.ts` }],
        mappings: [
          {
            generated_line: 1,
            generated_column: 0,
            source: `${localOrigin}/src/main.ts`,
            original_line: 1,
            original_column: 0,
          },
        ],
        original_module_edges: [
          {
            from_source: `${localOrigin}/src/main.ts`,
            specifier: "./dependency.ts",
            resolved_source: `${localOrigin}/src/dependency.ts`,
          },
        ],
      });
    expect(result.items.slice(5)).toMatchObject([
      { artifact: null, mappings: [], original_sources: [] },
      { artifact: null, mappings: [], original_sources: [] },
    ]);
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) => {
        server.close((error) =>
          error === undefined ? resolve() : reject(error),
        );
      });
  }
});

describe("source-map redirect URL resolution", () => {
  const deliveredPath =
    "/assets/v2/app.js.map?revision=2&token=public-selection";
  it.each(["/maps/current", deliveredPath])(
    "resolves relative sources against the delivered map at %s",
    async (initialPath) => {
      const calls: string[] = [];
      const text = JSON.stringify({
        version: 3,
        names: [],
        sources: ["../src/main.ts"],
        sourcesContent: ["import './dependency.ts';"],
        mappings: "AAAA",
      });
      const server = createServer((incoming, response) => {
        calls.push(incoming.url ?? "");
        if (incoming.url === "/maps/current") {
          response.writeHead(302, { location: deliveredPath }).end();
          return;
        }
        response.setHeader("content-type", "application/json");
        response.end(text);
      });
      try {
        await new Promise<void>((resolve, reject) => {
          server.once("error", reject);
          server.listen(0, "127.0.0.1", resolve);
        });
        const address = server.address();
        if (address === null || typeof address === "string")
          throw new TypeError("Expected a TCP listener address");
        const localOrigin = `http://127.0.0.1:${String(address.port)}`;
        const declaredUrl = `${localOrigin}${initialPath}`;
        const result = await fetchWebSourceMapsOk(
          [{ ...request, fetchUrl: declaredUrl, declaredUrl }],
          input({ allowed_origins: [localOrigin] }),
        );
        expect(calls).toEqual(
          initialPath === "/maps/current"
            ? [initialPath, deliveredPath]
            : [initialPath],
        );
        expect(result).toMatchObject({
          status: "included",
          items: [
            {
              declared_url: declaredUrl,
              effective_url: `${localOrigin}${deliveredPath}`,
              artifact: {
                text,
                bytes: Buffer.byteLength(text),
                sha256: createHash("sha256").update(text).digest("hex"),
              },
              original_sources: [
                { source: `${localOrigin}/assets/src/main.ts` },
              ],
              mappings: [{ source: `${localOrigin}/assets/src/main.ts` }],
              original_module_edges: [
                {
                  from_source: `${localOrigin}/assets/src/main.ts`,
                  resolved_source: `${localOrigin}/assets/src/dependency.ts`,
                },
              ],
            },
          ],
        });
      } finally {
        server.closeAllConnections();
        if (server.listening)
          await new Promise<void>((resolve, reject) => {
            server.close((error) =>
              error === undefined ? resolve() : reject(error),
            );
          });
      }
    },
  );

  it.each([
    [404, "unavailable", "fetch_failed"],
    [200, "not-json", "invalid"],
  ])(
    "retains the delivered URL when its HTTP %s response cannot supply a map",
    async (responseStatus, body, itemStatus) => {
      const effectiveUrl = `${origin}${deliveredPath}`;
      const calls: string[] = [];
      const result = await fetchWebSourceMapsOk([request], input(), undefined, {
        fetch: (url) => {
          calls.push(String(url));
          return Promise.resolve(
            calls.length === 1
              ? new Response(null, {
                  status: 302,
                  headers: { location: effectiveUrl },
                })
              : new Response(body, { status: responseStatus }),
          );
        },
      });
      expect(calls).toEqual([request.fetchUrl, effectiveUrl]);
      expect(result.items[0]).toMatchObject({
        status: itemStatus,
        declared_url: request.declaredUrl,
        effective_url: effectiveUrl,
        artifact: null,
        limitation:
          responseStatus === 200
            ? "Source-map JSON is not a version 3 map. Response text was not retained; completed response body identity is available."
            : "Source-map server returned HTTP 404.",
      });
    },
  );

  it("retains the last observed response URL when the next redirect fetch rejects", async () => {
    const nextUrl = `${origin}${deliveredPath}`;
    const calls: string[] = [];
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: (url) => {
        calls.push(String(url));
        return calls.length === 1
          ? Promise.resolve(
              new Response(null, {
                status: 302,
                headers: { location: nextUrl },
              }),
            )
          : Promise.reject(new TypeError("fixture connection failed"));
      },
    });
    expect(calls).toEqual([request.fetchUrl, nextUrl]);
    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      declared_url: request.declaredUrl,
      effective_url: request.fetchUrl,
      artifact: null,
    });
  });

  it("reports an absent effective URL when the first fetch rejects", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.reject(new TypeError("fixture connection failed")),
    });
    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      declared_url: request.declaredUrl,
      effective_url: null,
      artifact: null,
    });
  });
});

describe("web source-map fetching and validation: fetching maps and following redirects", () => {
  it("fetches without credentials and derives mappings and original modules", async () => {
    const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
    const map = JSON.stringify({
      version: 3,
      file: "app.js",
      names: ["entry"],
      sources: ["../src/main.ts"],
      sourcesContent: ["import './dependency.ts';\nexport const entry = 1;"],
      mappings: "AAAAA",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: (url, init) => {
        calls.push({ url: String(url), init });
        return Promise.resolve(
          new Response(map, {
            status: 200,
            headers: { "content-type": "application/json" },
          }),
        );
      },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: request.fetchUrl,
      init: {
        credentials: "omit",
        redirect: "manual",
        referrerPolicy: "no-referrer",
      },
    });
    expect(JSON.stringify(calls[0]?.init)).not.toContain("secret");
    expect(result).toMatchObject({
      status: "included",
      requested: 1,
      processed: 1,
      items: [
        {
          status: "included",
          artifact: { media_type: "application/source-map+json" },
          original_sources: [
            {
              source: `${origin}/src/main.ts`,
              artifact: { media_type: "text/typescript" },
            },
          ],
          original_module_edges: [
            {
              kind: "static_import",
              specifier: "./dependency.ts",
              resolved_source: `${origin}/src/dependency.ts`,
            },
          ],
          mappings: [
            {
              generated_line: 1,
              generated_column: 0,
              original_line: 1,
              original_column: 0,
            },
          ],
        },
      ],
    });
    expectInvalidIncludedSourceMaps(result);
  });

  it.each([
    ["another origin", "https://private.example.test/map"],
    ["same-origin credentials", "https://user:secret@app.example.test/map"],
  ])("reauthorizes a redirect with %s", async (_case, location) => {
    const calls: string[] = [];
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: (url) => {
        calls.push(String(url));
        return Promise.resolve(
          new Response(null, {
            status: 302,
            headers: { location },
          }),
        );
      },
    });

    expect(calls).toEqual([request.fetchUrl]);
    expect(JSON.stringify(result)).not.toContain("user:secret");
    expect(result).toMatchObject({
      status: "unavailable",
      items: [
        {
          status: "policy_filtered",
          effective_url: request.fetchUrl,
          limitation:
            "Each source-map redirect must be a credential-free HTTP(S) URL on an approved exact origin.",
        },
      ],
    });
    expectInvalidSourceMaps({
      ...result,
      items: [{ ...result.items[0], limitation: null }],
    });
  });
});

describe("source-map declared URL policy", () => {
  it.each([
    ["embedded credentials", "https://user:secret@app.example.test/a.map"],
    ["a different scheme on the same host", "http://app.example.test/a.map"],
    ["another origin", "https://private.example.test/a.map"],
    ["a non-http(s) scheme", "ftp://app.example.test/a.map"],
    ["a file URL", "file:///tmp/a.map"],
    ["an unparseable URL", "not a url"],
  ])(
    "filters a declared fetch URL with %s before any request",
    async (_description, fetchUrl) => {
      const calls: string[] = [];
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl }],
        input(),
        undefined,
        {
          fetch: (url) => {
            calls.push(String(url));
            return Promise.resolve(new Response("{}", { status: 200 }));
          },
        },
      );

      expect(calls).toEqual([]);
      expect(result).toMatchObject({
        status: "unavailable",
        items: [
          {
            status: "policy_filtered",
            effective_url: null,
            limitation:
              "Declared source-map URL must be a credential-free HTTP(S) URL on an approved exact origin.",
          },
        ],
      });
    },
  );

  it("follows an approved redirect chain without an arbitrary hop ceiling", async () => {
    const calls: string[] = [];
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: (url) => {
        const current = String(url);
        calls.push(current);
        const hop = Number(new URL(current).searchParams.get("hop") ?? "0");
        return Promise.resolve(
          hop < 7
            ? new Response(null, {
                status: 302,
                headers: {
                  location: `${origin}/assets/app.js.map?hop=${String(hop + 1)}`,
                },
              })
            : validMapResponse(),
        );
      },
    });

    expect(calls).toHaveLength(8);
    expect(result.items[0]?.status).toBe("included");
  });
});

describe("web source-map fetching and validation: enforcing fetch limits and validating responses", () => {
  it("settles an endless unique-URL redirect chain at the operation deadline", async () => {
    let calls = 0;
    const server = createServer((incoming, response) => {
      calls += 1;
      const next =
        Number(
          new URL(incoming.url ?? "/", "http://local").searchParams.get("n") ??
            "0",
        ) + 1;
      response.writeHead(302, { location: `/map?n=${String(next)}` }).end();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const url = `${localOrigin}/map?n=0`;
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl: url, declaredUrl: url }],
        input({ allowed_origins: [localOrigin] }),
        undefined,
        { fetch, timeoutMs: 100 },
      );
      expect(calls).toBeGreaterThan(1);
      expect(result).toMatchObject({
        status: "unavailable",
        processed: 1,
        items: [
          {
            status: "fetch_failed",
            artifact: null,
            limitation: expect.stringContaining("source_map_fetch_timeout_ms"),
          },
        ],
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  });

  it("cancels a streamed response when its retained-byte budget is exceeded", async () => {
    let responseClosed = false;
    let markResponseClosed: (() => void) | undefined;
    const responseClosedPromise = new Promise<void>((resolve) => {
      markResponseClosed = resolve;
    });
    const server = createServer((_incoming, response) => {
      response.on("close", () => {
        responseClosed = true;
        markResponseClosed?.();
      });
      response.writeHead(200, { "content-type": "application/json" });
      response.write("x".repeat(1_024));
      const interval = setInterval(() => response.write("x".repeat(1_024)), 2);
      response.on("close", () => clearInterval(interval));
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const url = `${localOrigin}/map`;
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl: url, declaredUrl: url }],
        input({ allowed_origins: [localOrigin] }),
        undefined,
        { fetch, maxResponseBytes: 512 },
      );
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const closeConfirmed = await Promise.race([
        responseClosedPromise.then(() => true),
        new Promise<boolean>((resolve) => {
          timeout = setTimeout(() => resolve(false), 500);
        }),
      ]);
      if (timeout !== undefined) clearTimeout(timeout);
      expect(closeConfirmed).toBe(true);
      expect(responseClosed).toBe(true);
      expect(result).toMatchObject({
        status: "unavailable",
        items: [
          {
            status: "fetch_failed",
            artifact: null,
            limitation: expect.stringContaining("retained budget"),
          },
        ],
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  });
});

describe("source-map response cancellation", () => {
  it("cancels a pending response reader on caller abort", async () => {
    let markPullStarted: (() => void) | undefined;
    const pullStarted = new Promise<void>((resolve) => {
      markPullStarted = resolve;
    });
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
      pull() {
        markPullStarted?.();
      },
      cancel() {
        cancelled = true;
      },
    });
    const controller = new AbortController();
    const abortReason = new Error("caller stopped source-map fetch");
    const pending = fetchWebSourceMaps([request], input(), controller.signal, {
      fetch: async () => new Response(body),
    });

    await withVerifierCleanup(async () => {
      await awaitAcknowledgement(
        pullStarted,
        pending,
        "source-map response pull",
      );
      controller.abort(abortReason);
      const result = await pending;
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.cause).toBe(abortReason);
      await expect.poll(() => cancelled).toBe(true);
    }, [
      () => controller.abort(),
      async () => {
        await pending;
      },
    ]);
  });
});

describe("completed source-map cancellation", () => {
  it.each([null, { stopped: "caller" }, new AnalysisCancelledError("test")])(
    "retains a completed map when a later response is cancelled with reason %s",
    async (reason) => {
      let markPullStarted: (() => void) | undefined;
      const pullStarted = new Promise<void>((resolve) => {
        markPullStarted = resolve;
      });
      let cancelled = false;
      const secondBody = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("{"));
        },
        pull() {
          markPullStarted?.();
        },
        cancel() {
          cancelled = true;
        },
      });
      const firstBody = JSON.stringify({
        version: 3,
        sources: ["src/first.ts"],
        names: [],
        mappings: "AAAA",
      });
      const first = {
        ...request,
        declaredUrl: `${origin}/first.map`,
        fetchUrl: `${origin}/first.map`,
      };
      const second = {
        ...request,
        declaredUrl: `${origin}/second.map`,
        fetchUrl: `${origin}/second.map`,
      };
      let fetches = 0;
      const controller = new AbortController();
      const pending = fetchWebSourceMaps(
        [first, second],
        input(),
        controller.signal,
        {
          fetch: async () => {
            fetches += 1;
            return fetches === 1
              ? new Response(firstBody, { status: 200 })
              : new Response(secondBody, { status: 200 });
          },
        },
      );

      await withVerifierCleanup(async () => {
        await awaitAcknowledgement(
          pullStarted,
          pending,
          "second source-map response pull",
        );
        controller.abort(reason);
        const result = await pending;
        expect(result.ok).toBe(false);
        if (result.ok) return;
        const failure = result.error;
        expect(failure).toBeInstanceOf(AnalysisCancelledError);
        expect(failure.cause).toBe(reason);
        expect(failure.partialObservation).toMatchObject({
          kind: "web-source-map-fetch",
          source_maps: {
            requested: 2,
            processed: 1,
            items: [
              {
                status: "included",
                artifact: {
                  text: firstBody,
                  sha256: createHash("sha256").update(firstBody).digest("hex"),
                },
              },
            ],
          },
        });
        await expect.poll(() => cancelled).toBe(true);
      }, [
        () => controller.abort(),
        async () => {
          await pending;
        },
      ]);
    },
  );
});

describe("source-map response validation", () => {
  it("reports malformed source-map JSON as invalid", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response("not-json", { status: 200 })),
    });
    expect(result.items[0]?.status).toBe("invalid");
  });
});

describe("selected source-map fetch deadline", () => {
  it("applies a non-default source_map_fetch_timeout_ms from the public input", async () => {
    let calls = 0;
    let closed = 0;
    const server = createServer((incoming, response) => {
      calls += 1;
      incoming.on("close", () => {
        closed += 1;
      });
      const next =
        Number(
          new URL(incoming.url ?? "/", "http://local").searchParams.get("n") ??
            "0",
        ) + 1;
      response.writeHead(302, { location: `/map?n=${String(next)}` }).end();
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const url = `${localOrigin}/map?n=0`;
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl: url, declaredUrl: url }],
        input({
          source_map_fetch_timeout_ms: 150,
          allowed_origins: [localOrigin],
        }),
        undefined,
        { fetch },
      );
      expect(calls).toBeGreaterThan(1);
      expect(closed).toBeGreaterThan(0);
      expect(result.items[0]?.limitation).toContain("150");
      expect(result.items[0]?.limitation).toContain(
        "source_map_fetch_timeout_ms",
      );
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  }, 3_000);
});

describe("browser map decoded validation", () => {
  it("keeps decoded-index and coordinate failures local to their map", async () => {
    const maps = [
      { version: 3, names: [], sources: ["ok.js"], mappings: "AAAA" },
      { version: 3, names: [], sources: ["bad.js"], mappings: "ACAA" },
      { version: 3, names: [], sources: ["bad.js"], mappings: "AADA" },
      { version: 3, names: [], sources: ["bad.js"], mappings: "DAAA" },
      { version: 3, names: [], sources: ["bad.js"], mappings: "AAAAD" },
      {
        version: 3,
        sections: [
          {
            offset: { line: 0, column: Number.MAX_SAFE_INTEGER },
            map: {
              version: 3,
              names: [],
              sources: ["bad.js"],
              mappings: "CAAA",
            },
          },
        ],
      },
      { version: 3, names: [], sources: ["ok.js"], mappings: "AAAA" },
    ];
    let index = 0;
    const requests = maps.map((_, requestIndex) => ({
      ...request,
      scriptKey: `scr_${String(requestIndex + 1).padStart(64, "0")}`,
    }));
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(JSON.stringify(maps[index++]), { status: 200 }),
        ),
    });

    expect(result.status).toBe("partial");
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "invalid",
      "included",
    ]);
    expect(result.items[0]?.mappings).toHaveLength(1);
    expect(result.items[6]?.mappings).toHaveLength(1);
  });
});

describe("source-map response encoding", () => {
  it("rejects malformed UTF-8 source-map response bytes", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(Uint8Array.of(0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d), {
            status: 200,
          }),
        ),
    });

    expect(result.status).toBe("unavailable");
    expect(result.items[0]).toMatchObject({
      status: "invalid",
      artifact: null,
      limitation:
        "Source-map response is not valid UTF-8. Response text was not retained; completed response body identity is available.",
    });
  });
});

describe("source-map operation deadline observations", () => {
  it("keeps completed maps when a later request times out", async () => {
    let calls = 0;
    const requests = [
      request,
      { ...request, scriptKey: `scr_${"2".repeat(64)}` },
    ];
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      timeoutMs: 100,
      fetch: () => {
        calls += 1;
        return calls === 1
          ? Promise.resolve(validMapResponse())
          : new Promise<Response>(() => undefined);
      },
    });

    expect(result.status).toBe("partial");
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "fetch_failed",
    ]);
    expect(result.items[0]?.original_sources).toHaveLength(1);
  });
});

describe("indexed source-map offsets", () => {
  it.each([
    { line: 0, column: -1 },
    { line: -1, column: 0 },
    { line: 0, column: "1" },
    { line: "0", column: 0 },
    { line: 0, column: 0.5 },
    { line: 0.5, column: 0 },
    { line: 0 },
    { line: 0, column: Number.MAX_SAFE_INTEGER + 1 },
  ])("retains an invalid-map item for malformed offset %j", async (offset) => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              sections: [
                {
                  offset,
                  map: {
                    version: 3,
                    names: [],
                    sources: ["original.js"],
                    sourcesContent: ["export const stable = 1;"],
                    mappings: "AAAA",
                  },
                },
              ],
            }),
            { status: 200 },
          ),
        ),
    });
    expect(result).toMatchObject({
      status: "unavailable",
      items: [{ status: "invalid", artifact: null, mappings: [] }],
    });
  });
});

describe("web source-map sourcesContent validation", () => {
  it.each([
    ["a scalar sourcesContent value", { sourcesContent: "source" }],
    ["a non-string, non-null source entry", { sourcesContent: [42] }],
  ])("reports %s as invalid", async (_description, content) => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              sources: ["source.ts"],
              names: [],
              mappings: "",
              ...content,
            }),
            { status: 200 },
          ),
        ),
    });

    expect(result).toMatchObject({
      status: "unavailable",
      items: [
        {
          status: "invalid",
          artifact: null,
          original_sources: [],
          limitation: expect.stringContaining("Source-map JSON"),
        },
      ],
    });
  });

  it.each([
    ["shorter", ["import './a.ts';"]],
    ["longer", ["import './a.ts';", null, "unused trailing content"]],
  ])(
    "keeps every source declaration when sourcesContent is %s than sources",
    async (_length, sourcesContent) => {
      const result = await fetchWebSourceMapsOk([request], input(), undefined, {
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                version: 3,
                sources: ["a.ts", "b.ts"],
                sourcesContent,
                names: [],
                mappings: "",
              }),
              { status: 200 },
            ),
          ),
      });

      expect(result.items[0]).toMatchObject({
        status: "included",
        limitation: null,
        original_sources: [
          {
            source_index: 0,
            declaration_index: 0,
            source: `${origin}/assets/a.ts`,
            artifact: { text: "import './a.ts';" },
          },
          {
            source_index: 1,
            declaration_index: 1,
            source: `${origin}/assets/b.ts`,
            artifact: null,
          },
        ],
      });
      expect(result.items[0]?.original_sources).toHaveLength(2);
    },
  );

  it("accepts null source-map source contents", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              sources: ["source.ts"],
              sourcesContent: null,
              names: [],
              mappings: "",
            }),
            { status: 200 },
          ),
        ),
    });

    expect(result.items[0]).toMatchObject({
      status: "included",
      original_sources: [
        {
          source_index: 0,
          declaration_index: 0,
          source: `${origin}/assets/source.ts`,
          artifact: null,
        },
      ],
    });
  });

  it("keeps unnamed source slots and mapping indices", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              sources: [null, "source.ts"],
              sourcesContent: ["unknown source text", "named source text"],
              names: [],
              mappings: "ACAA",
            }),
            { status: 200 },
          ),
        ),
    });

    expect(result.items[0]).toMatchObject({
      status: "partial",
      original_sources: [
        {
          source_index: 0,
          declaration_index: 0,
          source: null,
          artifact: { text: "unknown source text" },
        },
        {
          source_index: 1,
          declaration_index: 1,
          source: `${origin}/assets/source.ts`,
          artifact: { text: "named source text" },
        },
      ],
      mappings: [
        {
          source_index: 1,
          declaration_index: 1,
          source: `${origin}/assets/source.ts`,
        },
      ],
    });
    expect(result.items[0]?.limitation).toContain(
      "unnamed source at declaration 0",
    );
  });
});

describe("source-map original dependency syntax", () => {
  it("does not invent edges from comments or string contents", async () => {
    const text = [
      '// import "./comment.js";',
      String.raw`const quoted = "require(\"./string.js\")";`,
      'export { value } from "./real.js";',
      'import("./dynamic.js");',
      'require("./common.cjs");',
    ].join("\n");
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              names: [],
              sources: ["main.ts"],
              sourcesContent: [text],
              mappings: "AAAA",
            }),
          ),
        ),
    });
    expect(
      result.items[0]?.original_module_edges.map(({ specifier }) => specifier),
    ).toEqual(["./real.js", "./dynamic.js", "./common.cjs"]);
  });

  it("reads expression-free template module specifiers as literals", async () => {
    const text = [
      "import(`./dep.js`);",
      "import(`./dep.${name}.js`);",
      "require(`./common.cjs`);",
      "require(`./${name}.cjs`);",
    ].join("\n");
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              names: [],
              sources: ["main.ts"],
              sourcesContent: [text],
              mappings: "AAAA",
            }),
          ),
        ),
    });
    const item = result.items[0];
    if (item?.status !== "included") throw new Error("map not included");
    expect(item.original_module_edges).toEqual([
      expect.objectContaining({
        kind: "dynamic_import",
        specifier: "./dep.js",
        resolved_source: `${origin}/assets/dep.js`,
      }),
      expect.objectContaining({ kind: "require", specifier: "./common.cjs" }),
    ]);
    expect(item.original_sources[0]?.artifact?.text).toBe(text);
    expect(item.mappings).toHaveLength(1);
  });
});

describe("source-map original syntax boundaries", () => {
  it.each([
    [
      `import "./it's-real.js"; const quoted = \`import './template-comment.js'\`;`,
      "included",
      ["./it's-real.js"],
    ],
    [
      'function fake(require) { require("./not-a-module.js"); } require("./real.cjs");',
      "included",
      ["./real.cjs"],
    ],
    // An unrecoverable source cannot invent edges, and the caller is told its
    // edge list is incomplete rather than being told it has no imports.
    ['import "./recovered.js"; const = ;', "partial", []],
  ] as const)(
    "retains literal syntax without inventing module calls",
    async (text, status, expected) => {
      const result = await fetchWebSourceMapsOk([request], input(), undefined, {
        fetch: () =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                version: 3,
                names: [],
                sources: ["main.ts"],
                sourcesContent: [text],
                mappings: "AAAA",
              }),
            ),
          ),
      });
      const item = result.items[0];
      expect(item?.status).toBe(status);
      if (status === "partial")
        expect(item?.limitation).toContain("could not be parsed in full");
      else expect(item?.limitation).toBeNull();
      expect(
        item?.original_module_edges.map(({ specifier }) => specifier),
      ).toEqual(expected);
    },
  );
});

describe("source-map dependency coverage of hard-to-parse sources", () => {
  const fetchWithSources = (sources: readonly string[]) =>
    fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              names: [],
              sources: sources.map((_, index) => `source-${String(index)}.ts`),
              sourcesContent: [...sources],
              mappings: "AAAA",
            }),
          ),
        ),
    });

  it.each([
    [
      "decorated classes and parameters",
      '@Component({ selector: "app" })\nexport class A { @Inject() b: C; constructor(@Optional() private s: S) {} }\nimport "./a.js";',
      ["./a.js"],
    ],
    [
      "legacy class decorators",
      'class A { @dec method() {} }\nimport "./a.js";',
      ["./a.js"],
    ],
    [
      "TypeScript import equals",
      'import lib = require("./lib.js");',
      ["./lib.js"],
    ],
    [
      "type-only import equals",
      'import type Types = require("./types.js");\nimport lib = require("./lib.js");',
      ["./lib.js"],
    ],
    [
      "whole-statement type-only import",
      'import type { Value } from "./types.js";',
      [],
    ],
    [
      "whole-statement type-only export",
      'export type { Value } from "./types.js";',
      [],
    ],
    [
      "inline type import retains module side effects",
      'import { type Value } from "./types.js";',
      ["./types.js"],
    ],
    [
      "a local import alias",
      'import lib = localAlias;\nimport "./a.js";',
      ["./a.js"],
    ],
  ])("recovers dependencies from %s", async (_label, text, expected) => {
    const result = await fetchWithSources([text]);
    expect(result.items[0]?.status).toBe("included");
    expect(
      result.items[0]?.original_module_edges.map(({ specifier }) => specifier),
    ).toEqual(expected);
  });

  it("selects parser mode from the original source URL pathname", async () => {
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              names: [],
              sources: ["main.ts?revision=2#view.tsx"],
              sourcesContent: [`import "./dep.ts"; const value = <number>1;`],
              mappings: "AAAA",
            }),
          ),
        ),
    });
    expect(result.items[0]?.status).toBe("included");
    expect(result.items[0]?.limitation).toBeNull();
    expect(result.items[0]?.original_sources[0]?.source).toBe(
      `${origin}/assets/main.ts?revision=2#view.tsx`,
    );
    expect(result.items[0]?.original_module_edges).toEqual([
      expect.objectContaining({
        specifier: "./dep.ts",
        resolved_source: `${origin}/assets/dep.ts`,
      }),
    ]);
  });

  it("keeps recovered edges from a partly recovered source and reports them as partial", async () => {
    const result = await fetchWithSources([
      'with (scope) { require("./c.js"); }\nrequire("./b.js");\nimport "./a.js";',
    ]);
    expect(result.status).toBe("partial");
    expect(result.items[0]?.status).toBe("partial");
    expect(result.items[0]?.limitation).toContain(
      "could not be parsed in full",
    );
    expect(
      result.items[0]?.original_module_edges.map(({ specifier }) => specifier),
    ).toEqual(["./b.js", "./a.js"]);
  });

  it("distinguishes an unparsable source from a source with no imports", async () => {
    const broken = await fetchWithSources(['import "./a.js"; const s = "oops']);
    expect(broken.items[0]?.status).toBe("partial");
    expect(broken.items[0]?.original_module_edges).toEqual([]);
    const clean = await fetchWithSources(["export const value = 1;"]);
    expect(clean.status).toBe("included");
    expect(clean.items[0]?.status).toBe("included");
    expect(clean.items[0]?.original_module_edges).toEqual([]);
  });
});

describe("web source-map collection", () => {
  it("rejects mapping expansion before the trace-mapping decoder allocates it", async () => {
    const mapText = JSON.stringify({
      version: 3,
      names: [],
      sources: [],
      mappings: Array.from({ length: 262_145 }, () => "A").join(","),
    });
    const response = new Response(mapText, { status: 200 });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(response),
    });

    expect(result.status).toBe("unavailable");
    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      artifact: null,
    });
    expect(result.items[0]?.limitation).toContain("262144");
  });

  it("accounts for decoded records across the complete fetch operation", async () => {
    const mapText = JSON.stringify({
      version: 3,
      names: [],
      sources: [],
      mappings: Array.from({ length: 150_000 }, () => "A").join(","),
    });
    const requests = [
      request,
      { ...request, scriptKey: `scr_${"2".repeat(64)}` },
    ];
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      fetch: () => Promise.resolve(new Response(mapText, { status: 200 })),
    });

    expect(result.status).toBe("partial");
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "fetch_failed",
    ]);
    expect(result.items[1]?.limitation).toContain("262144-record");
  });

  it("rejects deeply nested indexed maps before recursive flattening", async () => {
    let map: unknown = {
      version: 3,
      names: [],
      sources: [],
      mappings: "",
    };
    for (let index = 0; index < 65; index += 1)
      map = {
        version: 3,
        sections: [{ offset: { line: 0, column: 0 }, map }],
      };
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(new Response(JSON.stringify(map), { status: 200 })),
    });

    expect(result.status).toBe("unavailable");
    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      artifact: null,
    });
    expect(result.items[0]?.limitation).toContain("64-level");
  });

  it("retains every mapping from a sectioned source map", async () => {
    const segmentCount = 10_001;
    const regular = {
      version: 3,
      names: [],
      sources: ["a.js"],
      sourcesContent: ["export const a = 1"],
      mappings: Array.from({ length: segmentCount }, () => "AAAA").join(","),
    };
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              version: 3,
              sections: [{ offset: { line: 0, column: 0 }, map: regular }],
            }),
            { status: 200 },
          ),
        ),
    });

    expect(result.status).toBe("included");
    expect(result.items[0]?.status).toBe("included");
    expect(result.items[0]?.mappings).toHaveLength(segmentCount);
  });

  it("fetches and returns every requested map inline", async () => {
    const calls: string[] = [];
    const requests = Array.from({ length: 101 }, (_, index) => ({
      ...request,
      scriptKey: `scr_${String(index + 1).padStart(64, "0")}`,
      fetchUrl: `${origin}/assets/${String(index)}.js.map`,
    }));
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      fetch: (url) => {
        calls.push(String(url));
        return Promise.resolve(validMapResponse());
      },
    });

    expect(calls).toHaveLength(requests.length);
    expect(result).toMatchObject({
      status: "included",
      requested: requests.length,
      processed: requests.length,
    });
    expect(result.items).toHaveLength(requests.length);
  });

  it("includes source-map text above the former per-map byte budget", async () => {
    const content = "x".repeat(8 * 1_024 * 1_024 + 1);
    const map = JSON.stringify({
      version: 3,
      names: [],
      sources: ["large.ts"],
      sourcesContent: [content],
      mappings: "AAAA",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response(map, { status: 200 })),
    });

    expect(result.status).toBe("included");
    expect(result.items[0]?.status).toBe("included");
    if (result.items[0]?.status !== "included") throw new Error("not included");
    expect(result.items[0].original_sources[0]?.artifact?.bytes).toBe(
      Buffer.byteLength(content),
    );
  });
});

describe("source-map output admission", () => {
  it.each([
    { selectionMiB: 8, responseStatus: "invalid" },
    { selectionMiB: 16, responseStatus: "invalid" },
    { selectionMiB: 16, responseStatus: "included" },
  ])(
    "accounts for JSON escaping in a $selectionMiB MiB effective URL for $responseStatus responses",
    async ({ selectionMiB, responseStatus }) => {
      const effectiveUrl = `${origin}/delivered.map?selection=${"\\".repeat(selectionMiB * 1_024 * 1_024)}`;
      const secondRequest = { ...request, scriptKey: `scr_${"2".repeat(64)}` };
      let calls = 0;
      const result = await fetchWebSourceMapsOk(
        [request, secondRequest],
        input(),
        undefined,
        {
          fetch: () => {
            calls += 1;
            return Promise.resolve(
              calls === 1
                ? validMapResponse()
                : calls === 2
                  ? new Response(null, {
                      status: 302,
                      headers: { location: effectiveUrl },
                    })
                  : responseStatus === "included"
                    ? validMapResponse()
                    : new Response("not-json", { status: 200 }),
            );
          },
        },
      );
      expect(calls).toBe(3);
      expect(result).toMatchObject({
        status: "partial",
        requested: 2,
        processed: selectionMiB === 8 ? 2 : 1,
      });
      if (selectionMiB === 8) {
        expect(result.items[1]).toMatchObject({
          status: "invalid",
          declared_url: secondRequest.declaredUrl,
        });
        expect(result.items[1]?.effective_url === effectiveUrl).toBe(true);
      } else {
        expect(result.items).toHaveLength(1);
        expect(result.limitation).toContain("1 requested map");
      }
      expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
        32 * 1_024 * 1_024,
      );
    },
  );
});

describe("source-map set output admission", () => {
  it("admits a maximum-size map set according to its serialized output size", async () => {
    const localOrigin = "http://127.0.0.1:9222";
    const mapUrl = `${localOrigin}/m`;
    const requests = Array.from({ length: 50_000 }, (_, index) => ({
      ...request,
      scriptKey: `scr_${index.toString(16).padStart(64, "0")}`,
      declaredUrl: mapUrl,
      fetchUrl: mapUrl,
    }));
    const map = JSON.stringify({
      version: 3,
      names: [],
      sources: ["x"],
      mappings: "AAAA",
    });
    const result = await fetchWebSourceMapsOk(
      requests,
      input({ allowed_origins: [localOrigin] }),
      undefined,
      {
        timeoutMs: 120_000,
        fetch: () => Promise.resolve(new Response(map, { status: 200 })),
      },
    );

    const outputLimitBytes = 32 * 1_024 * 1_024;
    const itemSizes = new Set(
      result.items.map((item) => Buffer.byteLength(JSON.stringify(item))),
    );
    expect(itemSizes.size).toBe(1);
    const firstItem = result.items[0];
    if (firstItem === undefined) throw new Error("no source map was admitted");
    const itemBytes = Buffer.byteLength(JSON.stringify(firstItem));
    const completeEnvelope = JSON.stringify({
      ...result,
      status: "included",
      processed: requests.length,
      items: [],
      limitation: undefined,
    });
    const projectedCompleteBytes =
      Buffer.byteLength(completeEnvelope) +
      itemBytes * requests.length +
      requests.length -
      1;
    const completeOutputFits = projectedCompleteBytes <= outputLimitBytes;

    expect(result.status).toBe(completeOutputFits ? "included" : "partial");
    if (completeOutputFits) {
      expect(result.limitation).toBeUndefined();
      expect(result.items).toHaveLength(requests.length);
    } else {
      expect(result.items.length).toBeLessThan(requests.length);
      expect(result.limitation).toContain(
        `${String(requests.length - result.items.length)} requested maps`,
      );
      expect(projectedCompleteBytes).toBeGreaterThan(outputLimitBytes);
    }
    expect(result.processed).toBe(result.items.length);
    expect(result.requested).toBe(requests.length);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      outputLimitBytes,
    );
  }, 120_000);

  it("reserves large failure contexts and reports unprocessed requests as unknown", async () => {
    const largeDeclaredUrl = `${origin}/${"u".repeat(8 * 1_024 * 1_024)}`;
    const requests = [
      request,
      ...Array.from({ length: 5 }, (_, index) => ({
        ...request,
        scriptKey: `scr_${String(index + 2).padStart(64, "0")}`,
        declaredUrl: largeDeclaredUrl,
        fetchUrl: `${origin}/invalid-${String(index)}.map`,
      })),
    ];
    let calls = 0;
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      fetch: () => {
        calls += 1;
        return Promise.resolve(
          calls === 1
            ? validMapResponse()
            : new Response("not-json", { status: 200 }),
        );
      },
    });

    expect(calls).toBe(4);
    expect(result).toMatchObject({
      status: "partial",
      requested: 6,
      processed: 4,
      limitation: expect.stringContaining("2 requested maps"),
    });
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "invalid",
      "invalid",
      "invalid",
    ]);
    expect(
      result.items.slice(1).map(({ declared_url }) => declared_url),
    ).toEqual([largeDeclaredUrl, largeDeclaredUrl, largeDeclaredUrl]);
    expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThanOrEqual(
      32 * 1_024 * 1_024,
    );
  });
});

describe("expanded source-map evidence budget", () => {
  it("retains a large declared source whose exact public representation fits the budget", async () => {
    const source = "x".repeat(12 * 1024 * 1024);
    const map = JSON.stringify({
      version: 3,
      names: [],
      sources: [source],
      mappings: "",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response(map, { status: 200 })),
    });
    expect(result.items[0]?.status).toBe("included");
    expect(result.items[0]?.original_sources[0]?.source).toBe(
      `${origin}/assets/${source}`,
    );
  });

  it("releases discarded malformed maps before reserving a later valid map", async () => {
    const malformed = JSON.stringify({
      version: 3,
      names: [],
      sourceRoot: "a/../".repeat(3_300_000),
      sources: ["main.ts"],
      mappings: "ACAA",
    });
    const valid = JSON.stringify({
      version: 3,
      names: [],
      sources: ["main.js"],
      sourcesContent: [`export default "${"x".repeat(2 * 1024 * 1024)}";`],
      mappings: "AAAA",
    });
    const responses = [malformed, malformed, valid];
    const result = await fetchWebSourceMapsOk(
      responses.map((_, index) => ({
        ...request,
        scriptKey: `scr_${String(index + 1).padStart(64, "0")}`,
      })),
      input(),
      undefined,
      {
        fetch: () =>
          Promise.resolve(new Response(responses.shift(), { status: 200 })),
      },
    );
    expect(result.items.map(({ status }) => status)).toEqual([
      "invalid",
      "invalid",
      "included",
    ]);
    expect(result.items[2]?.artifact?.text).toBe(valid);
  }, 15_000);

  it("bounds expanded evidence across individually valid maps", async () => {
    const expanded = JSON.stringify({
      version: 3,
      names: [],
      sources: ["x".repeat(60_000)],
      mappings: Array.from({ length: 280 }, () => "AAAA").join(","),
    });
    const responses = [expanded, expanded];
    const requests = Array.from({ length: 2 }, (_, index) => ({
      ...request,
      scriptKey: `scr_${String(index + 1).padStart(64, "0")}`,
    }));
    const result = await fetchWebSourceMapsOk(requests, input(), undefined, {
      fetch: () =>
        Promise.resolve(new Response(responses.shift() ?? "", { status: 200 })),
    });

    expect(result.status).toBe("partial");
    expect(result.items.map(({ status }) => status)).toEqual([
      "included",
      "fetch_failed",
    ]);
    expect(result.items[0]?.mappings).toHaveLength(280);
    expect(result.items[1]?.limitation).toContain(
      "Expanded source-map evidence",
    );
    expect(result.items[1]?.mappings).toEqual([]);
  });

  it("accepts a large raw source root that the pinned resolver normalizes away", async () => {
    const map = JSON.stringify({
      version: 3,
      names: [],
      sourceRoot: "a/../".repeat(2_300_000),
      sources: ["main.ts"],
      mappings: "",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response(map, { status: 200 })),
    });

    expect(result.items[0]?.status).toBe("included");
    expect(result.items[0]?.original_sources[0]?.source).toBe(
      `${origin}/assets/main.ts`,
    );
  });

  it("rejects a large resolved source product before allocating mapping rows", async () => {
    const map = JSON.stringify({
      version: 3,
      names: [],
      sourceRoot: "x".repeat(8 * 1_024 * 1_024),
      sources: ["main.ts"],
      mappings: "AAAA,AAAA,AAAA",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response(map, { status: 200 })),
    });

    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      artifact: null,
      mappings: [],
    });
    expect(result.items[0]?.limitation).toContain(
      "Expanded source-map evidence",
    );
  });

  it("bounds raw resolved identities even when URL sanitization removes credentials", async () => {
    const userinfo = "u".repeat(1 * 1_024 * 1_024);
    const map = JSON.stringify({
      version: 3,
      names: [],
      sourceRoot: `https://${userinfo}@sources.example.test/`,
      sources: Array.from({ length: 65 }, (_, index) => `source-${index}.ts`),
      mappings: "",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(new Response(map, { status: 200 })),
    });

    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      artifact: null,
      original_sources: [],
    });
    expect(result.items[0]?.limitation).toContain(
      "Resolved source-map identities exceed the 64 MiB decoder representation budget",
    );
  });
});

describe("raw source-map structure preflight", () => {
  it("budgets source inventory before schema parsing its entries", async () => {
    const mapText = JSON.stringify({
      version: 3,
      names: [],
      sources: Array.from({ length: 262_145 }, (_, index) =>
        index === 0 ? 42 : "source.js",
      ),
      mappings: "",
    });
    const response = new Response(mapText, { status: 200 });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: () => Promise.resolve(response),
    });

    expect(result.items[0]).toMatchObject({
      status: "fetch_failed",
      artifact: null,
    });
    expect(result.items[0]?.limitation).toContain("262144-record");
  });
});

const validMapResponse = () =>
  new Response(
    JSON.stringify({
      version: 3,
      names: [],
      sources: ["a.js"],
      sourcesContent: ["export const a = 1"],
      mappings: "AAAA",
    }),
    { status: 200 },
  );

const input = (overrides: Record<string, unknown> = {}) => {
  return analyzeWebBundleInputSchema.parse({
    cdp_endpoint: "http://127.0.0.1:9222",
    allowed_origins: [origin],
    target_id: "page-1",
    fetch_source_maps: true,
    ...overrides,
  });
};

it("keeps bare original module specifiers unresolved", async () => {
  const result = await fetchWebSourceMapsOk([request], input(), undefined, {
    fetch: () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            version: 3,
            names: [],
            sources: ["main.ts"],
            sourcesContent: ['import "package-name"; import "./actual.js";'],
            mappings: "AAAA",
          }),
        ),
      ),
  });
  const edges = result.items[0]?.original_module_edges;
  expect(
    edges?.find(({ specifier }) => specifier === "package-name")
      ?.resolved_source,
  ).toBeNull();
  expect(
    edges?.find(({ specifier }) => specifier === "./actual.js")
      ?.resolved_source,
  ).toContain("/assets/actual.js");
});

describe("source-map original artifact language metadata", () => {
  it.each([
    ["main.ts", "text/typescript"],
    ["main.tsx", "text/typescript"],
    ["main.mts", "text/typescript"],
    ["main.cts", "text/typescript"],
    ["main.js", "text/javascript"],
    ["main.mjs", "text/javascript"],
    ["main.cjs", "text/javascript"],
    ["main.ts?revision=2", "text/typescript"],
    ["main.tsx?revision=2", "text/typescript"],
    ["main.mts?revision=2", "text/typescript"],
    ["main.cts?revision=2", "text/typescript"],
    ["main.ts#original", "text/typescript"],
    ["main.tsx#original", "text/typescript"],
    ["main.mts#original", "text/typescript"],
    ["main.cts#original", "text/typescript"],
    ["main.js?filename=main.ts", "text/javascript"],
    ["main.js#main.ts", "text/javascript"],
    ["extensionless?revision=2", "text/javascript"],
  ])("retains the source language for %s", async (filename, mediaType) => {
    const text =
      mediaType === "text/typescript"
        ? "export const value: number = 1;"
        : "export const value = 1;";
    const server = createServer((_incoming, response) => {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          version: 3,
          sources: [filename],
          sourcesContent: [text],
          names: [],
          mappings: "AAAA",
        }),
      );
    });
    try {
      await new Promise<void>((resolve, reject) => {
        server.once("error", reject);
        server.listen(0, "127.0.0.1", resolve);
      });
      const address = server.address();
      if (address === null || typeof address === "string")
        throw new TypeError("Expected a TCP listener address");
      const localOrigin = `http://127.0.0.1:${String(address.port)}`;
      const url = `${localOrigin}/main.js.map`;
      const result = await fetchWebSourceMapsOk(
        [{ ...request, fetchUrl: url, declaredUrl: url }],
        input({ allowed_origins: [localOrigin] }),
        AbortSignal.timeout(2_000),
      );
      expect(result).toMatchObject({
        status: "included",
        items: [
          {
            original_sources: [
              {
                source: `${localOrigin}/${filename}`,
                artifact: {
                  media_type: mediaType,
                  text,
                  bytes: Buffer.byteLength(text),
                  sha256: createHash("sha256").update(text).digest("hex"),
                },
              },
            ],
            mappings: [{ source: `${localOrigin}/${filename}` }],
          },
        ],
      });
    } finally {
      server.closeAllConnections();
      if (server.listening)
        await new Promise<void>((resolve, reject) => {
          server.close((error) =>
            error === undefined ? resolve() : reject(error),
          );
        });
    }
  });
});

describe("deep source-map original syntax", () => {
  it("retains valid source maps and native/CommonJS evidence after a parser-admitted deep property chain", async () => {
    const source = `const value = root${".next".repeat(12_000)};\nimport "./last.js";\nrequire("./common.js");\nfunction local(require) { require("./shadowed.js"); }`;
    const text = JSON.stringify({
      version: 3,
      names: [],
      sources: ["../src/main.js"],
      sourcesContent: [source],
      mappings: "AAAA",
    });
    const result = await fetchWebSourceMapsOk([request], input(), undefined, {
      fetch: async () => new Response(text),
    });
    expect(result).toMatchObject({
      status: "included",
      items: [
        {
          status: "included",
          limitation: null,
          artifact: { text },
          original_sources: [{ artifact: { text: source } }],
          original_module_edges: [
            {
              from_source: `${origin}/src/main.js`,
              kind: "static_import",
              specifier: "./last.js",
              resolved_source: `${origin}/src/last.js`,
            },
            {
              from_source: `${origin}/src/main.js`,
              kind: "require",
              specifier: "./common.js",
              resolved_source: `${origin}/src/common.js`,
            },
          ],
          mappings: [
            {
              generated_line: 1,
              generated_column: 0,
              original_line: 1,
              original_column: 0,
            },
          ],
        },
      ],
    });
  });
});
