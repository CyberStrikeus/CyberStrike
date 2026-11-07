import { expect, it } from "vitest";
import {
  parseJadxEnvelope,
  parseJadxClassPage,
  parseJadxJson,
  normalizeJadxText,
  parseJadxFailure,
} from "../../../src/android/JadxProtocol.js";
import { androidInputSchemas } from "../../../src/domain/android/androidAnalysis.js";

it("recognizes named bridge failures without reinterpreting arbitrary engine text", () => {
  const failure = {
    kind: "jvm-memory-failure",
    memory_area: "heap",
    exception_type: "java.lang.OutOfMemoryError",
    message: "Java heap space",
    max_heap_bytes: 67108864,
  };
  expect(parseJadxFailure(JSON.stringify(failure))).toEqual(failure);
  for (const value of [
    "load failed: cannot read /inputs/Java heap space.apk",
    "{malformed Java heap space",
    JSON.stringify({
      ...failure,
      exception_type: "java.lang.IllegalArgumentException",
    }),
    JSON.stringify({ ...failure, max_heap_bytes: -1 }),
    JSON.stringify({ ...failure, memory_area: "native" }),
    JSON.stringify({ ...failure, arbitrary: true }),
  ])
    expect(parseJadxFailure(value)).toBeUndefined();
});

it("recognizes only complete external-reference allowance diagnostics", () => {
  const failure = {
    kind: "reference-output-limit",
    stage: "caller_inventory",
    limit_bytes: 1_048_448,
  };
  expect(parseJadxFailure(JSON.stringify(failure))).toEqual(failure);
  for (const changed of [
    { stage: "arbitrary" },
    { limit_bytes: 0 },
    { limit_bytes: 0.5 },
    { extra: "unrelated" },
  ])
    expect(
      parseJadxFailure(JSON.stringify({ ...failure, ...changed })),
    ).toBeUndefined();
});

it("validates provider text envelopes and rejects unsupported content rather than dropping it", () => {
  expect(
    parseJadxEnvelope(
      { content: [{ type: "text", text: "reported error" }], isError: true },
      "inspect_android_package",
    ),
  ).toEqual({
    content: [{ type: "text", text: "reported error" }],
    isError: true,
  });
  for (const response of [
    { content: [] },
    { content: [{ type: "image", data: "AA==", mimeType: "image/png" }] },
    {
      content: [
        { type: "text", text: "first" },
        { type: "text", text: "second" },
      ],
    },
  ])
    expect(() =>
      parseJadxEnvelope(response, "inspect_android_package"),
    ).toThrowError("unsupported MCP content envelope");
  expect(() =>
    parseJadxJson("{malformed", "inspect_android_package"),
  ).toThrowError("malformed JSON text");
});

it("retains UTF-8 source and recognizes only the producer's terminal truncation marker", () => {
  expect(normalizeJadxText("日本語")).toEqual({
    text: "日本語",
    status: "complete",
    reported_total_bytes: null,
  });
  const text = "日本語\n\n... [truncated: exceeds 9 bytes, total 100 bytes]";
  expect(normalizeJadxText(text)).toEqual({
    text,
    status: "partial",
    reported_total_bytes: 100,
  });
  expect(normalizeJadxText(text + "\nmore actual source").status).toBe(
    "complete",
  );
});

it("rejects invalid APK selectors and accepts an explicit zero overload without a confirmation flag", () => {
  const input = {
    path: "/fixture.apk",
    class_name: "fixture.Target",
    method_name: "choose",
  };
  expect(
    androidInputSchemas.inspect_android_method.safeParse({
      ...input,
      overload_index: 0,
    }).success,
  ).toBe(true);
  expect(
    androidInputSchemas.inspect_android_method.safeParse({
      ...input,
      overload_index: -1,
    }).success,
  ).toBe(false);
  expect(
    androidInputSchemas.inspect_android_method.safeParse({
      ...input,
      overload_index: 0.5,
    }).success,
  ).toBe(false);
  expect(
    androidInputSchemas.inspect_android_method.safeParse({
      ...input,
      approved: true,
    }).success,
  ).toBe(false);
  expect(
    androidInputSchemas.search_android_classes.safeParse({
      path: "/fixture.apk",
      query: "",
    }).success,
  ).toBe(true);
});

it("preserves JSON page and envelope annotations while rejecting unsupported inventory scope", () => {
  const page = {
    scope: "top_level",
    total_classes: 1,
    offset: 0,
    next_offset: 1,
    limit: 4096,
    items: ["fixture.Target"],
    audit: { source: "雪", missing: null },
  };
  Object.defineProperty(page, "__proto__", {
    value: { observed: "page" },
    enumerable: true,
  });
  expect(parseJadxClassPage(page)).toEqual(page);
  expect(Object.hasOwn(parseJadxClassPage(page), "__proto__")).toBe(true);
  expect(() => parseJadxClassPage({ ...page, scope: "all_dex" })).toThrow();
  const response = {
    content: [
      {
        type: "text",
        text: JSON.stringify(page),
        annotations: { audience: ["assistant"] },
      },
    ],
    _meta: { page: 1 },
  };
  Object.defineProperty(response, "__proto__", {
    value: { observed: "envelope" },
    enumerable: true,
  });
  Object.defineProperty(response.content[0], "__proto__", {
    value: { observed: "content" },
    enumerable: true,
  });
  const parsed = parseJadxEnvelope(response, "search_android_classes");
  expect(parsed).toEqual(response);
  expect(Object.hasOwn(parsed, "__proto__")).toBe(true);
  expect(Object.hasOwn(parsed.content[0], "__proto__")).toBe(true);
});
