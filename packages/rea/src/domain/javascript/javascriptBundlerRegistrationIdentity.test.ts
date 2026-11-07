import { expect, it } from "vitest";
import { analyzeJavaScriptStaticSource } from "./javascriptStaticAnalysis.js";

const registration = (runtime: string, callback: string, chunk = 1) =>
  "(globalThis." +
  runtime +
  " = globalThis." +
  runtime +
  " || []).push([[" +
  chunk +
  "], {a: function() {}}, " +
  callback +
  "]);";

it.each(["webpackChunkFixture", "rspackChunkFixture"])(
  "keeps differing callback facts for %s independent of source order",
  (runtime) => {
    const first = registration(
      runtime,
      'function(r) { r(7); r.e("chunk-a"); }',
    );
    const second = registration(
      runtime,
      'function(r) { r(8); r.e("chunk-b"); }',
    );
    for (const source of [first + "\n" + second, second + "\n" + first]) {
      const result = analyzeJavaScriptStaticSource(source);
      expect(result.parse_status).toBe("complete");
      expect(result.bundler_registrations).toHaveLength(2);
      expect(
        result.bundler_registrations.flatMap((r) => r.entry_module_keys).sort(),
      ).toEqual(["7", "8"]);
      expect(
        result.bundler_registrations.flatMap((r) => r.async_chunk_keys).sort(),
      ).toEqual(["chunk-a", "chunk-b"]);
    }
    expect(
      analyzeJavaScriptStaticSource(first + "\n" + first).bundler_registrations,
    ).toHaveLength(1);
    expect(
      analyzeJavaScriptStaticSource(first).bundler_registrations[0],
    ).toMatchObject({
      entry_module_keys: ["7"],
      async_chunk_keys: ["chunk-a"],
    });
    expect(
      analyzeJavaScriptStaticSource(second).bundler_registrations[0],
    ).toMatchObject({
      entry_module_keys: ["8"],
      async_chunk_keys: ["chunk-b"],
    });
  },
);

it.each([
  ["function(r) { r(7); }", "function(r) { r(8); }"],
  ['function(r) { r.e("a"); }', 'function(r) { r.e("b"); }'],
  ["function(r) {}", "function(s) {}"],
  ["function(r) {}", "function(r) { r(dynamic); }"],
  ["function(r) {}", "function(r) { r.e(dynamic); }"],
])("retains callback metadata differences: %s / %s", (left, right) => {
  const result = analyzeJavaScriptStaticSource(
    registration("webpackChunkFixture", left) +
      "\n" +
      registration("webpackChunkFixture", right),
  );
  expect(result.bundler_registrations).toHaveLength(2);
});

it("retains distinct chunk identities with identical callbacks", () => {
  const callback = "function(r) { r(7); }";
  const result = analyzeJavaScriptStaticSource(
    registration("webpackChunkFixture", callback, 1) +
      "\n" +
      registration("webpackChunkFixture", callback, 2),
  );
  expect(result.bundler_registrations).toHaveLength(2);
});
