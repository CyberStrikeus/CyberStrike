import { expect, it } from "vitest";

import { browserScenarioBrowserSchema } from "../../../src/domain/browserScenarioValues.js";

import { BROWSER_TOOL_CONTRACTS } from "../../../src/contracts/browserToolContracts.js";
import { comparePngScreenshots } from "../../../src/browser/PngVisualDiff.js";
import { compareWebScreenshotsInputSchema } from "../../../src/domain/webScreenshot.js";

it("executes the advertised screenshot comparison example through PNG checksum validation", () => {
  const contract = BROWSER_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_web_screenshots",
  );
  const input = compareWebScreenshotsInputSchema.parse(
    contract?.examples[0]?.input,
  );
  expect(comparePngScreenshots(input)).toMatchObject({
    status: "identical",
    compared_pixels: 1,
    changed_pixels: 0,
  });
});

it.each([" target ", "\t", "target"])(
  "preserves the connect scenario target identity %j",
  (targetId) => {
    expect(
      browserScenarioBrowserSchema.parse({
        mode: "connect",
        cdp_endpoint: "http://127.0.0.1:9222",
        target_id: targetId,
      }),
    ).toMatchObject({ target_id: targetId });
  },
);

it("rejects an empty connect scenario target identity", () => {
  expect(
    browserScenarioBrowserSchema.safeParse({
      mode: "connect",
      cdp_endpoint: "http://127.0.0.1:9222",
      target_id: "",
    }).success,
  ).toBe(false);
});
