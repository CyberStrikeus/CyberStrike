import { execFile } from "node:child_process";
import { writeFile, truncate, rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { expect, it as runtimeTest } from "vitest";
import {
  NODE_CAPTURE_HEAP_ENFORCED,
  NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES,
} from "../../../src/browser/history/CaptureRelease.js";
import { webNetworkCaptureSummaryViewResultSchema } from "../../../src/domain/analysisView/analysisView.js";
import { parseEvidence } from "../../../src/domain/evidence.js";
import {
  webNetworkCaptureSchema,
  WEB_NETWORK_CAPTURE_LIMITS,
} from "../../../src/domain/webNetworkCapture.js";
import { connectLocalToolsMcp } from "../../fixtures/localToolsMcp.js";
import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const execute = promisify(execFile);
const hasMemoryBound =
  NODE_CAPTURE_HEAP_ENFORCED ||
  NODE_CAPTURE_PROCESS_MEMORY_LIMIT_BYTES !== null;
const it = runtimeTest.skipIf(!hasMemoryBound);
const cli = fileURLToPath(new URL("../../../scripts/rea.mjs", import.meta.url));
const event = {
  name: "transport:packet_sent",
  time: 1791819895000.25,
  data: {
    header: { packet_type: "1RTT", packet_number: 5 },
    frames: [{ frame_type: "stream", stream_id: 0, offset: 10, length: 5 }],
  },
};
const qlog = (events: unknown[]) =>
  JSON.stringify({
    qlog_format: "JSON",
    qlog_version: "0.3",
    traces: [
      {
        vantage_point: { name: "aioquic", type: "server" },
        common_fields: { ODCID: "trace-local" },
        events,
      },
    ],
  });

const expectRecoveredCapture = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  path: string,
): Promise<void> => {
  const response = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "qlog",
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const capture = webNetworkCaptureSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
  expect(capture).toMatchObject({
    format: "qlog",
    records: [{ reported: { name: "transport:packet_sent" } }],
  });
};

it("does not classify hidden custom event data as incomplete transport facts", async () => {
  const root = await createTestTempDirectory("rea-qlog-hidden-extension-");
  const path = join(root, "input.qlog");
  await writeFile(
    path,
    qlog([
      { name: "extension:custom", time: 1, data: { body: "ordinary" } },
      {
        ...event,
        data: {
          ...event.data,
          frames: [{ ...event.data.frames[0], fin: false }],
        },
      },
    ]),
  );
  const { call } = await connectLocalToolsMcp();
  for (const sensitive of [[], ["data"]]) {
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "qlog",
      sensitive_values: sensitive,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    const mcp = parseEvidence(response.structuredContent);
    const cliResult = await execute(process.execPath, [
      cli,
      "inspect-web-network-capture",
      path,
      "qlog",
      ...sensitive.flatMap((value) => ["--sensitive-value", value]),
      "--json",
    ]);
    const cliEvidence = parseEvidence(JSON.parse(cliResult.stdout));
    expect(cliEvidence.normalized_result).toEqual(mcp.normalized_result);
    const capture = webNetworkCaptureSchema.parse(mcp.normalized_result);
    if (capture.format !== "qlog") throw new Error("qlog format required");
    expect(capture.qlog.traces[0]?.incomplete_fact_records).toEqual(
      sensitive.length === 0 ? [] : [1],
    );
    if (sensitive.length > 0)
      expect(capture.records[0]?.reported).toEqual({
        name: "extension:custom",
        time: 1,
      });
  }
});

const assertAdditionalQlogFacets = async (
  call: Awaited<ReturnType<typeof connectLocalToolsMcp>>["call"],
  retained: { kind: string; evidence_id: string },
): Promise<void> => {
  for (const [view, expected] of [
    [
      { kind: "qlog", facet: "traces", offset: 1, limit: 1 },
      [{ trace_index: 1, event_count: 1, stream_count: 1 }],
    ],
    [
      { kind: "qlog", facet: "loss-declarations", trace_index: 0 },
      [{ record_ordinal: 1, packet_number: { state: "reported", value: "5" } }],
    ],
    [{ kind: "qlog", facet: "incomplete-records", trace_index: 0 }, [0]],
    [
      {
        kind: "qlog",
        facet: "ranges",
        trace_index: 0,
        stream_id: "0",
        direction: "sent",
      },
      [{ start: "10", end: "15" }],
    ],
    [
      {
        kind: "qlog",
        facet: "final-sizes",
        trace_index: 0,
        stream_id: "0",
        direction: "sent",
      },
      [],
    ],
    [{ kind: "qlog", facet: "traces", offset: 99 }, []],
  ] as const) {
    const response = await call("inspect_analysis_view", {
      source: retained,
      view,
    });
    expect(response.isError, JSON.stringify(response)).not.toBe(true);
    expect(
      parseEvidence(response.structuredContent).normalized_result,
    ).toMatchObject({
      page: { items: expected },
      coverage: { exhausted: true },
    });
  }
};

it("pages original trace-scoped facts after source deletion without conflating selected events or identical stream IDs", async () => {
  const root = await createTestTempDirectory("rea-qlog-pages-");
  const path = join(root, "input.qlog");
  const source = JSON.parse(
    qlog([
      event,
      {
        name: "recovery:packet_lost",
        time: 1791819895001,
        data: { packet_number: 5, type: "1RTT" },
      },
    ]),
  );
  source.traces.push({
    ...source.traces[0],
    events: [
      {
        ...event,
        data: {
          frames: [
            {
              frame_type: "stream",
              stream_id: 0,
              offset: 100,
              length: 3,
              fin: true,
            },
          ],
        },
      },
    ],
  });
  await writeFile(path, JSON.stringify(source));
  const { call } = await connectLocalToolsMcp();
  const response = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "qlog",
    detail: "summary",
    record_ordinals: [2],
  });
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const summary = webNetworkCaptureSummaryViewResultSchema.parse(
    parseEvidence(response.structuredContent).normalized_result,
  );
  expect(summary).toMatchObject({
    summary: {
      total_records: 3,
      retained_records: 1,
      qlog: {
        trace_count: 2,
        retained_stream_count: 2,
        loss_declaration_count: 1,
      },
    },
  });
  expect(JSON.stringify(summary)).not.toContain('"contributions"');
  if (
    !("parent_evidence_id" in summary) ||
    typeof summary.parent_evidence_id !== "string"
  )
    throw new Error("Missing retained parent");
  const retained = {
    kind: "retained-evidence",
    evidence_id: summary.parent_evidence_id,
  };
  const parent = parseEvidence(
    (
      await call("inspect_web_network_capture", {
        capture_path: path,
        format: "qlog",
        record_ordinals: [2],
      })
    ).structuredContent,
  );
  expect(parent.evidence_id).toBe(summary.parent_evidence_id);
  const portablePath = join(root, "parent.json");
  await rm(path);
  const pages = [];
  for (const trace_index of [0, 1]) {
    const page = await call("inspect_analysis_view", {
      source: retained,
      view: { kind: "qlog", facet: "streams", trace_index, limit: 1 },
    });
    expect(page.isError, JSON.stringify(page)).not.toBe(true);
    pages.push(parseEvidence(page.structuredContent).normalized_result);
  }
  expect(pages[0]).toMatchObject({
    page: { items: [{ stream_id: "0", unique_bytes: "5" }] },
    context: { scope: "all-recorded-events-before-selection" },
  });
  expect(pages[1]).toMatchObject({
    page: { items: [{ stream_id: "0", unique_bytes: "3" }] },
  });
  await assertAdditionalQlogFacets(call, retained);
  const view = {
    kind: "qlog",
    facet: "contributions",
    trace_index: 0,
    stream_id: "0",
    direction: "sent",
    offset: 0,
    limit: 1,
  };
  const contribution = parseEvidence(
    (await call("inspect_analysis_view", { source: retained, view }))
      .structuredContent,
  );
  expect(contribution.normalized_result).toMatchObject({
    page: {
      items: [
        {
          record_ordinal: 0,
          frame_index: 0,
          offset: "10",
          length: "5",
          fin: null,
        },
      ],
    },
    coverage: { total: 1, exhausted: true },
  });
  await writeFile(
    portablePath,
    JSON.stringify({ source: { kind: "inline", evidence: parent }, view }),
  );
  const cliResult = await execute(process.execPath, [
    cli,
    "inspect-analysis-view",
    portablePath,
    "--json",
  ]);
  expect(parseEvidence(JSON.parse(cliResult.stdout)).normalized_result).toEqual(
    contribution.normalized_result,
  );
  for (const invalid of [
    { kind: "qlog", facet: "streams" },
    { kind: "qlog", facet: "streams", trace_index: 99 },
    { ...view, stream_id: "99" },
    { kind: "qlog", facet: "traces", trace_index: 0 },
  ])
    expect(
      parseMcpToolError(
        await call("inspect_analysis_view", {
          source: retained,
          view: invalid,
        }),
      ),
    ).toMatchObject({ error: { code: "invalid_request" } });
}, 60_000);

runtimeTest.runIf(!hasMemoryBound)(
  "refuses qlog when this runtime cannot enforce a decoder memory bound",
  async () => {
    const { call } = await connectLocalToolsMcp();
    const root = await createTestTempDirectory("rea-qlog-unbounded-");
    const path = join(root, "input.qlog");
    await writeFile(path, qlog([event]));
    expect(
      parseMcpToolError(
        await call("inspect_web_network_capture", {
          capture_path: path,
          format: "qlog",
        }),
      ),
    ).toMatchObject({ error: { code: "capability_unavailable" } });
  },
);

it("runs built CLI and real stdio SDK with exact evidence parity, selection, retained references and strict schemas", async () => {
  const root = await createTestTempDirectory("rea-qlog-public-");
  const path = join(root, "input.qlog");
  await writeFile(
    path,
    qlog([
      event,
      {
        name: "recovery:packet_lost",
        time: 1791819895001.125,
        data: { packet_number: 5, type: "1RTT" },
      },
    ]),
  );
  const { call, client } = await connectLocalToolsMcp();
  const input = { capture_path: path, format: "qlog", record_ordinals: [1, 0] };
  const response = await call("inspect_web_network_capture", input);
  expect(response.isError, JSON.stringify(response)).not.toBe(true);
  const mcp = parseEvidence(response.structuredContent);
  const result = await execute(process.execPath, [
    cli,
    "inspect-web-network-capture",
    path,
    "qlog",
    "--record",
    "1",
    "--record",
    "0",
    "--json",
  ]);
  const cliEvidence = parseEvidence(JSON.parse(result.stdout));
  expect(cliEvidence.evidence_id).toBe(mcp.evidence_id);
  expect(cliEvidence.normalized_result).toEqual(mcp.normalized_result);
  expect(mcp.analysis_profile?.parameters).toMatchObject({
    qlog_profile: "aioquic-1.5.0-json-0.3",
  });
  expect(mcp.authority).toBe("historical-reference");
  const decoded = webNetworkCaptureSchema.parse(mcp.normalized_result);
  expect(decoded.records.map((record) => record.ordinal)).toEqual([1, 0]);
  if (decoded.format !== "qlog") throw new Error("qlog format required");
  expect(decoded.qlog.traces[0]?.streams[0]).toMatchObject({
    unique_bytes: "5",
    covered_ranges: [{ start: "10", end: "15" }],
  });
  // An unsupported view over an existing retained parent proves lookup without pretending qlog is HAR.
  for (const kind of [
    "api-surface",
    "environment-manifest",
    "environment-state",
  ] as const) {
    const retained = await call("inspect_analysis_view", {
      source: { kind: "retained-evidence", evidence_id: mcp.evidence_id },
      view: { kind },
    });
    expect(parseMcpToolError(retained)).toMatchObject({
      error: { code: "unsupported_target" },
    });
  }
  await client.ping();
  for (const record_ordinals of [[2], [0, 0]]) {
    expect(
      parseMcpToolError(
        await call("inspect_web_network_capture", {
          ...input,
          record_ordinals,
        }),
      ),
    ).toMatchObject({ error: { code: "invalid_request" } });
  }
  const hidden = await call("inspect_web_network_capture", {
    capture_path: path,
    format: "qlog",
    sensitive_values: ["trace-local", "/traces/0", "input.qlog"],
  });
  expect(JSON.stringify(hidden)).not.toContain("trace-local");
  expect(JSON.stringify(hidden)).not.toContain("/traces/0");
  expect(JSON.stringify(hidden)).not.toContain("input.qlog");
  const hiddenEvidence = parseEvidence(hidden.structuredContent);
  expect(
    webNetworkCaptureSchema.parse(hiddenEvidence.normalized_result).artifact
      .path,
  ).toBe("");
  const invalid = await call("inspect_web_network_capture", {
    ...input,
    mysecret: true,
    sensitive_values: ["mysecret"],
  });
  expect(parseMcpToolError(invalid)).toMatchObject({
    error: { code: "invalid_request" },
  });
  expect(JSON.stringify(invalid)).not.toContain("mysecret");
}, 60_000);

it("fails whole-capture validation before selection and survives malformed, unsupported and oversized qlog", async () => {
  const root = await createTestTempDirectory("rea-qlog-errors-");
  const path = join(root, "input.qlog");
  const { call, client } = await connectLocalToolsMcp();
  for (const [text, expected] of [
    [
      qlog([event, { ...event, time: "invalid" }]),
      {
        code: "invalid_request",
        details: {
          operation: "inspect_web_network_capture",
          issues: [
            {
              path: ["capture_path", "/traces/0/events/1"],
              reason: "invalid_format",
            },
          ],
        },
      },
    ],
    [
      qlog([event]).slice(0, -1),
      {
        code: "invalid_request",
        details: {
          operation: "inspect_web_network_capture",
          issues: [{ path: ["capture_path", ""], reason: "invalid_format" }],
        },
      },
    ],
    [
      qlog([event]).replace('"qlog_version":"0.3"', '"qlog_version":"0.4"'),
      {
        code: "capability_unavailable",
        details: {
          operation: "inspect_web_network_capture",
          provider_id: "qlog",
        },
      },
    ],
    [
      qlog([
        {
          ...event,
          extension: JSON.parse("[".repeat(65) + "0" + "]".repeat(65)),
        },
      ]),
      {
        code: "invalid_request",
        details: {
          operation: "inspect_web_network_capture",
          issues: [
            expect.objectContaining({
              reason: "out_of_range",
              expected: {
                maximum_capture_nesting: WEB_NETWORK_CAPTURE_LIMITS.depth,
              },
            }),
          ],
        },
      },
    ],
  ] as const) {
    await writeFile(path, text);
    expect(
      parseMcpToolError(
        await call("inspect_web_network_capture", {
          capture_path: path,
          format: "qlog",
          record_ordinals: [0],
        }),
      ),
    ).toMatchObject({ error: expected });
    const failed: unknown = await execute(process.execPath, [
      cli,
      "inspect-web-network-capture",
      path,
      "qlog",
      "--json",
    ]).catch((cause: unknown) => cause);
    expect(failed).toMatchObject({
      code: 1,
      stdout: expect.any(String),
    });
    if (
      typeof failed !== "object" ||
      failed === null ||
      !("stdout" in failed) ||
      typeof failed.stdout !== "string"
    )
      throw new Error("CLI failure omitted JSON output");
    expect(JSON.parse(failed.stdout)).toMatchObject(expected);
  }
  await truncate(path, WEB_NETWORK_CAPTURE_LIMITS.inputBytes + 1);
  expect(
    parseMcpToolError(
      await call("inspect_web_network_capture", {
        capture_path: path,
        format: "qlog",
      }),
    ),
  ).toMatchObject({ error: { code: "invalid_request" } });
  await writeFile(path, qlog([event]));
  await client.ping();
  await expectRecoveredCapture(call, path);
}, 60_000);

runtimeTest.skipIf(process.versions.bun !== undefined || !hasMemoryBound)(
  "contains actual qlog decoder heap exhaustion and keeps MCP usable",
  async () => {
    const root = await createTestTempDirectory("rea-qlog-capacity-");
    const path = join(root, "dense.qlog");
    const dense = qlog(Array<unknown>(100_000).fill(event));
    expect(Buffer.byteLength(dense)).toBeLessThan(
      WEB_NETWORK_CAPTURE_LIMITS.inputBytes,
    );
    await writeFile(path, dense);
    const { call, client } = await connectLocalToolsMcp();
    const response = await call("inspect_web_network_capture", {
      capture_path: path,
      format: "qlog",
      record_ordinals: [0],
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: {
        code: "resource_constraint",
        details: {
          resource: "memory",
          reported_limits: { old_generation_heap_mib: 192 },
        },
      },
    });
    const failed: unknown = await execute(
      process.execPath,
      [cli, "inspect-web-network-capture", path, "qlog", "--json"],
      { timeout: 40_000, maxBuffer: 1024 * 1024 },
    ).catch((cause: unknown) => cause);
    expect(failed).toMatchObject({
      code: 1,
      stdout: expect.stringContaining('"code":"resource_constraint"'),
    });
    await writeFile(path, qlog([event]));
    await client.ping();
    await expectRecoveredCapture(call, path);
  },
  60_000,
);
