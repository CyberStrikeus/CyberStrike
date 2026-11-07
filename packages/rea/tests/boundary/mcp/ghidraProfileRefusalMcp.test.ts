import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it } from "vitest";

import { AnalysisProviderRegistry } from "../../../src/application/binary/AnalysisProviderRegistry.js";
import { composeBinarySession } from "../../../src/application/binary/BinarySessionComposition.js";
import { parseConfig } from "../../../src/config/parseConfig.js";
import { GhidraProvider } from "../../../src/ghidra/GhidraProvider.js";
import { silentLogger } from "../../../src/logger.js";
import { createServer } from "../../../src/server/createServer.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { ghidraInstallationHost } from "./ghidraMcpHarness.js";

const REFUSAL =
  "Processor or compiler specification overrides cannot replace the admitted raw-binary import.";

const openRawArm = async (languageId: string | undefined) => {
  const directory = await mkdtemp(join(tmpdir(), "rea-profile-refusal-"));
  const path = join(directory, "image.bin");
  await writeFile(path, Buffer.from([0, 0, 160, 225]));
  const config = parseConfig({
    GHIDRA_INSTALL_DIR: "/opt/ghidra_12.1.4_PUBLIC",
    ...(languageId === undefined ? {} : { REA_GHIDRA_LANGUAGE_ID: languageId }),
  });
  if (!config.ok) throw config.error;
  let clients = 0;
  const provider = new GhidraProvider(
    config.value,
    silentLogger,
    {},
    ghidraInstallationHost(),
    () => {
      clients += 1;
      throw new Error("Profile resolution must not start an engine");
    },
  );
  const session = composeBinarySession(
    new AnalysisProviderRegistry([provider]),
  );
  const server = createServer(
    { kind: "session", session },
    { logger: silentLogger },
  );
  const mcp = new Client({ name: "profile-refusal", version: "1.0.0" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  try {
    await server.connect(serverTransport);
    await mcp.connect(clientTransport);
    const result = await mcp.callTool({
      name: "open_binary",
      arguments: {
        path,
        format: "raw-binary",
        architecture: "arm",
        entry_point: "0x8000000",
        provider_id: "ghidra",
      },
    });
    return { result, clients };
  } finally {
    await Promise.allSettled([mcp.close(), server.close()]);
    await session.close();
    await rm(directory, { recursive: true, force: true });
  }
};

it("returns configuration diagnostics when a language override conflicts with the admitted profile", async () => {
  const { result, clients } = await openRawArm("ARM:LE:32:v7");
  expect(clients).toBe(0);
  const { error } = parseMcpToolError(result);
  expect(error).toMatchObject({
    code: "configuration_invalid",
    message: expect.stringContaining(REFUSAL),
    details: {
      settings: [{ setting: "REA_GHIDRA_LANGUAGE_ID", constraint: REFUSAL }],
    },
  });
});

it("still opens the same raw target when no language override conflicts", async () => {
  const { result, clients } = await openRawArm(undefined);
  expect(result.isError, JSON.stringify(result)).not.toBe(true);
  expect(clients).toBe(0);
});
