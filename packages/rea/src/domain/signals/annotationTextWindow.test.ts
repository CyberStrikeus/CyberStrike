import { expect, it } from "vitest";
import { windowAnnotationText } from "./annotationTextWindow.js";

it("preserves line terminators, blank lines and literal display text", () => {
  const text = "1-2 uart-1: 界\r\n\ntext without a sample range\nlast";
  expect(windowAnnotationText(text, 1, 2)).toEqual({
    annotations_text: "\ntext without a sample range\n",
    output_window: { total_lines: 4, returned_lines: 2, has_more: true },
  });
  expect(windowAnnotationText(text, 0, null).annotations_text).toBe(text);
  expect(windowAnnotationText(text, 3, 2)).toEqual({
    annotations_text: "last",
    output_window: { total_lines: 4, returned_lines: 1, has_more: false },
  });
});

it.each(["", "\n", "line\n", "line"])(
  "does not invent a trailing line or normalize %j",
  (text) => {
    expect(windowAnnotationText(text, 0, null)).toEqual({
      annotations_text: text,
      output_window: {
        total_lines: text === "" ? 0 : 1,
        returned_lines: text === "" ? 0 : 1,
        has_more: false,
      },
    });
  },
);

it("returns an empty covered window beyond the last line without unsafe arithmetic", () => {
  expect(
    windowAnnotationText(
      "one\ntwo",
      Number.MAX_SAFE_INTEGER,
      Number.MAX_SAFE_INTEGER,
    ),
  ).toEqual({
    annotations_text: "",
    output_window: { total_lines: 2, returned_lines: 0, has_more: false },
  });
});

it("does not replace source UTF-16 code units when copying a partial window", () => {
  expect(
    windowAnnotationText("first\n\ud800\nlast", 1, 1).annotations_text,
  ).toBe("\ud800\n");
});
