import { parseMcpToolError } from "../../fixtures/mcpToolError.js";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { expect, it, onTestFinished } from "vitest";

import { compareProcessEvidenceFiles } from "../../../src/application/process/ProcessCli.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { EMPTY_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCaptureExample.js";
import { FINALIZED_PROCESS_CAPTURE_EXAMPLE } from "../../../src/domain/process/processCapture.fixture.js";
import {
  capture,
  partialSpecification,
  processStarted,
  terminal,
} from "../../../src/domain/process/processTraceComparison.fixture.js";
import {
  parseProcessCapture,
  type ProcessCapture,
} from "../../../src/domain/process/processCaptureParsing.js";
import type { ProcessTraceSpecification } from "../../../src/domain/process/processTraceSpecification.js";
import {
  createEvidence,
  parseEvidence,
  type EvidenceProvider,
} from "../../../src/domain/evidence.js";

import { digestProcessCommitment } from "../../../src/domain/process/processScenario.js";
import { createServer } from "../../../src/server/createServer.js";
import { createTestBinarySession } from "../../fixtures/binarySession.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const captureEvidence = (
  side: "left" | "right",
  comparisonContract: Readonly<Record<string, string>> = {},
  provider: EvidenceProvider = PROCESS_PROVIDER,
  observation: ProcessCapture = parseProcessCapture(
    EMPTY_PROCESS_CAPTURE_EXAMPLE,
  ),
) =>
  createEvidence(undefined, provider, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: { side },
    result: {
      ...observation,
      manifest: {
        ...observation.manifest,
        comparison_contract: comparisonContract,
        comparison_contract_sha256: digestProcessCommitment(comparisonContract),
      },
    },
    confidence: "observed",
    authority: "controlled-replay",
  });

const left = captureEvidence("left", { working_directory: "/work/reference" });
const right = captureEvidence("right", {
  working_directory: "/work/reconstruction",
});

const connect = async (
  session = createTestBinarySession(() => {
    throw new Error("Process comparison must not launch a provider");
  }),
  maximumInputElements?: number,
) => {
  const server = createServer(
    { kind: "session", session },
    {
      environment: {
        ...process.env,
        ...(maximumInputElements === undefined
          ? {}
          : { REA_MCP_MAX_INPUT_ELEMENTS: String(maximumInputElements) }),
      },
    },
  );
  const client = new Client({ name: "process-comparison-test", version: "1" });
  onTestFinished(async () => {
    await Promise.allSettled([client.close(), server.close(), session.close()]);
  });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

const compareViaCli = async (
  left: ReturnType<typeof captureEvidence>,
  right: ReturnType<typeof captureEvidence>,
  specification?: ProcessTraceSpecification,
) => {
  const root = await createTestTempDirectory("rea-process-provider-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  await Promise.all([
    writeFile(leftPath, JSON.stringify(left)),
    writeFile(rightPath, JSON.stringify(right)),
  ]);
  const tracePath = join(root, "trace.json");
  if (specification !== undefined)
    await writeFile(tracePath, JSON.stringify(specification));
  return compareProcessEvidenceFiles(
    leftPath,
    rightPath,
    specification === undefined ? undefined : tracePath,
  );
};

it.each(
  (["left", "right"] as const).flatMap((missingWorker) =>
    (["left", "right", "both", "neither"] as const).map((omittedRendered) => ({
      missingWorker,
      omittedRendered,
    })),
  ),
)(
  "preserves terminal coverage when $missingWorker lacks a worker and $omittedRendered omits rendered output",
  async ({ missingWorker, omittedRendered }) => {
    const observation = (side: "left" | "right") => {
      const hasWorker = side !== missingWorker;
      const complete = capture({
        frames: [terminal],
        process_samples: hasWorker ? [processStarted] : [],
        event_journal: [
          { collection: "frames", index: 0 },
          ...(hasWorker
            ? [{ collection: "process_samples" as const, index: 0 }]
            : []),
        ],
      });
      const omitted = omittedRendered === "both" || omittedRendered === side;
      return captureEvidence(
        side,
        {},
        PROCESS_PROVIDER,
        omitted
          ? parseProcessCapture({
              ...complete,
              truncated: true,
              truncation_details: {
                ...complete.truncation_details,
                rendered_terminal: {
                  budget_bytes: 5,
                  observed_bytes: 0,
                  retained_bytes: 0,
                  observed_frames: 1,
                  retained_frames: 0,
                  unknown_size_frames: 1,
                },
              },
            })
          : complete,
      );
    };
    const left = observation("left");
    const right = observation("right");
    const terminalStatus =
      omittedRendered === "neither" ? "unchanged" : "unknown";
    const plain = parseEvidence(await compareViaCli(left, right));
    expect(plain.normalized_result).toMatchObject({
      terminal: terminalStatus,
      process: missingWorker === "left" ? "added" : "removed",
      status: "changed",
    });

    const specification = partialSpecification();
    const cli = parseEvidence(await compareViaCli(left, right, specification));
    const client = await connect();
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right, trace_spec: specification },
    });
    expect(response.isError).not.toBe(true);
    expect(parseEvidence(response.structuredContent)).toEqual(cli);
    expect(cli.evidence_links).toEqual([left.evidence_id, right.evidence_id]);
    expect(cli.normalized_result).toMatchObject({
      terminal: terminalStatus,
      process: "changed",
      status: "changed",
      trace: {
        verdict: "different",
        diagnostic: {
          kind: "cardinality",
          side: missingWorker,
          event_ids: ["worker"],
          locations: [],
        },
      },
    });
  },
);

it.each(
  (["left", "right"] as const).flatMap((side) =>
    [
      { id: "unrelated-provider" },
      { version: "1" },
      { name: "unrelated provider" },
    ].map((change) => ({ side, change })),
  ),
)(
  "rejects an authenticated $side capture with provider $change",
  async ({ side, change }) => {
    const wrongProvider = captureEvidence(
      side,
      {},
      { ...PROCESS_PROVIDER, ...change },
    );
    expect(parseEvidence(wrongProvider)).toEqual(wrongProvider);
    const left = side === "left" ? wrongProvider : captureEvidence("left");
    const right = side === "right" ? wrongProvider : captureEvidence("right");
    const issue = {
      path: [side, "provider"],
      reason: "invalid_value",
      message: expect.stringContaining("process capture provider"),
    };
    expect(await compareViaCli(left, right)).toMatchObject({
      category: "invalid_input",
      details: { operation: "compare_process_captures", issues: [issue] },
    });
    const client = await connect();
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right },
    });
    expect(response.isError).toBe(true);
    expect(parseMcpToolError(response)).toMatchObject({
      error: { code: "invalid_request", details: { issues: [issue] } },
    });
    await client.ping();
  },
);

it.each([PROCESS_PROVIDER.name, "REA deterministic process harness"])(
  "preserves authenticated CLI/MCP comparison Evidence for provider name %s",
  async (name) => {
    const provider = { ...PROCESS_PROVIDER, name };
    const left = captureEvidence("left", {}, provider);
    const right = captureEvidence("right", {}, provider);
    const cli = parseEvidence(await compareViaCli(left, right));
    const client = await connect();
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right },
    });
    expect(response.isError).not.toBe(true);
    expect(parseEvidence(response.structuredContent)).toEqual(cli);
    const text = response.content.find((block) => block.type === "text");
    expect(text?.type).toBe("text");
    if (text?.type !== "text") throw new Error("Missing comparison text");
    expect(JSON.parse(text.text)).toEqual(cli);
    expect(cli.evidence_links).toEqual([left.evidence_id, right.evidence_id]);
  },
);

it.each(["left", "right"] as const)(
  "authenticates the %s Evidence before provider admission",
  async (side) => {
    const mismatched = captureEvidence(
      side,
      {},
      { ...PROCESS_PROVIDER, id: "unrelated-provider" },
    );
    const tampered = { ...mismatched, parameters: { side: "tampered" } };
    const left = side === "left" ? tampered : captureEvidence("left");
    const right = side === "right" ? tampered : captureEvidence("right");
    expect(await compareViaCli(left, right)).toMatchObject({
      category: "invalid_input",
      details: {
        issues: [
          {
            path: ["evidence_id"],
            message: expect.stringContaining(
              "Evidence semantic identifier does not match its record",
            ),
          },
        ],
      },
    });
    const client = await connect();
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right },
    });
    expect(parseMcpToolError(response)).toMatchObject({
      error: { code: "evidence_integrity_mismatch" },
    });
  },
);

it("names differing comparison contract fields through MCP and the CLI", async () => {
  const client = await connect();
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: { left, right },
  });
  expect(response.isError).toBe(true);
  const issue = {
    path: ["right"],
    reason: "invalid_value",
    message: expect.stringContaining(
      "these scenario fields differ: working_directory",
    ),
    expected: ["working_directory"],
  };
  expect(parseMcpToolError(response)).toMatchObject({
    error: { code: "invalid_request", details: { issues: [issue] } },
  });

  const root = await createTestTempDirectory("rea-process-contract-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  await writeFile(leftPath, JSON.stringify(left));
  await writeFile(rightPath, JSON.stringify(right));
  expect(await compareProcessEvidenceFiles(leftPath, rightPath)).toMatchObject({
    error: "Process command failed",
    code: "invalid_request",
    details: { operation: "compare_process_captures", issues: [issue] },
  });
});

it("names the stale capture that exceeds max_capture_age_ms", async () => {
  const client = await connect();
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: captureEvidence("left"),
      right: captureEvidence("right"),
      max_capture_age_ms: 1000,
    },
  });
  expect(response.isError).toBe(true);
  expect(parseMcpToolError(response)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["max_capture_age_ms"],
            reason: "out_of_range",
            message: expect.stringContaining(
              `left completed at ${EMPTY_PROCESS_CAPTURE_EXAMPLE.manifest.completed_at}`,
            ),
          },
        ],
      },
    },
  });
});

it("retains a selected max_capture_age_ms requirement in comparison Evidence parameters", async () => {
  const session = createTestBinarySession(() => {
    throw new Error("Process comparison must not launch a provider");
  });
  const client = await connect(session);
  const unconstrained = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: captureEvidence("left"),
      right: captureEvidence("right"),
    },
  });
  const selected = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: captureEvidence("left"),
      right: captureEvidence("right"),
      max_capture_age_ms: Number.MAX_SAFE_INTEGER,
    },
  });
  expect(unconstrained.isError).not.toBe(true);
  expect(selected.isError).not.toBe(true);
  const before = parseEvidence(unconstrained.structuredContent);
  const after = parseEvidence(selected.structuredContent);
  expect(before.parameters).not.toHaveProperty("max_capture_age_ms");
  expect(after.parameters).toHaveProperty(
    "max_capture_age_ms",
    Number.MAX_SAFE_INTEGER,
  );
  expect(after.evidence_id).not.toBe(before.evidence_id);
  expect(session.evidenceById(after.evidence_id)?.parameters).toHaveProperty(
    "max_capture_age_ms",
    Number.MAX_SAFE_INTEGER,
  );
});

it("reports CLI trace specification issues like the MCP trace_spec input", async () => {
  const root = await createTestTempDirectory("rea-process-trace-spec-");
  const capturePath = join(root, "capture.json");
  const specPath = join(root, "spec.json");
  await writeFile(capturePath, JSON.stringify(captureEvidence("left")));
  await writeFile(specPath, JSON.stringify({ language: {} }));
  expect(
    await compareProcessEvidenceFiles(capturePath, capturePath, specPath),
  ).toMatchObject({
    code: "invalid_request",
    details: {
      operation: "compare_process_captures",
      issues: expect.arrayContaining([
        expect.objectContaining({ path: ["trace_spec", "events"] }),
      ]),
    },
  });
});

it("rejects a deep trace cycle as an input error through CLI and MCP", async () => {
  const events = Array.from({ length: 6000 }, (_, index) => ({
    id: `e${String(index)}`,
    source: "lifecycle",
    exact: { marker: index },
  }));
  const trace = {
    events,
    language: {
      kind: "partial_order",
      happens_before: events.map((event, index) => ({
        before: event.id,
        after: events[(index + 1) % events.length]!.id,
      })),
      not_before: events.map((event, index) => ({
        event: event.id,
        anchor: events[(index + 1) % events.length]!.id,
      })),
      unordered_groups: [{ events: events.map(({ id }) => id) }],
    },
  };
  const issue = {
    path: ["trace_spec", "language"],
    message: "happens-before graph must be acyclic",
  };
  const capture = captureEvidence("left");
  const root = await createTestTempDirectory("rea-process-trace-cycle-");
  const capturePath = join(root, "capture.json");
  const specPath = join(root, "spec.json");
  await writeFile(capturePath, JSON.stringify(capture));
  await writeFile(specPath, JSON.stringify(trace));
  expect(
    await compareProcessEvidenceFiles(capturePath, capturePath, specPath),
  ).toMatchObject({
    code: "invalid_request",
    details: { issues: [issue] },
  });

  // This 6,000-event graph intentionally exercises cycle validation beyond
  // ordinary transport admission. Keep a finite explicit fixture allowance.
  const client = await connect(undefined, 131_072);
  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: { left: capture, right: capture, trace_spec: trace },
  });
  expect(response.isError).toBe(true);
  expect(response.content).toEqual([
    { type: "text", text: expect.stringContaining(issue.message) },
  ]);
  await client.ping();
});

it("names the side and constraint when Evidence is not a usable capture", async () => {
  const client = await connect();
  const capture = captureEvidence("right");
  const unrelated = createEvidence(undefined, PROCESS_PROVIDER, {
    operation: "other",
    parameters: {},
    result: {},
  });
  const wrongKind = await client.callTool({
    name: "compare_process_captures",
    arguments: { left: unrelated, right: capture },
  });
  expect(parseMcpToolError(wrongKind)).toMatchObject({
    error: {
      code: "invalid_request",
      details: {
        issues: [
          {
            path: ["left"],
            reason: "invalid_value",
            message: expect.stringContaining(
              "the left Evidence has operation other",
            ),
          },
        ],
      },
    },
  });

  const tampered = await client.callTool({
    name: "compare_process_captures",
    arguments: {
      left: capture,
      right: { ...capture, parameters: { side: "changed" } },
    },
  });
  expect(parseMcpToolError(tampered)).toMatchObject({
    error: {
      code: "evidence_integrity_mismatch",
      message: expect.stringContaining(
        "The right Evidence failed validation (at evidence_id: Evidence semantic identifier does not match its record)",
      ),
    },
  });

  const coverage = EMPTY_PROCESS_CAPTURE_EXAMPLE.truncation_details;
  const invalidCaptures = [
    { result: { manifest: {} }, description: "(at " },
    {
      result: {
        ...EMPTY_PROCESS_CAPTURE_EXAMPLE,
        truncated: true,
        truncation_details: {
          ...coverage,
          rendered_terminal: {
            ...coverage.rendered_terminal,
            observed_frames: 2,
            unknown_size_frames: 1,
            normalization_over_budget_frames: 2,
          },
        },
      },
      description:
        "(at truncation_details.rendered_terminal.normalization_over_budget_frames: normalization omissions must be a subset of unknown-size rendered frames)",
    },
  ];
  const root = await createTestTempDirectory("rea-process-malformed-");
  const leftPath = join(root, "left.json");
  const rightPath = join(root, "right.json");
  await writeFile(leftPath, JSON.stringify(capture));
  for (const { result, description } of invalidCaptures) {
    const invalidResult = createEvidence(undefined, PROCESS_PROVIDER, {
      predicateType: "rea.process-capture",
      operation: "capture_process_scenario",
      parameters: {},
      result: result,
    });
    expect(parseEvidence(invalidResult)).toEqual(invalidResult);
    const malformed = await client.callTool({
      name: "compare_process_captures",
      arguments: { left: capture, right: invalidResult },
    });
    expect(parseMcpToolError(malformed)).toMatchObject({
      error: {
        code: "evidence_integrity_mismatch",
        message: expect.stringContaining(
          `The right Evidence has an invalid process capture result ${description}`,
        ),
      },
    });

    await writeFile(rightPath, JSON.stringify(invalidResult));
    expect(
      await compareProcessEvidenceFiles(leftPath, rightPath),
    ).toMatchObject({
      code: "invalid_request",
      category: "invalid_input",
      message: expect.stringContaining(
        `Capture evidence is malformed ${description}`,
      ),
      details: { issues: [expect.objectContaining({ path: ["right"] })] },
    });
  }
});

it("keeps structural capture issues alongside semantic ones through MCP and the CLI", async () => {
  const client = await connect();
  const capture = captureEvidence("left");
  const {
    manifest: { completed_at: _completedAt, ...manifest },
    exit,
    ...rest
  } = FINALIZED_PROCESS_CAPTURE_EXAMPLE;
  const mixed = createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: {},
    result: {
      ...rest,
      manifest,
      exit: {
        ...exit,
        finalization: {
          ...exit.finalization,
          signals: [
            { ...exit.finalization.signals[0], reason: "not allowed here" },
          ],
        },
      },
    },
  });
  const described =
    "(at manifest.completed_at: Invalid input: expected string, received undefined (1 more issues))";

  const response = await client.callTool({
    name: "compare_process_captures",
    arguments: { left: capture, right: mixed },
  });
  expect(parseMcpToolError(response)).toMatchObject({
    error: {
      code: "evidence_integrity_mismatch",
      message: expect.stringContaining(
        `The right Evidence has an invalid process capture result ${described}`,
      ),
    },
  });
  expect(await compareViaCli(capture, mixed)).toMatchObject({
    code: "invalid_request",
    category: "invalid_input",
    message: expect.stringContaining(
      `Capture evidence is malformed ${described}`,
    ),
  });
});
