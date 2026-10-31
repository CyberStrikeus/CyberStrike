import type { Client } from "@modelcontextprotocol/client";
import { Ajv2020 } from "ajv/dist/2020.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { toolContract } from "../../../src/contracts/toolContracts.js";
import { expandToolAvailability } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { ELECTRON_FUSE_STATE_BYTES } from "../../../src/domain/electron/electronFuses.js";
import {
  elfFuseImage,
  elfHeaderFuseImage,
  peHeaderFuseImage,
  OBSIDIAN_FUSE_BYTES,
  truncatedFuseImage,
  twoSentinelElf,
} from "../../fixtures/electron/fuseImage.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

const fuseMcpTest = mcpTest.extend<{
  fuse: { client: Client; session: ReturnType<typeof createTestBinarySession> };
}>({
  fuse: async ({ mcp }, use) => {
    const session = createTestBinarySession(() => {
      throw new Error(
        "Electron fuse inspection must not start a deep provider",
      );
    });
    try {
      const client = await mcp.connect(
        createServer({ kind: "session", session }),
      );
      await use({ client, session });
    } finally {
      await session.close();
    }
  },
});

fuseMcpTest(
  "advertises fuse inspection and preserves unknown fuse bytes through MCP",
  async ({ fuse: { client, session } }) => {
    const status = await client.callTool({
      name: "binary_session",
      arguments: {},
    });
    const availability = expandToolAvailability(
      toolContract("binary_session").outputSchema.parse(
        status.structuredContent,
      ).result.tool_availability,
    );
    expect(availability).toContainEqual(
      expect.objectContaining({
        name: "inspect_electron_fuses",
        available: true,
        reason: "available",
      }),
    );
    const advertised = (await client.listTools()).tools.find(
      (tool) => tool.name === "inspect_electron_fuses",
    );
    if (advertised?.outputSchema === undefined)
      throw new Error("Electron fuse inspection must publish both schemas");
    const ajv = new Ajv2020({ strict: false, validateFormats: false });
    const inputSchema: Record<string, unknown> = advertised.inputSchema;
    const outputSchema: Record<string, unknown> = advertised.outputSchema;
    expect(ajv.validateSchema(inputSchema)).toBe(true);
    expect(ajv.validateSchema(outputSchema)).toBe(true);
    expect(advertised.annotations).toMatchObject({
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    });

    const root = await createTestTempDirectory("rea-electron-fuses-mcp-");
    const elf = elfFuseImage([ELECTRON_FUSE_STATE_BYTES.removed, 0x99]);
    const path = join(root, "application");
    await writeFile(path, elf.bytes);
    const response = await client.callTool({
      name: "inspect_electron_fuses",
      arguments: { path },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    expect(
      ajv.validate(outputSchema, response.structuredContent),
      JSON.stringify(ajv.errors),
    ).toBe(true);
    const parsed = toolContract("inspect_electron_fuses").outputSchema.parse(
      response.structuredContent,
    );
    const evidence = parseEvidence(parsed);
    expect(evidence.confidence).toBe("observed");
    expect(parsed.normalized_result.artifact.format).toBe("elf");
    expect(
      parsed.normalized_result.slices[0]?.sentinels[0]?.fuses,
    ).toMatchObject([
      { index: 0, name: "RunAsNode", state: "removed", raw_byte: 0x72 },
      {
        index: 1,
        name: "EnableCookieEncryption",
        state: "unknown",
        raw_byte: 0x99,
      },
    ]);
    expect(parsed.normalized_result.runtime_implications).toEqual([
      expect.objectContaining({
        subject: "electron_run_as_node",
        relationship: "derivation",
        outcome: "not_honored",
        fuse_index: 0,
      }),
    ]);
    expect(session.evidenceById(evidence.evidence_id)).toEqual(evidence);

    const duplicated = twoSentinelElf();
    const duplicatePath = join(root, "duplicated");
    await writeFile(duplicatePath, duplicated.bytes);
    const duplicates = await client.callTool({
      name: "inspect_electron_fuses",
      arguments: { path: duplicatePath },
    });
    expect(duplicates.isError).not.toBe(true);
    const duplicateEvidence = toolContract(
      "inspect_electron_fuses",
    ).outputSchema.parse(duplicates.structuredContent);
    expect(
      duplicateEvidence.normalized_result.slices[0]?.sentinels.map(
        (item) => item.sentinel_offset,
      ),
    ).toEqual([...duplicated.offsets]);

    const truncatedPath = join(root, "truncated");
    await writeFile(truncatedPath, truncatedFuseImage());
    const truncated = await client.callTool({
      name: "inspect_electron_fuses",
      arguments: { path: truncatedPath },
    });
    expect(truncated.isError).not.toBe(true);
    const truncatedEvidence = toolContract(
      "inspect_electron_fuses",
    ).outputSchema.parse(truncated.structuredContent);
    expect(
      truncatedEvidence.normalized_result.slices[0]?.sentinels[0],
    ).toMatchObject({
      complete: false,
      declared_length: 4,
      wire_version: 1,
    });

    const relative = await client.callTool({
      name: "inspect_electron_fuses",
      arguments: { path: "relative.bin" },
    });
    expect(relative.isError).toBe(true);
    expect(parseMcpToolError(relative)).toMatchObject({
      error: {
        code: "invalid_request",
        details: {
          operation: "inspect_electron_fuses",
          issues: [expect.objectContaining({ path: ["path"] })],
        },
      },
    });
  },
);

fuseMcpTest.for([
  { format: "elf", machine: 3, architecture: "x86" },
  { format: "elf", machine: 62, architecture: "x86_64" },
  { format: "elf", machine: 183, architecture: "arm64" },
  { format: "elf", machine: 0xfffe, architecture: null },
  { format: "pe", machine: 0x14c, architecture: "x86" },
  { format: "pe", machine: 0x8664, architecture: "x86_64" },
  { format: "pe", machine: 0xaa64, architecture: "arm64" },
  { format: "pe", machine: 0x01f0, architecture: null },
] as const)(
  "preserves $format machine $machine architecture in MCP Evidence",
  async ({ format, machine, architecture }, { fuse: { client } }) => {
    const root = await createTestTempDirectory("rea-fuse-mcp-architecture-");
    const path = join(root, "selected");
    const image =
      format === "elf"
        ? elfHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES, {
            bits: architecture === "x86" ? 32 : 64,
            byteOrder: "little",
          })
        : peHeaderFuseImage(machine, OBSIDIAN_FUSE_BYTES);
    await writeFile(path, image.bytes);
    const response = await client.callTool({
      name: "inspect_electron_fuses",
      arguments: { path },
    });
    expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
    const evidence = toolContract("inspect_electron_fuses").outputSchema.parse(
      response.structuredContent,
    );
    expect(evidence.subject?.architecture).toBe(architecture);
    expect(evidence.normalized_result.slices).toMatchObject([
      {
        architecture,
        sentinel_count: 1,
        sentinels: [{ sentinel_offset: image.sentinelOffset, complete: true }],
      },
    ]);
    expect(
      evidence.normalized_result.slices[0]?.sentinels[0]?.fuses.map(
        (fuse) => fuse.raw_byte,
      ),
    ).toEqual(OBSIDIAN_FUSE_BYTES);
  },
);
