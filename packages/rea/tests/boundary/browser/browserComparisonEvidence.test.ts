import { expect, it } from "vitest";
import {
  compareWebCaptureEvidence,
  compareWebScreenshotEvidence,
} from "../../../src/application/BrowserObservationService.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { compareWebCapturesInputSchema } from "../../../src/domain/webCaptureDiffSchemas.js";
import { EvidenceLedger } from "../../../src/application/investigation/EvidenceLedger.js";
import { scenarioCaptureFixture } from "../../fixtures/browserScenarioCapture.js";
import { passiveNetworkCapture } from "../../fixtures/passiveNetworkCapture.js";
import { browserCaptureComparisonInputSchema } from "../../../src/domain/browserCaptureComparison.js";
import { compareWebScreenshotsInputSchema } from "../../../src/domain/webScreenshot.js";
import { BROWSER_TOOL_CONTRACTS } from "../../../src/contracts/browserToolContracts.js";
import { digestCanonicalValue } from "../../../src/domain/canonicalDigest.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import { ok } from "../../../src/domain/result.js";

it("retains distinct offline comparison inputs even when their diff reports match", async () => {
  const browser = new CdpBrowserProvider();
  const compare = async (path: string) => {
    const inspection = passiveNetworkCapture([path]);
    const result = await compareWebCaptureEvidence(
      browser,
      compareWebCapturesInputSchema.parse({
        before: { inspection },
        after: { inspection },
      }),
    );
    if (!result.ok) throw result.error;
    return parseEvidence(result.value);
  };
  const first = await compare("/customer-a");
  const second = await compare("/customer-b");
  expect(first.normalized_result).toEqual(second.normalized_result);
  expect(first.evidence_id).not.toBe(second.evidence_id);
  expect(first.parameters.comparison_input_sha256).not.toBe(
    second.parameters.comparison_input_sha256,
  );
  expect(first).toMatchObject({
    confidence: "derived",
    authority: "analyst-inference",
    parameters: { before_target_id: "page", after_target_id: "page" },
  });
  expect((await compare("/customer-a")).evidence_id).toBe(first.evidence_id);
  const ledger = new EvidenceLedger();
  expect(ledger.record(first)).toEqual(ok("added"));
  expect(ledger.record(second)).toEqual(ok("added"));
});

it("commits complete scenario comparison inputs beyond the diff projection", async () => {
  const compare = async (duration: number) => {
    const capture = { ...scenarioCaptureFixture(), duration_ms: duration };
    const input = browserCaptureComparisonInputSchema.parse({
      before_scenario: capture,
      after_scenario: capture,
    });
    const result = await compareWebCaptureEvidence(
      new CdpBrowserProvider(),
      input,
    );
    if (!result.ok) throw result.error;
    return result.value;
  };
  const first = await compare(1);
  const second = await compare(2);
  expect(first.normalized_result).toEqual(second.normalized_result);
  expect(first.evidence_id).not.toBe(second.evidence_id);
  expect(first).toMatchObject({
    confidence: "derived",
    authority: "analyst-inference",
    parameters: { comparison_kind: "browser_scenario" },
  });
});

it("commits complete screenshot comparison inputs and reports derived provenance", async () => {
  const contract = BROWSER_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_web_screenshots",
  );
  const input = compareWebScreenshotsInputSchema.parse(
    contract?.examples[0]?.input,
  );
  const result = await compareWebScreenshotEvidence(
    new CdpBrowserProvider(),
    input,
  );
  if (!result.ok) throw result.error;
  expect(parseEvidence(result.value)).toMatchObject({
    confidence: "derived",
    authority: "analyst-inference",
    parameters: {
      comparison_input_sha256: digestCanonicalValue(input),
      before_artifact_sha256: input.before.sha256,
      after_artifact_sha256: input.after.sha256,
      channel_threshold: input.channel_threshold,
    },
    normalized_result: { status: "identical", compared_pixels: 1 },
  });
});
