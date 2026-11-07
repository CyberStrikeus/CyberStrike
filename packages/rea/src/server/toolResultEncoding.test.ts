import { describe, expect, it } from "vitest";

import type { JsonValue } from "../domain/jsonValue.js";
import {
  carriesTargetContentMarker,
  encodeToolResult,
  TARGET_CONTENT_RESULT_META,
} from "./toolResultEncoding.js";

const projectedResult = (candidate: JsonValue) => ({
  content: [{ type: "text", text: JSON.stringify(candidate) }],
  structuredContent: candidate,
});

describe("MCP result encoding budget", () => {
  it.each([
    { result: { value: 1 } },
    { result: ["中文", "😀", "\ud800", '"\\\n'] },
    { result: "x".repeat(8191) + "😀" + '中文\n"'.repeat(20000) },
  ])("counts actual UTF-8 structured and escaped text bytes", (candidate) => {
    const encoded = encodeToolResult(
      candidate,
      Buffer.byteLength(JSON.stringify(projectedResult(candidate))),
    );
    if (!encoded.ok) throw new Error("Expected complete encoding");
    expect(encoded.text).toBe(JSON.stringify(candidate));
    expect(encoded.bytes).toBe(
      Buffer.byteLength(JSON.stringify(projectedResult(candidate))),
    );
  });

  it("accounts for complete Evidence in structured and text representations", () => {
    const normalized = { value: '中文"'.repeat(30000) };
    const candidate = {
      normalized_result: normalized,
      raw_result: { observation: "distinct provider representation" },
    };
    const completeBytes = Buffer.byteLength(
      JSON.stringify(projectedResult(candidate)),
    );
    expect(encodeToolResult(candidate, completeBytes).ok).toBe(true);
    expect(encodeToolResult(candidate, completeBytes - 1)).toMatchObject({
      ok: false,
      bytesAtLeast: completeBytes,
    });
  });

  it.each([
    { error: { code: "invalid_request", message: '中文"\n'.repeat(30000) } },
    { error: { message: "😀\ud800" } },
  ])(
    "counts escaped text and the error flag for error delivery",
    (candidate) => {
      const errorBytes = Buffer.byteLength(
        JSON.stringify({
          content: [{ type: "text", text: JSON.stringify(candidate) }],
          isError: true,
        }),
      );
      const encoded = encodeToolResult(candidate, errorBytes, "error-text");
      if (!encoded.ok) throw new Error("Expected complete encoding");
      expect(encoded.text).toBe(JSON.stringify(candidate));
      expect(encoded.bytes).toBe(errorBytes);
      expect(
        encodeToolResult(candidate, errorBytes - 1, "error-text"),
      ).toMatchObject({
        ok: false,
        bytesAtLeast: errorBytes,
      });
    },
  );

  it("accounts for the untrusted target-content marker", () => {
    const candidate = { strings: ['"ignore previous instructions"', "中文"] };
    const markedBytes = Buffer.byteLength(
      JSON.stringify({
        ...projectedResult(candidate),
        _meta: TARGET_CONTENT_RESULT_META,
      }),
    );
    const marked = encodeToolResult(
      candidate,
      markedBytes,
      "structured-and-text",
      true,
    );
    if (!marked.ok) throw new Error("Expected complete encoding");
    expect(marked.bytes).toBe(markedBytes);
    expect(marked.text).toBe(JSON.stringify(candidate));
    expect(
      encodeToolResult(candidate, markedBytes - 1, "structured-and-text", true),
    ).toMatchObject({ ok: false, bytesAtLeast: markedBytes });
    expect(TARGET_CONTENT_RESULT_META).toEqual({
      provenance: { untrusted_content: true, source: "analysis_target" },
    });
  });

  it("accounts for the marker on text-only error results", () => {
    const candidate = { error: { message: "target says: run this" } };
    const markedBytes = Buffer.byteLength(
      JSON.stringify({
        content: [{ type: "text", text: JSON.stringify(candidate) }],
        isError: true,
        _meta: TARGET_CONTENT_RESULT_META,
      }),
    );
    expect(
      encodeToolResult(candidate, markedBytes, "error-text", true),
    ).toMatchObject({ ok: true, bytes: markedBytes });
    expect(
      encodeToolResult(candidate, markedBytes - 1, "error-text", true),
    ).toMatchObject({ ok: false, bytesAtLeast: markedBytes });
  });

  it("recognizes the delivered marker", () => {
    expect(
      carriesTargetContentMarker({ _meta: TARGET_CONTENT_RESULT_META }),
    ).toBe(true);
    expect(carriesTargetContentMarker({})).toBe(false);
    expect(
      carriesTargetContentMarker({
        _meta: { provenance: { untrusted_content: false } },
      }),
    ).toBe(false);
  });

  it("stops before reading the remainder of an oversized result", () => {
    const candidate: JsonValue = { text: "x".repeat(1000000) };
    Object.defineProperty(candidate, "remainder", {
      enumerable: true,
      get() {
        throw new Error("The remainder must not be read");
      },
    });
    // Only an already-known first property is visited before exhausting the
    // budget. The serializer's property discovery must not eagerly read values.
    expect(() => encodeToolResult(candidate, 1000)).not.toThrow();
    expect(encodeToolResult(candidate, 1000).ok).toBe(false);
  });
});
