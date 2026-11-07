import { expect, it } from "vitest";
import { environmentServeSource } from "../../../tests/fixtures/environmentServe.js";
import {
  environmentCard,
  environmentToolDefinitions,
  ENVIRONMENT_CATALOG_LIMIT_BYTES,
} from "../../application/environment/environmentTools.js";
import { serveEnvironment } from "./serveEnvironment.js";

it("refuses a complete oversized discovery before trying to bind", async () => {
  const source = environmentServeSource();
  const tool = source.manifest.tools[0]!;
  const manifest = {
    ...source.manifest,
    tools: [
      {
        ...tool,
        query_parameter_names: Array.from(
          { length: 10000 },
          (_, index) => `q_${index}`,
        ),
      },
    ],
  };
  const result = await serveEnvironment({
    source: { ...source, manifest },
    host: "invalid.rea.invalid",
    port: 0,
  });
  expect(result).toMatchObject({
    ok: false,
    error: {
      _tag: "AnalysisResourceConstraintError",
      resource: "capacity",
      retryable: false,
      reportedLimits: { max_catalog_bytes: ENVIRONMENT_CATALOG_LIMIT_BYTES },
    },
  });
  expect(manifest.tools[0]?.query_parameter_names).toHaveLength(10000);
});

it("charges environment identity, aggregate tools and escaped text before producing a card", () => {
  const source = environmentServeSource();
  const tools = Array.from({ length: 1000 }, (_, index) => ({
    ...source.manifest.tools[0]!,
    name: `tool_${index}`,
    params: [],
    query_parameter_names: [],
  }));
  expect(
    environmentToolDefinitions({
      ...source,
      manifest: { ...source.manifest, tools },
    }).ok,
  ).toBe(false);
  expect(
    environmentToolDefinitions(
      source,
      "x".repeat(ENVIRONMENT_CATALOG_LIMIT_BYTES),
    ).ok,
  ).toBe(false);
  const normal = environmentToolDefinitions(source);
  expect(normal.ok).toBe(true);
  if (!normal.ok) throw normal.error;
  expect(
    Buffer.byteLength(
      JSON.stringify(
        normal.value.map(({ tool: _, ...definition }) => definition),
      ),
    ),
  ).toBeLessThan(ENVIRONMENT_CATALOG_LIMIT_BYTES);
});

it("reserves the state card only when the state data plane is served", () => {
  const source = environmentServeSource();
  const empty = { ...source, manifest: { ...source.manifest, tools: [] } };
  const admits = (length: number, dataPlane: "none" | "state") =>
    environmentToolDefinitions(empty, "x".repeat(length), { dataPlane }).ok;
  // With no tools, the name and the card are the whole reservation: six bytes per name unit plus quotes.
  const longest = (dataPlane: "none" | "state") =>
    Math.floor(
      (ENVIRONMENT_CATALOG_LIMIT_BYTES -
        2 -
        JSON.stringify(environmentCard("", [], dataPlane)).length) /
        6,
    );
  const stateless = longest("none");
  expect(admits(stateless, "none")).toBe(true);
  expect(admits(stateless + 1, "none")).toBe(false);
  expect(longest("state")).toBeLessThan(stateless);
  expect(admits(stateless, "state")).toBe(false);
  expect(admits(longest("state"), "state")).toBe(true);
  expect(admits(longest("state") + 1, "state")).toBe(false);
});
