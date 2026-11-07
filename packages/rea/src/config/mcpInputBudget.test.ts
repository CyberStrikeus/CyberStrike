import { expect, it } from "vitest";
import { ConfigurationError } from "../domain/configurationErrors.js";
import {
  DEFAULT_MCP_MAX_INPUT_ELEMENTS,
  parseMcpInputBudget,
} from "./mcpInputBudget.js";

it("defaults to the finite MCP input admission allowance", () => {
  expect(parseMcpInputBudget(undefined)).toEqual({
    ok: true,
    value: DEFAULT_MCP_MAX_INPUT_ELEMENTS,
  });
});

it.each(["1", "8192", "65536", String(Number.MAX_SAFE_INTEGER)])(
  "preserves the selected safe decimal allowance %s",
  (value) => {
    expect(parseMcpInputBudget(value)).toEqual({
      ok: true,
      value: Number(value),
    });
  },
);

it.each([
  "",
  "0",
  "-1",
  "1.5",
  "Infinity",
  "1e5",
  "0x100",
  " 42",
  "9007199254740992",
])("refuses invalid allowance %s without disabling admission", (value) => {
  const parsed = parseMcpInputBudget(value);
  expect(parsed.ok).toBe(false);
  if (parsed.ok) throw new Error("Invalid admission setting was accepted");
  expect(parsed.error).toBeInstanceOf(ConfigurationError);
  expect(parsed.error.settings).toEqual([
    {
      setting: "REA_MCP_MAX_INPUT_ELEMENTS",
      constraint: expect.stringContaining("positive decimal safe integer"),
    },
  ]);
});
