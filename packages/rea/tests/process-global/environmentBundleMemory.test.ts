import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { getHeapStatistics } from "node:v8";

import { expect, it, vi } from "vitest";

import { exportEnvironmentBundleTool } from "../../src/application/environment/environmentBundleTool.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../fixtures/analysisView.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

vi.mock("node:v8", { spy: true });

it("refuses retained export before allocation when its expanded copies cannot fit", async () => {
  const capture = analysisViewCaptureEvidence(
    environmentManifestCaptureFixture(),
  );
  const root = await createTestTempDirectory("rea-retained-export-memory-");
  const statistics = getHeapStatistics();
  vi.mocked(getHeapStatistics).mockReturnValue({
    ...statistics,
    total_available_size: 1,
  });
  const allocation = vi.spyOn(Buffer, "allocUnsafe");
  try {
    const result = await exportEnvironmentBundleTool(
      {
        source: { kind: "retained-evidence", evidence_id: capture.evidence_id },
        output_directory: join(root, "bundle"),
        dry_run: false,
      },
      () => capture,
    );
    if (result.ok) throw new Error("Expected a memory refusal");
    expect(projectAnalysisError(result.error)).toMatchObject({
      code: "resource_constraint",
      details: { operation: "export_environment_bundle", resource: "memory" },
    });
    expect(allocation).not.toHaveBeenCalled();
    expect(await readdir(root)).toEqual([]);
  } finally {
    allocation.mockRestore();
    vi.mocked(getHeapStatistics).mockReset();
  }
});
