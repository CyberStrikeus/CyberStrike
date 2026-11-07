import { join } from "node:path";

import { expect, it } from "vitest";

import { EvmInterfaceService } from "../../../src/application/evm/EvmInterfaceService.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { sessionOutputSchemas } from "../../../src/contracts/toolOutputSchemaGroups.js";
import { createServer } from "../../../src/server/createServer.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const linuxX64 = process.platform === "linux" && process.arch === "x64";

const connect = async (
  options: Parameters<typeof createServer>[1],
): Promise<{
  readonly availability: () => Promise<Record<string, unknown> | undefined>;
}> => {
  const session = createTestBinarySession(() => {
    throw new Error("binary analysis must not start during status discovery");
  });
  const { client } = await createApplicationMcpHarness({
    session,
    serverOptions: options,
    clientIdentity: { name: "evm-limiter-availability", version: "1" },
  });
  return {
    availability: async () => {
      const response = await client.callTool({
        name: "binary_session",
        arguments: {},
      });
      if (response.isError === true) throw new Error("binary_session failed");
      const parsed = sessionOutputSchemas.binary_session.parse(
        response.structuredContent,
      ).result;
      return expandToolAvailability(parsed.tool_availability).find(
        ({ name }) => name === "inspect_evm_interface",
      );
    },
  };
};

it.runIf(linuxX64)(
  "reports a missing selected limiter in the live default-provider session inventory",
  async () => {
    const directory = await createTestTempDirectory("rea-evm-limiter-mcp-");
    const limiter = join(directory, "missing-prlimit");
    const harness = await connect({
      environment: {
        REA_EVM_PRLIMIT_COMMAND: limiter,
        REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
      },
    });
    expect(await harness.availability()).toMatchObject({
      available: false,
      reason: "provider_missing",
      remediation: expect.stringContaining(limiter),
    });
  },
);

it("keeps a caller-injected EVM service independent of the default prlimit prerequisite", async () => {
  const directory = await createTestTempDirectory("rea-evm-limiter-injected-");
  const limiter = join(directory, "missing-prlimit");
  const service = new EvmInterfaceService({
    inspect: async () => {
      throw new Error("injected service must not be invoked by status");
    },
    close: async () => {},
  });
  const harness = await connect({
    environment: {
      REA_EVM_PRLIMIT_COMMAND: limiter,
      REA_MCP_OUTPUT_SCHEMA_PROFILE: "off",
    },
    evmInterface: service,
  });
  expect(await harness.availability()).toMatchObject({
    available: true,
    reason: "available",
    remediation: null,
  });
});
