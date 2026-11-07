import { expect, it, vi } from "vitest";
import { AndroidAnalysisService } from "./AndroidAnalysisService.js";
import type { AndroidAnalysisPort } from "./AndroidAnalysisPort.js";
import { projectAnalysisError } from "../../domain/analysisErrorProjection.js";

it("retains selector correction issues before target acquisition", async () => {
  const execute = vi.fn<AndroidAnalysisPort["execute"]>();
  const provider: AndroidAnalysisPort = {
    execute,
    inspectAvailability: vi.fn(),
    close: vi.fn(),
  };
  const result = await new AndroidAnalysisService(provider).execute(
    "inspect_android_class",
    {
      path: "/nonexistent.apk",
      class_name: "",
    },
  );
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(projectAnalysisError(result.error)).toMatchObject({
    code: "invalid_request",
    details: {
      issues: [{ path: ["class_name"], reason: "out_of_range", minimum: 1 }],
    },
  });
  expect(execute).not.toHaveBeenCalled();
});
