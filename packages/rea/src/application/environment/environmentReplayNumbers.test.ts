import { describe, expect, it } from "vitest";
import { environmentServeSourceWithBody as singleExchangeSource } from "../../../tests/fixtures/environmentServe.js";
import type { EnvironmentSource } from "./environmentSource.js";
import { replayEnvironmentTool } from "./environmentReplay.js";
const replay = (
  name: string,
  args: Readonly<Record<string, unknown>>,
  source: EnvironmentSource,
) => {
  const tool = source.manifest.tools.find((tool) => tool.name === name);
  if (tool === undefined) throw new Error("Missing fixture tool");
  const result = replayEnvironmentTool(source, tool, args);
  if (!result.ok) throw result.error;
  return result.value;
};
describe("replay JSON value fidelity", () => {
  it.each([
    '{"id":9007199254740993}',
    '{"id":9007199254740993.0}',
    '{"id":9.007199254740993e15}',
    '{"id":1e20}',
    '[{"id":18446744073709551615}]',
    '{"value":0.100000000000000005}',
    '{"value":1e-1000}',
    '{"value":-0}',
  ])(
    "retains numeric JSON as text when conversion loses its value: %s",
    (text) => {
      expect(
        replay(
          "get_users_by_id",
          {},
          singleExchangeSource(text, "application/json"),
        ),
      ).toMatchObject({
        body: text,
        replay: {
          truncated: false,
          body_recorded: true,
          body_encoding: "utf-8",
        },
      });
    },
  );

  it("still parses equivalent ordinary numeric spellings", () => {
    const text = '{"integer":1.0,"exponent":1e3,"fraction":0.1}';
    expect(
      replay(
        "get_users_by_id",
        {},
        singleExchangeSource(text, "application/json"),
      ).body,
    ).toEqual({ integer: 1, exponent: 1000, fraction: 0.1 });
  });

  it("retains own prototype-named JSON properties", () => {
    const text = '{"__proto__":{"retained":true},"constructor":1}';
    const result = replay(
      "get_users_by_id",
      {},
      singleExchangeSource(text, "application/json"),
    );
    expect(JSON.stringify(result.body)).toBe(text);
  });
});
