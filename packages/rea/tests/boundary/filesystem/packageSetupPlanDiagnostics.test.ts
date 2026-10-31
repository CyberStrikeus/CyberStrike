import { expect, it } from "vitest";

import { setupPlanFailureMessage } from "../../../scripts/verify-package-setup-plan.mjs";

it("preserves setup failure details when an error result has no action arrays", () => {
  const result = {
    status: "needs_human",
    remediation: "Review the host setup requirements.",
  };
  const message = setupPlanFailureMessage({
    planned: result,
    plannedExecution: { status: 1 },
    plannedClaudeConfig: "unchanged",
    plannedCodexConfig: "unchanged",
    plannedCursorConfig: "unchanged",
  });

  expect(message).toContain("packaged setup plan was not read-only");
  expect(message).toContain('"status":"needs_human"');
  expect(message).toContain("Review the host setup requirements.");
  expect(message).not.toContain("TypeError");
});

it("still formats action kinds for a structured setup result", () => {
  const message = setupPlanFailureMessage({
    planned: {
      status: "planned",
      plannedActions: [{ kind: "configure_client" }],
      appliedActions: [],
    },
    plannedExecution: { status: 0 },
    plannedClaudeConfig: "unchanged",
    plannedCodexConfig: "unchanged",
    plannedCursorConfig: "unchanged",
  });

  expect(message).toContain('"plannedKinds":["configure_client"]');
  expect(message).toContain('"appliedKinds":[]');
});
