import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  compressedKernelModuleContainer,
  kernelModuleFixture,
} from "../../../src/native/elf/KernelModule.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("Kernel module inspection must not start a deep provider");
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  return { client, session };
};

mcpTest(
  "advertises inspect_kernel_module and reads an ELF32 big-endian module",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const advertised = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_kernel_module",
      );
      expect(advertised?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-kernel-module-mcp-");
      const path = join(root, "demo.ko");
      await writeFile(path, kernelModuleFixture({ bits: 32, little: false }));
      const response = await client.callTool({
        name: "inspect_kernel_module",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = toolContract("inspect_kernel_module").outputSchema.parse(
        response.structuredContent,
      );
      expect(evidence.normalized_result).toMatchObject({
        format: "elf32",
        byte_order: "big",
        machine: 20,
        applicability: "applicable",
      });
      expect(evidence.subject?.architecture).toBe("powerpc");
      expect(evidence.normalized_result.modinfo?.entries[0]).toMatchObject({
        key: "license",
        value: "GPL",
      });
      expect(evidence.normalized_result.versions?.entries[1]?.crc_hex).toBe(
        "90abcdef",
      );
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "requires an absolute path for inspect_kernel_module",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const response = await client.callTool({
        name: "inspect_kernel_module",
        arguments: { path: "demo.ko" },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: { operation: "inspect_kernel_module" },
      });
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "reports a zstd container as an unsupported kernel-module target",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const root = await createTestTempDirectory("rea-kernel-module-zstd-mcp-");
      const path = join(root, "demo.ko.zst");
      await writeFile(path, compressedKernelModuleContainer("zstd"));
      const response = await client.callTool({
        name: "inspect_kernel_module",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = toolContract("inspect_kernel_module").outputSchema.parse(
        response.structuredContent,
      );
      expect(evidence.normalized_result).toMatchObject({
        applicability: "unsupported",
        compression: { codec: "zstd", status: "unsupported" },
        next_probe: { operation: "external_decompression" },
      });
    } finally {
      await session.close();
    }
  },
);
