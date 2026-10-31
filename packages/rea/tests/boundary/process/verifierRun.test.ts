import { expect, it } from "vitest";

import { assertVerifierCleanupComplete } from "../../../scripts/lib/verifier-run.mjs";

it("requires verified empty lineage before claiming verifier cleanup", () => {
  expect(() =>
    assertVerifierCleanupComplete({
      status: "unavailable",
      observed_at: "2026-10-14T00:00:00.000Z",
      launcher_pid: 100,
      launcher_parent_pid: 1,
      process_group_id: null,
      reason: "snapshot unavailable",
    }),
  ).toThrow("Verifier cleanup could not be verified: snapshot unavailable");

  expect(() =>
    assertVerifierCleanupComplete({
      status: "verified",
      observed_at: "2026-10-14T00:00:00.000Z",
      launcher_pid: 100,
      launcher_parent_pid: 1,
      process_group_id: 100,
      descendants: [{ pid: 101, parent_pid: 100, process_group_id: 100 }],
    }),
  ).toThrow("Owned descendants survived verifier cleanup");

  expect(() =>
    assertVerifierCleanupComplete({
      status: "verified",
      observed_at: "2026-10-14T00:00:00.000Z",
      launcher_pid: 100,
      launcher_parent_pid: 1,
      process_group_id: 100,
      descendants: [],
    }),
  ).not.toThrow();
});
