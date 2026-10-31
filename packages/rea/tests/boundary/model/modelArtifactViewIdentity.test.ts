import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";

import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { createModelArtifactService } from "../../../src/composition/model.js";
import { createEvidence } from "../../../src/domain/evidence.js";
import { freezeJsonSnapshot } from "../../../src/domain/immutableJson.js";
import { ggufFixture } from "../../fixtures/model/model.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("checks each model parent digest independently of cached declarations and display paths", async () => {
  const root = await createTestTempDirectory("rea-model-view-identity-");
  const path = join(root, "selected.gguf");
  await writeFile(path, ggufFixture().bytes);
  const service = createModelArtifactService();
  try {
    const inspected = await service.inspect({
      path,
      hash: "full",
      detail: "complete",
    });
    if (!inspected.ok) throw inspected.error;
    const original = inspected.value;
    if (original.subject === null) throw new Error("Missing full-file subject");
    const report = freezeJsonSnapshot(original.normalized_result);
    const parent = (name: string, targetPath: string, digest: string) =>
      createEvidence(
        { path: targetPath, sha256: digest, format: "file" },
        original.provider,
        {
          operation: original.operation,
          parameters: { path, hash: "full", fixture: name },
          result: report,
          confidence: "observed",
          limitations: original.limitations,
        },
      );
    const digest = original.subject.digest.sha256;
    const valid = parent("valid", path, digest);
    const aliasPath = join(root, "other.gguf");
    const rebound = parent("rebound-path", aliasPath, digest);
    const conflicting = [
      parent("wrong-digest", path, "00".repeat(32)),
      parent("wrong-digest-rebound", aliasPath, "00".repeat(32)),
    ];
    const project = (record: typeof valid) =>
      inspectAnalysisView(
        {
          source: {
            kind: "retained-evidence",
            evidence_id: record.evidence_id,
          },
          view: { kind: "summary" },
        },
        (id) => (id === record.evidence_id ? record : undefined),
      );
    for (const record of [...conflicting, rebound])
      expect(record.normalized_result).toBe(report);
    for (const phase of ["cold", "warm"]) {
      for (const record of conflicting) {
        expect(await project(record), phase).toMatchObject({
          ok: false,
          error: {
            _tag: "AnalysisInputError",
            issues: [{ path: ["source", "subject"], reason: "invalid_value" }],
          },
        });
      }
      for (const record of [valid, rebound]) {
        const projected = await project(record);
        if (!projected.ok) throw projected.error;
        expect(projected.value.subject).toEqual(record.subject);
        expect(projected.value.evidence_links).toEqual([record.evidence_id]);
        expect(projected.value.normalized_result).toMatchObject({
          artifact: { path, sha256: digest },
        });
      }
    }
  } finally {
    await service.close();
  }
});
