import { Ajv2020 } from "ajv/dist/2020.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, describe, expect, it } from "vitest";

import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { NATIVE_TOOL_CONTRACTS } from "../../../src/contracts/native/nativeToolContracts.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { ok } from "../../../src/domain/result.js";
import { createAnalysisExecution } from "../../../src/application/AnalysisProvider.js";
import { createServer } from "../../../src/server/createServer.js";

const provider = {
  id: "fixture-native",
  name: "Fixture native provider",
  version: "1",
} as const;

const plistResult = {
  format: "xml",
  value: {},
  bundle: {
    identifier: null,
    executable: null,
    name: null,
    version: null,
    short_version: null,
  },
  source_path: "/Applications/Fixture.app/Contents/Info.plist",
  provenance: [],
  limitations: [],
};

const resources: Array<{ close(): Promise<void> }> = [];

const connect = async (
  execute: AnalysisOperationPort["execute"],
): Promise<Client> => {
  const server = createServer({ kind: "fixed", analysis: { execute } });
  const client = new Client({ name: "native-contract-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

afterEach(async () => {
  await Promise.all(
    resources.splice(0).map(async (resource) => resource.close()),
  );
});

describe("native MCP input contracts", () => {
  it("rejects a misspelled plist path before dispatch and preserves omission", async () => {
    const calls: Array<{
      readonly operation: string;
      readonly parameters: Readonly<Record<string, JsonValue>>;
    }> = [];
    const client = await connect((operation, parameters) => {
      calls.push({ operation, parameters });
      return Promise.resolve(
        ok(createAnalysisExecution(plistResult, provider)),
      );
    });

    const tools = new Map(
      (await client.listTools()).tools.map((tool) => [tool.name, tool]),
    );
    for (const nativeContract of NATIVE_TOOL_CONTRACTS)
      expect(tools.get(nativeContract.name)?.inputSchema).toHaveProperty(
        "additionalProperties",
        false,
      );

    const contract = NATIVE_TOOL_CONTRACTS.find(
      ({ name }) => name === "inspect_plist",
    );
    const advertised = tools.get("inspect_plist");
    if (contract === undefined || advertised === undefined)
      throw new Error("inspect_plist was not registered");

    const validate = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(advertised.inputSchema);
    const typoInput = { pth: "/tmp/Other.plist" };
    expect(validate(typoInput)).toBe(false);
    expect(contract.inputSchema.safeParse(typoInput).success).toBe(false);
    expect(validate({})).toBe(true);
    expect(contract.inputSchema.safeParse({}).success).toBe(true);

    const defaulted = await client.callTool({
      name: "inspect_plist",
      arguments: {},
    });
    expect(defaulted.isError).not.toBe(true);
    expect(calls[0]).toEqual({ operation: "inspect_plist", parameters: {} });

    const selectedPath = "/tmp/Other.plist";
    const explicit = await client.callTool({
      name: "inspect_plist",
      arguments: { path: selectedPath },
    });
    expect(explicit.isError).not.toBe(true);
    expect(calls[1]).toEqual({
      operation: "inspect_plist",
      parameters: { path: selectedPath },
    });

    const beforeTypo = calls.length;
    const rejected = await client.callTool({
      name: "inspect_plist",
      arguments: typoInput,
    });
    expect(rejected.isError).toBe(true);
    expect(calls).toHaveLength(beforeTypo);
  });
});
