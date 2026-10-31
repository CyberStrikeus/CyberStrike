import { fileURLToPath } from "node:url";

import { expect } from "vitest";

import { parseEvidence } from "../../../src/domain/evidence.js";
import { silentLogger } from "../../../src/logger.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { itWithCaptureCapability } from "../process/processCaptureCapability.js";

const partialProcessFixture = fileURLToPath(
  new URL("../../fixtures/processFidelity.mjs", import.meta.url),
);

itWithCaptureCapability(
  "retains residuals from distinct process captures with the same missing scope",
  async () => {
    const harness = await createApplicationMcpHarness({
      session: createTestBinarySession(() => {
        throw new Error("Process capture must not launch an analysis provider");
      }),
      serverOptions: { logger: silentLogger },
    });
    const { client } = harness;
    try {
      const captures = [];
      for (const settleMs of [50, 75]) {
        const response = await client.callTool({
          name: "capture_process_scenario",
          arguments: {
            executable: process.execPath,
            arguments: [partialProcessFixture, "partial"],
            settle_ms: settleMs,
          },
        });
        expect(response.isError, JSON.stringify(response.content)).not.toBe(
          true,
        );
        captures.push(parseEvidence(response.structuredContent));
      }
      expect(captures[0]?.evidence_id).not.toBe(captures[1]?.evidence_id);
      for (const capture of captures)
        expect(capture.normalized_result).toMatchObject({
          residual_unknowns: expect.arrayContaining([
            expect.objectContaining({ scope: "network" }),
          ]),
        });

      const unknowns = await client.callTool({
        name: "list_unknowns",
        arguments: { domain: "process-network" },
      });
      expect(unknowns.isError, JSON.stringify(unknowns.content)).not.toBe(true);
      expect(unknowns.structuredContent).toMatchObject({
        result: {
          total: 2,
          items: expect.arrayContaining(
            captures.map((capture) =>
              expect.objectContaining({
                question: `Was network behavior fully observed during capture? (Evidence ${capture.evidence_id})`,
                supporting_evidence_ids: [capture.evidence_id],
              }),
            ),
          ),
        },
      });
    } finally {
      await harness.close();
    }
  },
  30_000,
);
