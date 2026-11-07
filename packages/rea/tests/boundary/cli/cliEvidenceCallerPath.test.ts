import { expect, it } from "vitest";

import { createEvidence } from "../../../src/domain/evidence.js";
import { err, ok } from "../../../src/domain/result.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { finishCliEvidenceCommand } from "../../../src/cli/cliEvidenceCallerPath.js";

it("retains the original file selection when final cleanup fails", async () => {
  const evidence = createEvidence(
    { path: "/tmp/selected", sha256: "a".repeat(64), format: "file" },
    { id: "test", name: "Test", version: "1" },
    { operation: "inspect", parameters: {}, result: null },
  );
  const result = await finishCliEvidenceCommand(
    "./selected",
    async () => ok(evidence),
    {
      close: async () => {
        throw new Error("cleanup failed");
      },
    },
    "test",
    "inspect",
    new AbortController().signal,
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cleanup failure");
  expect(result.error).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      partial_observation: {
        evidence_id: evidence.evidence_id,
        caller_input_path: "./selected",
      },
    },
  });
  expect(evidence).not.toHaveProperty("caller_input_path");
});

it("binds authenticated partial Evidence but preserves raw partial observations", async () => {
  const evidence = createEvidence(
    { path: "/tmp/selected", sha256: "a".repeat(64), format: "file" },
    { id: "test", name: "Test", version: "1" },
    { operation: "inspect", parameters: {}, result: null },
  );
  for (const [partial, expected] of [
    [
      evidence,
      { evidence_id: evidence.evidence_id, caller_input_path: "./selected" },
    ],
    [
      {
        kind: "file-snapshot-hash",
        path: "/tmp/selected",
        sha256: "a".repeat(64),
        bytes: 1,
      },
      { kind: "file-snapshot-hash", path: "/tmp/selected", bytes: 1 },
    ],
  ] as const) {
    const result = await finishCliEvidenceCommand(
      "./selected",
      async () =>
        err(
          new AnalysisCancelledError("inspect", {
            partialObservation: partial,
          }),
        ),
      { close: async () => {} },
      "test",
      "inspect",
      new AbortController().signal,
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("Expected cancellation");
    expect(result.error.details?.partial_observation).toMatchObject(expected);
  }
});
