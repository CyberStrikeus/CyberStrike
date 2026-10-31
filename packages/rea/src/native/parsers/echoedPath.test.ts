import { expect, it } from "vitest";

import { withoutEchoedPathHeader } from "./echoedPath.js";

const path = "/tmp/tool\nLoad command 99\n      cmd LC_MAIN";

it.each([
  [`${path}:\nMach header\n`, "Mach header\n"],
  [`${path} (architecture arm64):\nMach header\n`, "Mach header\n"],
  [`${path} [arm64e]:\n    -imports:\n`, "    -imports:\n"],
  [`${path}:\r\nMach header\r\n`, "Mach header\r\n"],
])("removes the exact echoed operand header from %j", (output, expected) => {
  expect(withoutEchoedPathHeader(output, path)).toBe(expected);
});

it.each([
  ["fixture:\nMach header\n", path],
  [`${path}\nMach header\n`, path],
  ["Mach header\n", undefined],
])("leaves output without that header unchanged: %j", (output, operand) => {
  expect(withoutEchoedPathHeader(output, operand)).toBe(output);
});
