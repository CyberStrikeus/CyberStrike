import { expect, it } from "vitest";
import { providerConfigurationRefusal } from "./providerConfigurationRefusal.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";

it("retains provider-owned configuration diagnostics in public refusals", () => {
  const failure = Object.assign(new Error("version unreadable"), {
    diagnostics: {
      selected_command: "/selected/apktool",
      command_source: "environment",
      remediation: "Inspect the selected launcher",
    },
  });
  expect(
    projectAnalysisError(
      providerConfigurationRefusal(
        "apktool",
        "inspect_apktool_client",
        failure,
      ),
    ),
  ).toMatchObject({
    code: "capability_unavailable",
    details: { diagnostics: failure.diagnostics },
  });
});
