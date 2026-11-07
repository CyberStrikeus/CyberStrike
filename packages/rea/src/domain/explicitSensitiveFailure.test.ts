import { EvidenceFileError } from "./evidenceErrors.js";
import {
  AnalysisAccessDeniedError,
  AnalysisInputError,
  AnalysisCapabilityUnavailableError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
  AnalysisArtifactChangedError,
  AnalysisOutputError,
  AnalysisResourceConstraintError,
} from "./analysisErrorCore.js";
import { expect, it } from "vitest";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import { ProviderCleanupError } from "./providerCleanupError.js";
import { ProviderAdapterError } from "./providerAdapterError.js";
import { analysisErrorWithCleanupFailure } from "./analysisErrorCleanup.js";
import { resolvedAnalysisError } from "./analysisErrorBase.js";
import { createEvidence } from "./evidence.js";
import {
  redactExplicitFailure,
  redactExplicitPointer,
} from "./explicitSensitiveFailure.js";

const context = {
  diagnostics: {
    note: "explicit-secret warning",
    nested: { "explicit-secret-key": 5, observed: 7 },
    caller_path: "/tmp/password-fixture?token=public-value",
  },
  capturedOutput: {
    stdout: "explicit-secret output",
    stderr: "public stderr",
    stdout_bytes: 22,
    truncated: false,
  },
};

it.each([
  new AnalysisCancelledError("inspect", context),
  new AnalysisTimeoutError("inspect", 250, context),
  new AnalysisInputError("inspect", context),
  new AnalysisAccessDeniedError("inspect", "/public", "EACCES", context),
  new AnalysisArtifactChangedError("inspect", "/public", "changed", context),
  new AnalysisOutputError("inspect", "invalid", context),
  new AnalysisCapabilityUnavailableError(
    "provider",
    "inspect",
    "unsupported",
    context,
  ),
  new AnalysisResourceConstraintError(
    "inspect",
    "memory",
    "capacity",
    null,
    context,
  ),
  new ProviderAdapterError("provider", "inspect", context),
])("preserves sanitized common context for $._tag", (error) => {
  const observation = createEvidence(
    undefined,
    { id: "fixture", name: "Owner facts", version: "1" },
    {
      operation: "inspect",
      parameters: {},
      result: { source: "already sanitized owner facts" },
      confidence: "observed",
      authority: "historical-reference",
    },
  );
  error.retainPartialObservation(observation);
  const sanitized = redactExplicitFailure(error, ["explicit-secret"]);
  expect(sanitized.partialObservation).toBe(observation);
  expect(sanitized._tag).toBe(error._tag);
  const projected = projectAnalysisError(sanitized);
  expect(projected.details).toMatchObject({
    diagnostics: {
      note: "[REDACTED] warning",
      nested: { observed: 7 },
      caller_path: context.diagnostics.caller_path,
    },
    captured_output: {
      stdout: "[REDACTED] output",
      stdout_bytes: 22,
      stderr: "public stderr",
    },
  });
  expect(JSON.stringify(projected)).not.toContain("explicit-secret");
});

it.each([
  ["/metadata/private~1~0/numeric", ["private/~"], "/metadata"],
  ["/metadata/private/child", ["private"], "/metadata"],
  ["/ordinary/path", [], "/ordinary/path"],
])(
  "preserves a real parent for excluded pointer identities: %s",
  (pointer, values, expected) => {
    expect(redactExplicitPointer(pointer, values)).toBe(expected);
  },
);

it("preserves cleanup failure authority and resources while excluding diagnostics", () => {
  const error = new ProviderCleanupError(
    "har",
    ["/root/private/capture", "pid:123"],
    {
      capture_path: "/root/private/capture",
      nested: { "private-key": 5, ordinary: "private ordinary" },
      exit_code: 2,
    },
    { operation: "inspect_web_network_capture" },
  );
  const projected = projectAnalysisError(
    redactExplicitFailure(error, ["private", "REDACTED"]),
  );
  expect(projected).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      resources: expect.arrayContaining(["pid:123"]),
      diagnostics: { exit_code: 2 },
    },
  });
  expect(JSON.stringify(projected)).not.toContain("private");
  expect(JSON.stringify(projected)).not.toContain("REDACTED");
});

it("redacts cleanup primaries and mirrors the source error's live status", () => {
  const primary = new AnalysisInputError(
    "inspect_web_network_capture",
    undefined,
    [
      {
        path: ["capture_path", "/root/private-marker/capture.har"],
        reason: "invalid_value",
        message: "Selected private-marker capture was invalid",
      },
    ],
  );
  const cleanup = new ProviderCleanupError(
    "har",
    ["/tmp/private-marker-runtime"],
    { reason: "private-marker runtime close failed" },
    { operation: "inspect_web_network_capture" },
  );
  const original = analysisErrorWithCleanupFailure(
    primary,
    cleanup,
    "inspect_web_network_capture",
  );

  const redacted = redactExplicitFailure(original, ["private-marker"]);
  expect(redacted.cleanupIncomplete).toBe(true);
  expect(redacted.cleanupResources).toEqual(["/tmp/[REDACTED]-runtime"]);
  expect(JSON.stringify(projectAnalysisError(redacted))).not.toContain(
    "private-marker",
  );

  original.resolveCleanup();
  expect(redacted.cleanupIncomplete).toBe(false);
  const resolved = resolvedAnalysisError(redacted);
  expect(JSON.stringify(projectAnalysisError(resolved))).not.toContain(
    "private-marker",
  );
  expect(projectAnalysisError(resolved).details).toMatchObject({
    issues: [
      {
        path: ["capture_path", "/root"],
        reason: "invalid_value",
      },
    ],
  });
});

it("keeps a named timeout control through explicit-value redaction", () => {
  const error = new AnalysisTimeoutError(
    "analyze_javascript_application",
    300000,
    {
      userMessage:
        "JavaScript source analysis reached its 300000ms per-source server/provider deadline (analysis_timeout_ms) for explicit-secret, not the MCP client deadline.",
      remediationAction:
        "Increase analysis_timeout_ms through MCP for explicit-secret, or use rea analyze-javascript-application <input_path> --analysis-timeout-ms <milliseconds> on the CLI.",
    },
  );
  const redacted = redactExplicitFailure(error, ["explicit-secret"]);
  const projected = projectAnalysisError(redacted);
  expect(projected.message).toContain("analysis_timeout_ms");
  expect(projected.message).toContain("300000");
  expect(projected.remediation.action).toContain("analysis_timeout_ms");
  expect(projected.remediation.action).toContain("--analysis-timeout-ms");
  expect(JSON.stringify(projected)).not.toContain("explicit-secret");
});

it("keeps unsupported profile reasons distinct from malformed input", () => {
  const error = new AnalysisCapabilityUnavailableError(
    "mitmproxy",
    "inspect_web_network_capture",
    "Unsupported private profile",
    { userMessage: "Select private-compatible profile" },
  );
  const result = redactExplicitFailure(error, ["private"]);
  expect(result).toBeInstanceOf(AnalysisCapabilityUnavailableError);
  expect(projectAnalysisError(result).code).toBe("capability_unavailable");
  expect(JSON.stringify(projectAnalysisError(result))).not.toContain("private");
});

it("preserves a retryable capability failure through explicit-value redaction", () => {
  // Retryability is a semantic field of the error, not presentation: dropping
  // it turns a transient admission failure into a permanent one and changes
  // the remediation the caller is shown.
  const error = new AnalysisCapabilityUnavailableError(
    "mitmproxy",
    "inspect_web_network_capture",
    "Runtime admission for /targets/private/capture failed transiently",
    { retryable: true },
  );
  expect(projectAnalysisError(error).retryable).toBe(true);
  const result = redactExplicitFailure(error, ["private"]);
  expect(result).toBeInstanceOf(AnalysisCapabilityUnavailableError);
  expect((result as AnalysisCapabilityUnavailableError).retryable).toBe(true);
  expect(projectAnalysisError(result).retryable).toBe(true);
  expect(JSON.stringify(projectAnalysisError(result))).not.toContain("private");
});

it("coarsens format issue pointers without creating replacement coordinates", () => {
  const error = new AnalysisInputError(
    "inspect_web_network_capture",
    undefined,
    [
      {
        path: ["capture_path", "/metadata/private~1~0/nested"],
        reason: "invalid_format",
        message: "Malformed private field",
      },
    ],
  );
  const result = redactExplicitFailure(error, ["private/~", "private"]);
  if (!(result instanceof AnalysisInputError))
    throw new Error("Input error required");
  expect(result.issues[0]?.path).toEqual(["capture_path", "/metadata"]);
});

it("excludes a marked permission-denied path without losing its host error code", () => {
  const error = redactExplicitFailure(
    new AnalysisAccessDeniedError(
      "inspect_web_network_capture",
      "/declared-path-value/capture.har",
      "EACCES",
    ),
    ["declared-path-value"],
  );
  expect(error._tag).toBe("AnalysisAccessDeniedError");
  const projected = projectAnalysisError(error);
  expect(projected).toMatchObject({
    code: "access_denied",
    category: "unavailable",
    details: { system_code: "EACCES" },
  });
  expect(JSON.stringify(projected)).not.toContain("declared-path-value");
});

it("coarsens ordinary sensitive issue-path segments to their real parent", () => {
  const input = new AnalysisInputError(
    "inspect_web_network_capture",
    undefined,
    [
      {
        path: ["input", "mysecret", "child"],
        reason: "unknown_argument",
        message: "Unrecognized mysecret",
      },
    ],
  );
  const result = redactExplicitFailure(input, ["secret"]);
  if (!(result instanceof AnalysisInputError))
    throw new Error("Input error required");
  expect(result.issues[0]?.path).toEqual(["input"]);
  expect(JSON.stringify(projectAnalysisError(result))).not.toContain("secret");
});

it("does not reinterpret an unknown argument name as a JSON pointer", () => {
  const input = new AnalysisInputError(
    "inspect_web_network_capture",
    undefined,
    [{ path: ["/ordinary/secret"], reason: "unknown_argument" }],
  );
  const result = redactExplicitFailure(input, ["secret"]);
  if (!(result instanceof AnalysisInputError))
    throw new Error("Input error required");
  expect(result.issues[0]?.path).toEqual([]);
});

it("preserves completed publication and live cleanup while excluding marked file identities", () => {
  const original = new EvidenceFileError("write", "io", {
    path: "/private-marker/output.json",
    published: { path: "/private-marker/output.json", bytes: 42 },
    cleanup: {
      reason: "private-marker staging failed",
      resources: ["/private-marker/stage"],
    },
  });
  const redacted = redactExplicitFailure(original, ["private-marker"]);
  const projected = projectAnalysisError(redacted);
  expect(projected).toMatchObject({
    code: "cleanup_incomplete",
    details: { published: true, bytes: 42 },
  });
  expect(projected.details).not.toHaveProperty("path");
  expect(projected.details).not.toHaveProperty("published_path");
  expect(JSON.stringify(projected)).not.toContain("private-marker");
  original.resolveCleanup();
  expect(redacted.cleanupIncomplete).toBe(false);
});
