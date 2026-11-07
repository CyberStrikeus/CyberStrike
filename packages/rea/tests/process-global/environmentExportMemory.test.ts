import { getHeapStatistics } from "node:v8";

import { expect, it, vi } from "vitest";

import { evidenceFileBytes } from "../../src/application/environment/environmentEvidenceBytes.js";
import {
  environmentExportEvidenceFile,
  environmentExportFile,
} from "../../src/application/environment/environmentExport.js";
import { projectAnalysisError } from "../../src/domain/analysisErrorProjection.js";
import {
  analysisViewCaptureEvidence,
  environmentManifestCaptureFixture,
} from "../fixtures/analysisView.js";

vi.mock("node:v8", { spy: true });

it.each(["serialize", "parse"] as const)(
  "refuses in-memory export before %s when its copies cannot fit",
  async (stage) => {
    const capture = analysisViewCaptureEvidence(
      environmentManifestCaptureFixture(),
    );
    const bytes = evidenceFileBytes(capture);
    const statistics = getHeapStatistics();
    const allocate = vi.spyOn(Buffer, "allocUnsafe");
    vi.mocked(getHeapStatistics).mockReturnValue({
      ...statistics,
      total_available_size: 1,
    });
    try {
      const result =
        stage === "serialize"
          ? await environmentExportEvidenceFile(
              "evidence",
              "capture.json",
              capture,
              "environment-build",
            )
          : await environmentExportFile("evidence", "capture.json", bytes, {
              operation: "environment-build",
            });
      if (result.ok) throw new Error("Expected a memory refusal");
      expect(projectAnalysisError(result.error)).toMatchObject({
        code: "resource_constraint",
        details: { operation: "environment-build", resource: "memory" },
      });
      expect(allocate).not.toHaveBeenCalled();
    } finally {
      vi.mocked(getHeapStatistics).mockReset();
      allocate.mockRestore();
    }
  },
);
