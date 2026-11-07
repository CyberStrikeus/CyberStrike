import { rustBinarySchema } from "../../../src/domain/rust/rustBinary.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  createRustImage,
  createRustHashOverflowImage,
} from "../../fixtures/rust/image.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("Rust metadata must not start a deep provider");
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  return { client, session };
};

mcpTest(
  "advertises inspect_rust_binary and reads an embedded dependency list",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const advertised = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_rust_binary",
      );
      expect(advertised?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-rust-mcp-");
      const path = join(root, "sample.elf");
      await writeFile(path, createRustImage({ format: "elf" }));
      const response = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = toolContract("inspect_rust_binary").outputSchema.parse(
        response.structuredContent,
      );
      expect(
        rustBinarySchema.parse(evidence.normalized_result).auditable_metadata
          ?.packages,
      ).toEqual([
        expect.objectContaining({ name: "itoa", version: "1.0.18" }),
        expect.objectContaining({
          name: "sample",
          version: "0.1.0",
          root: true,
        }),
      ]);
      const missing = join(root, "plain.elf");
      await writeFile(
        missing,
        createRustImage({ format: "pe", omitSection: true }),
      );
      const absent = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path: missing },
      });
      expect(absent.isError).not.toBe(true);
      const absentEvidence = toolContract(
        "inspect_rust_binary",
      ).outputSchema.parse(absent.structuredContent);
      expect(
        rustBinarySchema.parse(absentEvidence.normalized_result)
          .auditable_metadata,
      ).toBeNull();
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "requires an absolute path for inspect_rust_binary",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const response = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path: "sample" },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: { operation: "inspect_rust_binary" },
      });
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "preserves rustc hash capacity units through the public error contract",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const root = await createTestTempDirectory("rea-rust-mcp-");
      const path = join(root, "many-hashes.elf");
      await writeFile(path, createRustHashOverflowImage());
      const response = await client.callTool({
        name: "inspect_rust_binary",
        arguments: { path },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "resource_constraint",
        details: {
          operation: "inspect_rust_binary",
          resource: "capacity",
          reported_limits: { maximum_rustc_hashes: 64 },
        },
      });
      expect(parseMcpToolError(response).error.details).not.toHaveProperty(
        "reported_limits.maximum_bytes",
      );
    } finally {
      await session.close();
    }
  },
);
