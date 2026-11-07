import { expect, it } from "vitest";
import { BROWSER_TOOL_CONTRACTS } from "./browserToolContracts.js";
import {
  browserCaptureComparisonInputSchema,
  compareBrowserCaptures,
} from "../domain/browserCaptureComparison.js";

it("preserves attached event uncertainty in the advertised scenario comparison example", () => {
  const contract = BROWSER_TOOL_CONTRACTS.find(
    ({ name }) => name === "compare_web_captures",
  );
  const input = browserCaptureComparisonInputSchema.parse(
    contract?.examples[0]?.input,
  );
  if (!("before_scenario" in input))
    throw new Error("Expected a scenario example");
  expect(input.before_scenario.browser).toMatchObject({
    mode: "connect",
    process_ownership: "external",
  });
  expect(input.before_scenario.completeness).toMatchObject({
    status: "incomplete",
    equality_eligible: false,
    missing_sections: ["events"],
  });
  expect(compareBrowserCaptures(input)).toMatchObject({
    overall_status: "unknown",
  });
});
