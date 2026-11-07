import { expect, it } from "vitest";
import { z } from "zod";

import { createAnalysisExecution } from "../../src/application/AnalysisProvider.js";
import { traceCallPath } from "../../src/application/CallPathTracing.js";
import { ok } from "../../src/domain/result.js";

it("attributes malformed relationship output to the originating provider operation", async () => {
  const result = await traceCallPath(
    async (operation) =>
      ok(operation === "procedure_address" ? "0x1000" : "0x1000"),
    async () =>
      ok(
        createAnalysisExecution(
          { callees: [123] },
          { id: "test", name: "test", version: null },
        ),
      ),
    { start: "entry", direction: "forward" },
  );

  expect(result.ok).toBe(true);
  if (result.ok) {
    const failures = z
      .object({
        failures: z.array(
          z.object({
            error: z.object({
              details: z.object({ operation: z.string() }),
            }),
          }),
        ),
      })
      .parse(result.value).failures;
    expect(failures[0]?.error.details.operation).toBe("procedure_callees");
  }
});
