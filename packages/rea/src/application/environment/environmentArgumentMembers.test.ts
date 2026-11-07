import { expect, it } from "vitest";
import { servedFrom } from "../../../tests/fixtures/environmentStateServing.js";
import { matchProbeRequest } from "./environmentCompareMatch.js";
import {
  selectsRecordedLine,
  selectReplayExchange,
} from "./environmentReplay.js";
import { callQuery } from "./environmentStateCallLines.js";
import { pinnedRequest } from "./environmentStateWriteQuery.js";

it.each(["__proto__", "constructor", "toString"])(
  "preserves an own %s probe argument and treats omission as absent",
  (name) => {
    const { source } = servedFrom();
    const original = source.manifest.tools[0]!;
    const tool = {
      ...original,
      method: "GET",
      path_template: "/api/books",
      params: [],
      query_parameter_names: [name],
    };
    const manifest = { ...source.manifest, tools: [tool] };
    const call = matchProbeRequest(manifest, {
      method: "GET",
      path: "/api/books",
      query: `?${name}=selected`,
      body: undefined,
    });
    expect(call).toBeDefined();
    expect(Object.hasOwn(call!.args, name)).toBe(true);
    expect(call!.args[name]).toBe("selected");
    expect([...callQuery(tool, {})]).toEqual([]);
    expect([...callQuery(tool, call!.args)]).toEqual([[name, "selected"]]);
    const exchange = {
      ...source.exchanges.values().next().value!,
      path: "/api/books",
      query: `?${name}=selected`,
    };
    const exchanges = new Map([[exchange.ordinal, exchange]]);
    expect(selectsRecordedLine(tool, exchange, {})).toBe(false);
    expect(selectReplayExchange(tool, exchanges, call!.args)).toMatchObject({
      exact: true,
    });
  },
);

it.each(["__proto__", "constructor"])(
  "fills an omitted pinned %s argument as an own member",
  (name) => {
    const serving = servedFrom();
    const tool = {
      ...serving.source.manifest.tools[0]!,
      params: [],
      query_parameter_names: [name],
    };
    const exchange = {
      ...serving.source.exchanges.values().next().value!,
      query: `?${name}=selected`,
    };
    const source = {
      ...serving.source,
      exchanges: new Map([[exchange.ordinal, exchange]]),
    };
    const plan = {
      ...serving.state.writes.values().next().value!,
      exemplar_ordinal: exchange.ordinal,
    };
    for (const args of [{}, Object.fromEntries([[name, "selected"]])]) {
      const result = pinnedRequest(
        { source, store: serving.store },
        { tool, plan, args },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) throw result.error;
      expect(Object.hasOwn(result.value.args, name)).toBe(true);
      expect(result.value.args[name]).toBe("selected");
    }
  },
);

it("keeps a prototype-named path argument and every own body member in a probe", () => {
  const { source } = servedFrom();
  const tool = {
    ...source.manifest.tools[0]!,
    method: "PATCH",
    path_template: "/api/books/{__proto__}",
    params: [
      {
        name: "__proto__",
        index: 2,
        rule: "numeric" as const,
        basis: "inferred" as const,
        observed_values: ["1"],
      },
    ],
    query_parameter_names: [],
  };
  const body = JSON.parse(
    '{"__proto__":{"selected":true},"constructor":"value"}',
  );
  const call = matchProbeRequest(
    { ...source.manifest, tools: [tool] },
    {
      method: "PATCH",
      path: "/api/books/3",
      query: null,
      body,
    },
  );
  expect(call).toBeDefined();
  expect(Object.hasOwn(call!.args, "__proto__")).toBe(true);
  expect(call!.args["__proto__"]).toBe("3");
  expect(call!.args.body).toBe(body);
  expect(JSON.stringify(call!.args.body)).toBe(JSON.stringify(body));
});
