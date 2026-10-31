import { rm } from "node:fs/promises";
import { describe, expect } from "vitest";
import { ArtifactProvider } from "../../../src/artifacts/ArtifactProvider.js";
import { artifactExtractionResultSchema } from "../../../src/domain/artifactGraph.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import {
  createArmSliceFixture,
  expectArmSliceExtraction,
  expectArmSliceInventory,
} from "../../fixtures/machoArmSlices.js";
import { mcpTest } from "../../support/mcp/mcpFixture.js";

describe.skipIf(process.platform !== "darwin")(
  "ARM slice MCP with system lipo",
  () => {
    mcpTest(
      "retains physical slice identities through inspection and extraction",
      async ({ mcp, onTestFinished }) => {
        const fixture = await createArmSliceFixture();
        const session = createTestBinarySession(
          new ArtifactProvider(process.env),
        );
        onTestFinished(async () => {
          expect((await session.close()).ok).toBe(true);
        });
        const client = await mcp.connect(
          createServer({ kind: "session", session }),
        );
        const opened = await client.callTool({
          name: "open_binary",
          arguments: { path: fixture.path },
        });
        expect(opened.isError, JSON.stringify(opened.content)).not.toBe(true);
        const inspected = await client.callTool({
          name: "inspect_artifact",
          arguments: {},
        });
        expect(inspected.isError, JSON.stringify(inspected.content)).not.toBe(
          true,
        );
        const manifest = expectArmSliceInventory(
          parseEvidence(inspected.structuredContent).normalized_result,
          fixture,
        );
        const result = await client.callTool({
          name: "extract_artifact",
          arguments: {},
        });
        expect(result.isError, JSON.stringify(result.content)).not.toBe(true);
        const extracted = artifactExtractionResultSchema.parse(
          parseEvidence(result.structuredContent).normalized_result,
        );
        onTestFinished(() =>
          rm(extracted.output_root, { recursive: true, force: true }),
        );
        expect(await expectArmSliceExtraction(extracted, fixture)).toEqual(
          manifest,
        );
      },
    );
  },
);
