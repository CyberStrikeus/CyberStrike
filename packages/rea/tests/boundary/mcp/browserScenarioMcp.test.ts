import { describe, expect, test } from "vitest";
import { Ajv2020 } from "ajv/dist/2020.js";
import { z } from "zod";

import type { BrowserScenarioCapturePort } from "../../../src/application/BrowserScenarioCapturePort.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import type {
  ExecutionOptions,
  ProviderIdentity,
} from "../../../src/application/AnalysisProvider.js";
import { CdpBrowserProvider } from "../../../src/browser/CdpBrowserProvider.js";
import { sanitizeBrowserUrl } from "../../../src/domain/browserObservation.js";
import type { BrowserScenario } from "../../../src/domain/browserScenario.js";
import {
  browserScenarioCaptureSchema,
  type BrowserScenarioCapture,
} from "../../../src/domain/browserScenarioCapture.js";
import type { AnalysisError } from "../../../src/domain/analysisErrorBase.js";
import { AnalysisCancelledError } from "../../../src/domain/analysisErrorCore.js";
import { err, ok, type Result } from "../../../src/domain/result.js";
import { createApplicationMcpHarness } from "../../fixtures/applicationMcpHarness.js";
import { observed } from "../../fixtures/analysisExecution.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { advertisedInputJsonSchema } from "../../../src/contracts/toolSchemaMetadata.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";

const providerIdentity: ProviderIdentity = {
  id: "test-browser-scenario",
  name: "Test browser scenario provider",
  version: "1",
};

class FakeBrowserScenarioProvider implements BrowserScenarioCapturePort {
  readonly scenarios: BrowserScenario[] = [];

  identity(): ProviderIdentity {
    return providerIdentity;
  }

  captureScenario(
    scenario: BrowserScenario,
    _options?: ExecutionOptions,
  ): Promise<Result<BrowserScenarioCapture, AnalysisError>> {
    this.scenarios.push(scenario);
    return Promise.resolve(ok(captureFor(scenario)));
  }
}

const artifacts = {
  screenshot: { state: "not_requested" },
  dom: { state: "not_requested" },
  accessibility: { state: "not_requested" },
  url: { state: "not_requested" },
  history: { state: "not_requested" },
  storage: { state: "not_requested" },
} as const;

const captureFor = (scenario: BrowserScenario): BrowserScenarioCapture => {
  const start = scenario.start_url.url;
  const step = (stepIndex: number, stepId: string, action: string) => ({
    step_index: stepIndex,
    step_id: stepId,
    action,
    status: "completed",
    elapsed_ms: 1,
    before_url: sanitizeBrowserUrl(start),
    after_url: sanitizeBrowserUrl(start),
    error: null,
    event_sequence_start: 1,
    event_sequence_end: 0,
    artifacts,
    completeness: {
      status: "complete",
      equality_eligible: true,
      missing_sections: [],
      truncated_sections: [],
    },
  });
  return browserScenarioCaptureSchema.parse({
    browser: {
      mode: scenario.browser.mode,
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
      product: "Test Browser",
      version: "1",
    },
    scenario: {
      start_origin: new URL(start).origin,
      action_count: scenario.actions.length,
      secret_references: scenario.secrets.map(({ secret_id: id }) => id),
      network_content: scenario.capture.network,
      event_families: scenario.capture.events,
      limits: scenario.capture.limits,
    },
    duration_ms: 2,
    steps: [
      step(0, "scenario_start", "goto_start"),
      ...scenario.actions.map((action, index) =>
        step(index + 1, action.step_id, action.action),
      ),
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
    completeness: {
      status: "complete",
      equality_eligible: true,
      missing_sections: [],
      truncated_sections: [],
    },
    limitations: [],
  });
};

const minimalScenario = (origin = "https://app.example.test") => ({
  browser: {
    mode: "launch",
    executable_path: process.execPath,
  },
  start_url: { url: `${origin}/`, query: [] },
  actions: [
    {
      step_id: "settle",
      action: "wait_for_timeout",
      duration_ms: 1,
    },
  ],
});

const scenario = (origin = "https://app.example.test") => ({
  ...minimalScenario(origin),
  start_url: {
    url: `${origin}/?token=caller-selected`,
    query: [
      { name: "login", value: { source: "secret", secret_id: "login_input" } },
      { name: "mode", value: { source: "literal", value: "account" } },
    ],
  },
  storage: {
    local_storage: [
      {
        origin,
        entries: [
          {
            name: "session",
            value: { source: "secret", secret_id: "login_input" },
          },
          {
            name: "view",
            value: { source: "literal", value: "token=selected" },
          },
        ],
      },
    ],
  },
  actions: [
    {
      step_id: "login-input",
      action: "fill",
      locator: { kind: "test_id", value: "password" },
      value: { source: "secret", secret_id: "login_input" },
      timeout_ms: 1_234,
    },
  ],
  secrets: [
    {
      secret_id: "login_input",
      environment_variable: "REA_TEST_PASSWORD",
    },
  ],
});

test.each(["full", "compact"] as const)(
  "advertises portable browser action patterns (%s)",
  async (profile) => {
    const provider = new FakeBrowserScenarioProvider();
    const session = createTestBinarySession(() => {
      throw new Error("Schema discovery must not start a deep provider");
    });
    const { client } = await createApplicationMcpHarness({
      session,
      clientIdentity: { name: "browser-action-patterns", version: "1" },
      serverOptions: {
        browserScenarioCapture: provider,
        environment: { REA_MCP_INPUT_SCHEMA_PROFILE: profile },
      },
    });
    const tool = (await client.listTools()).tools.find(
      ({ name }) => name === "capture_browser_scenario",
    );
    if (tool === undefined) throw new Error("Missing browser scenario tool");
    const properties = z
      .record(z.string(), z.unknown())
      .parse(tool.inputSchema.properties);
    const pending = [{ value: properties.actions, where: "actions" }];
    const patterns: Array<{ where: string; pattern: string }> = [];
    while (pending.length > 0) {
      const selected = pending.pop();
      if (
        selected === undefined ||
        selected.value === null ||
        typeof selected.value !== "object"
      )
        continue;
      for (const [key, value] of Object.entries(selected.value)) {
        const where = `${selected.where}/${key}`;
        if (key === "pattern" && typeof value === "string")
          patterns.push({ where, pattern: value });
        pending.push({ value, where });
      }
    }
    if (profile === "full") {
      expect(
        patterns.some(({ where }) => where.endsWith("/path/pattern")),
      ).toBe(true);
      expect(
        patterns.some(
          ({ where }) =>
            where.includes("/headers/") && where.endsWith("/name/pattern"),
        ),
      ).toBe(true);
    }
    const failures = patterns.flatMap(({ where, pattern }) =>
      ["", "u", "v"].flatMap((flags) => {
        try {
          new RegExp(pattern, flags);
          return [];
        } catch (cause: unknown) {
          return [`${where} /${pattern}/${flags}: ${String(cause)}`];
        }
      }),
    );
    expect(failures).toEqual([]);
    expect(
      patterns.filter(({ pattern }) =>
        /\(\?<?[=!]|\\[1-9]|\\k</u.test(pattern),
      ),
    ).toEqual([]);
    expect(provider.scenarios).toEqual([]);
  },
);

describe("browser scenario MCP tool", () => {
  test("runs the explicit scenario request without a permission grant", async () => {
    const provider = new FakeBrowserScenarioProvider();
    const session = createTestBinarySession(() => ({
      execute: () => Promise.resolve(observed(null)),
      close: () => Promise.resolve(ok(null)),
    }));
    const { client } = await createApplicationMcpHarness({
      session,
      clientIdentity: { name: "browser-scenario-test", version: "1" },
      serverOptions: {
        browserObservation: new CdpBrowserProvider(),
        browserScenarioCapture: provider,
        availabilityPolicy: () => ({
          processCaptureEnabled: false,
          investigationInputRoots: 0,
        }),
      },
    });

    const minimal = await client.callTool({
      name: "capture_browser_scenario",
      arguments: minimalScenario(),
    });
    expect(minimal.isError, JSON.stringify(minimal)).not.toBe(true);
    expect(provider.scenarios[0]).toMatchObject({
      environment: { color_scheme: "light", service_workers: "block" },
      storage: { cookies: [], local_storage: [], session_storage: [] },
      capture: { after_each_step: [], at_end: ["url"], events: [] },
    });

    const captured = await client.callTool({
      name: "capture_browser_scenario",
      arguments: scenario(),
    });
    expect(captured.isError, JSON.stringify(captured)).not.toBe(true);
    expect(captured.structuredContent).toMatchObject({
      normalized_result: {
        scenario: {
          secret_references: ["login_input"],
        },
      },
    });
    expect(provider.scenarios).toHaveLength(2);
    expect(captured.structuredContent).toMatchObject({
      predicate_type: "rea.browser-scenario-capture",
      operation: "capture_browser_scenario",
      parameters: {
        ...provider.scenarios[1],
        scenario_sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      },
    });
    const captureResult = Reflect.get(
      captured.structuredContent ?? {},
      "normalized_result",
    );
    const comparisonInput = {
      before_scenario: captureResult,
      after_scenario: captureResult,
      normalization: { rules: [] },
    };
    const comparisonTool = (await client.listTools()).tools.find(
      ({ name }) => name === "compare_web_captures",
    );
    if (comparisonTool === undefined)
      throw new Error("Missing comparison tool");
    const validateComparison = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(comparisonTool.inputSchema);
    const validateFullComparison = new Ajv2020({
      strict: false,
      validateFormats: false,
    }).compile(advertisedInputJsonSchema(toolContract("compare_web_captures")));
    expect(
      validateComparison(comparisonInput),
      JSON.stringify(validateComparison.errors),
    ).toBe(true);
    for (const malformed of [
      { before_scenario: captureResult },
      { before_scenario: captureResult, after: captureResult },
      { ...comparisonInput, before: captureResult, after: captureResult },
    ]) {
      expect(validateFullComparison(malformed)).toBe(false);
      const rejected = await client.callTool({
        name: "compare_web_captures",
        arguments: malformed,
      });
      expect(parseMcpToolError(rejected)).toMatchObject({
        error: { code: "invalid_request", category: "invalid_input" },
      });
    }
    const compared = await client.callTool({
      name: "compare_web_captures",
      arguments: {
        before_scenario: captureResult,
        after_scenario: captureResult,
      },
    });
    expect(compared.isError, JSON.stringify(compared)).not.toBe(true);
    expect(compared.structuredContent).toMatchObject({
      normalized_result: {
        comparison_kind: "browser_scenario",
        overall_status: "unchanged",
        alignment: { status: "aligned", aligned_steps: 2 },
      },
    });

    const otherOrigin = await client.callTool({
      name: "capture_browser_scenario",
      arguments: scenario("https://other.example.test"),
    });
    expect(otherOrigin.isError, JSON.stringify(otherOrigin)).not.toBe(true);
    expect(provider.scenarios).toHaveLength(3);
  });
});

test("records a completed late-close cancellation as server Evidence", async () => {
  const provider: BrowserScenarioCapturePort = {
    identity: () => providerIdentity,
    captureScenario: async (request) => {
      const capture = captureFor(request);
      return err(
        new AnalysisCancelledError("capture_browser_scenario", {
          partialObservation: { kind: "browser-scenario-observation", capture },
        }),
      );
    },
  };
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(ok(null)),
  }));
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "scenario-late-close", version: "1" },
    serverOptions: {
      browserScenarioCapture: provider,
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  });
  const response = await client.callTool({
    name: "capture_browser_scenario",
    arguments: minimalScenario(),
  });
  const { error } = parseMcpToolError(response);
  const reference = z
    .object({
      partial_observation: z.object({
        kind: z.literal("retained-evidence"),
        evidence_id: z.string(),
      }),
    })
    .parse(error.details).partial_observation;
  const retained = session.evidenceById(reference.evidence_id);
  if (retained === undefined) throw new Error("Evidence was not retained");
  expect(retained.operation).toBe("capture_browser_scenario");
  expect(retained.normalized_result).toMatchObject({
    browser: { cleanup: "terminated-owned-process" },
  });
  expect(
    (retained.normalized_result as BrowserScenarioCapture).steps.map(
      ({ step_id, status }) => ({ step_id, status }),
    ),
  ).toEqual([
    { step_id: "scenario_start", status: "completed" },
    { step_id: "settle", status: "completed" },
  ]);
  await expect(client.ping()).resolves.toEqual({});
});

test("delivers a retained summary and pages its exact steps and events", async () => {
  const provider = new FakeBrowserScenarioProvider();
  const session = createTestBinarySession(() => ({
    execute: () => Promise.resolve(observed(null)),
    close: () => Promise.resolve(ok(null)),
  }));
  const { client } = await createApplicationMcpHarness({
    session,
    clientIdentity: { name: "scenario-summary", version: "1" },
    serverOptions: {
      browserScenarioCapture: provider,
      availabilityPolicy: () => ({
        processCaptureEnabled: false,
        investigationInputRoots: 0,
      }),
    },
  });
  const tools = (await client.listTools()).tools;
  const advertised = tools.find(
    ({ name }) => name === "capture_browser_scenario",
  );
  if (advertised?.outputSchema === undefined)
    throw new Error("Missing advertised scenario output schema");
  const ajv = new Ajv2020({ strict: false, validateFormats: false });
  const validateInput = ajv.compile(advertised.inputSchema);
  const validateOutput = ajv.compile(
    z.record(z.string(), z.unknown()).parse(advertised.outputSchema),
  );
  const request = { ...minimalScenario(), detail: "summary" };
  expect(validateInput(request), JSON.stringify(validateInput.errors)).toBe(
    true,
  );

  const response = await client.callTool({
    name: "capture_browser_scenario",
    arguments: request,
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  expect(
    validateOutput(response.structuredContent),
    JSON.stringify(validateOutput.errors),
  ).toBe(true);
  const summary = z
    .object({
      normalized_result: z.object({
        kind: z.literal("summary"),
        parent_evidence_id: z.string(),
        summary: z.object({
          steps: z.array(z.object({ step_id: z.string() })),
        }),
      }),
    })
    .parse(response.structuredContent).normalized_result;
  expect(summary.summary.steps.map(({ step_id }) => step_id)).toEqual([
    "scenario_start",
    "settle",
  ]);
  // Delivery detail is neither sent to the provider nor recorded as a scenario parameter.
  expect(provider.scenarios[0]).not.toHaveProperty("detail");
  const parent = session.evidenceById(summary.parent_evidence_id);
  expect(parent?.operation).toBe("capture_browser_scenario");
  expect(parent?.parameters).not.toHaveProperty("detail");

  const page = await client.callTool({
    name: "inspect_analysis_view",
    arguments: {
      source: {
        kind: "retained-evidence",
        evidence_id: summary.parent_evidence_id,
      },
      view: {
        kind: "browser-scenario",
        collection: "steps",
        step_indices: [1],
      },
    },
  });
  expect(page.isError, JSON.stringify(page)).not.toBe(true);
  expect(page.structuredContent).toMatchObject({
    normalized_result: {
      kind: "browser-scenario",
      parent_evidence_id: summary.parent_evidence_id,
      items: {
        collection: "steps",
        rows: [{ step_index: 1, step_id: "settle", artifacts: {} }],
      },
      coverage: { total: 1, exhausted: true },
    },
  });

  const invalid = await client.callTool({
    name: "capture_browser_scenario",
    arguments: { ...minimalScenario(), detail: "brief" },
  });
  expect(parseMcpToolError(invalid)).toMatchObject({
    error: { code: "invalid_request" },
  });
  expect(provider.scenarios).toHaveLength(1);
});
