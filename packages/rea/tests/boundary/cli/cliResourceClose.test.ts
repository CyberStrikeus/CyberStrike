import { afterEach, expect, it, vi } from "vitest";
import { closeCliResources } from "../../../src/cli.js";
import * as javascript from "../../../src/cli/javascriptApplicationAnalysis.js";
import * as guidance from "../../../src/cli/guidanceCommands.js";

afterEach(() => vi.restoreAllMocks());

it.each([
  [false, false],
  [true, false],
  [false, true],
  [true, true],
])(
  "settles both CLI owners when JavaScript fails=%s and guidance fails=%s",
  async (jsFails, guideFails) => {
    const jsError = new Error("JavaScript resources retained");
    const guideError = new Error("Guidance descriptor retained");
    const js = vi
      .spyOn(javascript, "closeCliJavaScriptResources")
      .mockImplementation(async () => {
        if (jsFails) throw jsError;
      });
    const guides = vi
      .spyOn(guidance, "closeCliGuidanceResources")
      .mockImplementation(async () => {
        if (guideFails) throw guideError;
      });
    const closing = closeCliResources();
    if (jsFails && guideFails)
      await expect(closing).rejects.toMatchObject({
        errors: [jsError, guideError],
      });
    else if (jsFails || guideFails)
      await expect(closing).rejects.toBe(jsFails ? jsError : guideError);
    else await expect(closing).resolves.toBeUndefined();
    expect(js).toHaveBeenCalledOnce();
    expect(guides).toHaveBeenCalledOnce();
  },
);
