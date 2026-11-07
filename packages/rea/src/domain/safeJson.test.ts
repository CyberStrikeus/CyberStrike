import { expect, it } from "vitest";
import { safeParseUtf8Json } from "./safeJson.js";

it("distinguishes malformed UTF-8 from a literal Unicode replacement character", () => {
  const invalid = Buffer.concat([
    Buffer.from('{"message":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  expect(safeParseUtf8Json(invalid)).toMatchObject({
    ok: false,
    cause: { code: "ERR_ENCODING_INVALID_ENCODED_DATA" },
  });
  expect(safeParseUtf8Json(Buffer.from('{"message":"valid � 雪"}'))).toEqual({
    ok: true,
    value: { message: "valid � 雪" },
  });
});

it.each(["\uFEFF{}", '{"message":', ""])(
  "retains strict JSON failure causes for %j",
  (text) => {
    expect(safeParseUtf8Json(Buffer.from(text))).toMatchObject({
      ok: false,
      cause: expect.any(SyntaxError),
    });
  },
);
