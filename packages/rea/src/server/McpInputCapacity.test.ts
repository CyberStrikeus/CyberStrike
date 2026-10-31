import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";
import { z } from "zod";
import { EvidenceMcpServerCore } from "./EvidenceMcpServerCore.js";
import { createToolResultDelivery } from "./toolResult.js";
import { DEFAULT_MCP_MAX_INPUT_ELEMENTS } from "../config/mcpInputBudget.js";
import { evidenceSchema } from "../domain/evidence.js";

const defaultElements = DEFAULT_MCP_MAX_INPUT_ELEMENTS;

const fixture = async (maximum?: number, element: z.ZodType = z.unknown()) => {
  let validations = 0;
  let calls = 0;
  const canonical = z.strictObject({ values: z.array(element) });
  const server = new EvidenceMcpServerCore(
    { name: "input-capacity-fixture", version: "1" },
    maximum === undefined ? {} : { maxToolInputElements: maximum },
    undefined,
    createToolResultDelivery(16_384),
  );
  server.registerTool(
    "capacity_probe",
    {
      inputSchema: {
        "~standard": {
          ...canonical["~standard"],
          validate: (value: unknown) => {
            validations++;
            return canonical["~standard"].validate(value);
          },
        },
      },
    },
    async (input) => {
      calls++;
      return {
        content: [{ type: "text", text: String(input.values.length) }],
      };
    },
  );
  const client = new Client({ name: "input-capacity-client", version: "1" });
  onTestFinished(async () => {
    try {
      await client.close();
    } finally {
      await server.close();
    }
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, validations: () => validations, calls: () => calls };
};

const refusal = (result: Awaited<ReturnType<Client["callTool"]>>): unknown => {
  expect(result.isError).toBe(true);
  const text = result.content.find((part) => part.type === "text")?.text;
  return JSON.parse(text ?? "null");
};

it("bounds default MCP arguments before invoking their canonical validator", async () => {
  const f = await fixture();
  const result = await f.client.callTool({
    name: "capacity_probe",
    arguments: { values: Array.from({ length: 1_024 }, () => 0) },
  });
  expect(f.validations()).toBe(0);
  expect(f.calls()).toBe(0);
  expect(refusal(result)).toMatchObject({
    error: {
      code: "resource_constraint",
      retryable: false,
      details: {
        operation: "capacity_probe",
        resource: "transport",
        reported_limits: { max_input_elements: defaultElements },
      },
    },
  });
  expect(Buffer.byteLength(JSON.stringify(result))).toBeLessThan(4096);
  await f.client.ping();
});

it("counts nested object members as well as array elements before validation", async () => {
  const f = await fixture(8);
  const result = await f.client.callTool({
    name: "capacity_probe",
    arguments: {
      values: [
        { a: 0, b: 1, c: 2 },
        { a: 0, b: 1, c: 2 },
      ],
    },
  });
  expect(f.validations()).toBe(0);
  expect(f.calls()).toBe(0);
  expect(refusal(result)).toMatchObject({
    error: { details: { reported_limits: { max_input_elements: 8 } } },
  });
});

it("refuses missing-field Evidence arrays before their per-field issues are allocated", async () => {
  const f = await fixture(undefined, evidenceSchema);
  const result = await f.client.callTool({
    name: "capacity_probe",
    arguments: { values: Array.from({ length: 1_024 }, () => ({})) },
  });
  expect(f.validations()).toBe(0);
  expect(f.calls()).toBe(0);
  expect(refusal(result)).toMatchObject({
    error: {
      code: "resource_constraint",
      details: { reported_limits: { max_input_elements: 1_024 } },
    },
  });
});

it("admits the exact selected allowance without altering the values or schema", async () => {
  const f = await fixture(4);
  const result = await f.client.callTool({
    name: "capacity_probe",
    arguments: { values: ["one", "two", "three"] },
  });
  expect(result.isError).not.toBe(true);
  expect(result.content).toEqual([{ type: "text", text: "3" }]);
  expect(f.validations()).toBe(1);
  expect(f.calls()).toBe(1);
  const { tools } = await f.client.listTools();
  expect(
    tools.find((tool) => tool.name === "capacity_probe")?.inputSchema,
  ).toMatchObject({
    type: "object",
    properties: { values: { type: "array" } },
  });
});

it("preserves ordinary canonical refusals and advertised schemas across allowances", async () => {
  const bounded = await fixture(4);
  const selected = await fixture(Infinity);
  const request = {
    name: "capacity_probe",
    arguments: { values: "not-an-array" },
  };
  const boundedError = refusal(await bounded.client.callTool(request));
  const selectedError = refusal(await selected.client.callTool(request));
  expect(boundedError).toEqual(selectedError);
  expect(boundedError).toMatchObject({ error: { code: "invalid_request" } });
  expect(bounded.validations()).toBe(1);
  expect(bounded.calls()).toBe(0);
  expect((await bounded.client.listTools()).tools).toEqual(
    (await selected.client.listTools()).tools,
  );
});
