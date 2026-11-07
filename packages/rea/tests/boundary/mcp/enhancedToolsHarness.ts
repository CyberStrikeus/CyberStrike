import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import type { CallToolResult } from "@modelcontextprotocol/server";
import {
  jsonValueSchema,
  type JsonValue,
} from "../../../src/domain/jsonValue.js";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import type { AnalysisOperationPort } from "../../../src/application/AnalysisProvider.js";
import { createServer } from "../../../src/server/createServer.js";

export const PROCEDURES = {
  "0x1": "_TtC7Fixture5Class",
  "0x2": "_TtV7Fixture6Struct",
  "0x3": "_TtP7Fixture8Protocol",
  "0x4": "_TtO7Fixture4Enum",
  "0x5": "_TtE7Fixture9Extension",
  "0x6": "prefix_TtOther",
};

export const inventory = (values: Readonly<Record<string, string>>) =>
  Object.entries(values).map(([address, value]) => ({ address, value }));

export const resources: Array<{ close(): Promise<void> }> = [];

export const connect = async (analysis: AnalysisOperationPort) => {
  const server = createServer({ kind: "fixed", analysis });
  const client = new Client({ name: "enhanced-test", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

/** Close every client/server pair opened by `connect` in this module. */
export const closeEnhancedToolResources = async (): Promise<void> => {
  await Promise.all(
    resources.splice(0).map(async (resource) => resource.close()),
  );
};

export const jsonResult = (result: CallToolResult): JsonValue =>
  result.isError === true
    ? jsonValueSchema.parse(parseMcpToolError(result))
    : parseEvidence(result.structuredContent).normalized_result;
