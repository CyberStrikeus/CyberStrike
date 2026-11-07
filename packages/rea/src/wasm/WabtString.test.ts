import { expect, it } from "vitest";
import { parseWabtWat } from "./WabtWat.js";
import { watString, watStringEnd } from "./WabtString.js";

it("frames escaped quotes and trailing backslashes without consuming the next form", () => {
  const source = String.raw`prefix "a\"b\\" (export "next" (func 0))`;
  const end = source.indexOf(" (export");
  expect(watStringEnd(source, 8)).toBe(end);
  expect(watString(source, 8)).toEqual({
    bytes: Buffer.from('a"b\\'),
    end,
  });
  expect(watStringEnd('""', 1)).toBe(2);
  for (const count of [1, 2, 3, 4, 5]) {
    for (const tail of ['"tail', ""]) {
      const value = "\\".repeat(count) + tail;
      const encoded = JSON.stringify(value);
      const source = encoded + ' (export "next" (func 0))';
      expect(watStringEnd(source, 1)).toBe(encoded.length);
      expect(
        Buffer.compare(watString(source, 1).bytes, Buffer.from(value)),
      ).toBe(0);
    }
  }
});

it("rejects missing terminators, including a dangling escape or escaped last quote", () => {
  for (const source of ['"', '"payload', '"payload\\', '"payload\\"']) {
    expect(() => watStringEnd(source, 1)).toThrow(
      expect.objectContaining({
        _tag: "WabtAdmissionError",
        code: "incomplete_string",
      }),
    );
    expect(() => watString(source, 1)).toThrow(
      expect.objectContaining({
        _tag: "WabtAdmissionError",
        code: "incomplete_string",
      }),
    );
    expect(() => parseWabtWat(`(module (import ${source}`)).toThrow();
  }
});

it("preserves quoted WAT punctuation, nested comments, escaped names and unknown signatures", () => {
  const result = parseWabtWat(String.raw`(module
    (; outer " (; inner ;) ;)
    (import "env" "a\"b\\(;);;\00" (func (param i32)))
    (memory 1 (future-proposal "ignored\ff"))
    (export "memory" (memory 0))
    (data (i32.const 0) "(; );) ;; \" \\"))`);
  expect(result.interface.entries).toMatchObject([
    {
      direction: "import",
      name: 'a"b\\(;);;\0',
      signature: { kind: "func", params: ["i32"] },
    },
    {
      direction: "export",
      name: "memory",
      signature: null,
      issue: expect.any(String),
    },
  ]);
  expect(() => parseWabtWat('(module (import "env" "\\q" (func)))')).toThrow(
    expect.objectContaining({
      _tag: "WabtAdmissionError",
      code: "unsupported_escape",
    }),
  );
});
