import { rebindEvidenceToTargetPath } from "../../../src/domain/evidence.js";
import { EvidenceLedger } from "../../../src/application/investigation/EvidenceLedger.js";
import { inspectAnalysisView } from "../../../src/application/analysisView/AnalysisViewService.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { ApkSignatureProvider } from "../../../src/apkSignature/ApkSignatureProvider.js";
import { ApkSignatureService } from "../../../src/application/apkSignature/ApkSignatureService.js";
import { freezeJsonSnapshot } from "../../../src/domain/immutableJson.js";
import { projectApkSignatureView } from "../../../src/domain/analysisView/apkSignatureView.js";
import { zipWith } from "../../fixtures/apkSignature/v1SignatureBlock.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("checks parent subject identity again when signing facts are already cached", async () => {
  const root = await createTestTempDirectory("rea-apk-cache-identity-");
  const path = join(root, "selected.apk");
  await writeFile(
    path,
    await zipWith([{ name: "classes.dex", data: "opaque" }]),
  );
  const service = new ApkSignatureService(new ApkSignatureProvider());
  try {
    const result = await service.inspect({ path, detail: "complete" });
    if (!result.ok) throw result.error;
    const evidence = result.value;
    if (evidence.subject === null || evidence.subject.format !== "apk")
      throw new Error("selected file subject missing");
    const parent = {
      evidenceId: evidence.evidence_id,
      operation: evidence.operation,
      normalizedResult: freezeJsonSnapshot(evidence.normalized_result),
      sealedResult: true,
      subject: evidence.subject,
      limitations: evidence.limitations,
    };
    const initial = projectApkSignatureView(parent, { kind: "summary" });
    if (!initial.ok) throw initial.error;
    for (const format of ["file", "apk", "zip"] as const)
      expect(
        projectApkSignatureView(
          { ...parent, subject: { ...evidence.subject, format } },
          { kind: "summary" },
        ).ok,
      ).toBe(true);
    const rebound = rebindEvidenceToTargetPath(evidence, {
      path: join(root, "alias.apk"),
      sha256: evidence.subject.digest.sha256,
      format: evidence.subject.format,
    });
    const exporting = new EvidenceLedger();
    expect(exporting.record(rebound).ok).toBe(true);
    const imported = new EvidenceLedger();
    expect(imported.import(exporting.export()).ok).toBe(true);
    const replay = await inspectAnalysisView(
      {
        source: { kind: "retained-evidence", evidence_id: rebound.evidence_id },
        view: { kind: "summary" },
      },
      (id) => imported.forAnalysis(id),
    );
    if (!replay.ok) throw replay.error;
    expect(replay.value.subject?.local_path).toBe(join(root, "alias.apk"));
    expect(replay.value.normalized_result).toMatchObject({
      artifact: { path },
    });
    for (const subject of [
      { ...evidence.subject, format: "directory" as const },
      {
        ...evidence.subject,
        digest: { ...evidence.subject.digest, sha256: "00".repeat(32) },
      },
    ]) {
      const invalid = projectApkSignatureView(
        { ...parent, subject },
        { kind: "summary" },
      );
      expect(invalid).toMatchObject({
        ok: false,
        error: { _tag: "AnalysisInputError" },
      });
    }
  } finally {
    await service.close();
  }
});
