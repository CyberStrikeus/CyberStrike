import { expect, it } from "vitest";
import type { BrowserObservationPort } from "./BrowserObservationPort.js";
import {
  listBrowserTargets,
  inspectWebPage,
  analyzeWebBundle,
} from "./BrowserObservationService.js";
import type { BrowserTargetList } from "../domain/browserObservationSchemas.js";
import { parseEvidence } from "../domain/evidence.js";
import {
  AnalysisCancelledError,
  AnalysisOutputError,
} from "../domain/analysisErrorCore.js";
import { resolvedAnalysisError } from "../domain/analysisErrorBase.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import {
  expectDroppedPartial,
  expectKeptPartial,
  expectOutputError,
  expectOwnerError,
} from "./ownerObservationExpectation.fixture.js";
import { BrowserObservationError } from "../domain/browserObservationError.js";
import { err, ok } from "../domain/result.js";
import { passiveNetworkCapture } from "../../tests/fixtures/passiveNetworkCapture.js";
import { analyzeWebBundleFixture } from "../../tests/support/browser/analyzeWebBundleFixture.js";
import { analyzeWebBundleInputSchema } from "../domain/webBundleAnalysis.js";
import { inspectWebPageInputSchema } from "../domain/browserObservation.js";

const input = {
  cdp_endpoint: {
    transport: "http_discovery" as const,
    url: "http://127.0.0.1:9222",
    recorded: "http://127.0.0.1:9222",
  },
  allowed_origins: [],
};

const report: BrowserTargetList = {
  browser: {
    product: "Chrome",
    protocol_version: "1.3",
    revision: "1",
    user_agent: "Chrome fixture",
    js_version: "V8 fixture",
  },
  targets: [],
  excluded: { disallowed_origin: 0, unsupported_url: 0, non_page: 0 },
  limitations: [],
};

const provider = (
  listTargets: BrowserObservationPort["listTargets"],
): BrowserObservationPort =>
  ({
    identity: () => ({ id: "browser-fixture", name: "Fixture", version: "1" }),
    listTargets,
  }) as unknown as BrowserObservationPort;

it("keeps live browser inventory Evidence observed with external-service authority", async () => {
  const result = await listBrowserTargets(
    provider(async () => ok(report)),
    input,
  );
  expect(result).toMatchObject({
    ok: true,
    value: { confidence: "observed", authority: "external-service" },
  });
  if (result.ok)
    expect(result.value.parameters).not.toHaveProperty(
      "comparison_input_sha256",
    );
});

it("retains completed browser inventory Evidence when the provider completes after abort", async () => {
  const controller = new AbortController();
  const result = await listBrowserTargets(
    provider(async () => {
      controller.abort();
      return ok(report);
    }),
    input,
    { signal: controller.signal },
  );
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error._tag).toBe("AnalysisCancelledError");
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "list_browser_targets",
      normalized_result: report,
    });
  }
});

it("does not let late cancellation hide invalid completed browser output", async () => {
  const malformed = {
    ...report,
    limitations: [() => undefined],
  } as unknown as BrowserTargetList;
  const output = await listBrowserTargets(
    provider(async () => ok(malformed)),
    input,
  );
  expectOutputError(output);

  const controller = new AbortController();
  const late = await listBrowserTargets(
    provider(async () => {
      controller.abort();
      return ok(malformed);
    }),
    input,
    { signal: controller.signal },
  );
  expectOutputError(late);
});

it("converts a raw page inspection retained after browser cleanup failure", async () => {
  const inspection = passiveNetworkCapture();
  const failure = new BrowserObservationError(
    "inspect_web_page",
    "cleanup_failed",
    {
      cleanup: {
        reason: "target detach failed",
        resources: ["browser target"],
      },
      partialObservation: inspection,
    },
  );
  const browser: BrowserObservationPort = {
    identity: () => ({ id: "browser-fixture", name: "Fixture", version: "1" }),
    listTargets: async () => ok(report),
    inspectPage: async () => ({ ok: false, error: failure }),
  } as unknown as BrowserObservationPort;
  const pageInput = inspectWebPageInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    allowed_origins: [],
    target_id: "page",
    observation_ms: 0,
    include_script_sources: false,
  });
  const result = await inspectWebPage(browser, pageInput);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(result.error.cleanupIncomplete).toBe(true);
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_web_page",
      normalized_result: inspection,
    });
  }
});

it.each([true, false])(
  "promotes cleanup primary facts once when wrapper retains them: %s",
  async (wrapperRetainsFacts) => {
    const inspection = passiveNetworkCapture();
    const primary = new AnalysisCancelledError("inspect_web_page", {
      partialObservation: inspection,
    });
    const failure = new BrowserObservationError(
      "inspect_web_page",
      "cleanup_failed",
      {
        cleanupPrimary: primary,
        cleanup: {
          reason: "target detach failed",
          resources: ["browser target"],
        },
        ...(wrapperRetainsFacts ? { partialObservation: inspection } : {}),
      },
    );
    const browser = {
      ...provider(async () => ok(report)),
      inspectPage: async () => err(failure),
    } as unknown as BrowserObservationPort;
    const result = await inspectWebPage(browser, pageInput());
    expect(result.ok).toBe(false);
    expect(parseEvidence(primary.partialObservation)).toMatchObject({
      operation: "inspect_web_page",
      normalized_result: inspection,
    });
    if (wrapperRetainsFacts)
      expect(failure.partialObservation).toBe(primary.partialObservation);
    failure.resolveCleanup();
    expect(resolvedAnalysisError(failure)).toBe(primary);
    expect(
      parseEvidence(
        projectAnalysisError(resolvedAnalysisError(failure)).details?.[
          "partial_observation"
        ],
      ),
    ).toEqual(primary.partialObservation);
  },
);

it("retains captured page Evidence when bundle analysis fails after capture", async () => {
  const inspection = passiveNetworkCapture();
  const failure = new BrowserObservationError(
    "analyze_web_bundle",
    "cancelled",
    { partialObservation: inspection },
  );
  const browser: BrowserObservationPort = {
    ...provider(async () => ok(report)),
    analyzeBundle: async () => ({ ok: false as const, error: failure }),
  } as unknown as BrowserObservationPort;
  const bundleInput = analyzeWebBundleInputSchema.parse({
    ...input,
    cdp_endpoint: input.cdp_endpoint.recorded,
    target_id: "page",
    observation_ms: 0,
    include_script_sources: true,
  });
  const result = await analyzeWebBundle(browser, bundleInput);
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error).toBe(failure);
    expect(failure.operation).toBe("analyze_web_bundle");
    expect(parseEvidence(result.error.partialObservation)).toMatchObject({
      operation: "inspect_web_page",
      normalized_result: inspection,
    });
  }
});

it("projects completed source-map acquisition without claiming bundle analysis", async () => {
  const inspection = passiveNetworkCapture();
  const partial = {
    kind: "web-bundle-acquisition" as const,
    inspection,
    source_maps: {
      status: "unavailable" as const,
      requested: 1,
      processed: 0,
      items: [],
      limitation: "One requested source map was not processed.",
    },
    analysis_status: "not_performed" as const,
  };
  const reason = { requested: "stop after capture" };
  const failure = new AnalysisCancelledError("analyze_web_bundle", {
    cause: reason,
    partialObservation: partial,
  });
  const browser: BrowserObservationPort = {
    ...provider(async () => ok(report)),
    analyzeBundle: async () => err(failure),
  };
  const selected = analyzeWebBundleInputSchema.parse({
    ...input,
    cdp_endpoint: input.cdp_endpoint.recorded,
    target_id: "page",
    fetch_source_maps: true,
  });
  const result = await analyzeWebBundle(browser, selected);
  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.error).toBe(failure);
  expect(result.error.cause).toBe(reason);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "analyze_web_bundle",
    parameters: expect.objectContaining({ fetch_source_maps: true }),
    normalized_result: partial,
  });
});

it("retains completed bundle facts as bundle Evidence after cancellation", async () => {
  const { AnalysisCancelledError } =
    await import("../domain/analysisErrorCore.js");
  const bundle = analyzeWebBundleFixture(passiveNetworkCapture());
  const reason = { requested: "stop after completed script" };
  const failure = new AnalysisCancelledError("analyze_web_bundle", {
    cause: reason,
    partialObservation: bundle,
  });
  const browser: BrowserObservationPort = {
    ...provider(async () => ok(report)),
    analyzeBundle: async () => ({ ok: false as const, error: failure }),
  };
  const selected = analyzeWebBundleInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    target_id: "page",
    max_heap_mb: 256,
    analysis_timeout_ms: 100,
    total_analysis_timeout_ms: 1000,
  });
  const result = await analyzeWebBundle(browser, selected);
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancellation");
  expect(result.error).toBe(failure);
  expect(result.error.cause).toBe(reason);
  expect(parseEvidence(result.error.partialObservation)).toMatchObject({
    operation: "analyze_web_bundle",
    parameters: expect.objectContaining({
      max_heap_mb: 256,
      analysis_timeout_ms: 100,
      total_analysis_timeout_ms: 1000,
    }),
    normalized_result: bundle,
  });
});

it("preserves a prior caller reason without admitting browser work", async () => {
  const reason = new AnalysisOutputError(
    "inspect_web_page",
    "caller supplied reason",
  );
  const result = await listBrowserTargets(
    provider(async () => {
      throw new Error("Cancelled inventory must not start");
    }),
    input,
    { signal: AbortSignal.abort(reason) },
  );
  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("Expected cancelled inventory");
  expect(result.error._tag).toBe("AnalysisCancelledError");
  expect(result.error.cause).toBe(reason);
});

it("keeps page cancellation when the retained inspection is incomplete", async () => {
  const reason = { requested: "stop during page inspection" };
  const partial = {
    target: { target_id: "page" },
    network: {},
    capture_window: {},
  };
  const failure = new AnalysisCancelledError("inspect_web_page", {
    cause: reason,
    partialObservation: partial as never,
  });
  const browser = {
    ...provider(async () => ok(report)),
    inspectPage: async () => err(failure),
  } as unknown as BrowserObservationPort;
  const pageInput = inspectWebPageInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    allowed_origins: [],
    target_id: "page",
    observation_ms: 0,
    include_script_sources: false,
  });
  const result = await inspectWebPage(browser, pageInput);
  expectKeptPartial(expectOwnerError(result, failure, reason), partial);
});

it("keeps bundle cancellation and an earlier failure when retained facts are incomplete", async () => {
  const reason = { requested: "stop during bundle analysis" };
  const partial = { observations: [], capture: { status: "partial" } };
  const cancelled = new AnalysisCancelledError("analyze_web_bundle", {
    cause: reason,
    partialObservation: partial as never,
  });
  const timedOut = new BrowserObservationError(
    "analyze_web_bundle",
    "timeout",
    { partialObservation: partial as never },
  );
  const selected = analyzeWebBundleInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    target_id: "page",
    observation_ms: 0,
  });
  for (const failure of [cancelled, timedOut]) {
    const browser = {
      ...provider(async () => ok(report)),
      analyzeBundle: async () => err(failure),
    } as unknown as BrowserObservationPort;
    const result = await analyzeWebBundle(browser, selected);
    expectKeptPartial(
      expectOwnerError(result, failure, failure.cause),
      partial,
      failure === timedOut ? "provider_timeout" : "cancelled",
    );
  }
  expect(projectAnalysisError(cancelled).code).toBe("cancelled");
});

const pageInput = () =>
  inspectWebPageInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    allowed_origins: [],
    target_id: "page",
    observation_ms: 0,
    include_script_sources: false,
  });

const bundleInput = () =>
  analyzeWebBundleInputSchema.parse({
    cdp_endpoint: input.cdp_endpoint.recorded,
    target_id: "page",
    observation_ms: 0,
  });

const browserReturning = (
  failure: BrowserObservationError | AnalysisCancelledError,
) =>
  ({
    ...provider(async () => ok(report)),
    inspectPage: async () => err(failure),
    analyzeBundle: async () => err(failure),
  }) as unknown as BrowserObservationPort;

it.each([
  {
    name: "bundle bytes",
    operation: "analyze_web_bundle" as const,
    partial: { observations: [], capture: { bytes: Number.NaN } },
  },
  {
    name: "bundle observations",
    operation: "analyze_web_bundle" as const,
    partial: { observations: [undefined], capture: {} },
  },
  {
    name: "page requests",
    operation: "inspect_web_page" as const,
    partial: {
      target: { target_id: "page" },
      network: { requests: Number.NaN },
      capture_window: {},
    },
  },
])(
  "drops a non-JSON $name partial and keeps cancellation primary",
  async ({ operation, partial }) => {
    const reason = { requested: `stop ${operation}` };
    const failure = new AnalysisCancelledError(operation, {
      cause: reason,
      partialObservation: partial as never,
    });
    const result =
      operation === "inspect_web_page"
        ? await inspectWebPage(browserReturning(failure), pageInput())
        : await analyzeWebBundle(browserReturning(failure), bundleInput());
    const error = expectOwnerError(result, failure, reason);
    expectDroppedPartial(
      error,
      "Browser provider retained a non-JSON incomplete observation.",
    );
    expect(projectAnalysisError(error).details).not.toHaveProperty(
      "partial_observation",
    );
  },
);

it.each([
  {
    name: "schema-shaped page",
    partial: {
      target: { target_id: "page" },
      network: { requests: Number.NaN },
      capture_window: {},
    },
  },
  {
    name: "shapeless page",
    partial: { requests: Number.NaN },
  },
])(
  "drops a non-JSON $name partial and keeps timeout primary",
  async ({ partial }) => {
    const failure = new BrowserObservationError("inspect_web_page", "timeout", {
      partialObservation: partial as never,
    });
    const error = expectOwnerError(
      await inspectWebPage(browserReturning(failure), pageInput()),
      failure,
      undefined,
    );
    expectDroppedPartial(
      error,
      "Browser provider retained a non-JSON incomplete observation.",
      "provider_timeout",
    );
    expect(projectAnalysisError(error).category).toBe("timeout");
  },
);
