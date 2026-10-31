import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import {
  McpServer,
  STDIO_DEFAULT_MAX_BUFFER_SIZE,
} from "@modelcontextprotocol/server";

import { ProcessCaptureError } from "../../../src/process/capture/ProcessCaptureError.js";
import {
  resolveProcessResult,
  type ProcessCaptureCleanupOutcome,
} from "../../../src/process/capture/ProcessCaptureLifecycle.js";
import { toolContract } from "../../../src/contracts/toolContracts.js";
import type { ToolContract } from "../../../src/contracts/toolContractTypes.js";
import { err } from "../../../src/domain/result.js";
import { EvidenceIntegrityError } from "../../../src/domain/evidenceErrors.js";
import { HopperProcessError } from "../../../src/domain/hopperErrors.js";
import { processScenarioSchema } from "../../../src/domain/process/processScenario.js";
import { createToolResultDelivery } from "../../../src/server/toolResult.js";
import { createEvidence, parseEvidence } from "../../../src/domain/evidence.js";
import {
  accountFullyObservedProcessCapture,
  emptyProcessCapture,
} from "../../../src/domain/process/processCapture.fixture.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { evidenceResultOf } from "../../../src/contracts/toolOutputSchemaPrimitives.js";
import { toolRegistrationOptions } from "../../../src/server/toolRegistrationOptions.js";

import type {
  IncompleteProcessCaptureObservations,
  ProcessCaptureCleanupReport,
} from "../../../src/domain/process/processCapture.js";
const delivery = createToolResultDelivery(STDIO_DEFAULT_MAX_BUFFER_SIZE);
const UNTRUSTED_TARGET_CONTENT = {
  provenance: { untrusted_content: true, source: "analysis_target" },
};
const emptyFilesystemCoverage =
  emptyProcessCapture().truncation_details.filesystem_before;
const historicalCleanupOutcome = (
  report: ProcessCaptureCleanupReport,
): ProcessCaptureCleanupOutcome => ({ report, cleanupLease: undefined });

const captureWithObservedOutput = () =>
  accountFullyObservedProcessCapture({
    ...emptyProcessCapture(),
    frames: [{ sequence: 0, at_ms: 0, data: "observed output" }],
    event_journal: [],
  });

const contract: ToolContract = {
  name: "provider_neutral_fixture",
  title: "Provider Neutral Fixture",
  description: "Fixture contract for provider-neutral output validation.",
  kind: "enhanced",
  inputSchema: z.object({}),
  outputSchema: z.object({ value: z.string() }),
  effects: {
    mutatesTarget: false,
    mutatesSession: false,
    writesFilesystem: false,
    launchesProcess: false,
    accessesNetwork: false,
    changesUiState: false,
    mayDiscardData: false,
    executesForeignCode: false,
    mutatesDevice: false,
    idempotent: true,
  },
  annotations: {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
  },
  returnsTargetContent: false,
  examples: [{ title: "Example fixture request", input: {} }],
};

describe("completed partial process capture MCP projection", () => {
  it("preserves observations when execution fails after cleanup succeeds", () => {
    const cleanup = {
      owned_process_group: { state: "cleaned" as const, reason: null },
      terminal_renderer: { state: "cleaned" as const, reason: null },
      temporary_root: { state: "cleaned" as const, reason: null },
    };
    const capture = captureWithObservedOutput();
    let failure: ProcessCaptureError | undefined;
    try {
      resolveProcessResult(
        capture,
        new Error("final filesystem snapshot failed"),
        historicalCleanupOutcome(cleanup),
      );
    } catch (cause: unknown) {
      if (!(cause instanceof ProcessCaptureError)) throw cause;
      failure = cause;
    }
    if (failure === undefined)
      throw new Error("expected process capture failure");

    const result = delivery.toCallToolResult(
      err(failure),
      toolContract("capture_process_scenario"),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "process_capture_failed",
        details: {
          cleanup_report: cleanup,
          execution_failure: "final filesystem snapshot failed",
          partial_observation: {
            capture: {
              frames: [{ data: "observed output" }],
              settlement: { cleanup_outcome: "not_required" },
            },
            execution_failure: "final filesystem snapshot failed",
          },
        },
      },
    });
    // The partial observation carries terminal output from the target.
    expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
  });

  it("preserves partial capture details over the MCP SDK transport", async () => {
    const executionFailure = new Error("capture ended after a fixture error");
    const cleanup = {
      owned_process_group: {
        state: "unverified" as const,
        reason: "process ownership token could not be read",
      },
      terminal_renderer: { state: "cleaned" as const, reason: null },
      temporary_root: { state: "cleaned" as const, reason: null },
    };
    const capture = captureWithObservedOutput();

    let failure: ProcessCaptureError | undefined;
    try {
      resolveProcessResult(
        capture,
        executionFailure,
        historicalCleanupOutcome(cleanup),
      );
    } catch (cause: unknown) {
      if (!(cause instanceof ProcessCaptureError)) throw cause;
      failure = cause;
    }
    expect(failure).toBeDefined();
    if (failure === undefined)
      throw new Error("expected cleanup-incomplete result");

    const captureContract = toolContract("capture_process_scenario");
    const server = new McpServer({
      name: "process-partial-error",
      version: "1",
    });
    server.registerTool(
      captureContract.name,
      toolRegistrationOptions(captureContract),
      async () => delivery.toCallToolResult(err(failure), captureContract),
    );
    const client = new Client({
      name: "process-partial-error-client",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: captureContract.name,
        arguments: captureContract.examples[0]?.input ?? {},
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          code: "cleanup_incomplete",
          details: {
            cleanup_report: cleanup,
            execution_failure: "capture ended after a fixture error",
            partial_observation: {
              capture: {
                frames: [{ data: "observed output" }],
                settlement: { cleanup_outcome: "failed" },
              },
              execution_failure: "capture ended after a fixture error",
            },
          },
        },
      });
      const textContent = result.content.find((block) => block.type === "text");
      expect(textContent?.type === "text" ? textContent.text : undefined).toBe(
        JSON.stringify(result.structuredContent),
      );
      expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe("incomplete partial process observations MCP projection", () => {
  it("preserves normalized raw observations over the MCP SDK transport", async () => {
    const captureContract = toolContract("capture_process_scenario");
    const example = captureContract.examples[0];
    if (example === undefined)
      throw new Error("missing process scenario example");
    const scenario = processScenarioSchema.parse({
      ...example.input,
      normalization: { pids: false },
    });
    const rootPid = 45678;
    const cleanup = {
      owned_process_group: {
        state: "unverified" as const,
        reason: "process ownership token could not be read",
      },
      terminal_renderer: { state: "cleaned" as const, reason: null },
      temporary_root: { state: "cleaned" as const, reason: null },
    };
    const observations: IncompleteProcessCaptureObservations = {
      target_pid: { state: "available", value: rootPid },
      frames: {
        state: "available",
        value: [{ sequence: 0, at_ms: 0, data: "partial output" }],
      },
      rendered_frames: {
        state: "unavailable",
        reason: "fixture renderer observation unavailable",
      },
      interaction_events: { state: "available", value: [] },
      exit: {
        state: "unavailable",
        reason: "fixture terminal exit unavailable",
      },
      settlement: {
        state: "unavailable",
        reason: "fixture process settlement unavailable",
      },
      process_samples: {
        state: "available",
        value: [
          {
            at_ms: 1,
            pid: rootPid,
            parent_pid: 1,
            command: `fixture ${String(rootPid)}`,
            process_group_id: rootPid,
            session_id: rootPid,
          },
        ],
      },
      filesystem_snapshots: {
        before: {
          state: "available",
          value: {
            files: [],
            truncated: false,
            completeRoots: [],
            coverage: emptyFilesystemCoverage,
          },
        },
        after: {
          state: "unavailable",
          reason: "fixture final snapshot unavailable",
        },
      },
      event_journal: { state: "available", value: [] },
      manifest: {
        state: "unavailable",
        reason: "fixture capture manifest unavailable",
      },
    };

    let failure: ProcessCaptureError | undefined;
    try {
      resolveProcessResult(
        undefined,
        new Error("capture failed before completion"),
        historicalCleanupOutcome(cleanup),
        observations,
        { scenario, rootPid },
      );
    } catch (cause: unknown) {
      if (!(cause instanceof ProcessCaptureError)) throw cause;
      failure = cause;
    }
    if (failure === undefined)
      throw new Error("expected cleanup-incomplete result");

    const server = new McpServer({
      name: "process-partial-observations",
      version: "1",
    });
    server.registerTool(
      captureContract.name,
      toolRegistrationOptions(captureContract),
      async () => delivery.toCallToolResult(err(failure), captureContract),
    );
    const client = new Client({
      name: "process-partial-observations-client",
      version: "1",
    });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    try {
      await server.connect(serverTransport);
      await client.connect(clientTransport);
      const result = await client.callTool({
        name: captureContract.name,
        arguments: example.input,
      });

      expect(result.isError).toBe(true);
      expect(result.structuredContent).toMatchObject({
        error: {
          details: {
            partial_observation: {
              observations: {
                target_pid: { state: "available", value: rootPid },
                frames: {
                  state: "available",
                  value: [{ data: "partial output" }],
                },
                process_samples: {
                  state: "available",
                  value: [{ pid: rootPid }],
                },
              },
            },
          },
        },
      });
    } finally {
      await Promise.all([client.close(), server.close()]);
    }
  });
});

describe("tool result projection", () => {
  it("exposes an actionable adapter code to MCP callers", () => {
    const result = delivery.toCallToolResult(
      err(new HopperProcessError(76)),
      contract,
    );
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "provider_unavailable",
        details: { failure_code: "unsupported_demo_dialog" },
        category: "unavailable",
      },
    });
  });
  it("keeps an absent post-authentication dialog out of publisher verification", () => {
    const result = delivery.toCallToolResult(
      err(new HopperProcessError(81)),
      contract,
    );
    expect(result.structuredContent).toMatchObject({
      error: {
        code: "provider_unavailable",
        details: { failure_code: "demo_dialog_absent", exit_code: 81 },
        category: "unavailable",
      },
    });
    expect(
      (result.structuredContent as { error: { details: unknown } }).error
        .details,
    ).not.toHaveProperty("launch_rejection");
  });
  it("projects bounded private-display coordinates without raw stderr", () => {
    const result = delivery.toCallToolResult(
      err(
        new HopperProcessError(80, {
          diagnostic: {
            component: "hopper_private_display",
            operation: "launch",
            status: "error",
            failure_code: "x11_socket_directory_unusable",
            reason: "socket_directory_read_only",
            socket_directory: "/tmp/.X11-unix",
            socket_directory_mode: "0777",
            mount_read_only: true,
            effective_socket_directory_mode: "1777",
            effective_mount_read_only: false,
            wsl: true,
            strategy: "user-mount-namespace",
            fallback_reason: null,
            xvfb_stderr_bytes: 512,
          },
        }),
      ),
      contract,
    );
    expect(result.structuredContent).toMatchObject({
      error: {
        details: {
          failure_code: "x11_socket_directory_unusable",
          diagnostics: {
            socket_directory: "/tmp/.X11-unix",
            mount_read_only: true,
            wsl: true,
            strategy: "user-mount-namespace",
          },
        },
      },
    });
  });
  it("returns one complete Evidence record with its typed normalized result", () => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Fixture", version: "1" },
      {
        operation: "fixture",
        parameters: {},
        result: { value: "observed" },
      },
    );
    const evidenceContract: ToolContract = {
      ...contract,
      outputSchema: evidenceResultOf(z.object({ value: z.string() })),
    };

    const result = delivery.toEvidenceToolResult(
      evidence,
      evidenceContract,
      undefined,
    );
    expect(result.structuredContent).toEqual(evidence);
    expect(result.structuredContent).not.toHaveProperty("result");
    expect(result.structuredContent).not.toHaveProperty("evidence");
    expect(result.content[0]).toMatchObject({
      type: "text",
      text: expect.stringContaining('"value":"observed"'),
    });
    const parsed = evidenceContract.outputSchema.parse(
      result.structuredContent,
    );
    expect(parseEvidence(parsed)).toEqual(evidence);
  });

  it.each<JsonValue>([null, false, 0, "", [], { nested: [false, null, 7] }])(
    "preserves a complete reusable Evidence record for JSON result %j",
    (value) => {
      const evidence = createEvidence(
        undefined,
        { id: "fixture", name: "Fixture", version: "1" },
        { operation: "fixture", parameters: {}, result: value },
      );
      const evidenceContract = {
        ...contract,
        outputSchema: evidenceResultOf(z.json()),
      };
      const result = delivery.toEvidenceToolResult(
        evidence,
        evidenceContract,
        undefined,
      );
      const parsed = evidenceContract.outputSchema.parse(
        result.structuredContent,
      );
      expect(parsed.normalized_result).toEqual(value);
      expect(parseEvidence(parsed)).toEqual(evidence);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify(parsed) },
      ]);
      const { normalized_result: _missingResult, ...incomplete } = evidence;
      expect(evidenceContract.outputSchema.safeParse(incomplete).success).toBe(
        false,
      );
    },
  );
});

describe("untrusted provenance on failed tool results", () => {
  const failure = () => new HopperProcessError(76);

  it("marks an error from a target-content tool", () => {
    const targetContract = toolContract("procedure_pseudo_code");
    expect(targetContract.returnsTargetContent).toBe(true);
    const result = delivery.toCallToolResult(err(failure()), targetContract);
    expect(result.isError).toBe(true);
    expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    expect(delivery.toErrorToolResult(failure(), true)._meta).toEqual(
      UNTRUSTED_TARGET_CONTENT,
    );
  });

  it("leaves an error from a content-free tool unmarked", () => {
    const recordContract = toolContract("record_unknown");
    expect(recordContract.returnsTargetContent).toBe(false);
    const result = delivery.toCallToolResult(err(failure()), recordContract);
    expect(result.isError).toBe(true);
    expect(result._meta).toBeUndefined();
    expect(delivery.toErrorToolResult(failure(), false)._meta).toBeUndefined();
  });

  it("marks a recorded partial-observation error and its retention fallback", () => {
    const evidence = createEvidence(
      undefined,
      { id: "fixture", name: "Partial observation fixture", version: "1" },
      { operation: "fixture", parameters: {}, result: { observed: true } },
    );
    const original = failure().retainPartialObservation(evidence);
    const recorded = delivery.toPartialErrorToolResult(original, true, () => ({
      ok: true,
      value: "added",
    }));
    expect(recorded.structuredContent).toMatchObject({
      error: {
        details: {
          partial_observation: {
            kind: "retained-evidence",
            evidence_id: evidence.evidence_id,
          },
        },
      },
    });
    expect(recorded._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    const unrecorded = delivery.toPartialErrorToolResult(original, true, () =>
      err(new EvidenceIntegrityError("fixture rejects partial")),
    );
    expect(unrecorded.structuredContent).toMatchObject({
      error: { details: { partial_observation: evidence } },
    });
    expect(unrecorded._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
    expect(original.partialObservation).toBe(evidence);
  });

  it("marks the response-budget error that replaces an oversized target-content result", () => {
    const small = createToolResultDelivery(4096);
    const result = small.toCallToolResult(
      { ok: true, value: { text: "x".repeat(8192) } },
      toolContract("procedure_pseudo_code"),
    );
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toMatchObject({
      error: { code: "resource_constraint" },
    });
    expect(result._meta).toEqual(UNTRUSTED_TARGET_CONTENT);
  });
});
