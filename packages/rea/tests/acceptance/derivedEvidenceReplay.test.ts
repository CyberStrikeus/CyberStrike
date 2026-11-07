import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { z } from "zod";

import { FUNCTION_COMPARISON_EXAMPLE } from "../../src/contracts/functionComparisonExample.js";
import { createEvidence, parseEvidence } from "../../src/domain/evidence.js";
import { parseEvidenceBundle } from "../../src/domain/evidenceBundle.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../src/domain/process/processCaptureExample.js";
import { PROCESS_PROVIDER } from "../../src/domain/process/processEvidenceProvider.js";
import {
  residualUnknownSchema,
  type ResidualUnknown,
  type UpdateUnknownInput,
} from "../../src/domain/residualUnknown.js";
import { connectLocalToolsMcp } from "../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../fixtures/temporaryDirectory.js";

const resultEnvelope = z.object({ result: z.unknown() });

const capture = (changed: boolean) =>
  createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: {},
    result: {
      ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
      interaction_events: changed
        ? [
            {
              sequence: 0,
              scheduled_at_ms: 0,
              dispatched_at_ms: 0,
              type: "input",
              data: "fixture",
              outcome: "dispatched",
            },
          ]
        : [],
    },
    confidence: "observed",
    authority: "controlled-replay",
  });

const updateInput = (
  unknown: ResidualUnknown,
  status: "investigating" | "resolved",
): UpdateUnknownInput => ({
  unknown_id: unknown.unknown_id,
  expected_revision: unknown.revision,
  status,
  severity: "low",
  supporting_evidence_ids: unknown.supporting_evidence_ids,
  contradicting_evidence_ids: unknown.contradicting_evidence_ids,
  required_authority: unknown.required_authority,
  required_confidence: unknown.required_confidence,
  required_environment: unknown.required_environment,
  recommended_probes: [],
  relationships: unknown.relationships,
  resolution:
    status === "resolved"
      ? {
          disposition: "withdrawn",
          rationale: "Analyst withdrew this question.",
          evidence_ids: [],
        }
      : null,
});

it.each([
  {
    operation: "compare_process_captures",
    left: capture(false),
    right: capture(true),
  },
  { operation: "compare_functions", ...FUNCTION_COMPARISON_EXAMPLE },
])(
  "replays $operation without reverting analyst revisions, including after handoff",
  async ({ operation, left, right }) => {
    const { call } = await connectLocalToolsMcp();
    const args = { left, right };
    const compared = await call(operation, args);
    expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
    const evidence = parseEvidence(compared.structuredContent);
    expect(evidence.normalized_result).toMatchObject({ status: "changed" });
    const bundle = async () => {
      const response = await call("get_evidence_bundle", {});
      expect(response.isError, JSON.stringify(response)).not.toBe(true);
      return parseEvidenceBundle(
        resultEnvelope.parse(response.structuredContent).result,
      );
    };
    const initial = await bundle();
    expect(initial.unknowns).toHaveLength(1);
    let head = residualUnknownSchema.parse(initial.unknowns[0]);
    const repeat = await call(operation, args);
    expect(repeat.isError, JSON.stringify(repeat)).not.toBe(true);
    expect(parseEvidence(repeat.structuredContent)).toEqual(evidence);
    expect(await bundle()).toEqual(initial);

    for (const status of ["investigating", "resolved"] as const) {
      const command = updateInput(head, status);
      const updated = await call("update_unknown", command);
      expect(updated.isError, JSON.stringify(updated)).not.toBe(true);
      head = residualUnknownSchema.parse(
        resultEnvelope.parse(updated.structuredContent).result,
      );
      expect(head).toMatchObject({
        status,
        revision: command.expected_revision + 1,
      });
      const beforeReplay = await bundle();
      const replayed = await call(operation, args);
      expect(replayed.isError, JSON.stringify(replayed)).not.toBe(true);
      expect(parseEvidence(replayed.structuredContent)).toEqual(evidence);
      expect(await bundle()).toEqual(beforeReplay);
      const stale = await call("update_unknown", command);
      expect(stale.isError).toBe(true);
      expect(parseMcpToolError(stale)).toMatchObject({
        error: {
          code: "revision_conflict",
          details: { reason: "revision-conflict" },
        },
      });
      expect(await bundle()).toEqual(beforeReplay);
    }

    const retained = await bundle();
    expect(retained.unknowns.map(({ revision }) => revision)).toEqual([
      1, 2, 3,
    ]);
    const root = await createTestTempDirectory("rea-derived-replay-");
    const path = join(root, "handoff.json");
    await writeFile(path, JSON.stringify(retained));
    const restored = await connectLocalToolsMcp();
    const imported = await restored.call("import_evidence_bundle", { path });
    expect(imported.isError, JSON.stringify(imported)).not.toBe(true);
    const replayed = await restored.call(operation, args);
    expect(replayed.isError, JSON.stringify(replayed)).not.toBe(true);
    expect(parseEvidence(replayed.structuredContent)).toEqual(evidence);
    const listed = await restored.call("list_unknowns", {});
    expect(listed.structuredContent).toMatchObject({
      result: { items: [head] },
    });

    const invalid = await restored.call(operation, {
      left: { ...left, normalized_result: {} },
      right,
    });
    expect(invalid.isError).toBe(true);
    expect(parseMcpToolError(invalid).error).toMatchObject({
      code: "evidence_integrity_mismatch",
      category: "integrity_mismatch",
      retryable: false,
    });
    const afterReplay = await restored.call("get_evidence_bundle", {});
    expect(
      parseEvidenceBundle(
        resultEnvelope.parse(afterReplay.structuredContent).result,
      ),
    ).toEqual(retained);
  },
);
