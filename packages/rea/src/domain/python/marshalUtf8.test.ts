import { expect, it } from "vitest";

import { decodeMarshalUtf8 } from "./marshalUtf8.js";

it.each([
  ["efbbbfeda080efbbbfedbfbfefbbbf", "\ufeff\ud800\ufeff\udfff\ufeff"],
  ["ed9fbfeda080ee8080", "\ud7ff\ud800\ue000"],
  ["f0908080eda080f48fbfbf", "\ud800\udc00\ud800\udbff\udfff"],
  ["eda080edbfbf", "\ud800\udfff"],
  ["616263eda080646566edbfbf676869", "abc\ud800def\udfffghi"],
])(
  "preserves ordinary UTF-8 spans around marshal surrogates (%s)",
  (hex, value) => {
    expect(decodeMarshalUtf8(Buffer.from(hex, "hex"))).toEqual({
      ok: true,
      value: { text: value, prefixEnd: value.length },
    });
  },
);

it("keeps source-point boundaries before UTF-16 merges adjacent surrogate encodings", () => {
  const prefix = "a".repeat(79);
  const scalar = Buffer.from(prefix + "\u{10000}z");
  const separate = Buffer.concat([
    Buffer.from(prefix),
    Buffer.from("eda080edb080", "hex"),
    Buffer.from("z"),
  ]);
  const a = decodeMarshalUtf8(scalar, 80);
  const b = decodeMarshalUtf8(separate, 80);
  expect(a).toEqual({
    ok: true,
    value: { text: prefix + "\u{10000}z", prefixEnd: 79 },
  });
  expect(b).toEqual({
    ok: true,
    value: { text: prefix + "\ud800\udc00z", prefixEnd: 80 },
  });
  if (a.ok && b.ok) {
    expect(a.value.text.slice(0, a.value.prefixEnd)).toBe(prefix);
    expect(b.value.text.slice(0, b.value.prefixEnd)).toBe(prefix + "\ud800");
  }
});

it("validates bytes after a closed preview and preserves whole boundary controls", () => {
  expect(decodeMarshalUtf8(Buffer.from("\u{1f600}".repeat(40)), 80)).toEqual({
    ok: true,
    value: { text: "\u{1f600}".repeat(40), prefixEnd: 80 },
  });
  expect(decodeMarshalUtf8(Buffer.from("abc"), 0)).toEqual({
    ok: true,
    value: { text: "abc", prefixEnd: 0 },
  });
  expect(
    decodeMarshalUtf8(
      Buffer.concat([
        Buffer.from("a".repeat(100)),
        Buffer.from("eda08080", "hex"),
      ]),
      80,
    ),
  ).toEqual({ ok: false, error: { kind: "invalid-marshal-utf8" } });
});

it.each([
  "c2eda080",
  "e282eda080",
  "f09080eda080",
  "80eda080",
  "eda08080",
  "eda080c2",
  "eda080e08080",
  "eda080f4908080",
  "eda080eda0",
  "eda0eda080",
])("does not hide malformed bytes beside a marshal surrogate (%s)", (hex) => {
  expect(decodeMarshalUtf8(Buffer.from(hex, "hex"))).toEqual({
    ok: false,
    error: { kind: "invalid-marshal-utf8" },
  });
});
