import { describe, expect, it } from "vitest";
import {
  AnalysisCapabilityUnavailableError,
  AnalysisUnsupportedTargetError,
  AnalysisInputError,
  AnalysisOutputError,
  AnalysisCancelledError,
  AnalysisTimeoutError,
  AnalysisResourceConstraintError,
} from "./analysisErrorCore.js";
import { ArtifactOperationError } from "./artifactOperationError.js";
import {
  BinaryTargetError,
  ConfigurationError,
} from "./configurationErrors.js";
import { BrowserObservationError } from "./browserObservationError.js";
import { EvidenceFileError, EvidenceIntegrityError } from "./evidenceErrors.js";
import {
  HopperProcessError,
  HopperRemoteError,
  HopperStartError,
  HopperTimeoutError,
} from "./hopperErrors.js";
import {
  DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  HOPPER_DEMO_DIALOG_TIMEOUT_SETTING,
  MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
  type DialogTimeoutRejection,
  type HopperStartupFailureDiagnostic,
} from "./hopperStartupFailure.js";
import { ProviderAdapterError } from "./providerAdapterError.js";
import { UnknownRegistryError } from "./unknownRegistryError.js";
import { projectAnalysisError } from "./analysisErrorProjection.js";
import { ProviderSelectionError } from "./providerSelectionError.js";
import { analysisErrorProjectionSchema } from "../contracts/errorSchemas.js";
import { nativeCallPartialObservationSchema } from "./native/nativeCallPartialObservation.js";

describe("agent recovery metadata", () => {
  it("does not mark deterministic input validation as retryable", () => {
    const projected = projectAnalysisError(
      new AnalysisInputError("extract_firmware", undefined, [
        { path: ["range", "length"], reason: "missing_argument" },
      ]),
    );

    expect(projected).toMatchObject({
      code: "invalid_request",
      retryable: false,
      remediation: {
        action: expect.stringContaining("Do not repeat the unchanged call."),
      },
    });
    expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
  });

  it("distinguishes deterministic duplicate identities from stale update revisions", () => {
    const duplicate = projectAnalysisError(
      new UnknownRegistryError("already-exists"),
    );
    expect(duplicate).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      retryable: false,
      details: { reason: "already-exists" },
      remediation: {
        action: expect.stringContaining("do not repeat record_unknown"),
      },
    });
    expect(analysisErrorProjectionSchema.parse(duplicate)).toEqual(duplicate);
    expect(
      projectAnalysisError(new UnknownRegistryError("revision-conflict")),
    ).toMatchObject({ code: "revision_conflict", retryable: true });
  });

  it.each(["history_gap", "revision_chain"] as const)(
    "preserves %s as an integrity failure with producer facts",
    (kind) => {
      const constraint = { kind, unknown_id: `unk_${"0".repeat(64)}` };
      const projected = projectAnalysisError(
        new UnknownRegistryError(constraint, {
          cause: new Error("Unrelated private diagnostic"),
        }),
      );
      expect(projected).toMatchObject({
        code: "evidence_integrity_mismatch",
        retryable: false,
        details: { reason: "integrity", constraint },
      });
      expect(projected.message).toContain(constraint.unknown_id);
      expect(JSON.stringify(projected)).not.toContain(
        "Unrelated private diagnostic",
      );
      expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
    },
  );

  it("keeps retryability for transient conflicts and provider timeouts", () => {
    expect(
      projectAnalysisError(new UnknownRegistryError("revision-conflict")),
    ).toMatchObject({ code: "revision_conflict", retryable: true });
    expect(
      projectAnalysisError(
        new AnalysisTimeoutError("inspect_binary_layout", 2500),
      ),
    ).toMatchObject({ code: "provider_timeout", retryable: true });
  });

  it("names the input contract for malformed analysis arguments", () => {
    const projected = projectAnalysisError(
      new AnalysisInputError("inspect_analysis_view", undefined, [
        {
          path: ["view", "kind"],
          reason: "invalid_value",
          expected: ["summary", "module"],
        },
      ]),
    );

    expect(projected).toMatchObject({
      recovery: {
        kind: "inspect_input_contract",
        operation: "inspect_analysis_view",
      },
      remediation: {
        action:
          "Read the declared input schema or CLI usage for inspect_analysis_view; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.",
      },
    });
    expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
  });

  it("omits schema recovery when a conforming request lacks a target fact", () => {
    const issue = {
      path: ["address"],
      reason: "invalid_value",
      message: "Address 0x2000 is in uninitialized memory block .bss",
      observed: { address: "0x2000", file_mapping: "uninitialized" },
    } as const;
    const projected = projectAnalysisError(
      new AnalysisInputError(
        "address_to_file_offset",
        {
          userMessage: "No exact original-file offset exists.",
          remediationAction: "Select an address inside a file-backed mapping.",
          conformsToInputContract: true,
        },
        [issue],
      ),
    );

    expect(projected).toEqual({
      code: "invalid_request",
      category: "invalid_input",
      message: "No exact original-file offset exists.",
      retryable: false,
      remediation: {
        action: "Select an address inside a file-backed mapping.",
      },
      details: { operation: "address_to_file_offset", issues: [issue] },
    });
    expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
  });

  it("separates timeout-state inspection from client deadline recovery", () => {
    const projected = projectAnalysisError(
      new AnalysisTimeoutError("inspect_binary_layout", 2_500),
    );

    expect(projected).toMatchObject({
      code: "provider_timeout",
      recovery: {
        kind: "inspect_timeout_state",
        operation: "inspect_binary_layout",
        timeout_ms: 2_500,
      },
      message: expect.stringContaining("server/provider deadline"),
      remediation: {
        action: expect.stringContaining("provider diagnostics"),
      },
    });
    expect(projected.message).toContain("not a client-side timeout");
    expect(projected.remediation.action).not.toContain(
      "raise its tool deadline",
    );
    expect(projected.remediation.action).not.toMatch(
      /declared timeout controls|larger server\/provider budget|without assuming adjustable limits|do not assume adjustable/u,
    );
    expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
  });
});

describe("capability failure retry disposition", () => {
  it.each([
    { options: {}, retryable: false, category: "unsupported_provider" },
    {
      options: { retryable: false },
      retryable: false,
      category: "unsupported_provider",
    },
    { options: { retryable: true }, retryable: true, category: "unavailable" },
  ] as const)(
    "preserves the producer's $retryable disposition",
    ({ options, retryable, category }) => {
      const reason = "Native self-test failed with a sharing violation";
      const projected = projectAnalysisError(
        new AnalysisCapabilityUnavailableError(
          "fixture-provider",
          "inspect",
          reason,
          options,
        ),
      );
      expect(projected).toMatchObject({
        code: "capability_unavailable",
        category,
        retryable,
        details: { reason },
      });
      if (retryable) {
        expect(projected.message).toBe(
          "Required runtime controls are unavailable for this attempt.",
        );
        expect(projected.remediation.action).toContain(
          "retry the same analysis",
        );
      }
      expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
        true,
      );
    },
  );

  it("preserves a caller-selected message for a retryable failure", () => {
    expect(
      projectAnalysisError(
        new AnalysisCapabilityUnavailableError(
          "fixture-provider",
          "inspect",
          "temporary failure",
          {
            retryable: true,
            userMessage: "Selected runtime diagnostic",
          },
        ),
      ).message,
    ).toBe("Selected runtime diagnostic");
  });

  it("retains cleanup ownership before allowing a transient operation to retry", () => {
    expect(
      projectAnalysisError(
        new AnalysisCapabilityUnavailableError(
          "fixture-provider",
          "inspect",
          "temporary failure",
          {
            retryable: true,
            cleanup: {
              reason: "owned handle is still live",
              resources: ["native-owner"],
            },
          },
        ),
      ),
    ).toMatchObject({
      code: "cleanup_incomplete",
      retryable: false,
      details: {
        cleanup: "incomplete",
        resources: ["native-owner"],
        execution_failure: "capability_unavailable",
      },
    });
  });
});

it("projects a published file receipt alongside retained cleanup failure", () => {
  const projected = projectAnalysisError(
    new EvidenceFileError("write", "io", {
      path: "/tmp/evidence.json",
      published: { path: "/tmp/evidence.json", bytes: 42 },
      cleanup: {
        reason: "staging directory is still owned",
        resources: ["/tmp/.rea-write-abc"],
      },
      cause: new Error("cleanup incomplete"),
    }),
  );
  expect(projected).toMatchObject({
    code: "cleanup_incomplete",
    message:
      "The output file was published, but staging cleanup remains incomplete.",
    remediation: {
      action:
        "Use the published file at details.published_path and resolve the reported staging cleanup failure.",
    },
    details: {
      operation: "write",
      path: "/tmp/evidence.json",
      published: true,
      published_path: "/tmp/evidence.json",
      bytes: 42,
      resources: ["/tmp/.rea-write-abc"],
    },
  });
  expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(true);
});

const nativeCallPartialObservation = nativeCallPartialObservationSchema.parse({
  kind: "native-call-observation",
  target: {
    path: "/tmp/selected-app",
    sha256: "a".repeat(64),
    architecture: "arm64",
    arguments: [],
    environment: {},
    working_directory: null,
  },
  process: {
    pid: 4242,
    stdout: {
      text: "partial stdout",
      bytes: 13,
      truncated: false,
      complete: false,
    },
    stderr: null,
    other_stops: [],
  },
  debugger: { version: null },
  events: [],
  coverage: { status: "partial", reason: "cancelled" },
  limitations: ["Observation ended before the requested window completed."],
});

const retainedOutput = {
  stdout: "selected output\u0000",
  stderr: "upstream warning",
  truncated: true,
};

it("distinguishes unsupported target formats from unavailable provider capabilities", () => {
  const projected = projectAnalysisError(
    new AnalysisUnsupportedTargetError(
      "inspect_evm_interface",
      "/selected/runtime.hex",
      "EOF-style EF00 container is unsupported.",
      { capturedOutput: retainedOutput },
    ),
  );
  expect(projected).toMatchObject({
    code: "unsupported_target",
    category: "unsupported_target",
    retryable: false,
    details: {
      operation: "inspect_evm_interface",
      path: "/selected/runtime.hex",
      reason: "EOF-style EF00 container is unsupported.",
      captured_output: retainedOutput,
    },
  });
  expect(projected.message).toContain("EF00");
  expect(projected.remediation.action).toContain("target format");
  expect(projected.remediation.action).not.toContain("doctor");
  expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(true);
});

it("keeps a refusing provider's recovery on a target selection failure", () => {
  const selection = {
    reason: "target_unsupported" as const,
    requestedProviderId: "ghidra",
    candidateIds: ["ghidra"],
    userMessage: "Unsupported target: the configured extension is x86-64 only.",
  };
  expect(
    projectAnalysisError(
      new ProviderSelectionError({
        ...selection,
        remediationAction: "Omit the extension setting for this target.",
      }),
    ),
  ).toMatchObject({
    code: "capability_unavailable",
    message: selection.userMessage,
    remediation: { action: "Omit the extension setting for this target." },
    details: { selection_reason: "target_unsupported" },
  });
  expect(
    projectAnalysisError(new ProviderSelectionError(selection)).remediation
      .action,
  ).toBe(selection.userMessage);
});

it.each([false, true])(
  "marks occupied capacity retryable only while cleanup is confirmed: %s",
  (cleanupIncomplete) => {
    const projected = projectAnalysisError(
      new AnalysisResourceConstraintError(
        "inspect_sqlite_database",
        "capacity",
        "Inspection slots are occupied",
        { max_concurrent_inspections: 2 },
        cleanupIncomplete
          ? {
              cleanup: {
                reason: "Snapshot removal denied",
                resources: ["/private/snapshot"],
              },
            }
          : undefined,
      ),
    );
    expect(projected.retryable).toBe(!cleanupIncomplete);
    expect(projected.code).toBe(
      cleanupIncomplete ? "cleanup_incomplete" : "resource_constraint",
    );
    expect(projected.details).toMatchObject({
      resource: "capacity",
      reported_limits: { max_concurrent_inspections: 2 },
    });
    expect(projected.remediation.action).toContain("Wait");
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  },
);

it.each([
  ["memory", null],
  ["memory", { address_space_bytes: 67108864 }],
  ["cpu", null],
  ["cpu", { cpu_seconds: 1 }],
  ["file-size", null],
  ["file-size", { file_size_bytes: 1024 }],
  ["transport", { result_budget_bytes: 10485760 }],
] as const)(
  "projects reported %s constraints with observed or unknown limits: %j",
  (resource, limits) => {
    const projected = projectAnalysisError(
      new AnalysisResourceConstraintError(
        "inspect_binary_layout",
        resource,
        resource === "memory"
          ? "Memory allocation failed; exact cause unknown."
          : "Observed SIGXCPU; exact signal cause unknown.",
        limits,
        { capturedOutput: retainedOutput },
      ),
    );
    expect(projected).toMatchObject({
      code: "resource_constraint",
      category: "resource_constraint",
      retryable: false,
      details: {
        resource,
        reported_limits: limits,
        captured_output: retainedOutput,
      },
    });
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  },
);
it.each([
  new AnalysisInputError("inspect", { capturedOutput: retainedOutput }),
  new AnalysisOutputError("inspect", "invalid reply", {
    capturedOutput: retainedOutput,
  }),
  new AnalysisCapabilityUnavailableError(
    "provider",
    "inspect",
    "unsupported profile",
    { capturedOutput: retainedOutput },
  ),
  new AnalysisCancelledError("inspect", { capturedOutput: retainedOutput }),
  new AnalysisTimeoutError("inspect", 30, { capturedOutput: retainedOutput }),
  new ProviderSelectionError({
    operation: "inspect",
    reason: "provider_unavailable",
    requestedProviderId: "provider",
    candidateIds: [],
    capturedOutput: retainedOutput,
  }),
])(
  "retains captured output without changing the typed primary failure: $._tag",
  (failure) => {
    expect(projectAnalysisError(failure).details?.captured_output).toEqual(
      retainedOutput,
    );
  },
);

it.each([
  new AnalysisCancelledError("observe_native_calls", {
    cleanup: {
      reason: "target process termination could not be verified",
      resources: ["native-target:4242"],
    },
  }),
  new AnalysisTimeoutError("observe_native_calls", 65_000, {
    cleanup: {
      reason: "target process identity was unavailable",
      resources: ["native-target:4242"],
    },
  }),
])("retains incomplete cleanup for lifecycle failures: $._tag", (failure) => {
  expect(projectAnalysisError(failure)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      cleanup: "incomplete",
      cleanup_reason: expect.any(String),
      resources: ["native-target:4242"],
    },
  });
});

it("retains the original failure tag and code when cleanup is incomplete", () => {
  const error = new EvidenceIntegrityError(
    "The launched native target did not match its selected digest",
    {
      cleanup: {
        reason: "target survivor identity could not be verified",
        resources: ["native-target:4242"],
      },
    },
  );
  expect(error._tag).toBe("EvidenceIntegrityError");
  expect(projectAnalysisError(error)).toMatchObject({
    code: "cleanup_incomplete",
    category: "integrity_mismatch",
    details: {
      cleanup: "incomplete",
      cleanup_reason: "target survivor identity could not be verified",
      resources: ["native-target:4242"],
      execution_failure: "evidence_integrity_mismatch",
    },
  });
});

it("projects native partial observations through healthy cancellation failures", () => {
  const projected = projectAnalysisError(
    new AnalysisCancelledError("observe_native_calls", {
      partialObservation: nativeCallPartialObservation,
    }),
  );

  expect(projected).toMatchObject({
    code: "cancelled",
    details: {
      operation: "observe_native_calls",
      cleanup: "complete",
      partial_observation: nativeCallPartialObservation,
    },
  });
  expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(true);
});

it("retains native partial observations and cleanup uncertainty on provider failures", () => {
  const projected = projectAnalysisError(
    new ProviderAdapterError("native-lldb", "observe_native_calls", {
      partialObservation: nativeCallPartialObservation,
      cleanup: {
        reason: "target process termination could not be verified",
        resources: ["native-target:4242"],
      },
    }),
  );

  expect(projected).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      provider_id: "native-lldb",
      operation: "observe_native_calls",
      cleanup: "incomplete",
      cleanup_reason: "target process termination could not be verified",
      resources: ["native-target:4242"],
      execution_failure: "execution_failure",
      partial_observation: nativeCallPartialObservation,
    },
  });
  expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(true);
});

describe("analysis error projection: browser provider failures", () => {
  it("explains the service-worker policy refusal and names its recovery", () => {
    const projected = projectAnalysisError(
      new BrowserObservationError(
        "capture_browser_scenario",
        "service_worker_blocked",
      ),
    );

    expect(projected).toMatchObject({
      code: "target_unavailable",
      category: "unavailable",
      retryable: false,
      message: expect.stringContaining("service-worker policy is block"),
      remediation: {
        action: expect.stringContaining("environment.service_workers to allow"),
      },
      details: {
        operation: "capture_browser_scenario",
        reason: "service_worker_blocked",
      },
    });
  });

  it("projects the primary browser failure alongside incomplete cleanup", () => {
    const projected = projectAnalysisError(
      new BrowserObservationError(
        "observe_javascript_runtime",
        "cleanup_failed",
        {
          cause: new AggregateError([
            new BrowserObservationError(
              "observe_javascript_runtime",
              "target_changed",
            ),
            new Error("socket close failed"),
          ]),
        },
      ),
    );

    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      details: {
        operation: "observe_javascript_runtime",
        reason: "cleanup_failed",
        cleanup: "incomplete",
        resources: ["browser_transport"],
        primary_reason: "target_changed",
      },
    });
  });

  it("keeps producer facts when a browser failure is attributed to another operation", () => {
    const partial = { kind: "browser-test-partial" } as never;
    const original = new BrowserObservationError(
      "inspect_web_page",
      "cleanup_failed",
      {
        detail: "Target page-1 closed while REA released its session.",
        remediationAction: "Release session page-1, then retry.",
        cleanup: { reason: "socket close failed", resources: ["page-1"] },
        diagnostics: { endpoint: "loopback" },
        partialObservation: partial,
        cause: new AggregateError([
          new BrowserObservationError("inspect_web_page", "target_changed"),
          new Error("socket close failed"),
        ]),
      },
    );
    const relabelled = original.forOperation("capture_web_screenshot");

    expect(relabelled).toMatchObject({
      operation: "capture_web_screenshot",
      reason: "cleanup_failed",
      cause: original.cause,
      diagnostics: { endpoint: "loopback" },
      partialObservation: partial,
    });
    const { details, ...projected } = projectAnalysisError(relabelled);
    const { details: originalDetails, ...originalProjected } =
      projectAnalysisError(original);
    expect(projected).toEqual(originalProjected);
    expect(projected).toMatchObject({
      code: "cleanup_incomplete",
      message: "Target page-1 closed while REA released its session.",
      remediation: { action: "Release session page-1, then retry." },
    });
    expect(details).toEqual({
      ...originalDetails,
      operation: "capture_web_screenshot",
    });
    expect(details).toMatchObject({
      resources: ["page-1"],
      primary_reason: "target_changed",
    });
  });

  it("derives default browser guidance for the attributed operation", () => {
    const original = new BrowserObservationError(
      "inspect_web_page",
      "target_not_found",
    );
    expect(original.forOperation("inspect_web_page")).toBe(original);

    const relabelled = original.forOperation("discover_webmcp_tools");
    const projected = projectAnalysisError(relabelled);
    expect(projected).toMatchObject({
      code: "target_unavailable",
      message: expect.stringMatching(/^discover_webmcp_tools could not find/),
      details: {
        operation: "discover_webmcp_tools",
        reason: "target_not_found",
      },
    });
    expect(projected.message).not.toContain("inspect_web_page");
    expect(
      projectAnalysisError(
        new BrowserObservationError("inspect_web_page", "timeout").forOperation(
          "observe_web_session",
        ),
      ),
    ).toMatchObject({
      code: projectAnalysisError(
        new BrowserObservationError("observe_web_session", "timeout"),
      ).code,
      details: { operation: "observe_web_session", reason: "timeout" },
    });
  });
});

describe("analysis error projection: Hopper provider failures", () => {
  it("reports a timed-out active Hopper request and actionable retry guidance", () => {
    const projected = projectAnalysisError(
      new HopperTimeoutError(30_000, "trace_feature", 42, "busy"),
    );

    expect(projected).toMatchObject({
      code: "provider_timeout",
      category: "timeout",
      retryable: true,
      details: {
        stage: "analysis",
        operation: "trace_feature",
        request_id: 42,
        provider_state: "busy",
        timeout_ms: 30_000,
      },
    });
    expect(projected.message).toContain("binary_session.analysis_activity");
    expect(projected.remediation.action).toContain(
      "wait for the active Hopper request",
    );
  });

  it("identifies the REA session that already owns a Hopper target", () => {
    const error = new HopperStartError({
      ownerRunId: "session-owner",
      userMessage:
        "This Hopper target is already open in REA session session-owner. Use that REA session or close it before opening this target again.",
    });
    expect(projectAnalysisError(error)).toMatchObject({
      category: "unavailable",
      message: expect.stringContaining("session-owner"),
      remediation: {
        action: expect.stringContaining(
          "Use the active REA session session-owner",
        ),
      },
    });
  });

  it("retains the Hopper request and provider diagnostic on a remote failure", () => {
    expect(
      projectAnalysisError(
        new HopperRemoteError(
          7,
          "Hopper analysis failed in the selected document",
          {
            diagnosticType: "bridge_exception",
            operation: "trace_feature",
            requestId: 43,
          },
        ),
      ),
    ).toMatchObject({
      code: "execution_failure",
      details: {
        stage: "analysis",
        provider_code: 7,
        diagnostic_type: "bridge_exception",
        operation: "trace_feature",
        request_id: 43,
      },
      message: expect.stringContaining("Hopper analysis failed"),
    });
  });
});

describe("analysis error projection: detached provider diagnostics", () => {
  it.each(["adapter", "cancelled", "timeout"])(
    "preserves detached, actionable diagnostics for %s errors",
    (kind) => {
      const diagnostics = {
        runtime_root: "/tmp/rea-ghidra-fixture",
        profile_digest: "a".repeat(64),
        exit_code: 1,
      };
      const error =
        kind === "adapter"
          ? new ProviderAdapterError("ghidra", "health", { diagnostics })
          : kind === "cancelled"
            ? new AnalysisCancelledError("health", { diagnostics })
            : new AnalysisTimeoutError("health", 250, { diagnostics });

      expect(error.diagnostics).not.toBe(diagnostics);
      expect(projectAnalysisError(error)).toMatchObject({
        details: {
          ...(kind === "adapter" ? { provider_id: "ghidra" } : {}),
          operation: "health",
          diagnostics,
        },
      });
      diagnostics.exit_code = 2;
      expect(error.diagnostics?.exit_code).toBe(1);
    },
  );
});

describe("analysis error projection: Hopper startup failures", () => {
  it("maps the Linux startup compatibility exit codes without host internals", () => {
    const expected = [
      [70, "private_display_unavailable"],
      [71, "x11_authorization_failed"],
      [72, "unsupported_hopper_build"],
      [73, "invalid_launch_command"],
      [74, "process_ownership_mismatch"],
      [75, "hopper_exited_during_startup"],
      [76, "unsupported_demo_dialog"],
      [77, "unexpected_display_geometry"],
      [78, "x11_input_failed"],
      [79, "runtime_dependency_unavailable"],
      [80, "x11_socket_directory_unusable"],
      [81, "demo_dialog_absent"],
      [82, "invalid_dialog_timeout"],
    ] as const;

    for (const [exitCode, code] of expected) {
      const projected = projectAnalysisError(new HopperProcessError(exitCode));
      expect(projected).toMatchObject({
        code: "provider_unavailable",
        details: { failure_code: code, exit_code: exitCode },
      });
      expect(projected.details).not.toHaveProperty("launch_rejection");
      expect(projected.message).toMatch(/\S/u);
      expect(JSON.stringify(projected)).not.toContain("/proc/");
    }
  });

  it("does not attribute an absent post-authentication dialog to publisher verification", () => {
    const projected = projectAnalysisError(new HopperProcessError(81));
    expect(projected).toMatchObject({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        failure_code: "demo_dialog_absent",
        exit_code: 81,
      },
    });
    expect(projected.details).not.toHaveProperty("launch_rejection");
    expect(projected.message).toContain("REA_HOPPER_DEMO_DIALOG_TIMEOUT_MS");
  });

  it("reports a rejected demo dialog timeout through its setting fields", () => {
    const dialogTimeout = {
      setting: HOPPER_DEMO_DIALOG_TIMEOUT_SETTING,
      value: "-5",
      source: "setting",
      minimum_ms: MINIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
      maximum_ms: MAXIMUM_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
      default_ms: DEFAULT_HOPPER_DEMO_DIALOG_TIMEOUT_MS,
    } satisfies DialogTimeoutRejection;
    const projected = projectAnalysisError(
      new HopperProcessError(82, {
        diagnostic: {
          component: "hopper_private_display",
          operation: "launch",
          reason: "invalid_dialog_timeout",
          socket_directory: "/tmp/.X11-unix",
          socket_directory_mode: null,
          mount_read_only: null,
          effective_socket_directory_mode: null,
          effective_mount_read_only: null,
          wsl: false,
          strategy: "direct",
          fallback_reason: null,
          xvfb_stderr_bytes: 0,
          status: "error",
          failure_code: "invalid_dialog_timeout",
          dialog_timeout: dialogTimeout,
        } as HopperStartupFailureDiagnostic,
      }),
    );
    expect(projected).toMatchObject({
      code: "provider_unavailable",
      details: {
        stage: "launch",
        failure_code: "invalid_dialog_timeout",
        exit_code: 82,
        diagnostics: { dialog_timeout: dialogTimeout },
      },
    });
    expect(projected.details).not.toHaveProperty("launch_rejection");
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  });
});

describe("analysis error projection: retry guidance", () => {
  it.each([
    [
      "unreadable output",
      new AnalysisOutputError("inspect_firmware_regions", "report missing"),
      "unreadable_output",
    ],
    [
      "adapter failure",
      new ProviderAdapterError("firmware", "inspect_firmware_regions"),
      "execution_failure",
    ],
    [
      "Hopper remote failure",
      new HopperRemoteError(7, "Hopper analysis failed", {
        diagnosticType: "bridge_exception",
        operation: "trace_feature",
      }),
      "execution_failure",
    ],
  ])(
    "does not recommend an unchanged retry for non-retryable %s",
    (_name, error, code) => {
      const projected = projectAnalysisError(error);

      expect(projected).toMatchObject({ code, retryable: false });
      for (const text of [projected.message, projected.remediation.action])
        expect(text).not.toMatch(/\bretry\b/iu);
    },
  );
});

describe("analysis error projection: caller contract", () => {
  it("preserves the reported output constraint without exposing its internal cause", () => {
    const projected = projectAnalysisError(
      new AnalysisOutputError(
        "extract_firmware",
        "Report exceeded the declared byte budget",
        { cause: new Error("private internal cause") },
      ),
    );
    expect(projected).toMatchObject({
      code: "unreadable_output",
      details: {
        operation: "extract_firmware",
        reason: "Report exceeded the declared byte budget",
      },
    });
    expect(JSON.stringify(projected)).not.toContain("private internal cause");
  });
  it("maps representative failures without exposing causes", () => {
    const secretCause = new Error("secret-token");
    const projected = [
      projectAnalysisError(
        new AnalysisInputError("overview", { cause: secretCause }),
      ),
      projectAnalysisError(
        new AnalysisCapabilityUnavailableError("fixture", "overview", "absent"),
      ),
      projectAnalysisError(
        new BinaryTargetError("/local/targets/app", "invalid", {
          cause: secretCause,
        }),
      ),
    ];

    expect(projected.map(({ code }) => code)).toEqual([
      "invalid_request",
      "capability_unavailable",
      "target_unavailable",
    ]);
    expect(projected[1]).toMatchObject({
      category: "unsupported_provider",
      message:
        "This analysis is unavailable for the current target. Choose another analysis or target.",
      details: {
        provider_id: "fixture",
        operation: "overview",
        reason: "absent",
      },
    });
    expect(projected[2]).toMatchObject({
      details: { path: "/local/targets/app" },
    });
    expect(JSON.stringify(projected)).not.toContain("secret-token");
  });

  it.each(["EACCES", "EPERM"] as const)(
    "reports a target the host refused to read (%s) as access_denied",
    (systemCode) => {
      const denied = Object.assign(new Error("denied"), { code: systemCode });
      const reason = `permission denied while reading target: ${systemCode}`;
      expect(
        projectAnalysisError(
          new BinaryTargetError("/local/targets/app", reason, {
            cause: denied,
          }),
        ),
      ).toMatchObject({
        code: "access_denied",
        category: "unavailable",
        retryable: false,
        remediation: {
          action:
            "Check the current process's read access to the selected path. Retry with a readable local file.",
        },
        details: {
          path: "/local/targets/app",
          reason,
          system_code: systemCode,
          boundary: "filesystem-read",
        },
      });
      expect(
        projectAnalysisError(
          new BinaryTargetError("/local/targets/app", "missing", {
            cause: Object.assign(new Error("missing"), { code: "ENOENT" }),
          }),
        ),
      ).toMatchObject({ code: "target_unavailable" });
    },
  );

  it("uses explicit capability recovery while retaining the constraint", () => {
    const projected = projectAnalysisError(
      new AnalysisCapabilityUnavailableError(
        "fixture",
        "capture",
        "host constraint",
        {
          userMessage: "Use the supported host workflow.",
          cause: new Error("private internal cause"),
        },
      ),
    );
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      category: "unsupported_provider",
      message: "Use the supported host workflow.",
      details: {
        provider_id: "fixture",
        operation: "capture",
        reason: "host constraint",
      },
    });
    expect(JSON.stringify(projected)).not.toContain("private internal cause");
  });

  it("preserves exact artifact-integrity coordinates", () => {
    expect(
      projectAnalysisError(
        new ArtifactOperationError("inventory_artifact", "integrity", {
          logicalPath: "main.js",
          declaredSha256: "a".repeat(64),
          calculatedSha256: "b".repeat(64),
          unpacked: true,
        }),
      ),
    ).toMatchObject({
      category: "integrity_mismatch",
      details: {
        logical_path: "main.js",
        declared_sha256: "a".repeat(64),
        calculated_sha256: "b".repeat(64),
        unpacked: true,
      },
    });
  });

  it("gives missing residual unknowns lookup-specific remediation", () => {
    expect(
      projectAnalysisError(new UnknownRegistryError("not-found")),
    ).toMatchObject({
      code: "execution_failure",
      message:
        "The requested residual unknown does not exist in this session. Check the unknown_id and try again.",
      remediation: {
        action:
          "Check that the unknown_id belongs to this session, then retry.",
      },
      details: { reason: "not-found" },
    });
  });
});

describe("analysis error projection: operational diagnostics", () => {
  it("distinguishes an observed Hopper exit from an undetermined provider failure", () => {
    const exited = projectAnalysisError(
      new HopperProcessError(7, { operation: "search_strings", requestId: 4 }),
    );
    expect(exited).toMatchObject({
      code: "provider_unavailable",
      retryable: true,
      details: {
        stage: "analysis",
        provider_state: "exited",
        retry_action: "restart_provider",
        operation: "search_strings",
        request_id: 4,
        exit_code: 7,
      },
    });
    expect(exited.message).not.toContain("Run `rea doctor`, then try again.");
    expect(exited.remediation.action).toContain("Restart the owned provider");

    const unknown = projectAnalysisError(
      new HopperProcessError(null, {
        operation: "search_strings",
        requestId: 5,
      }),
    );
    expect(unknown.details).toMatchObject({
      stage: "analysis",
      provider_state: "unknown",
      retry_action: "unknown",
      operation: "search_strings",
      request_id: 5,
      exit_code: null,
    });
    expect(unknown.message).toContain("could not determine");
    expect(unknown.message).not.toContain("stopped");
    expect(unknown.remediation.action).toContain("provider_operation_health");

    const unreachable = projectAnalysisError(
      new HopperProcessError(null, {
        operation: "search_strings",
        providerState: "unreachable",
      }),
    );
    expect(unreachable.message).toContain(
      "If Hopper may have exited, call export_evidence_bundle before close_binary",
    );
    expect(unreachable.message).toContain("closing clears retained records");
    expect(unreachable.remediation.action).toContain("export_evidence_bundle");
  });
});

describe("analysis error projection: evidence files", () => {
  it.each([
    ["read", "missing", "invalid_request", "invalid_input"],
    ["read", "not-file", "invalid_request", "invalid_input"],
    ["write", "missing", "invalid_request", "invalid_input"],
    ["write", "exists", "invalid_request", "invalid_input"],
    ["write", "path-limit", "resource_constraint", "resource_constraint"],
    [
      "read",
      "invalid-json",
      "evidence_integrity_mismatch",
      "execution_failure",
    ],
    ["read", "io", "execution_failure", "execution_failure"],
  ] as const)(
    "classifies a %s %s evidence file by who can correct it",
    (operation, reason, code, category) => {
      const projected = projectAnalysisError(
        new EvidenceFileError(operation, reason, { path: "/selected.json" }),
      );
      expect(projected).toMatchObject({
        code,
        category,
        details: { operation, reason, path: "/selected.json" },
      });
      expect(analysisErrorProjectionSchema.parse(projected)).toEqual(projected);
    },
  );
});

it("retains the primary failure and both cleanup reports after a secondary failure", () => {
  const callerReason = { caller: "stop" };
  const primary = new AnalysisCancelledError("execute_rizin_command", {
    cause: callerReason,
    capturedOutput: {
      stdout: "partial",
      stderr: "diagnostic",
      truncated: false,
    },
    cleanup: { reason: "writer remains", resources: ["writer"] },
  });
  const secondary = new AnalysisOutputError("open_binary", "cannot rebind", {
    cleanup: { reason: "provider remains", resources: ["provider", "writer"] },
  });
  const enriched = primary.retainSecondaryFailure(secondary, {
    rebind_error: projectAnalysisError(secondary),
  });
  expect(enriched).toBe(primary);
  expect(enriched._tag).toBe("AnalysisCancelledError");
  expect(enriched.cause).toBe(callerReason);
  expect(enriched.secondaryFailures).toEqual([secondary]);
  expect(projectAnalysisError(enriched)).toMatchObject({
    code: "cleanup_incomplete",
    details: {
      execution_failure: "cancelled",
      resources: ["writer"],
      cleanup_reason: "writer remains",
      captured_output: { stdout: "partial", stderr: "diagnostic" },
      diagnostics: { rebind_error: { code: "cleanup_incomplete" } },
    },
  });
});

it("retains secondary failures when the primary error has no cause", () => {
  const primary = new AnalysisCancelledError("execute_rizin_command");
  const secondary = new AnalysisOutputError("open_binary", "cannot rebind");

  primary.retainSecondaryFailure(secondary, {});

  expect(primary.cause).toBeUndefined();
  expect(primary.secondaryFailures).toEqual([secondary]);
});

it.each([false, true])(
  "preserves producer capability recovery with retryable=%s",
  (retryable) => {
    const recovery =
      "Choose an explicit disposition, then retry the same session.";
    const projected = projectAnalysisError(
      new AnalysisCapabilityUnavailableError("fixture", "close", "live state", {
        retryable,
        remediationAction: recovery,
      }),
    );
    expect(projected).toMatchObject({
      code: "capability_unavailable",
      retryable,
      remediation: { action: recovery },
      details: {
        provider_id: "fixture",
        operation: "close",
        reason: "live state",
      },
    });
    expect(analysisErrorProjectionSchema.safeParse(projected).success).toBe(
      true,
    );
  },
);

it("retains Hopper startup diagnostics beside generic and secondary context", () => {
  const diagnostic = {
    component: "hopper_private_display",
    operation: "launch",
    reason: "fixture_denial",
    socket_directory: "/tmp/.X11-unix",
    socket_directory_mode: null,
    mount_read_only: null,
    effective_socket_directory_mode: null,
    effective_mount_read_only: null,
    wsl: false,
    strategy: "unavailable",
    fallback_reason: null,
    xvfb_stderr_bytes: 0,
    status: "error",
    failure_code: "private_display_unavailable",
  } as const;
  expect(
    projectAnalysisError(new HopperProcessError(null, { diagnostic })).details
      ?.diagnostics,
  ).toEqual(diagnostic);
  const generic = { caller_context: "retained" };
  expect(
    projectAnalysisError(
      new HopperProcessError(null, { diagnostic, diagnostics: generic }),
    ),
  ).toMatchObject({
    code: "provider_unavailable",
    details: { diagnostics: generic, provider_diagnostics: diagnostic },
  });
  const secondary = new HopperProcessError(null, {
    diagnostic,
  }).retainSecondaryFailure(new HopperProcessError(null), {
    retirement_error: "retained",
  });
  expect(projectAnalysisError(secondary).details).toMatchObject({
    provider_diagnostics: diagnostic,
    diagnostics: { retirement_error: "retained" },
  });
});

it("does not offer entry-policy retries for integrity refusals without a declared-versus-observed entry contradiction", () => {
  const native = projectAnalysisError(
    new ArtifactOperationError(
      "inspect_artifact",
      "integrity",
      undefined,
      "hdiutil verify failed: invalid checksum",
    ),
  );
  expect(native.category).toBe("integrity_mismatch");
  expect(native.details).toMatchObject({
    reason: "integrity",
    detail: "hdiutil verify failed: invalid checksum",
  });
  expect(native.message).not.toContain("record-and-continue");
  expect(native.remediation.action).not.toContain("record-and-continue");
});

it("preserves ordinary configuration recovery and projects a producer-owned session repair", () => {
  const settings = [{ setting: "REA_EXAMPLE", constraint: "must be positive" }];
  const original = projectAnalysisError(
    new ConfigurationError("Invalid setting", { settings }),
  );
  const repairing = projectAnalysisError(
    new ConfigurationError("Invalid setting", {
      settings,
      remediationAction: "Repair the running session, then retry.",
    }),
  );
  expect(original.remediation.action).toBe(
    "Correct REA_EXAMPLE in the environment that starts REA (your shell or the MCP client's registration), then rerun.",
  );
  expect(repairing).toEqual({
    ...original,
    remediation: { action: "Repair the running session, then retry." },
  });
  expect(repairing.code).toBe("configuration_invalid");
});
