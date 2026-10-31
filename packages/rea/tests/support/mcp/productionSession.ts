import type { Client } from "@modelcontextprotocol/client";
import { expect, type OnTestFinishedHandler } from "vitest";

import { createBinarySession } from "../../../src/composition/binary.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import type { TestMcp } from "./mcpFixture.js";

/** Open one real target in a production session served over MCP. */
export const openProductionTarget = async (
  mcp: TestMcp,
  onTestFinished: (handler: OnTestFinishedHandler) => void,
  path: string,
): Promise<Client> => {
  const configured = parseConfig({ REA_ANALYSIS_PROVIDER: "auto" });
  if (!configured.ok) throw configured.error;
  const session = createBinarySession(
    configured.value,
    silentLogger,
    process.env,
  );
  onTestFinished(async () => {
    const result = await session.close();
    if (!result.ok) throw result.error;
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  const opened = await client.callTool({
    name: "open_binary",
    arguments: { path },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  return client;
};
