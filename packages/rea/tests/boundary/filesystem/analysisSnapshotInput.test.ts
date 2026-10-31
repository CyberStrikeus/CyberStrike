import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { readAnalysisSnapshot } from "../../../src/application/binary/AnalysisSnapshotFiles.js";
import { projectAnalysisError } from "../../../src/domain/analysisErrorProjection.js";
import {
  snapshotBinding,
  snapshotTarget,
} from "../../../src/domain/analysisSnapshot.js";
import {
  ANALYSIS_SNAPSHOT_PROFILE,
  ANALYSIS_SNAPSHOT_TARGET,
} from "../../../src/domain/analysisSnapshot.fixture.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

describe.each([
  { mode: "native", paddingBytes: 0 },
  { mode: "streamed", paddingBytes: 9 * 1024 * 1024 },
])("analysis snapshot input ($mode)", ({ paddingBytes }) => {
  it.each(["[]", "null", "5", '"x"', "true"])(
    "classifies a readable %s root as invalid content, not an I/O failure",
    async (document) => {
      const root = await createTestTempDirectory("rea-snapshot-root-");
      const path = join(root, "snapshot.json");
      const encoded = `${" ".repeat(paddingBytes)}${document}`;
      await writeFile(path, encoded);

      const loaded = await readAnalysisSnapshot(path);
      if (loaded.ok) throw new Error("Expected a non-object root rejection");
      const projected = projectAnalysisError(loaded.error);
      expect(projected).toMatchObject({
        code: "evidence_integrity_mismatch",
        details: { reason: "invalid-json" },
      });
      expect(projected.message).toContain("Repair or recreate");
      expect(loaded.error.cause).toMatchObject({
        message: "JSON document root must be an object",
      });
      expect(await readFile(path, "utf8")).toBe(encoded);
    },
  );

  it("retains syntax and snapshot-member validation and loads valid objects", async () => {
    const root = await createTestTempDirectory("rea-snapshot-validation-");
    const path = join(root, "snapshot.json");
    const prefix = " ".repeat(paddingBytes);
    await writeFile(path, `${prefix}[`);
    expect(await readAnalysisSnapshot(path)).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceFileError", reason: "invalid-json" },
    });
    await writeFile(path, `${prefix}{}`);
    expect(await readAnalysisSnapshot(path)).toMatchObject({
      ok: false,
      error: { _tag: "EvidenceIntegrityError" },
    });
    const snapshot = {
      target: snapshotTarget(ANALYSIS_SNAPSHOT_TARGET),
      binding: snapshotBinding(ANALYSIS_SNAPSHOT_PROFILE),
      entries: [],
      workflow_entries: [],
      evidence_bundle: createEvidenceBundle([]),
    };
    await writeFile(path, `${prefix}${JSON.stringify(snapshot)}`);
    expect(await readAnalysisSnapshot(path)).toEqual({
      ok: true,
      value: snapshot,
    });
  });
});

it("keeps file-selection failures distinct from invalid snapshot contents", async () => {
  const root = await createTestTempDirectory("rea-snapshot-selection-");
  for (const [path, reason] of [
    [join(root, "missing.json"), "missing"],
    [root, "not-file"],
  ] as const) {
    const loaded = await readAnalysisSnapshot(path);
    if (loaded.ok) throw new Error("Expected a file-selection failure");
    expect(projectAnalysisError(loaded.error)).toMatchObject({
      code: "invalid_request",
      details: { reason },
    });
  }
});
