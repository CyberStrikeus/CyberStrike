import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { expect, it, onTestFinished } from "vitest";

import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import { createEvidenceBundle } from "../../../src/domain/evidenceBundle.js";

import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { parseProcessCapture } from "../../../src/domain/process/processCaptureParsing.js";
import { compareProcessCaptures } from "../../../src/domain/process/processComparison.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { reconstructionVerificationResultSchema } from "../../../src/domain/reconstructionVerificationSchemas.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

it("rejects an inconsistent imported process comparison while retaining its Evidence", async () => {
  const dimension = "terminal" as const;
  const source = (side: string) =>
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: { side },
      result: EMPTY_PROCESS_CAPTURE_EXAMPLE,
      confidence: "observed",
      authority: "controlled-replay",
      environment: {
        id: "fixture",
        platform: "fixture",
        architecture: "fixture",
        isolation: "process",
      },
    });
  const left = source("left");
  const right = source("right");
  const nativeResult = compareProcessCaptures(
    parseProcessCapture(left.normalized_result),
    parseProcessCapture(right.normalized_result),
  );
  expect(nativeResult.status).toBe("unchanged");
  const comparison = (status: "unchanged" | "contradiction") =>
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-comparison",
      operation: "compare_process_captures",
      parameters: {
        left_evidence_id: left.evidence_id,
        right_evidence_id: right.evidence_id,
      },
      result: {
        ...nativeResult,
        [dimension]: "contradiction",
        status,
      },
      confidence: "derived",
      authority: "analyst-inference",
      evidenceLinks: [left.evidence_id, right.evidence_id],
    });
  const inconsistent = comparison("unchanged");
  const consistent = comparison("contradiction");
  const root = await createTestTempDirectory("rea-process-verification-");
  const path = join(root, "bundle.json");
  await writeFile(
    path,
    JSON.stringify(
      createEvidenceBundle([left, right, inconsistent, consistent]),
    ),
  );
  let providerLaunches = 0;
  const session = createTestBinarySession(() => {
    providerLaunches += 1;
    throw new Error("Imported process verification must not launch a provider");
  });
  const harness = await createApplicationMcpHarness({ session });
  onTestFinished(harness.close);
  const imported = await harness.client.callTool({
    name: "import_evidence_bundle",
    arguments: { path },
  });
  expect(imported.isError).not.toBe(true);
  const verify = (evidenceId: string, selected: "overall" | typeof dimension) =>
    harness.client.callTool({
      name: "verify_reconstruction",
      arguments: {
        specification: {
          name: "Process comparison consistency",
          claims: [
            {
              kind: "behavioral",
              claim_id: selected,
              title: "Process replay agrees",
              comparison_evidence_id: evidenceId,
              dimension: selected,
            },
          ],
        },
      },
    });
  for (const selected of ["overall", dimension] as const) {
    const rejected = await verify(inconsistent.evidence_id, selected);
    expect(parseMcpToolError(rejected).error).toMatchObject({
      code: "evidence_integrity_mismatch",
      details: {
        reason: expect.stringContaining(
          "Process comparison status contradicts its dimensions",
        ),
      },
    });
    const failed = await verify(consistent.evidence_id, selected);
    expect(failed.isError).not.toBe(true);
    expect(
      reconstructionVerificationResultSchema.parse(
        parseEvidence(failed.structuredContent).normalized_result,
      ),
    ).toMatchObject({
      status: "fail",
      claims: { items: [{ observed_status: "contradiction" }] },
    });
  }
  for (const record of [left, right, inconsistent, consistent])
    expect(session.evidenceById(record.evidence_id)).toEqual(record);
  const recomputed = await harness.client.callTool({
    name: "compare_process_captures",
    arguments: { left, right },
  });
  expect(recomputed.isError).not.toBe(true);
  const control = parseEvidence(recomputed.structuredContent);
  const verified = await verify(control.evidence_id, "overall");
  expect(verified.isError).not.toBe(true);
  expect(
    reconstructionVerificationResultSchema.parse(
      parseEvidence(verified.structuredContent).normalized_result,
    ),
  ).toMatchObject({ status: "pass" });
  expect(providerLaunches).toBe(0);
  await harness.client.ping();
});

it("keeps omitted rendered observations unknown through trace comparison and imported verification", async () => {
  const frame = { sequence: 0, at_ms: 10, data: "Ready" };
  const capture = parseProcessCapture({
    ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
    frames: [frame],
    truncated: true,
    truncation_details: {
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE.truncation_details,
      raw_terminal: {
        budget_bytes: 5,
        observed_bytes: 5,
        retained_bytes: 5,
        observed_frames: 1,
        retained_frames: 1,
      },
      rendered_terminal: {
        budget_bytes: 5,
        observed_bytes: 0,
        retained_bytes: 0,
        observed_frames: 1,
        retained_frames: 0,
        unknown_size_frames: 1,
      },
    },
    event_journal: [
      { collection: "filesystem_checkpoints", index: 0, capture_order: 0 },
      { collection: "frames", index: 0, capture_order: 1 },
      { collection: "lifecycle", index: 0, capture_order: 2 },
      { collection: "lifecycle", index: 1, capture_order: 3 },
      { collection: "filesystem_checkpoints", index: 1, capture_order: 4 },
    ],
  });
  const source = (side: string) =>
    createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: { side },
      result: capture,
      confidence: "observed",
      authority: "controlled-replay",
      environment: {
        id: "fixture",
        platform: "fixture",
        architecture: "fixture",
        isolation: "process",
      },
    });
  const left = source("left");
  const right = source("right");
  const harness = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Unexpected provider launch");
    }),
  });
  onTestFinished(harness.close);
  const compared = await harness.client.callTool({
    name: "compare_process_captures",
    arguments: {
      left,
      right,
      trace_spec: {
        events: [
          {
            id: "ready",
            source: "terminal_raw",
            exact: frame,
            cardinality: { kind: "required" },
          },
        ],
        language: {
          kind: "finite_traces",
          variants: [{ id: "only", trace: ["ready"] }],
        },
      },
    },
  });
  expect(compared.isError).not.toBe(true);
  const comparison = parseEvidence(compared.structuredContent);
  expect(comparison.normalized_result).toMatchObject({
    terminal: "unknown",
    status: "unknown",
    trace: { verdict: "equivalent" },
    first_divergence: { status: "unknown" },
  });
  const root = await createTestTempDirectory("rea-process-trace-unknown-");
  const path = join(root, "bundle.json");
  await writeFile(
    path,
    JSON.stringify(createEvidenceBundle([left, right, comparison])),
  );
  const restored = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Unexpected provider launch");
    }),
  });
  onTestFinished(restored.close);
  const imported = await restored.client.callTool({
    name: "import_evidence_bundle",
    arguments: { path },
  });
  expect(imported.isError).not.toBe(true);
  const verification = await restored.client.callTool({
    name: "verify_reconstruction",
    arguments: {
      specification: {
        name: "Terminal coverage",
        claims: [
          {
            kind: "behavioral",
            claim_id: "terminal",
            title: "Replay remains equivalent",
            comparison_evidence_id: comparison.evidence_id,
            dimension: "terminal",
          },
        ],
      },
    },
  });
  expect(verification.isError).not.toBe(true);
  expect(
    reconstructionVerificationResultSchema.parse(
      parseEvidence(verification.structuredContent).normalized_result,
    ),
  ).toMatchObject({
    status: "unknown",
    claims: { items: [{ observed_status: "unknown" }] },
  });
});
