import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { OFFICIAL_TOOL_CONTRACTS } from "../../../src/contracts/officialToolContracts.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { jsonObjectSchema } from "../../../src/domain/jsonValue.js";
import { HopperRemoteError } from "../../../src/domain/hopperErrors.js";
import { err } from "../../../src/domain/result.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { createServer } from "../../../src/server/createServer.js";
import { HopperProvider } from "../../../src/hopper/HopperProvider.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { silentLogger } from "../../../src/logger.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { createBinarySessionTargets } from "../../fixtures/binarySession.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";

interface Invocation {
  readonly name: string;
  readonly arguments_: Readonly<Record<string, JsonValue>>;
}

const resources: Array<{ close(): Promise<void> }> = [];

it("returns typed Hopper byte-search unavailability without launching the provider", async () => {
  const [target] = await createBinarySessionTargets();
  const config = parseConfig({ HOPPER_LAUNCHER_PATH: process.execPath });
  if (!config.ok) throw config.error;
  const provider = new HopperProvider(config.value, silentLogger, {}, "linux");
  const session = composeBinarySession(
    new AnalysisProviderRegistry([provider]),
  );
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: { logger: silentLogger },
    clientIdentity: { name: "hopper-byte-search-unavailable", version: "1" },
  });
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path: target },
  });
  expect(opened.isError).not.toBe(true);
  const result = await client.callTool({
    name: "search_bytes",
    arguments: { pattern: "48 8b" },
  });
  expect(result.isError).toBe(true);
  expect(parseMcpToolError(result)).toMatchObject({
    error: {
      code: "capability_unavailable",
      details: { provider_id: "hopper", operation: "search_bytes" },
    },
  });
});

it("advertises strict masked-byte arguments and bounded pages", () => {
  const contract = OFFICIAL_TOOL_CONTRACTS.find(
    ({ name }) => name === "search_bytes",
  );
  expect(
    contract?.inputSchema.parse({ pattern: "48 8B ?? ?? 89" }),
  ).toMatchObject({ limit: 100 });
  expect(
    contract?.inputSchema.safeParse({ pattern: "48", ignored: true }).success,
  ).toBe(false);
  expect(
    contract?.inputSchema.safeParse({ pattern: "48", mask: "f0", limit: 1000 })
      .success,
  ).toBe(true);
});

describe("read_bytes contract", () => {
  it("accepts lengths above the former arbitrary ceiling and rejects zero", () => {
    const contract = OFFICIAL_TOOL_CONTRACTS.find(
      ({ name }) => name === "read_bytes",
    );
    expect(contract).toBeDefined();
    expect(
      contract?.inputSchema.safeParse({ address: "0x1000", length: 4097 })
        .success,
    ).toBe(true);
    expect(
      contract?.inputSchema.safeParse({ address: "0x1000", length: 0 }).success,
    ).toBe(false);
    expect(
      contract?.outputSchema.shape.normalized_result.safeParse({
        address: "0x1000",
        requested_bytes: 4097,
        returned_bytes: 4097,
        bytes_hex: "ff".repeat(4097),
        complete: true,
      }).success,
    ).toBe(true);
  });
});

describe("list_strings contract", () => {
  it("describes optional provider string metadata inline", () => {
    const contract = OFFICIAL_TOOL_CONTRACTS.find(
      ({ name }) => name === "list_strings",
    );
    expect(
      contract?.outputSchema.shape.normalized_result.safeParse([
        {
          address: "0x1000",
          value: "coffee",
          string: {
            encoding: "UTF-8",
            termination: "present_or_not_required",
            byte_length: 6,
          },
        },
        { address: "0x1008", value: "beans" },
      ]).success,
    ).toBe(true);
  });
});

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (resource) => resource.close()),
  );
});

const connect = async (analysis: AnalysisOperationPort) => {
  const server = createServer({ kind: "fixed", analysis });
  const client = new Client({ name: "contract-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

describe("official tool input contracts", () => {
  it("preserves every batch naming destination and rejects malformed own values before dispatch", async () => {
    const invocations: Invocation[] = [];
    const client = await connect({
      execute: (name, arguments_) => {
        invocations.push({ name, arguments_ });
        return Promise.resolve(ok(null));
      },
    });
    const names = JSON.parse('{"0x1000":"entry","__proto__":"other"}');
    await client.callTool({
      name: "set_addresses_names",
      arguments: { names },
    });
    expect(invocations).toEqual([
      { name: "set_addresses_names", arguments_: { names } },
    ]);
    expect(JSON.stringify(invocations[0]!.arguments_)).toContain(
      '"__proto__":"other"',
    );
    for (const value of [42, null, {}]) {
      const result = await client.callTool({
        name: "set_addresses_names",
        arguments: {
          names: Object.fromEntries([
            ["0x1000", "entry"],
            ["__proto__", value],
          ]),
        },
      });
      expect(result.isError).toBe(true);
    }
    expect(invocations).toHaveLength(1);
  });

  it("rejects misspelled top-level inputs before dispatch and keeps record keys open", async () => {
    const invocations: Invocation[] = [];
    const client = await connect({
      execute: (name, arguments_) => {
        invocations.push({ name, arguments_ });
        return Promise.resolve(ok(null));
      },
    });
    const { tools } = await client.listTools();
    const advertisedByName = new Map(tools.map((tool) => [tool.name, tool]));
    for (const contract of OFFICIAL_TOOL_CONTRACTS) {
      expect(advertisedByName.get(contract.name)?.inputSchema).toHaveProperty(
        "additionalProperties",
        false,
      );
    }
    const advertised = tools.find(({ name }) => name === "address_name");
    const recordTool = tools.find(({ name }) => name === "set_addresses_names");
    if (advertised === undefined || recordTool === undefined)
      throw new Error("Official tools were not advertised");

    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const validateAddressName = ajv.compile(advertised.inputSchema);
    const validateRecordInput = ajv.compile(recordTool.inputSchema);
    const typoInput = { adress: "0x1234" };
    expect(advertised.inputSchema).toHaveProperty(
      "additionalProperties",
      false,
    );
    expect(validateAddressName(typoInput)).toBe(false);
    expect(
      OFFICIAL_TOOL_CONTRACTS.find(
        ({ name }) => name === "address_name",
      )?.inputSchema.safeParse(typoInput).success,
    ).toBe(false);
    expect(validateRecordInput({ names: { "0x1000": "entry" } })).toBe(true);

    const result = await client.callTool({
      name: "address_name",
      arguments: typoInput,
    });
    expect(result.isError).toBe(true);
    expect(invocations).toEqual([]);
  });
});

describe("official Hopper proxy tools", () => {
  it("delivers every batch naming readback key in structured and text Evidence", async () => {
    const readback = JSON.parse(
      '{"0x1000":true,"__proto__":false,"constructor":true}',
    );
    const client = await connect({
      execute: () => Promise.resolve(ok(readback)),
    });
    const response = await client.callTool({
      name: "set_addresses_names",
      arguments: {
        names: JSON.parse(
          '{"0x1000":"entry","__proto__":"other","constructor":"named"}',
        ),
      },
    });
    expect(response.isError).toBeFalsy();
    const evidence = toolContract("set_addresses_names").outputSchema.parse(
      response.structuredContent,
    );
    const result = jsonObjectSchema.parse(evidence.normalized_result);
    expect(result).toEqual(readback);
    expect(Object.hasOwn(result, "__proto__")).toBe(true);
    const text = response.content.find((item) => item.type === "text");
    if (text?.type !== "text") throw new Error("Missing serialized Evidence");
    expect(
      jsonObjectSchema.parse(JSON.parse(text.text)).normalized_result,
    ).toEqual(readback);
  });

  it("returns stable safe MCP error content", async () => {
    const client = await connect({
      execute: () => Promise.resolve(err(new HopperRemoteError(-1, "denied"))),
    });
    const result = await client.callTool({
      name: "list_documents",
      arguments: {},
    });
    expect(result.isError).toBe(true);
    expect(result.content[0]).toEqual({
      type: "text",
      text: JSON.stringify(parseMcpToolError(result)),
    });
  });

  it("binds list_procedures without adding omitted document arguments", async () => {
    const invocations: Invocation[] = [];
    const client = await connect({
      execute: (name, arguments_) => {
        invocations.push({ name, arguments_ });
        return Promise.resolve(
          ok([
            { address: "0x1", value: "procedure" },
            { address: "0x2", value: "procedure" },
          ]),
        );
      },
    });

    const result = await client.callTool({
      name: "list_procedures",
      arguments: {},
    });

    expect(result.structuredContent).toMatchObject({
      normalized_result: [
        { address: "0x1", value: "procedure" },
        { address: "0x2", value: "procedure" },
      ],
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.name).toBe("list_procedures");
    expect(invocations[0]?.arguments_).toEqual({});
    expect(
      (await client.listTools()).tools.find(
        ({ name }) => name === "list_procedures",
      )?.inputSchema,
    ).not.toHaveProperty("properties.offset");
  });

  it("returns every search match inline in one provider call", async () => {
    const invocations: Invocation[] = [];
    const client = await connect({
      execute: (name, arguments_) => {
        invocations.push({ name, arguments_ });
        return Promise.resolve(
          ok([
            { address: "0x1", value: "coffee" },
            { address: "0x2", value: "coffee" },
          ]),
        );
      },
    });

    const result = await client.callTool({
      name: "search_strings",
      arguments: { pattern: "coffee" },
    });

    expect(result.structuredContent).toMatchObject({
      normalized_result: [
        { address: "0x1", value: "coffee" },
        { address: "0x2", value: "coffee" },
      ],
    });
    expect(invocations).toHaveLength(1);
    expect(invocations[0]?.arguments_).toMatchObject({ pattern: "coffee" });
    expect(
      (await client.listTools()).tools.find(
        ({ name }) => name === "search_strings",
      )?.inputSchema,
    ).not.toHaveProperty("properties.offset");
  });
});
