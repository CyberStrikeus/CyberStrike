import type { Client } from "@modelcontextprotocol/client";
import { expect, type OnTestFinishedHandler } from "vitest";

import { createArtifactBinarySession } from "../../../src/composition/binary.js";
import { createServer } from "../../../src/server/createServer.js";
import type { TestMcp } from "./mcpFixture.js";

/** Register session teardown while retaining its owner for a failed-close retry. */
export const ownArtifactSession = (
  session: Awaited<ReturnType<typeof createArtifactBinarySession>>,
  onTestFinished: (handler: OnTestFinishedHandler) => void,
): void => {
  onTestFinished(async () => {
    const result = await session.close();
    if (!result.ok) throw result.error;
  });
};

const openSessionTarget = async (
  mcp: TestMcp,
  onTestFinished: (handler: OnTestFinishedHandler) => void,
  operation: "open_binary" | "open_bundle_resources",
  path: string,
): Promise<Client> => {
  const session = await createArtifactBinarySession(process.env);
  ownArtifactSession(session, onTestFinished);
  const client = await mcp.connect(createServer({ kind: "session", session }));
  const opened = await client.callTool({
    name: operation,
    arguments: { path },
  });
  expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
  return client;
};

/** Open a static artifact target in the production artifact-only MCP composition. */
export const openArtifactTarget = (
  mcp: TestMcp,
  onTestFinished: (handler: OnTestFinishedHandler) => void,
  path: string,
): Promise<Client> =>
  openSessionTarget(mcp, onTestFinished, "open_binary", path);

/** Open a caller-selected bundle resource root in the production MCP session. */
export const openBundleResourcesTarget = (
  mcp: TestMcp,
  onTestFinished: (handler: OnTestFinishedHandler) => void,
  path: string,
): Promise<Client> =>
  openSessionTarget(mcp, onTestFinished, "open_bundle_resources", path);
