import { expect, it, vi } from "vitest";
import { AnalysisCapabilityUnavailableError } from "../../domain/analysisErrorCore.js";
import { NodeCaptureAdapter } from "./NodeCaptureAdapter.js";

it.each(["har", "qlog"] as const)(
  "keeps SAZ-specific limitations out of %s captures",
  (format) => {
    expect(new NodeCaptureAdapter(format).limitations).toEqual([]);
  },
);

vi.mock("./CaptureRelease.js", async (original) => ({
  ...(await original<typeof import("./CaptureRelease.js")>()),
  NODE_CAPTURE_HEAP_ENFORCED: false,
  captureDecoderProcessMemoryLimitBytes: () => null,
}));

it.each(["saz", "qlog"] as const)(
  "refuses a %s worker when the runtime has no enforceable memory bound",
  async (format) => {
    await expect(
      new NodeCaptureAdapter(format).command("/owned/request.json"),
    ).rejects.toBeInstanceOf(AnalysisCapabilityUnavailableError);
  },
);
