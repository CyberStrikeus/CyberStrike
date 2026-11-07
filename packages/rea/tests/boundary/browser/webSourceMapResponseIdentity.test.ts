import { createHash } from "node:crypto";
import { expect, it, onTestFinished, vi } from "vitest";

import { fetchWebSourceMaps } from "../../../src/browser/WebSourceMapFetcher.js";
import {
  analyzeWebBundleInputSchema,
  webSourceMapsSchema,
} from "../../../src/domain/webBundleAnalysis.js";

const origin = "https://maps.example.test";
const request = (index: number) => ({
  scriptKey: `scr_${String(index).padStart(64, "0")}`,
  declaredUrl: `${origin}/${String(index)}.js.map`,
  fetchUrl: `${origin}/${String(index)}.js.map`,
});
const input = analyzeWebBundleInputSchema.parse({
  cdp_endpoint: "http://127.0.0.1:9222",
  allowed_origins: [origin],
  target_id: "page-1",
  fetch_source_maps: true,
});
const digest = (bytes: Uint8Array | string): string =>
  createHash("sha256").update(bytes).digest("hex");

it.each([
  { label: "an empty body", body: "" },
  { label: "JSON", body: "not-json" },
  { label: "BOM and XSSI framing", body: "\uFEFF)]}'\nnot-json" },
  {
    label: "mapping indices",
    body: JSON.stringify({
      version: 3,
      sources: ["a.js"],
      names: [],
      mappings: "ACAA",
    }),
  },
])(
  "retains completed body identity when $label is invalid",
  async ({ body }) => {
    const result = await fetchWebSourceMaps([request(1)], input, undefined, {
      fetch: () => Promise.resolve(new Response(body, { status: 200 })),
    });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      status: "unavailable",
      requested: 1,
      processed: 1,
      items: [
        {
          status: "invalid",
          artifact: null,
          response_identity: {
            sha256: digest(body),
            bytes: Buffer.byteLength(body),
            representation: "fetch-response-body-bytes",
          },
          original_sources: [],
          original_module_edges: [],
          mappings: [],
          limitation: expect.stringContaining("Response text was not retained"),
        },
      ],
    });
    expect(webSourceMapsSchema.parse(result.value)).toEqual(result.value);
  },
);

it("retains only completed response bytes when UTF-8 decoding fails", async () => {
  const body = Uint8Array.of(0x7b, 0x22, 0xc3, 0x28, 0x22, 0x7d);
  const result = await fetchWebSourceMaps([request(1)], input, undefined, {
    fetch: () => Promise.resolve(new Response(body, { status: 200 })),
  });
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    status: "unavailable",
    items: [
      {
        status: "invalid",
        artifact: null,
        response_identity: {
          sha256: digest(body),
          bytes: body.byteLength,
          representation: "fetch-response-body-bytes",
        },
        original_sources: [],
        original_module_edges: [],
        mappings: [],
        limitation: expect.stringContaining("Response text was not retained"),
      },
    ],
  });
});

it("retains completed body identity when map interpretation reaches its deadline", async () => {
  const body = JSON.stringify({
    version: 3,
    sources: ["a.js"],
    names: [],
    mappings: "AAAA",
  });
  const response = new Response(body, { status: 200 });
  const realDecode = TextDecoder.prototype.decode;
  let clock = 0;
  const clockSpy = vi.spyOn(performance, "now").mockImplementation(() => clock);
  const decodeSpy = vi
    .spyOn(TextDecoder.prototype, "decode")
    .mockImplementation(function (
      this: TextDecoder,
      input?: Parameters<TextDecoder["decode"]>[0],
      options?: Parameters<TextDecoder["decode"]>[1],
    ) {
      const text = realDecode.call(this, input, options);
      clock = 1_001;
      return text;
    });
  try {
    const result = await fetchWebSourceMaps([request(1)], input, undefined, {
      timeoutMs: 1_000,
      fetch: () => Promise.resolve(response),
    });
    if (!result.ok) throw result.error;
    expect(result.value).toMatchObject({
      status: "unavailable",
      requested: 1,
      processed: 1,
      items: [
        {
          status: "fetch_failed",
          artifact: null,
          response_identity: {
            sha256: digest(body),
            bytes: Buffer.byteLength(body),
            representation: "fetch-response-body-bytes",
          },
          original_sources: [],
          original_module_edges: [],
          mappings: [],
          limitation: expect.stringContaining(
            "source_map_fetch_timeout_ms deadline",
          ),
        },
      ],
    });
  } finally {
    decodeSpy.mockRestore();
    clockSpy.mockRestore();
  }
});

it("refuses oversized text before JSON interpretation while retaining body identity and later maps", async () => {
  // JSON escaping expands these decoded control characters beyond the fixed
  // 32 MiB source-map output allowance while the response stays below 64 MiB.
  const oversized = Buffer.alloc(6 * 1024 * 1024, 1);
  const oversizedText = oversized.toString("utf8");
  const valid = JSON.stringify({
    version: 3,
    sources: ["a.js"],
    names: [],
    mappings: "AAAA",
  });
  const parseSpy = vi.spyOn(JSON, "parse");
  onTestFinished(() => parseSpy.mockRestore());
  let calls = 0;
  const result = await fetchWebSourceMaps(
    [request(1), request(2)],
    input,
    undefined,
    {
      fetch: () =>
        Promise.resolve(
          new Response(calls++ === 0 ? oversized : valid, { status: 200 }),
        ),
    },
  );
  if (!result.ok) throw result.error;
  expect(result.value).toMatchObject({
    status: "partial",
    requested: 2,
    processed: 2,
    items: [
      {
        status: "fetch_failed",
        artifact: null,
        response_identity: {
          sha256: digest(oversized),
          bytes: oversized.byteLength,
          representation: "fetch-response-body-bytes",
        },
        mappings: [],
        limitation: expect.stringContaining("Response text was not retained"),
      },
      { status: "included", artifact: { text: valid }, mappings: [{}] },
    ],
  });
  expect(Buffer.byteLength(JSON.stringify(result.value))).toBeLessThanOrEqual(
    32 * 1024 * 1024,
  );
  expect(parseSpy.mock.calls.some(([text]) => text === oversizedText)).toBe(
    false,
  );
  expect(calls).toBe(2);
});

it("keeps historical invalid rows with no response identity admissible", () => {
  const historical = {
    status: "unavailable",
    requested: 1,
    processed: 1,
    items: [
      {
        script_key: request(1).scriptKey,
        declared_url: request(1).declaredUrl,
        status: "invalid",
        artifact: null,
        original_sources: [],
        original_module_edges: [],
        mappings: [],
        limitation: "Source-map JSON is not a version 3 map.",
      },
    ],
  };
  expect(webSourceMapsSchema.parse(historical)).toMatchObject(historical);
});
