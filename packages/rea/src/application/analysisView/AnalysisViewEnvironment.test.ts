import { describe, expect, it } from "vitest";
import { scenarioCaptureEvidence } from "../../../tests/fixtures/browserScenarioCapture.js";
import {
  createImmutableEvidenceBundle,
  parseEvidenceBundle,
  serializeEvidenceBundle,
} from "../../domain/evidenceBundle.js";
import { EvidenceLedger } from "../investigation/EvidenceLedger.js";
import {
  inspectAnalysisView,
  summarizeRetainedAnalysis,
} from "./AnalysisViewService.js";

describe("analysis view execution environment provenance", () => {
  it("preserves controlled replay environment through projection, retention, and portable export", async () => {
    const parent = scenarioCaptureEvidence();
    expect(parent.environment).not.toBeNull();
    const ledger = new EvidenceLedger();
    const summary = summarizeRetainedAnalysis(parent, {
      recordEvidence: (evidence) => ledger.record(evidence),
      evidenceById: (id) => ledger.forAnalysis(id),
    });
    if (!summary.ok) throw summary.error;
    const manifest = await inspectAnalysisView(
      {
        source: { kind: "retained-evidence", evidence_id: parent.evidence_id },
        view: { kind: "environment-manifest" },
      },
      (id) => ledger.forAnalysis(id),
    );
    if (!manifest.ok) throw manifest.error;
    for (const view of [summary.value, manifest.value]) {
      expect(view.environment).toEqual(parent.environment);
      expect(view.authority).toBe("controlled-replay");
      expect(view.evidence_links).toEqual([parent.evidence_id]);
      expect(ledger.record(view).ok).toBe(true);
    }
    const bundle = parseEvidenceBundle(
      JSON.parse(
        serializeEvidenceBundle(
          createImmutableEvidenceBundle([
            parent,
            summary.value,
            manifest.value,
          ]),
        ),
      ),
    );
    expect(bundle.environments).toEqual([parent.environment]);
    for (const record of bundle.records)
      expect(record.environment).toEqual(parent.environment);
  });

  it("keeps an unknown source environment unknown", async () => {
    const { analysisViewCaptureEvidence } =
      await import("../../../tests/fixtures/analysisView.js");
    const parent = analysisViewCaptureEvidence();
    expect(parent.environment).toBeNull();
    const projected = await inspectAnalysisView({
      source: { kind: "inline", evidence: parent },
      view: { kind: "summary" },
    });
    if (!projected.ok) throw projected.error;
    expect(projected.value.environment).toBeNull();
  });
});
