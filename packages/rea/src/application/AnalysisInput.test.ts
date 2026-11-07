import { expect, it, vi } from "vitest";
import { z } from "zod";
import {
  AnalysisCancelledError,
  AnalysisInputError,
} from "../domain/analysisErrorCore.js";
import { parseAnalysisInput } from "./AnalysisInput.js";

it("admits direct inputs with schema defaults while preserving caller values", () => {
  const raw = {
    path: "/tmp/selected artifact",
    nested: { input: "caller value" },
  };
  const result = parseAnalysisInput(
    "inspect",
    raw,
    z.strictObject({
      path: z.string(),
      nested: z.strictObject({ input: z.string() }),
      detail: z.literal("full").default("full"),
    }),
  );
  if (!result.ok) throw result.error;
  expect(result.value).toEqual({ ...raw, detail: "full" });
  expect(raw).not.toHaveProperty("detail");
});

it("preserves direct-input issue paths and the original validation cause", () => {
  const result = parseAnalysisInput(
    "inspect",
    { input: "", extra: "caller-only-marker" },
    z.strictObject({ input: z.string().min(1) }),
  );
  if (result.ok || !(result.error instanceof AnalysisInputError))
    throw new Error("Expected input error");
  expect(result.error.operation).toBe("inspect");
  expect(result.error.issues).toEqual([
    { path: ["input"], reason: "out_of_range", minimum: 1 },
    { path: ["extra"], reason: "unknown_argument" },
  ]);
  expect(result.error.cause).toBeInstanceOf(z.ZodError);
  expect(JSON.stringify(result.error.issues)).not.toContain(
    "caller-only-marker",
  );
});

it("honors direct-input admission cancellation before reading the caller input", () => {
  const controller = new AbortController();
  const reason = { request: "cancel before validation" };
  controller.abort(reason);
  const read = vi.fn(() => "caller input");
  const raw = {
    get path() {
      return read();
    },
  };
  const result = parseAnalysisInput(
    "inspect",
    raw,
    z.strictObject({ path: z.string() }),
    controller.signal,
  );
  if (result.ok || !(result.error instanceof AnalysisCancelledError))
    throw new Error("Expected cancellation");
  expect(result.error.operation).toBe("inspect");
  expect(result.error.cause).toBe(reason);
  expect(read).not.toHaveBeenCalled();
});
