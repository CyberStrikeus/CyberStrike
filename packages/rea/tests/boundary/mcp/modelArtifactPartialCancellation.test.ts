import { open, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, vi } from "vitest";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ModelArtifactService } from "../../../src/application/model/ModelArtifactService.js";
import { ModelArtifactProvider } from "../../../src/model/ModelArtifactProvider.js";
import { InvestigationRecords } from "../../../src/application/investigation/InvestigationRecords.js";
import { EvidenceMcpServer } from "../../../src/server/EvidenceMcpServer.js";
import { registerModelArtifactTools } from "../../../src/server/registerModelArtifactTools.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { silentLogger } from "../../../src/logger.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { ggufFixture, safetensorsFixture } from "../../fixtures/model/model.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

const interruptedFixture = (fullHash: boolean) => {
  const seed = ggufFixture();
  const count = 200_000;
  return fullHash
    ? safetensorsFixture(
        JSON.stringify({
          __metadata__: { author: "test" },
          weight: {
            dtype: "F32",
            shape: [524288],
            data_offsets: [0, 2 * 1024 * 1024],
          },
        }),
        Buffer.alloc(2 * 1024 * 1024),
      )
    : ggufFixture({
        tensors: [],
        metadata: [
          { key: "general.name", type: 8, value: seed.text("First row") },
          {
            key: "custom.bools",
            type: 9,
            value: Buffer.concat([
              seed.u32(7),
              seed.u64(BigInt(count)),
              Buffer.alloc(count),
            ]),
          },
        ],
      });
};

mcpTest.for([
  { retained: false, fullHash: false },
  { retained: true, fullHash: false },
  { retained: false, fullHash: true },
  { retained: true, fullHash: true },
])(
  "projects partial model Evidence through an MCP tool error ($retained, fullHash=$fullHash)",
  async ({ retained, fullHash }, { mcp }) => {
    const root = await createTestTempDirectory("rea-model-mcp-partial-");
    const path = join(root, fullHash ? "model.safetensors" : "model.gguf");
    const fixture = interruptedFixture(fullHash);
    await writeFile(path, fixture.bytes);
    const arrayStart = fullHash
      ? fixture.header.length
      : 24 +
        8 +
        Buffer.byteLength("general.name") +
        4 +
        8 +
        Buffer.byteLength("First row") +
        8 +
        Buffer.byteLength("custom.bools") +
        4 +
        4 +
        8;
    const sample = await open(path, "r");
    const prototype = Object.getPrototypeOf(sample) as {
      read: (
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) => Promise<{ bytesRead: number }>;
    };
    await sample.close();
    const originalRead = prototype.read;
    const denied = Object.assign(new Error("controlled MCP read failure"), {
      code: "EACCES",
    });
    let observedArrayChunk = false;
    const readSpy = vi
      .spyOn(prototype, "read")
      .mockImplementation(async function (
        this: unknown,
        buffer: Buffer,
        offset: number,
        length: number,
        position: number,
      ) {
        if (observedArrayChunk && position > arrayStart) throw denied;
        const result = await originalRead.call(
          this,
          buffer,
          offset,
          length,
          position,
        );
        if (position === arrayStart && result.bytesRead > 0)
          observedArrayChunk = true;
        return result;
      });
    const provider = new ModelArtifactProvider();
    const server = new EvidenceMcpServer(
      { name: "model-partial-test", version: "1" },
      {},
      undefined,
      createToolResultDelivery(undefined),
    );
    const records = new InvestigationRecords();
    registerModelArtifactTools(
      server,
      new ModelArtifactService(provider),
      silentLogger,
      retained ? (evidence) => records.recordEvidence(evidence) : undefined,
    );
    const client = await mcp.connect(server);
    try {
      const response = await client.callTool({
        name: "inspect_model_artifact",
        arguments: {
          path,
          detail: "complete",
          ...(fullHash ? { hash: "full" } : {}),
        },
      });
      if (!observedArrayChunk) throw new Error(JSON.stringify(response));
      const projected = parseMcpToolError(response);
      const details = projected.error.details;
      if (details === undefined)
        throw new Error("MCP error omitted its partial observation");
      let partial;
      if (retained) {
        expect(details.partial_observation).toMatchObject({
          kind: "retained-evidence",
          evidence_id: expect.any(String),
        });
        const reference = details.partial_observation as {
          evidence_id: string;
        };
        partial = parseEvidence(records.evidenceById(reference.evidence_id));
      } else partial = parseEvidence(details.partial_observation);
      expect(partial.normalized_result).toMatchObject({
        kind: "model-artifact-partial",
        ...(fullHash
          ? {
              format: "safetensors",
              metadata: [
                expect.objectContaining({ key: "author", value: "test" }),
              ],
              tensors: [expect.objectContaining({ name: "weight" })],
              coverage: {
                header: "complete",
                metadata: "complete",
                tensors: "complete",
              },
            }
          : {
              metadata: [
                {
                  index: 0,
                  key: "general.name",
                  value: "First row",
                  source_offset: 24,
                  source_length: 41,
                },
              ],
            }),
        artifact: {
          path,
          header_sha256: null,
          sha256: null,
          file_identity: "unverified",
        },
      });
      expect(partial.locations).toEqual([{ kind: "artifact-path", path }]);
    } finally {
      readSpy.mockRestore();
      await provider.close();
      await rm(root, { recursive: true, force: true });
    }
  },
);
