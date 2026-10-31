import { expect, it, vi } from "vitest";
import { EnhancedTools } from "./EnhancedTools.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";

it("preserves field diagnostics for rejected enhanced tool inputs", async () => {
  const execute = vi.fn();
  const tools = new EnhancedTools({ execute });
  const result = await tools.execute("trace_native_values", { procedure: "" });
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected an input failure");
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "trace_native_values",
      issues: [{ path: ["procedure"], reason: "out_of_range", minimum: 1 }],
    },
  });
  expect(execute).not.toHaveBeenCalled();

  const sibling = await tools.execute("batch_decompile", { addresses: "bad" });
  expect(sibling.ok).toBe(false);
  if (sibling.ok) throw new Error("expected an input failure");
  expect(projectAnalysisError(sibling.error)).toMatchObject({
    details: { issues: [{ path: ["addresses"], reason: "invalid_type" }] },
  });
  expect(execute).not.toHaveBeenCalled();
});
