import { analysisViewRequestSchema } from "../../src/domain/analysisView/analysisView.js";
import { createHash } from "node:crypto";

import { inspectAnalysisViewValidated } from "../../src/application/analysisView/AnalysisViewService.js";
import { createBrowserScenarioEvidence } from "../../src/application/BrowserScenarioEvidence.js";
import { sanitizeBrowserUrl } from "../../src/domain/browserObservation.js";
import { browserScenarioSchema } from "../../src/domain/browserScenario.js";
import {
  browserScenarioCaptureSchema,
  type BrowserScenarioCapture,
} from "../../src/domain/browserScenarioCapture.js";
import { DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS } from "../../src/domain/browserScenarioCaptureLimits.js";
import type { Evidence } from "../../src/domain/evidence.js";
import {
  ALL_TEMPLATE_RULES,
  type EnvironmentServeFixture,
} from "./environmentServe.js";

/** One recorded transaction; omit `status` for a request that never got a response. */
export interface ScenarioExchange {
  readonly method: string;
  readonly url: string;
  readonly resourceType?: string;
  readonly redactedUrl?: boolean;
  readonly status?: number;
  readonly mediaType?: string | null;
  readonly body?: string | Buffer;
  readonly requestMediaType?: string;
  readonly requestBody?: string;
  /** A request body Playwright did not expose. */
  readonly requestBodyHidden?: true;
  /** The request event's header names. */
  readonly requestHeaderNames?: readonly string[];
  /** Header values as `header_values` retains them; a null value is one the capture excluded. */
  readonly requestHeaders?: readonly ScenarioHeader[];
  readonly responseHeaders?: readonly ScenarioHeader[];
}

export interface ScenarioHeader {
  readonly name: string;
  readonly value: string | null;
}

const retainedHeaders = (headers: readonly ScenarioHeader[] | undefined) =>
  headers === undefined
    ? { state: "not_requested" as const }
    : {
        state: "captured" as const,
        items: headers.map(({ name, value }) => ({
          name,
          value,
          redacted: value === null,
        })),
      };

export const SCENARIO_ORIGIN = "http://127.0.0.1:3101";

/** A small app session: a page load, JSON reads, a search, a JSON write, a redacted URL, binary bytes and a failure. */
export const SCENARIO_EXCHANGES: readonly ScenarioExchange[] = [
  {
    method: "GET",
    url: "/",
    resourceType: "document",
    status: 200,
    mediaType: "text/html",
    body: "<!doctype html><title>Rota</title>",
  },
  {
    method: "GET",
    url: "/api/users/2",
    status: 200,
    mediaType: "application/json",
    body: '{"id":2,"login":"probe"}',
  },
  {
    method: "GET",
    url: "/api/users/3",
    status: 200,
    mediaType: "application/json",
    body: '{"id":3,"login":"viewer"}',
  },
  {
    method: "GET",
    url: "/api/search?query=lighthouse",
    status: 200,
    mediaType: "application/json",
    body: '[{"title":"Lighthouse Rota"}]',
  },
  {
    method: "POST",
    url: "/api/folders",
    status: 200,
    mediaType: "application/json",
    body: '{"uid":"f1","title":"Lighthouse Rota"}',
    requestMediaType: "application/json",
    requestBody: '{"title":"Lighthouse Rota"}',
  },
  {
    method: "GET",
    url: "/api/sessions/[REDACTED:session]",
    redactedUrl: true,
    status: 200,
    mediaType: "application/json",
    body: "{}",
  },
  {
    method: "GET",
    url: "/api/blobs/1",
    status: 200,
    mediaType: "application/json",
    body: Buffer.from([0xff, 0xfe, 0x00, 0x41]),
  },
  { method: "GET", url: "/api/slow" },
];

const capturedBody = (
  content: string | Buffer,
  representation:
    | "browser-exposed-request-bytes"
    | "playwright-response-body-bytes",
  mediaType: string | null,
) => {
  const bytes =
    typeof content === "string" ? Buffer.from(content, "utf8") : content;
  return {
    state: "captured" as const,
    representation,
    encoding: "base64" as const,
    content: bytes.toString("base64"),
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    media_type: mediaType,
    redacted: false,
  };
};

const exchangeEvents = (
  exchange: ScenarioExchange,
  index: number,
  first: number,
) => {
  const transaction = `request-${String(index + 1)}`;
  const url = sanitizeBrowserUrl(`${SCENARIO_ORIGIN}${exchange.url}`);
  const network = {
    step_index: 1,
    transaction_id: transaction,
    redirected_from_transaction_id: null,
    redirected_from_transaction_state: "root" as const,
    method: exchange.method,
    url: exchange.redactedUrl === true ? { ...url, redacted: true } : url,
    resource_type: exchange.resourceType ?? "fetch",
    header_names: [...(exchange.requestHeaderNames ?? [])],
  };
  const content = (
    sequence: number,
    source: number,
    phase: "request" | "response",
    body:
      | ReturnType<typeof capturedBody>
      | { readonly state: "not_requested" | "not_exposed" },
  ) => ({
    sequence,
    step_index: 1,
    kind: "network-content" as const,
    transaction_id: transaction,
    source_event_sequence: source,
    phase,
    headers: retainedHeaders(
      phase === "request" ? exchange.requestHeaders : exchange.responseHeaders,
    ),
    body,
  });
  const events: unknown[] = [
    {
      ...network,
      sequence: first,
      kind: "request",
      status: null,
      failure: null,
    },
  ];
  let next = first + 1;
  if (
    exchange.requestBody !== undefined ||
    exchange.requestBodyHidden === true ||
    exchange.requestHeaders !== undefined
  ) {
    events.push(
      content(
        next,
        first,
        "request",
        exchange.requestBodyHidden === true
          ? { state: "not_exposed" }
          : exchange.requestBody === undefined
            ? { state: "not_requested" }
            : capturedBody(
                exchange.requestBody,
                "browser-exposed-request-bytes",
                exchange.requestMediaType ?? null,
              ),
      ),
    );
    next += 1;
  }
  if (exchange.status === undefined) {
    events.push({
      ...network,
      sequence: next,
      kind: "request-failed",
      status: null,
      failure: "net::ERR_CONNECTION_RESET",
    });
    return { events, next: next + 1 };
  }
  const response = next;
  events.push({
    ...network,
    sequence: response,
    kind: "response",
    status: exchange.status,
    failure: null,
  });
  next += 1;
  if (exchange.body !== undefined || exchange.responseHeaders !== undefined) {
    events.push(
      content(
        next,
        response,
        "response",
        exchange.body === undefined
          ? { state: "not_requested" }
          : capturedBody(
              exchange.body,
              "playwright-response-body-bytes",
              exchange.mediaType ?? null,
            ),
      ),
    );
    next += 1;
  }
  return { events, next };
};

const step = (index: number) => ({
  step_index: index,
  step_id: index === 0 ? "initial" : "browse",
  action: index === 0 ? "initial" : "goto",
  elapsed_ms: 0,
  before_url: sanitizeBrowserUrl(`${SCENARIO_ORIGIN}/`),
  after_url: sanitizeBrowserUrl(`${SCENARIO_ORIGIN}/`),
  event_sequence_start: 1,
  event_sequence_end: 0,
  artifacts: {
    screenshot: { state: "not_requested" },
    dom: { state: "not_requested" },
    accessibility: { state: "not_requested" },
    url: { state: "not_requested" },
    history: { state: "not_requested" },
    storage: { state: "not_requested" },
  },
  completeness: {
    status: "complete",
    equality_eligible: true,
    missing_sections: [],
    truncated_sections: [],
  },
  status: "completed",
  error: null,
});

/** A complete, schema-valid scenario capture of the given transactions. */
export const scenarioCaptureFixture = (
  exchanges: readonly ScenarioExchange[] = SCENARIO_EXCHANGES,
  networkContent = {
    request_body: true,
    response_body: true,
    header_values: false,
  },
): BrowserScenarioCapture => {
  const items: unknown[] = [];
  let sequence = 1;
  for (const [index, exchange] of exchanges.entries()) {
    const built = exchangeEvents(exchange, index, sequence);
    items.push(...built.events);
    sequence = built.next;
  }
  return browserScenarioCaptureSchema.parse({
    browser: {
      mode: "launch",
      process_ownership: "provider-owned",
      cleanup: "terminated-owned-process",
      product: "Chromium",
      version: "fixture",
    },
    scenario: {
      start_origin: SCENARIO_ORIGIN,
      action_count: 1,
      secret_references: [],
      network_content: networkContent,
      event_families: ["network"],
      limits: DEFAULT_BROWSER_SCENARIO_CAPTURE_LIMITS,
    },
    duration_ms: 1,
    steps: [step(0), step(1)],
    events: {
      retained: items.length,
      dropped: 0,
      items,
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

/** The capture as Evidence, the way capture_browser_scenario records it. */
export const scenarioCaptureEvidence = (
  capture: BrowserScenarioCapture = scenarioCaptureFixture(),
): Evidence =>
  createBrowserScenarioEvidence(
    browserScenarioSchema.parse({
      browser: { mode: "launch", executable_path: process.execPath },
      start_url: { url: `${SCENARIO_ORIGIN}/`, query: [] },
      actions: [
        { step_id: "browse", action: "wait_for_timeout", duration_ms: 1 },
      ],
    }),
    capture,
    { id: "fixture", name: "fixture", version: "1" },
  );

/** Project the scenario capture through the real view service, with every opt-in rule. */
export const scenarioServeFixture = (
  capture: Evidence = scenarioCaptureEvidence(),
): EnvironmentServeFixture => {
  const manifest = inspectAnalysisViewValidated({
    source: { kind: "inline", evidence: capture },
    view: analysisViewRequestSchema.parse({
      kind: "environment-manifest",
      template_rules: [...ALL_TEMPLATE_RULES],
    }),
  });
  if (!manifest.ok) throw manifest.error;
  return { manifest: manifest.value, capture };
};

/** A scenario capture that kept header values but no bodies: it yields a manifest but no environment state. */
export const scenarioHeaderOnlyCaptureEvidence = (): Evidence =>
  scenarioCaptureEvidence(
    scenarioCaptureFixture(undefined, {
      request_body: false,
      response_body: false,
      header_values: true,
    }),
  );
