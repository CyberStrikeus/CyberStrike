import { expect, it } from "vitest";
import { AnalysisAccessDeniedError } from "./analysisErrorCore.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import { analysisErrorProjectionSchema } from "../contracts/errorSchemas.js";

it.each(["EACCES", "EPERM"] as const)(
  "projects %s as host access denial with correction guidance and a valid public schema",
  (systemCode) => {
    const error = new AnalysisAccessDeniedError(
      "inspect_web_network_capture",
      "/selected/capture.har",
      systemCode,
      { cause: new Error("internal detail") },
    );
    const projected = projectAnalysisError(error);
    expect(analysisErrorProjectionSchema.parse(projected)).toMatchObject({
      code: "access_denied",
      category: "unavailable",
      retryable: false,
      details: {
        path: "/selected/capture.har",
        system_code: systemCode,
        boundary: "filesystem-read",
      },
    });
    expect(projected.remediation.action).toContain("read access");
    expect(JSON.stringify(projected)).not.toContain("internal detail");
  },
);
