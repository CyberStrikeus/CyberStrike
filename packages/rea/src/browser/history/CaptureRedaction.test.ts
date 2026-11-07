import { expect, it } from "vitest";
import { CaptureRedaction } from "./CaptureRedaction.js";

it.each([
  {
    value: " https://user:password@example.test/path ",
    expected: " https://example.test/path ",
  },
  {
    value: "\tHTTPS://user:password@example.test/path\t",
    expected: "\tHTTPS://example.test/path\t",
  },
  {
    value: " \t//user:password@example.test/path?token=ordinary#fragment\t ",
    expected: " \t//example.test/path?token=ordinary#fragment\t ",
  },
  {
    value: "\r\n \v\fhttps://user:password@example.test/path",
    expected: "\r\n \v\fhttps://example.test/path",
  },
  {
    value: "\u0000\u001f//user:password@example.test/path",
    expected: "\u0000\u001f//example.test/path",
  },
])(
  "excludes URL userinfo after optional whitespace while preserving the original header text: $value",
  ({ value, expected }) => {
    const redactor = new CaptureRedaction([]);
    expect(redactor.text(value, "/response/headers/0/value", {})).toBe(
      expected,
    );
    expect(redactor.redactions).toEqual([
      { pointer: "/response/headers/0/value", reason: "transport-credential" },
    ]);
  },
);

it("preserves the same URL-looking text in an ordinary extension", () => {
  const redactor = new CaptureRedaction([]);
  const value = " \thttps://user:password@example.test/path\t ";
  expect(redactor.text(value, "/_extension")).toBe(value);
  expect(redactor.redactions).toEqual([]);
});

it.each([
  "https:user:password@example.test/path",
  "https:///user:password@example.test/path",
  "https://\\user:password@example.test/path",
  "https://\t/user:password@example.test/path",
  "https://\n/user:password@example.test/path",
  "https://\r/user:password@example.test/path",
  "ht\ttps://user:password@example.test/path",
  "\\\\user:password@example.test/path",
  "/\\user:password@example.test/path",
  "\\/user:password@example.test/path",
  "/\t/user:password@example.test/path",
])("excludes credentials whose raw URL span is ambiguous: %s", (value) => {
  const redactor = new CaptureRedaction([]);
  expect(redactor.text(value, "/request/url", {})).toBeNull();
  expect(redactor.redactions).toEqual([
    { pointer: "/request/url", reason: "transport-credential" },
  ]);
  expect(new CaptureRedaction([]).text(value, "/_extension")).toBe(value);
});

it("uses non-special URL authority rules to remove the complete userinfo span", () => {
  const value = "custom://user:secret@part\\more:password@host/path";
  const redactor = new CaptureRedaction([]);
  expect(redactor.text(value, "/response/redirectURL", {})).toBe(
    "custom://host/path",
  );
  expect(redactor.redactions).toEqual([
    { pointer: "/response/redirectURL", reason: "transport-credential" },
  ]);
});

it("preserves noncanonical URLs and path/query userinfo lookalikes without parsed credentials", () => {
  for (const value of [
    "https:example.test/path?token=ordinary",
    "https://example.test/a/%2e%2e/user:password@literal?url=user:password@literal",
    "https://example.test\\user:password@literal",
    "https://invalid host\\user:password@literal",
    "//invalid host\\user:password@literal",
  ]) {
    const redactor = new CaptureRedaction([]);
    expect(redactor.text(value, "/request/url", {})).toBe(value);
    expect(redactor.redactions).toEqual([]);
  }
});

it.each(["\ud800", "\udfff"])(
  "does not invent replacement UTF-8 bytes for a non-scalar declaration",
  (literal) => {
    const redactor = new CaptureRedaction([literal]);
    expect(redactor.sensitiveBytes(Buffer.from("\ufffd"))).toBe(false);
    expect(redactor.text(literal, "/reported")).toBe(null);
  },
);

it("matches scalar UTF-8 declarations and complete surrogate pairs exactly", () => {
  expect(
    new CaptureRedaction(["\ufffd"]).sensitiveBytes(Buffer.from("\ufffd")),
  ).toBe(true);
  expect(
    new CaptureRedaction(["\ud83d\ude00"]).sensitiveBytes(Buffer.from("😀")),
  ).toBe(true);
});
