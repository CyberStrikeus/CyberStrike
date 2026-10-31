import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect } from "vitest";

import { webPageInspectionSchema } from "../../../src/domain/browserObservationSchemas.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { cliTest } from "../../support/cli/cliFixture.js";
import { startHttpComparisonBrowser } from "../../fixtures/httpComparisonBrowser.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

cliTest(
  "CLI compares incomplete HTTP responses without inventing changes",
  async ({ cli }) => {
    const root = await createTestTempDirectory("rea-http-comparison-");
    const response = {
      requestId: "request-1",
      status: 200,
      mimeType: "application/json",
    };
    const fixture = await startHttpComparisonBrowser([response]);
    try {
      const inspect = () =>
        cli.run({
          arguments: [
            "inspect-web-page",
            fixture.browser.endpoint,
            "allowed-page",
            "--observation-ms",
            "0",
            "--json",
          ],
          environment: process.env,
        });
      const pendingInvocation = await inspect();
      expect(pendingInvocation.exitCode, pendingInvocation.stderr).toBe(0);
      expect(pendingInvocation.signal).toBeNull();
      const pending = webPageInspectionSchema.parse(
        parseEvidence(pendingInvocation.json).normalized_result,
      );
      fixture.setRequests([{ ...response, encodedDataLength: 100 }]);
      const finishedInvocation = await inspect();
      expect(finishedInvocation.exitCode, finishedInvocation.stderr).toBe(0);
      expect(finishedInvocation.signal).toBeNull();
      const finished = webPageInspectionSchema.parse(
        parseEvidence(finishedInvocation.json).normalized_result,
      );
      fixture.setRequests([
        { ...response, status: 500, encodedDataLength: 100 },
      ]);
      const changedInvocation = await inspect();
      expect(changedInvocation.exitCode, changedInvocation.stderr).toBe(0);
      expect(changedInvocation.signal).toBeNull();
      const changed = webPageInspectionSchema.parse(
        parseEvidence(changedInvocation.json).normalized_result,
      );
      expect(pending.network.requests).toMatchObject([
        {
          status: 200,
          mime_type: "application/json",
          encoded_data_length: null,
        },
      ]);
      expect(finished.network.requests).toMatchObject([
        {
          status: 200,
          mime_type: "application/json",
          encoded_data_length: 100,
        },
      ]);
      // Passive attachment cannot establish the complete same-URL request
      // inventory. Closed imported captures can, and retain the positive oracle.
      const closed = structuredClone(pending);
      closed.completeness.attach_limited_sections =
        closed.completeness.attach_limited_sections.filter(
          (section) => section !== "network_requests",
        );
      const captures = [pending, finished, changed, closed];
      const paths = captures.map((_, index) =>
        join(root, `capture-${String(index)}.json`),
      );
      await Promise.all(
        captures.map((inspection, index) =>
          writeFile(paths[index]!, JSON.stringify({ inspection })),
        ),
      );
      for (const [left, right, status, count] of [
        [0, 1, "unknown", 0],
        [1, 0, "unknown", 0],
        [0, 2, "unknown", 0],
        [3, 2, "changed", 1],
      ] as const) {
        const comparedInvocation = await cli.run({
          arguments: [
            "compare-web-captures",
            paths[left]!,
            paths[right]!,
            "--json",
          ],
          environment: process.env,
        });
        expect(comparedInvocation.exitCode, comparedInvocation.stderr).toBe(0);
        expect(comparedInvocation.signal).toBeNull();
        const compared = comparedInvocation.json;
        expect(compared).toMatchObject({
          operation: "compare_web_captures",
          normalized_result: {
            overall_status: status,
            dimensions: {
              network: { status, total_changes: count },
            },
          },
        });
      }
    } finally {
      await fixture.browser.close();
    }
  },
  60_000,
);
