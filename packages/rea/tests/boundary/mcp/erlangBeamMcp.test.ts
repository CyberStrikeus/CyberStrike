import pino from "pino";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerErlangTools } from "../../../src/server/registerErlangTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { BeamService } from "../../../src/application/erlang/BeamService.js";
import { BeamProvider } from "../../../src/erlang/BeamProvider.js";
import {
  erlangBeamSchema,
  MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS,
} from "../../../src/domain/erlang/beam.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import {
  erlangBeamDeclaredRowsFixture,
  erlangBeamFixture,
} from "../../../src/erlang/Beam.fixture.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest, type TestMcp } from "../../support/mcp/mcpFixture.js";

const completeBeamEvidenceSchema = toolContract(
  "inspect_erlang_beam",
).outputSchema.safeExtend({ normalized_result: erlangBeamSchema });

const connect = async (mcp: TestMcp) => {
  const session = createTestBinarySession(() => {
    throw new Error("BEAM inspection must not start a deep provider");
  });
  const client = await mcp.connect(createServer({ kind: "session", session }));
  return { client, session };
};

mcpTest(
  "advertises inspect_erlang_beam and reads the module atom",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const advertised = (await client.listTools()).tools.find(
        (tool) => tool.name === "inspect_erlang_beam",
      );
      expect(advertised?.annotations).toMatchObject({
        readOnlyHint: false,
        idempotentHint: true,
      });
      const root = await createTestTempDirectory("rea-beam-mcp-");
      const path = join(root, "app.beam");
      await writeFile(path, erlangBeamFixture("mcp_mod"));
      const response = await client.callTool({
        name: "inspect_erlang_beam",
        arguments: { path },
      });
      expect(response.isError, JSON.stringify(response.content)).not.toBe(true);
      const evidence = completeBeamEvidenceSchema.parse(
        response.structuredContent,
      );
      expect(evidence.normalized_result.module).toBe("mcp_mod");
      expect(evidence.normalized_result.atom_encoding).toBe("utf8");
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "requires an absolute path for inspect_erlang_beam",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    try {
      const response = await client.callTool({
        name: "inspect_erlang_beam",
        arguments: { path: "app.beam" },
      });
      expect(response.isError).toBe(true);
      expect(parseMcpToolError(response).error).toMatchObject({
        code: "invalid_request",
        details: { operation: "inspect_erlang_beam" },
      });
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "returns recovery for the actual exhausted BEAM allowance",
  async ({ mcp }) => {
    const { client, session } = await connect(mcp);
    const root = await createTestTempDirectory("rea-beam-capacity-");
    try {
      for (const [label, bytes, settings, remediation] of [
        [
          "atoms",
          erlangBeamFixture(),
          { max_atoms: 1 },
          "Raise max_atoms above 1",
        ],
        [
          "chunks",
          erlangBeamFixture(),
          { max_chunks: 1 },
          "Raise max_chunks above 1",
        ],
        [
          "rows",
          erlangBeamDeclaredRowsFixture([
            ["ExpT", MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS + 1],
          ]),
          {},
          `${String(MAX_INSPECT_ERLANG_BEAM_TABLE_ROWS)}-row ceiling`,
        ],
      ] as const) {
        const path = join(root, `${label}.beam`);
        await writeFile(path, bytes);
        const response = await client.callTool({
          name: "inspect_erlang_beam",
          arguments: { path, ...settings },
        });
        expect(response.isError).toBe(true);
        const error = parseMcpToolError(response).error;
        expect(error).toMatchObject({
          code: "resource_constraint",
          retryable: false,
          remediation: { action: expect.stringContaining(remediation) },
        });
      }
    } finally {
      await session.close();
    }
  },
);

mcpTest(
  "refuses BEAM summary before file access without retention and still delivers complete output",
  async ({ mcp }) => {
    const root = await createTestTempDirectory("rea-beam-no-retention-");
    const service = new BeamService(new BeamProvider());
    const server = new EvidenceMcpServer(
      { name: "beam-no-retention", version: "1" },
      {},
      undefined,
      createToolResultDelivery(2 * 1024 * 1024),
    );
    registerErlangTools(server, service, pino({ enabled: false }));
    const client = await mcp.connect(server);
    try {
      for (const delivery of [
        { detail: "summary" },
        { detail: "summary", view: { kind: "beam", collection: "exports" } },
      ]) {
        const reply = await client.callTool({
          name: "inspect_erlang_beam",
          arguments: { path: join(root, "does-not-exist.beam"), ...delivery },
        });
        expect(reply.isError).toBe(true);
        expect(parseMcpToolError(reply).error).toMatchObject({
          code: "capability_unavailable",
          details: { operation: "inspect_erlang_beam" },
        });
      }
      const path = join(root, "complete.beam");
      await writeFile(path, erlangBeamFixture("without_retention"));
      const complete = await client.callTool({
        name: "inspect_erlang_beam",
        arguments: { path },
      });
      expect(complete.isError).not.toBe(true);
      expect(
        completeBeamEvidenceSchema.parse(complete.structuredContent)
          .normalized_result.module,
      ).toBe("without_retention");
    } finally {
      await service.close();
    }
  },
);
