import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it as test, onTestFinished } from "vitest";
import { FIRMWARE_TOOL_CONTRACTS } from "../../../src/contracts/firmware/firmwareToolContracts.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  firmwareFixture,
  assertFirmwareCleanup,
} from "../../fixtures/firmware/provider.js";

const it = test.skipIf(process.platform !== "linux");

it("executes named firmware contracts with inline Evidence and no native binary admission", async () => {
  const fixture = await firmwareFixture();
  const session = createTestBinarySession(() => {
    throw new Error("Firmware inspection must not acquire a native provider");
  });
  const server = createServer(
    { kind: "session", session },
    {
      firmwareAnalysis: fixture.provider,
    },
  );
  const client = new Client({ name: "firmware-regression", version: "1" });
  onTestFinished(async () => {
    await client.close();
    await server.close();
    await session.close();
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  const advertised = await client.listTools();
  for (const contract of FIRMWARE_TOOL_CONTRACTS) {
    expect(
      advertised.tools.find((tool) => tool.name === contract.name)?.annotations,
    ).toMatchObject(contract.annotations);
    const response = await client.callTool({
      name: contract.name,
      arguments: {
        path: fixture.path,
        ...(contract.name === "extract_firmware"
          ? { output_directory: fixture.output }
          : {}),
      },
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const result = contract.outputSchema.parse(response.structuredContent);
    const evidence = parseEvidence(result);
    expect(evidence.operation).toBe(contract.name);
    expect(evidence.raw_result).not.toBeNull();
  }
  await assertFirmwareCleanup(fixture.launches);
});
