import { expect, it } from "vitest";

import {
  MANAGED_APPLICATION_GRAPH_EXAMPLE,
  MANAGED_MEMBER_COMPARISON_EXAMPLE,
  MANAGED_NATIVE_VERIFICATION_EXAMPLE,
  MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
} from "../../../src/contracts/managed/managedWorkflowExamples.js";
import { parseEvidence, type Evidence } from "../../../src/domain/evidence.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";

const reference = (evidence: Evidence) => ({
  kind: "retained-evidence" as const,
  evidence_id: evidence.evidence_id,
});

const cases = [
  {
    name: "compare_managed_members",
    inline: MANAGED_MEMBER_COMPARISON_EXAMPLE,
    retained: {
      left: reference(MANAGED_MEMBER_COMPARISON_EXAMPLE.left),
      right: reference(MANAGED_MEMBER_COMPARISON_EXAMPLE.right),
    },
  },
  {
    name: "verify_managed_native_boundaries",
    inline: MANAGED_NATIVE_VERIFICATION_EXAMPLE,
    retained: {
      managed_boundaries: reference(
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      ),
      native_observations:
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.native_observations.map(reference),
    },
  },
  {
    name: "import_managed_reconstruction",
    inline: MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
    retained: {
      ...MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE,
      static_members: reference(
        MANAGED_RECONSTRUCTION_IMPORT_EXAMPLE.static_members,
      ),
    },
  },
  {
    name: "project_managed_application_graph",
    inline: MANAGED_APPLICATION_GRAPH_EXAMPLE,
    retained: {
      managed_members: reference(
        MANAGED_APPLICATION_GRAPH_EXAMPLE.managed_members,
      ),
    },
  },
] as const;

it("composes managed workflows from retained sources without opening an engine", async () => {
  const { client, session } = await createApplicationMcpHarness({
    session: createTestBinarySession(() => {
      throw new Error("Evidence composition must not open a provider");
    }),
  });

  for (const scenario of cases) {
    const inline = await client.callTool({
      name: scenario.name,
      arguments: scenario.inline,
    });
    expect(inline.isError, JSON.stringify(inline)).not.toBe(true);
    const original = parseEvidence(inline.structuredContent);

    const retained = await client.callTool({
      name: scenario.name,
      arguments: scenario.retained,
    });
    expect(retained.isError, JSON.stringify(retained)).not.toBe(true);
    expect(parseEvidence(retained.structuredContent)).toEqual(original);
    for (const sourceId of original.evidence_links)
      expect(session.hasEvidence(sourceId), sourceId).toBe(true);
  }

  const before = session.exportEvidenceBundle();
  const missingId = `ev_${"f".repeat(64)}`;
  const missing = await client.callTool({
    name: "project_managed_application_graph",
    arguments: {
      managed_members: { kind: "retained-evidence", evidence_id: missingId },
    },
  });
  expect(parseMcpToolError(missing)).toMatchObject({
    error: { details: { evidence_id: missingId, reason: "missing" } },
  });
  expect(session.exportEvidenceBundle()).toEqual(before);

  const wrongRole = await client.callTool({
    name: "project_managed_application_graph",
    arguments: {
      managed_members: reference(
        MANAGED_NATIVE_VERIFICATION_EXAMPLE.managed_boundaries,
      ),
    },
  });
  expect(parseMcpToolError(wrongRole)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: [expect.objectContaining({ path: ["managed_members"] })],
      },
    },
  });
  expect(session.exportEvidenceBundle()).toEqual(before);
});
