import { expect, it } from "vitest";

import { parseClientRegistration } from "./ClientRegistration.js";
import type { SetupClient } from "./SupportedClients.js";

const client: SetupClient = {
  name: "opencode",
  format: "opencode",
  configPath: "/fixture/opencode.json",
};

it("preserves every OpenCode environment key while normalizing its launcher", () => {
  const input = JSON.parse(
    '{"type":"local","command":["rea","mcp"],"environment":{"__proto__":"operator","constructor":"selected","normal":"value"}}',
  );
  const result = parseClientRegistration(input, client);
  expect(result.ok).toBe(true);
  if (!result.ok) throw result.error;
  expect(result.value.command).toBe("rea");
  expect(result.value.args).toEqual(["mcp"]);
  expect(result.value.environment).toEqual(input.environment);
  const environment = result.value.environment;
  if (typeof environment !== "object" || environment === null)
    throw new Error("Missing parsed environment");
  expect(Object.hasOwn(environment, "__proto__")).toBe(true);
});

it.each([42, null, {}])(
  "rejects malformed OpenCode environment values at __proto__: %j",
  (value) => {
    const environment = Object.fromEntries([["__proto__", value]]);
    const result = parseClientRegistration(
      { type: "local", command: ["rea", "mcp"], environment },
      client,
    );
    expect(result.ok).toBe(false);
  },
);
