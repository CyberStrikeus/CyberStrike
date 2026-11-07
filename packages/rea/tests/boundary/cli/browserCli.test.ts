import { afterEach, describe, expect } from "vitest";
import { z } from "zod";

import { cliTest, type TestCli } from "../../support/cli/cliFixture.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "../../../src/domain/browserScenarioCaptureLimits.js";
import { BROWSER_STORAGE_FINGERPRINT_VERSION } from "../../../src/domain/browserScenarioCaptureValues.js";
import { browserScenarioDiffSchema } from "../../../src/domain/browserScenarioDiffValues.js";
import {
  startFakeCdpBrowser,
  type FakeCdpBrowser,
  type FakeOptions,
} from "../../fixtures/fakeCdpBrowser.js";

const browsers: FakeCdpBrowser[] = [];
const INTEGRATION_TEST_TIMEOUT_MS = 60_000;

const partialScriptEvents: FakeOptions["commandEvents"] = (
  { method },
  origin,
) =>
  method === "Debugger.enable"
    ? [
        {
          method: "Debugger.scriptParsed",
          sessionId: "session-1",
          params: {
            scriptId: "partial-script",
            url: `${origin}/app.js`,
            executionContextId: 1,
          },
        },
      ]
    : undefined;

afterEach(async () => {
  await Promise.all(browsers.splice(0).map(async (browser) => browser.close()));
});

cliTest(
  "compares source-map declaration omissions through the public CLI",
  async ({ cli }) => {
    const cdn = "https://cdn.example.test";
    const browser = await startFakeCdpBrowser({
      commandEvents: ({ method }, origin) =>
        method === "Debugger.enable"
          ? [
              {
                method: "Debugger.scriptParsed",
                sessionId: "session-1",
                params: {
                  scriptId: "map-script",
                  url: `${origin}/app.js`,
                  hash: "a".repeat(64),
                  length: 10,
                  isModule: false,
                  scriptLanguage: "JavaScript",
                  sourceMapURL: `${cdn}/app.map`,
                },
              },
            ]
          : undefined,
    });
    browsers.push(browser);
    const inspect = async (broad: boolean) => {
      const result = await cli.run({
        arguments: [
          "inspect-web-page",
          browser.endpoint,
          "allowed-page",
          "--observation-ms",
          "0",
          "--allowed-origins",
          browser.allowedOrigin,
          ...(broad ? ["--allowed-origins", cdn] : []),
          "--json",
        ],
        environment: process.env,
      });
      expect(result.exitCode, result.stderr).toBe(0);
      return normalizedResult(result.json);
    };
    const known = await inspect(true);
    const omitted = await inspect(false);
    expect(known).toMatchObject({
      scripts: {
        items: [expect.objectContaining({ source_map_url: `${cdn}/app.map` })],
      },
    });
    expect(omitted).toMatchObject({
      scripts: { items: [expect.objectContaining({ source_map_url: null })] },
      completeness: {
        excluded: expect.arrayContaining([
          expect.objectContaining({
            section: "source_maps",
            reason: "disallowed_origin",
          }),
        ]),
      },
    });
    for (const [before, after] of [
      [known, omitted],
      [omitted, known],
      [omitted, omitted],
    ] as const) {
      const result = await cli.run({
        arguments: [
          "compare-web-captures",
          JSON.stringify({ inspection: before }),
          JSON.stringify({ inspection: after }),
          "--json",
        ],
      });
      expect(result.exitCode, result.stderr).toBe(0);
      expect(result.json).toMatchObject({
        normalized_result: {
          dimensions: { scripts: { status: "unknown", total_changes: 0 } },
        },
      });
    }
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

cliTest(
  "browser CLI parity returns the same Evidence discovery and inspection contracts",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser({
      sessionTimeline: "same_origin",
      webMcpTools: true,
      sensitiveShapes: true,
      commandEvents: partialScriptEvents,
      eventsBeforeReply: ["Network.enable"],
    });
    browsers.push(browser);
    const listedInvocation = await cli.run({
      arguments: ["list-browser-targets", browser.endpoint, "--json"],
      environment: process.env,
    });
    expect(listedInvocation.exitCode, listedInvocation.stderr).toBe(0);
    expect(listedInvocation.signal).toBeNull();
    const listed = listedInvocation.json;
    expect(listed).toMatchObject({
      operation: "list_browser_targets",
      provider: { id: "rea-cdp-browser" },
      normalized_result: {
        targets: expect.arrayContaining([
          expect.objectContaining({ target_id: "allowed-page" }),
          expect.objectContaining({ target_id: "disallowed-page" }),
        ]),
      },
    });
    const inspectedInvocation = await cli.run({
      arguments: [
        "inspect-web-page",
        browser.endpoint,
        "allowed-page",
        "--observation-ms",
        "0",
        "--include-console-text",
        "--include-json-body-shapes",
        "--include-websocket-shapes",
        "--json",
      ],
      environment: process.env,
    });
    expect(inspectedInvocation.exitCode, inspectedInvocation.stderr).toBe(0);
    expect(inspectedInvocation.signal).toBeNull();
    const inspected = inspectedInvocation.json;
    expect(inspected).toMatchObject({
      operation: "inspect_web_page",
      provider: { id: "rea-cdp-browser" },
      normalized_result: {
        target: { target_id: "allowed-page" },
        scripts: {
          items: [{ cdp_hash: null, length: null, is_module: null }],
        },
        network: {
          prior_activity_available: false,
          requests: [
            expect.objectContaining({
              body_shapes: expect.objectContaining({ status: "included" }),
            }),
          ],
        },
      },
    });
    const inspection = normalizedResult(inspected);
    const comparedInvocation = await cli.run({
      arguments: [
        "compare-web-captures",
        JSON.stringify({ inspection, scenario: { caller_metadata: true } }),
        JSON.stringify({ inspection }),
        "--json",
      ],
      environment: process.env,
    });
    expect(comparedInvocation.exitCode, comparedInvocation.stderr).toBe(0);
    expect(comparedInvocation.signal).toBeNull();
    const compared = comparedInvocation.json;
    expect(compared).toMatchObject({
      operation: "compare_web_captures",
      normalized_result: {
        overall_status: "unknown",
        dimensions: {
          network: { status: "unknown", total_changes: 0 },
        },
      },
    });
    await assertScenarioComparisonPolicy(cli);
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

cliTest(
  "compares redirect metadata uncertainty through the public CLI",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser();
    browsers.push(browser);
    const inspectedInvocation = await cli.run({
      arguments: [
        "inspect-web-page",
        browser.endpoint,
        "allowed-page",
        "--observation-ms",
        "0",
        "--json",
      ],
      environment: process.env,
    });
    expect(inspectedInvocation.exitCode, inspectedInvocation.stderr).toBe(0);
    expect(inspectedInvocation.signal).toBeNull();
    const inspected = inspectedInvocation.json;
    const inspection = normalizedResult(inspected);
    const missingVsKnownInvocation = await compareCapturesCli(
      cli,
      redirectCapture(inspection, browser.allowedOrigin, null),
      redirectCapture(inspection, browser.allowedOrigin, 302),
    );
    expect(
      missingVsKnownInvocation.exitCode,
      missingVsKnownInvocation.stderr,
    ).toBe(0);
    expect(missingVsKnownInvocation.signal).toBeNull();
    const missingVsKnown = missingVsKnownInvocation.json;
    expect(missingVsKnown).toMatchObject({
      normalized_result: {
        dimensions: {
          network: {
            status: "unknown",
            total_changes: 0,
            reason: expect.stringContaining("redirect"),
          },
        },
      },
    });
    const knownDifferenceInvocation = await compareCapturesCli(
      cli,
      redirectCapture(inspection, browser.allowedOrigin, 302),
      redirectCapture(inspection, browser.allowedOrigin, 307),
    );
    expect(
      knownDifferenceInvocation.exitCode,
      knownDifferenceInvocation.stderr,
    ).toBe(0);
    expect(knownDifferenceInvocation.signal).toBeNull();
    const knownDifference = knownDifferenceInvocation.json;
    expect(knownDifference).toMatchObject({
      normalized_result: {
        dimensions: { network: { status: "unknown", total_changes: 0 } },
      },
    });
    // A closed imported request inventory supplies the missing directional
    // proof; two attachment-limited samples cannot pair repeated requests.
    const closed = redirectCapture(inspection, browser.allowedOrigin, 302);
    if (!isRecord(closed.inspection.completeness))
      throw new Error("Missing capture completeness");
    const limited = closed.inspection.completeness.attach_limited_sections;
    if (!Array.isArray(limited)) throw new Error("Missing attachment coverage");
    closed.inspection.completeness.attach_limited_sections = limited.filter(
      (section) => section !== "network_requests",
    );
    const closedDifferenceInvocation = await compareCapturesCli(
      cli,
      closed,
      redirectCapture(inspection, browser.allowedOrigin, 307),
    );
    expect(
      closedDifferenceInvocation.exitCode,
      closedDifferenceInvocation.stderr,
    ).toBe(0);
    expect(closedDifferenceInvocation.signal).toBeNull();
    expect(closedDifferenceInvocation.json).toMatchObject({
      normalized_result: {
        dimensions: { network: { status: "changed", total_changes: 1 } },
      },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

cliTest(
  "browser CLI attaches through a browser socket and records it redacted",
  async ({ cli }) => {
    const browser = await startFakeCdpBrowser();
    browsers.push(browser);
    const inspectedInvocation = await cli.run({
      arguments: [
        "inspect-web-page",
        browser.browserWebSocketUrl,
        "allowed-page",
        "--observation-ms",
        "0",
        "--json",
      ],
      environment: process.env,
    });
    expect(inspectedInvocation.exitCode, inspectedInvocation.stderr).toBe(0);
    expect(inspectedInvocation.signal).toBeNull();
    const inspected = inspectedInvocation.json;
    expect(inspected).toMatchObject({
      operation: "inspect_web_page",
      parameters: {
        cdp_endpoint: browser.browserWebSocketUrl.replace(
          /fake$/u,
          "[REDACTED]",
        ),
      },
      normalized_result: { target: { target_id: "allowed-page" } },
    });
    expect(JSON.stringify(inspected)).not.toContain("/devtools/browser/fake");

    const refusedInvocation = await cli.run({
      arguments: [
        "list-browser-targets",
        browser.browserWebSocketUrl.replace(/fake$/u, "not-this-browser"),
        "--json",
      ],
      environment: process.env,
    });
    expect(refusedInvocation.exitCode, refusedInvocation.stderr).toBe(1);
    expect(refusedInvocation.signal).toBeNull();
    const refused = refusedInvocation.json;
    expect(refused).toMatchObject({
      code: "provider_unavailable",
      details: {
        operation: "list_browser_targets",
        reason: "endpoint_unreachable",
      },
    });
    expect(JSON.stringify(refused)).not.toContain("not-this-browser");
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

describe("scenario comparison CLI diagnostics", () => {
  const rule = {
    rule_id: "domain",
    artifacts: ["url"],
    match: "app.example.test",
    replacement: "normalized.test",
  };
  cliTest.for([
    {
      name: "duplicate rule IDs",
      normalization: { rules: [rule, rule] },
      issue: {
        path: ["normalization", "rules", 1, "rule_id"],
        reason: "invalid_value",
        message: "Normalization rule IDs must be unique",
      },
    },
    {
      name: "duplicate artifact kinds",
      normalization: { rules: [{ ...rule, artifacts: ["url", "url"] }] },
      issue: {
        path: ["normalization", "rules", 0, "artifacts"],
        reason: "invalid_value",
        message: "Normalization rule artifact kinds must be unique",
      },
    },
    {
      name: "structurally invalid rules",
      normalization: { rules: "invalid" },
      issue: {
        path: ["normalization", "rules"],
        reason: "invalid_type",
        expected: "array",
      },
    },
  ])(
    "retains scenario normalization diagnostics for $name",
    async ({ normalization, issue }, { cli }) => {
      const capture = JSON.stringify(completeScenarioCapture());
      const resultInvocation = await cli.run({
        arguments: [
          "compare-web-captures",
          capture,
          capture,
          "--normalization-json",
          JSON.stringify(normalization),
          "--json",
        ],
        environment: process.env,
      });
      expect(resultInvocation.exitCode, resultInvocation.stderr).toBe(1);
      expect(resultInvocation.signal).toBeNull();
      const result = resultInvocation.json;
      expect(result).toMatchObject({
        code: "invalid_request",
        details: { operation: "compare_web_captures", issues: [issue] },
      });
    },
  );

  cliTest(
    "keeps malformed scenario diagnostics in the selected capture group",
    async ({ cli }) => {
      const capture = completeScenarioCapture();
      const resultInvocation = await cli.run({
        arguments: [
          "compare-web-captures",
          JSON.stringify({ ...capture, duration_ms: "invalid" }),
          JSON.stringify(capture),
          "--json",
        ],
        environment: process.env,
      });
      expect(resultInvocation.exitCode, resultInvocation.stderr).toBe(1);
      expect(resultInvocation.signal).toBeNull();
      const result = resultInvocation.json;
      expect(result).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "compare_web_captures",
          issues: [
            {
              path: ["before_scenario", "duration_ms"],
              reason: "invalid_type",
              expected: "number",
            },
          ],
        },
      });
    },
  );

  cliTest.for(["omitted", "misspelled"])(
    "reports the missing scenario manifest when it is %s on both captures",
    async (kind, { cli }) => {
      const { scenario, ...capture } = completeScenarioCapture();
      const input = JSON.stringify(
        kind === "omitted" ? capture : { ...capture, scneario: scenario },
      );
      const resultInvocation = await cli.run({
        arguments: ["compare-web-captures", input, input, "--json"],
        environment: process.env,
      });
      expect(resultInvocation.exitCode, resultInvocation.stderr).toBe(1);
      expect(resultInvocation.signal).toBeNull();
      const result = resultInvocation.json;
      expect(result).toMatchObject({
        code: "invalid_request",
        details: {
          operation: "compare_web_captures",
          issues: expect.arrayContaining([
            {
              path: ["before_scenario", "scenario"],
              reason: "missing_argument",
              expected: "object",
            },
            {
              path: ["after_scenario", "scenario"],
              reason: "missing_argument",
              expected: "object",
            },
          ]),
        },
      });
      expect(JSON.stringify(result)).not.toContain('"inspection"');
    },
  );
});

describe("scenario comparison recovery guidance", () => {
  cliTest(
    "reports each distinct event coverage instruction once",
    async ({ cli }) => {
      const before = scenarioCaptureWithConsole("same", {
        request_body: false,
        response_body: false,
        header_values: false,
      });
      const after = {
        ...before,
        scenario: {
          ...before.scenario,
          event_families: [...before.scenario.event_families, "network"],
          network_content: {
            ...before.scenario.network_content,
            response_body: true,
          },
        },
      };
      const invocation = await compareCapturesCli(cli, before, after);
      expect(invocation.exitCode, invocation.stderr).toBe(0);
      const result = z
        .object({ normalized_result: browserScenarioDiffSchema })
        .parse(invocation.json).normalized_result;
      expect(result.overall_status).toBe("unknown");
      const diffs = result.steps.flatMap((step) =>
        step.artifact_diffs.filter((diff) => diff.artifact === "events"),
      );
      expect(diffs.length).toBeGreaterThan(0);
      for (const diff of diffs) {
        expect(
          diff.reason?.match(/Event family selections differ/gu),
        ).toHaveLength(1);
        expect(
          diff.reason?.match(/Network content selections differ/gu),
        ).toHaveLength(1);
      }
    },
  );

  cliTest(
    "reports independent network recovery alongside console differences",
    async ({ cli }) => {
      const base = completeScenarioCapture();
      const matchingSelection = scenarioCaptureWithConsole(
        "before",
        base.scenario.network_content,
      );
      const differentSelection = scenarioCaptureWithConsole("after", {
        ...base.scenario.network_content,
        response_body: true,
      });
      const changedInvocation = await compareCapturesCli(
        cli,
        matchingSelection,
        differentSelection,
      );
      expect(changedInvocation.exitCode, changedInvocation.stderr).toBe(0);
      expect(changedInvocation.signal).toBeNull();
      const changed = changedInvocation.json;
      expect(changed).toMatchObject({
        normalized_result: {
          overall_status: "changed",
          steps: expect.arrayContaining([
            expect.objectContaining({
              step_id: "open-settings",
              artifact_diffs: expect.arrayContaining([
                expect.objectContaining({
                  artifact: "events",
                  status: "changed",
                  reason: expect.stringContaining(
                    "Network content selections differ",
                  ),
                }),
              ]),
            }),
          ]),
        },
      });
      const quietMismatchInvocation = await compareCapturesCli(
        cli,
        matchingSelection,
        scenarioCaptureWithConsole(
          "before",
          differentSelection.scenario.network_content,
        ),
      );
      expect(
        quietMismatchInvocation.exitCode,
        quietMismatchInvocation.stderr,
      ).toBe(0);
      expect(quietMismatchInvocation.signal).toBeNull();
      const quietMismatch = quietMismatchInvocation.json;
      expect(quietMismatch).toMatchObject({
        normalized_result: {
          steps: expect.arrayContaining([
            expect.objectContaining({
              step_id: "open-settings",
              artifact_diffs: expect.arrayContaining([
                expect.objectContaining({
                  artifact: "events",
                  status: "unknown",
                  reason: expect.stringContaining(
                    "Network content selections differ",
                  ),
                }),
              ]),
            }),
          ]),
        },
      });
    },
  );
});

describe("browser CLI capture parity", () => {
  cliTest(
    "runs analysis, session, WebMCP, screenshot, and comparison from explicit request scope",
    async ({ cli }) => {
      const browser = await startFakeCdpBrowser({
        sessionTimeline: "same_origin",
        webMcpTools: true,
        sensitiveShapes: true,
      });
      browsers.push(browser);
      const scopeArgs = ["--allowed-origins", browser.allowedOrigin];
      const analyzedInvocation = await cli.run({
        arguments: [
          "analyze-web-bundle",
          browser.endpoint,
          "allowed-page",
          ...scopeArgs,
          "--observation-ms",
          "0",
          "--json",
        ],
        environment: process.env,
      });
      expect(analyzedInvocation.exitCode, analyzedInvocation.stderr).toBe(0);
      expect(analyzedInvocation.signal).toBeNull();
      const analyzed = analyzedInvocation.json;
      expect(analyzed).toMatchObject({
        operation: "analyze_web_bundle",
        normalized_result: {
          capture: { scripts_analyzed: 1 },
          observations: { source_maps: { status: "not_requested" } },
        },
      });
      const observedSessionInvocation = await cli.run({
        arguments: [
          "observe-web-session",
          browser.endpoint,
          "allowed-page",
          ...scopeArgs,
          "--observation-ms",
          "5",
          "--json",
        ],
        environment: process.env,
      });
      expect(
        observedSessionInvocation.exitCode,
        observedSessionInvocation.stderr,
      ).toBe(0);
      expect(observedSessionInvocation.signal).toBeNull();
      const observedSession = observedSessionInvocation.json;
      expect(observedSession).toMatchObject({
        operation: "observe_web_session",
        normalized_result: {
          window: { end_reason: "window_elapsed" },
          timeline: expect.arrayContaining([
            expect.objectContaining({ type: "same_origin_reload" }),
          ]),
        },
      });
      const webMcpInvocation = await cli.run({
        arguments: [
          "discover-webmcp-tools",
          browser.endpoint,
          "allowed-page",
          ...scopeArgs,
          "--observation-ms",
          "0",
          "--json",
        ],
        environment: process.env,
      });
      expect(webMcpInvocation.exitCode, webMcpInvocation.stderr).toBe(0);
      expect(webMcpInvocation.signal).toBeNull();
      const webMcp = webMcpInvocation.json;
      expect(webMcp).toMatchObject({
        operation: "discover_webmcp_tools",
        normalized_result: {
          tools: {
            items: [
              expect.objectContaining({
                name: "search_orders",
                annotations: expect.objectContaining({
                  consequential: true,
                }),
              }),
            ],
          },
        },
      });
      const screenshotInvocation = await cli.run({
        arguments: [
          "capture-web-screenshot",
          browser.endpoint,
          "allowed-page",
          ...scopeArgs,
          "--json",
        ],
        environment: process.env,
      });
      expect(screenshotInvocation.exitCode, screenshotInvocation.stderr).toBe(
        0,
      );
      expect(screenshotInvocation.signal).toBeNull();
      const screenshot = screenshotInvocation.json;
      const artifact = screenshotArtifact(screenshot);
      expect(artifact).toMatchObject({ media_type: "image/png", bytes: 70 });
      const visualInvocation = await cli.run({
        arguments: [
          "compare-web-screenshots",
          JSON.stringify(artifact),
          JSON.stringify(artifact),
          "--json",
        ],
        environment: process.env,
      });
      expect(visualInvocation.exitCode, visualInvocation.stderr).toBe(0);
      expect(visualInvocation.signal).toBeNull();
      const visual = visualInvocation.json;
      expect(visual).toMatchObject({
        operation: "compare_web_screenshots",
        normalized_result: { status: "identical", changed_pixels: 0 },
      });
    },
    INTEGRATION_TEST_TIMEOUT_MS,
  );
});

const screenshotArtifact = (value: unknown): Record<string, unknown> => {
  if (
    !isRecord(value) ||
    !isRecord(value.normalized_result) ||
    !isRecord(value.normalized_result.artifact)
  )
    throw new TypeError("Missing CLI screenshot artifact");
  return value.normalized_result.artifact;
};

const normalizedResult = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value) || !isRecord(value.normalized_result))
    throw new TypeError("Missing CLI normalized result");
  return value.normalized_result;
};

const redirectCapture = (
  inspection: Record<string, unknown>,
  origin: string,
  status: number | null,
) => {
  const copy = structuredClone(inspection);
  if (!isRecord(copy.network) || !Array.isArray(copy.network.requests))
    throw new Error("Missing network capture");
  const request = copy.network.requests[0];
  if (!isRecord(request)) throw new Error("Missing network request");
  request.redirects = [
    {
      url: `${origin}/prior`,
      response_url: `${origin}/prior`,
      method: "GET",
      resource_type: "Fetch",
      status,
      mime_type: "text/plain",
      encoded_data_length: 12,
      request_timestamp: 1,
      redirect_event_timestamp: 2,
    },
  ];
  return { inspection: copy };
};

const assertScenarioComparisonPolicy = async (cli: TestCli): Promise<void> => {
  const scenarioCapture = completeScenarioCapture();
  const scenarioComparedInvocation = await cli.run({
    arguments: [
      "compare-web-captures",
      JSON.stringify(scenarioCapture),
      JSON.stringify(scenarioCapture),
      "--normalization-json",
      '{"rules":[]}',
      "--json",
    ],
    environment: process.env,
  });
  expect(
    scenarioComparedInvocation.exitCode,
    scenarioComparedInvocation.stderr,
  ).toBe(0);
  expect(scenarioComparedInvocation.signal).toBeNull();
  const scenarioCompared = scenarioComparedInvocation.json;
  expect(scenarioCompared).toMatchObject({
    operation: "compare_web_captures",
    normalized_result: {
      comparison_kind: "browser_scenario",
      overall_status: "unchanged",
      alignment: { status: "aligned", aligned_steps: 2 },
    },
  });
  const intentionalPolicyInvocation = await cli.run({
    arguments: [
      "compare-web-captures",
      JSON.stringify(scenarioCapture),
      JSON.stringify(scenarioCapture),
      "--normalization-json",
      JSON.stringify({
        rules: [
          {
            rule_id: "domain",
            artifacts: ["url"],
            match: "app.example.test",
            replacement: "normalized.test",
          },
        ],
      }),
      "--json",
    ],
    environment: process.env,
  });
  expect(
    intentionalPolicyInvocation.exitCode,
    intentionalPolicyInvocation.stderr,
  ).toBe(0);
  expect(intentionalPolicyInvocation.signal).toBeNull();
  const intentionalPolicy = intentionalPolicyInvocation.json;
  expect(intentionalPolicy).toMatchObject({
    normalized_result: {
      normalization: { rules: [{ rule_id: "domain" }] },
    },
  });

  const malformedPolicyInvocation = await cli.run({
    arguments: [
      "compare-web-captures",
      JSON.stringify(scenarioCapture),
      JSON.stringify(scenarioCapture),
      "--normalization-json",
      "{invalid-policy",
      "--json",
    ],
    environment: process.env,
  });
  expect(
    malformedPolicyInvocation.exitCode,
    malformedPolicyInvocation.stderr,
  ).toBe(1);
  expect(malformedPolicyInvocation.signal).toBeNull();
  const malformedPolicy = malformedPolicyInvocation.json;
  expect(malformedPolicy).toMatchObject({
    error: "Browser observation failed",
    code: "invalid_request",
    details: {
      operation: "compare_web_captures",
      issues: [
        {
          path: ["normalization"],
          reason: "invalid_format",
          expected: "JSON",
        },
      ],
    },
  });
};

const compareCapturesCli = (cli: TestCli, before: unknown, after: unknown) =>
  cli.run({
    arguments: [
      "compare-web-captures",
      JSON.stringify(before),
      JSON.stringify(after),
      "--json",
    ],
    environment: process.env,
  });

const completeScenarioCapture = () => {
  const url = {
    url: "https://app.example.test/",
    origin: "https://app.example.test",
    query_parameter_names: [],
    redacted: false,
  };
  const completeness = {
    status: "complete",
    equality_eligible: true,
    missing_sections: [],
    truncated_sections: [],
  };
  const artifacts = {
    screenshot: { state: "not_requested" },
    dom: { state: "not_requested" },
    accessibility: { state: "not_requested" },
    url: { state: "captured", value: url },
    history: { state: "not_requested" },
    storage: { state: "not_requested" },
  };
  const step = (stepIndex: number, stepId: string, action: string) => ({
    step_index: stepIndex,
    step_id: stepId,
    action,
    status: "completed",
    elapsed_ms: stepIndex,
    before_url: url,
    after_url: url,
    error: null,
    event_sequence_start: 1,
    event_sequence_end: 0,
    artifacts,
    completeness,
  });
  return {
    browser: {
      mode: "connect",
      process_ownership: "external",
      cleanup: "disconnected-external",
      product: "Chromium",
      version: "149",
    },
    scenario: {
      start_origin: "https://app.example.test",
      action_count: 1,
      secret_references: [],
      network_content: {
        request_body: false,
        response_body: false,
        header_values: false,
      },
      event_families: [],
      limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    },
    duration_ms: 1,
    steps: [
      step(0, "scenario_start", "scenario_start"),
      step(1, "open-settings", "click"),
    ],
    events: {
      retained: 0,
      dropped: 0,
      items: [],
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
      },
    },
    completeness,
    limitations: [],
  };
};

cliTest(
  "compares reordered scenario storage through the public CLI and commits the rule",
  async ({ cli }) => {
    const capture = completeScenarioCapture();
    const entries = [
      { name: "theme", value_state: "hashed", value_sha256: "a".repeat(64) },
      { name: "locale", value_state: "hashed", value_sha256: "b".repeat(64) },
    ];
    const withStorage = (values: typeof entries) => ({
      ...capture,
      steps: capture.steps.map((step) => ({
        ...step,
        artifacts: {
          ...step.artifacts,
          storage: {
            state: "captured",
            value: {
              fingerprint_version: BROWSER_STORAGE_FINGERPRINT_VERSION,
              cookies: [],
              local_storage: values,
              session_storage: [],
            },
          },
        },
      })),
    });
    const comparedInvocation = await compareCapturesCli(
      cli,
      withStorage(entries),
      withStorage(entries.toReversed()),
    );
    expect(comparedInvocation.exitCode, comparedInvocation.stderr).toBe(0);
    expect(comparedInvocation.signal).toBeNull();
    const compared = comparedInvocation.json;
    expect(compared).toMatchObject({
      operation: "compare_web_captures",
      normalized_result: {
        comparison_kind: "browser_scenario",
        overall_status: "unchanged",
        normalization: {
          built_in_rules: expect.arrayContaining([
            "compare_storage_entries_as_unordered_collection",
          ]),
        },
      },
    });
    const changedInvocation = await compareCapturesCli(
      cli,
      withStorage(entries),
      withStorage(entries.slice(1)),
    );
    expect(changedInvocation.exitCode, changedInvocation.stderr).toBe(0);
    expect(changedInvocation.signal).toBeNull();
    const changed = changedInvocation.json;
    expect(changed).toMatchObject({
      normalized_result: { overall_status: "changed" },
    });
  },
  INTEGRATION_TEST_TIMEOUT_MS,
);

const scenarioCaptureWithConsole = (
  text: string,
  networkContent: {
    readonly request_body: boolean;
    readonly response_body: boolean;
    readonly header_values: boolean;
  },
) => {
  const capture = completeScenarioCapture();
  return {
    ...capture,
    scenario: {
      ...capture.scenario,
      network_content: networkContent,
      event_families: ["console"],
    },
    events: {
      retained: 1,
      dropped: 0,
      items: [
        {
          sequence: 1,
          step_index: 1,
          kind: "console",
          level: "info",
          text,
          url: null,
        },
      ],
      omissions: {
        by_kind: [],
        network_transactions: [],
        network_transaction_range: null,
      },
    },
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
