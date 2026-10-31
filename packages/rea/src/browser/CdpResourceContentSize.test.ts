import { expect, it } from "vitest";
import { resourceContentSize } from "./CdpCaptureValues.js";

it.each([
  [undefined, null],
  [0, 0],
  [128, 128],
  [0.5, 0.5],
])("preserves optional CDP size %s as %s", (input, value) => {
  expect(resourceContentSize(input)).toEqual({ ok: true, value });
});

it.each([-1, null, "4", NaN, Infinity, -Infinity, {}])(
  "rejects supplied invalid CDP size %s without inventing zero",
  (value) => {
    expect(resourceContentSize(value)).toEqual({
      ok: false,
      error: { _tag: "InvalidCdpResourceSize" },
    });
  },
);
