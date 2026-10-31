import { ok as resultOk } from "../../../src/domain/result.js";
import { rm, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { INLINE_EVIDENCE_MCP_ENVIRONMENT } from "../../../scripts/lib/mcp-verification-environment.mjs";
import { afterEach, describe, expect, it } from "vitest";

import { createTestBinarySession } from "../../fixtures/binarySession.js";
import type { AnalysisClient } from "../../../src/application/AnalysisProvider.js";
import { compareProcessEvidenceFiles } from "../../../src/application/process/ProcessCli.js";
import { PROCESS_PROVIDER } from "../../../src/domain/process/processEvidenceProvider.js";
import { processTraceCaptureFixture } from "../../../src/domain/process/processCapture.fixture.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";

import { createServer } from "../../../src/server/createServer.js";
import { observed as ok } from "../../fixtures/analysisExecution.js";
import { createTestTempDirectory } from "../../fixtures/temporaryDirectory.js";

const resources: Array<{ close(): Promise<void> }> = [];
const temporaryRoots: string[] = [];
const { capture, traceSpecification } = processTraceCaptureFixture();

const captureEvidence = (side: "left" | "right") =>
  createEvidence(undefined, PROCESS_PROVIDER, {
    predicateType: "rea.process-capture",
    operation: "capture_process_scenario",
    parameters: { side },
    result: capture,
    confidence: "observed",
    authority: "controlled-replay",
    locations: [{ kind: "artifact-path", path: `/fixture/${side}` }],
  });

const comparisonClient = async (
  left: ReturnType<typeof captureEvidence>,
  right: ReturnType<typeof captureEvidence>,
) => {
  const session = createTestBinarySession(
    (_path) =>
      ({
        execute: () => Promise.resolve(ok(null)),
        close: () => Promise.resolve(resultOk(null)),
      }) satisfies AnalysisClient,
  );
  expect(session.recordEvidence(left).ok).toBe(true);
  expect(session.recordEvidence(right).ok).toBe(true);
  const server = createServer(
    { kind: "session", session },
    { environment: { ...process.env, ...INLINE_EVIDENCE_MCP_ENVIRONMENT } },
  );
  const client = new Client({ name: "trace-parity", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push(client, server);
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("declared trace adapter parity", () => {
  it("returns identical CLI and MCP results and Evidence identity", async () => {
    const left = captureEvidence("left");
    const right = captureEvidence("right");
    const root = await createTestTempDirectory("rea-trace-adapters-");
    temporaryRoots.push(root);
    const leftPath = join(root, "left.json");
    const rightPath = join(root, "right.json");
    const specificationPath = join(root, "trace.json");
    await Promise.all([
      writeFile(leftPath, JSON.stringify(left)),
      writeFile(rightPath, JSON.stringify(right)),
      writeFile(specificationPath, JSON.stringify(traceSpecification)),
    ]);
    const cliEvidence = parseEvidence(
      await compareProcessEvidenceFiles(leftPath, rightPath, specificationPath),
    );
    const client = await comparisonClient(left, right);
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: {
        left,
        right,
        trace_spec: traceSpecification,
      },
    });
    expect(response.isError).not.toBe(true);
    expect(response.structuredContent).toMatchObject({
      normalized_result: { trace: { verdict: "equivalent" } },
      evidence_id: cliEvidence.evidence_id,
    });
    const structuredResult =
      typeof response.structuredContent === "object" &&
      response.structuredContent !== null
        ? Reflect.get(response.structuredContent, "normalized_result")
        : undefined;
    expect(structuredResult).toEqual(cliEvidence.normalized_result);
    expect(cliEvidence.locations).toEqual([
      { kind: "artifact-path", path: "/fixture/left" },
      { kind: "artifact-path", path: "/fixture/right" },
    ]);
  });

  it("reports one complete missing-pair diagnostic through CLI and MCP", async () => {
    const left = captureEvidence("left");
    const right = captureEvidence("right");
    const incompleteSpecification = {
      events: Array.from({ length: 200 }, (_, index) => ({
        id: `e${String(index)}`,
        source: "lifecycle",
        exact: { fixture: index },
        cardinality: { kind: "optional" },
      })),
      language: { kind: "partial_order" },
    };
    const root = await createTestTempDirectory("rea-trace-diagnostics-");
    temporaryRoots.push(root);
    const leftPath = join(root, "left.json");
    const rightPath = join(root, "right.json");
    const specificationPath = join(root, "trace.json");
    await Promise.all([
      writeFile(leftPath, JSON.stringify(left)),
      writeFile(rightPath, JSON.stringify(right)),
      writeFile(specificationPath, JSON.stringify(incompleteSpecification)),
    ]);
    const message =
      "19900 event pairs must be explicitly ordered or unordered; first undeclared pair: e0/e1";
    const cli = await compareProcessEvidenceFiles(
      leftPath,
      rightPath,
      specificationPath,
    );
    expect(cli).toMatchObject({
      category: "invalid_input",
      details: {
        issues: [{ path: ["trace_spec", "language"], message }],
      },
    });
    const client = await comparisonClient(left, right);
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right, trace_spec: incompleteSpecification },
    });
    expect(response.isError).toBe(true);
    const text = response.content
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n");
    expect(text).toContain(message);
    expect(text.match(/first undeclared pair/g)).toHaveLength(1);
    await client.ping();
  });

  it("rejects a variant that only reorders unordered members through CLI and MCP", async () => {
    const left = captureEvidence("left");
    const right = captureEvidence("right");
    const reorderedSpecification = {
      ...traceSpecification,
      language: {
        kind: "finite_traces",
        variants: [
          {
            id: "forward",
            trace: ["before", { unordered: ["exit", "settlement"] }, "after"],
          },
          {
            id: "reverse",
            trace: ["before", { unordered: ["settlement", "exit"] }, "after"],
          },
        ],
      },
    };
    const root = await createTestTempDirectory("rea-trace-duplicates-");
    temporaryRoots.push(root);
    const leftPath = join(root, "left.json");
    const rightPath = join(root, "right.json");
    const specificationPath = join(root, "trace.json");
    await Promise.all([
      writeFile(leftPath, JSON.stringify(left)),
      writeFile(rightPath, JSON.stringify(right)),
      writeFile(specificationPath, JSON.stringify(reorderedSpecification)),
    ]);
    const message = "finite trace variants must not duplicate a trace";
    expect(
      await compareProcessEvidenceFiles(leftPath, rightPath, specificationPath),
    ).toMatchObject({
      category: "invalid_input",
      details: {
        issues: [
          { path: ["trace_spec", "language", "variants", 1, "trace"], message },
        ],
      },
    });
    const client = await comparisonClient(left, right);
    const response = await client.callTool({
      name: "compare_process_captures",
      arguments: { left, right, trace_spec: reorderedSpecification },
    });
    expect(response.isError).toBe(true);
    expect(
      response.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n"),
    ).toContain(message);
  });
});
