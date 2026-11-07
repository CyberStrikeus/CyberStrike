import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect } from "vitest";

import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { analysisViewLayoutFixture } from "../../fixtures/analysisView.js";
import { BINARY_LAYOUT_TEST_PROVIDER } from "../../fixtures/binaryDiagnostics/layout.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";
import { cliTest } from "../../support/cli/cliFixture.js";

cliTest.for(["valid", "invalid-type", "empty"] as const)(
  "preserves owning layout field diagnostics through authenticated CLI input for %s",
  async (testCase, { cli }) => {
    const layout = analysisViewLayoutFixture();
    const result =
      testCase === "valid"
        ? layout
        : testCase === "empty"
          ? {}
          : { ...layout, artifact: { ...layout.artifact, bytes: "bad" } };
    const evidence = createEvidence(
      {
        path: layout.artifact.path,
        format: "elf",
        sha256: layout.artifact.sha256,
      },
      BINARY_LAYOUT_TEST_PROVIDER,
      { operation: "inspect_binary_layout", parameters: {}, result },
    );
    const path = join(
      await createTestTempDirectory("rea-layout-view-diagnostics-"),
      "request.json",
    );
    await writeFile(
      path,
      JSON.stringify({
        source: { kind: "inline", evidence },
        view: { kind: "summary" },
      }),
    );
    const response = await cli.run({
      arguments: ["inspect-analysis-view", path, "--format", "json"],
    });
    if (testCase === "valid") {
      expect(response.exitCode, response.stderr).toBe(0);
      expect(parseEvidence(response.json).normalized_result).toMatchObject({
        kind: "summary",
        parent_operation: "inspect_binary_layout",
      });
      return;
    }
    expect(response.exitCode, response.stderr).toBe(1);
    expect(response.json).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: {
        operation: "inspect_analysis_view",
        issues:
          testCase === "invalid-type"
            ? [
                expect.objectContaining({
                  path: ["source", "normalized_result", "artifact", "bytes"],
                  reason: "invalid_type",
                }),
              ]
            : expect.arrayContaining([
                expect.objectContaining({
                  path: ["source", "normalized_result", "artifact"],
                  reason: "missing_argument",
                }),
              ]),
      },
    });
  },
);
