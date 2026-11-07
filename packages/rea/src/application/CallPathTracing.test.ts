import { describe, expect, it } from "vitest";

import { traceCallPath } from "./CallPathTracing.js";
import { createAnalysisExecution } from "./AnalysisProvider.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { err, ok } from "../domain/result.js";

const input = { start: "entry", direction: "forward" as const };
const provider = { id: "fixture", name: "Fixture", version: "1" };

describe("call-path traversal cancellation ownership", () => {
  for (const phase of ["selection", "relationship"] as const)
    for (const reason of [null, { requested: "stop after provider reply" }])
      it(`preserves the exact reason at the ${phase} continuation (${reason === null ? "null" : "object"})`, async () => {
        const controller = new AbortController();
        const result = await traceCallPath(
          async () => {
            if (phase === "selection") controller.abort(reason);
            return ok("0x1000");
          },
          async () => {
            controller.abort(reason);
            return ok(createAnalysisExecution([], provider));
          },
          input,
          controller.signal,
        );
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error("Expected cancellation");
        expect(result.error).toBeInstanceOf(AnalysisCancelledError);
        expect(result.error.cause).toBe(reason);
      });

  it("preserves a selected provider failure when cancellation arrives with its reply", async () => {
    const controller = new AbortController();
    const failure = new AnalysisOutputError(
      "procedure_callees",
      "invalid fixture reply",
    );
    const result = await traceCallPath(
      async () => ok("0x1000"),
      async () => {
        controller.abort({ requested: "stop" });
        return err(failure);
      },
      input,
      controller.signal,
    );
    expect(result).toEqual(err(failure));
  });
});
