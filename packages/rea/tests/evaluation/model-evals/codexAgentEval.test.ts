import { describe, expect, it } from "vitest";

import { createEvidence } from "../../../src/domain/evidence.js";
import type { JsonValue } from "../../../src/domain/jsonValue.js";
import { evaluateCodexEvents } from "./CodexAgentEval.js";

const observation = (
  operation = "inspect_managed_artifact",
  result: JsonValue = { observed: true },
  evidenceLinks: readonly string[] = [],
) =>
  createEvidence(
    { path: "/tmp/app.dll", sha256: "1".repeat(64), format: "pe" },
    { id: "managed", name: "Managed static analysis", version: null },
    {
      operation,
      parameters: {},
      result,
      evidenceLinks,
      authority: "shipped-artifact",
    },
  );

const citationMetrics = (
  result: unknown,
  evidenceId: string,
  tool = "inspect_managed_artifact",
) =>
  evaluateCodexEvents(
    [
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          status: "completed",
          server: "rea",
          tool,
          arguments: {},
          result,
        },
      },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `Observed artifact evidence ${evidenceId} is cited here; runtime behavior remains unknown because no runtime authority was supplied.`,
        },
      },
    ],
    tool,
    { requireEvidence: true },
  );

describe("Codex agent release evaluation", () => {
  it("measures natural routing, repeated calls, tokens, and answer heuristics", () => {
    const call = {
      id: "item-tool-1",
      type: "mcp_tool_call",
      server: "rea",
      tool: "analyze_javascript_application",
      arguments: { input_path: "/tmp/app" },
    };
    const metrics = evaluateCodexEvents(
      [
        { type: "item.completed", item: call },
        { type: "item.completed", item: call },
        {
          type: "item.completed",
          item: {
            id: "item-message-1",
            type: "agent_message",
            text: "The observed artifact evidence identifies one preload API. Runtime reachability remains unknown because no runtime authority was available.",
          },
        },
        {
          type: "turn.completed",
          usage: {
            input_tokens: 12_345,
            cached_input_tokens: 10_000,
            output_tokens: 321,
          },
        },
      ],
      "analyze_javascript_application",
    );

    expect(metrics).toMatchObject({
      naturalUse: true,
      correctFirstTool: true,
      firstTool: "analyze_javascript_application",
      repeatedCallCount: 0,
      inputTokens: 12_345,
      cachedInputTokens: 10_000,
      outputTokens: 321,
      answerHeuristicsMet: true,
      epistemicCuePresent: true,
    });
    expect(metrics.reaCalls).toHaveLength(1);
  });

  it("requires the final answer to cite produced Evidence when requested", () => {
    const evidence = observation();
    const evidenceId = evidence.evidence_id;
    const events = [
      {
        type: "item.completed",
        item: {
          id: "item-tool",
          type: "mcp_tool_call",
          server: "rea",
          tool: "inspect_managed_artifact",
          arguments: { path: "/tmp/app.dll" },
          result: { structuredContent: evidence },
        },
      },
      {
        type: "item.completed",
        item: {
          type: "agent_message",
          text: `The observed managed metadata is supported by evidence ${evidenceId}; runtime behavior remains unknown without runtime authority.`,
        },
      },
    ];

    expect(
      evaluateCodexEvents(events, "inspect_managed_artifact", {
        requireEvidence: true,
      }),
    ).toMatchObject({
      evidenceIds: [evidenceId],
      finalCitesEvidence: true,
      answerHeuristicsMet: true,
    });
  });
});

describe("Codex completed tool call parsing", () => {
  it("does not let an unfinished direct event reserve a completed call identity", () => {
    const evidence = observation();
    const metrics = evaluateCodexEvents(
      [
        {
          type: "mcp_tool_call",
          id: "same-call",
          status: "in_progress",
          server: "rea",
          tool: evidence.operation,
          arguments: {},
        },
        {
          type: "item.completed",
          item: {
            id: "same-call",
            type: "mcp_tool_call",
            status: "completed",
            server: "rea",
            tool: evidence.operation,
            arguments: {},
            result: { structuredContent: evidence },
          },
        },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: `Observed Evidence ${evidence.evidence_id} supports the artifact claim; runtime behavior remains unknown without runtime authority.`,
          },
        },
      ],
      evidence.operation,
      { requireEvidence: true },
    );

    expect(metrics).toMatchObject({
      naturalUse: true,
      correctFirstTool: true,
      reaCalls: [{ id: "same-call" }],
      evidenceIds: [evidence.evidence_id],
      finalCitesEvidence: true,
      answerHeuristicsMet: true,
    });
  });

  it.each([
    { server: "rea", server_name: "other" },
    { tool: "inspect_managed_artifact", name: "other_tool" },
    { server: 42 },
    { arguments: { value: 1 }, input: { value: 2 } },
  ])(
    "rejects completed calls with invalid or conflicting fields: %j",
    (aliases) => {
      const evidence = observation();
      const metrics = evaluateCodexEvents(
        [
          {
            type: "item.completed",
            item: {
              type: "mcp_tool_call",
              status: "completed",
              server: "rea",
              tool: evidence.operation,
              arguments: {},
              result: { structuredContent: evidence },
              ...aliases,
            },
          },
        ],
        evidence.operation,
        { requiredToolSubsequence: [evidence.operation] },
      );

      expect(metrics).toMatchObject({
        naturalUse: false,
        correctFirstTool: false,
        requiredToolSubsequenceMet: false,
        evidenceIds: [],
      });
    },
  );

  it.each([
    {
      label: "missing server identity",
      identity: {},
      routed: false,
    },
    {
      label: "another server",
      identity: { server: "other" },
      routed: false,
    },
    {
      label: "verified REA alias",
      identity: { server_name: "rea" },
      routed: true,
    },
  ])("routes only $label calls", ({ identity, routed }) => {
    const metrics = evaluateCodexEvents(
      [
        {
          type: "item.completed",
          item: {
            type: "mcp_tool_call",
            status: "completed",
            tool: "inspect_managed_artifact",
            arguments: {},
            ...identity,
          },
        },
      ],
      "inspect_managed_artifact",
      { requiredToolSubsequence: ["inspect_managed_artifact"] },
    );

    expect(metrics).toMatchObject({
      naturalUse: routed,
      correctFirstTool: routed,
      firstTool: routed ? "inspect_managed_artifact" : null,
      requiredToolSubsequenceMet: routed,
      reaCalls: routed ? [{ server: "rea" }] : [],
    });
  });
});

describe("Codex Evidence delivery", () => {
  it("rejects diagnostic IDs and failed results as delivered Evidence", () => {
    const evidenceId = `ev_${"a".repeat(64)}`;
    for (const result of [
      { content: [{ type: "text", text: `diagnostic: ${evidenceId}` }] },
      { evidence_id: evidenceId },
      { structuredContent: { metadata: { evidence_id: evidenceId } } },
      {
        isError: true,
        content: [
          {
            type: "text",
            text: JSON.stringify({ error: { message: evidenceId } }),
          },
        ],
      },
    ]) {
      expect(citationMetrics(result, evidenceId)).toMatchObject({
        evidenceIds: [],
        finalCitesEvidence: false,
        answerHeuristicsMet: false,
      });
    }
  });

  it("accepts complete text-only Evidence while rejecting truncated and tampered copies", () => {
    const evidence = observation();
    const text = JSON.stringify(evidence);
    const textResult = (value: string) => ({
      content: [{ type: "text", text: value }],
      structured_content: null,
    });
    expect(
      citationMetrics(textResult(text), evidence.evidence_id),
    ).toMatchObject({
      evidenceIds: [evidence.evidence_id],
      finalCitesEvidence: true,
      answerHeuristicsMet: true,
    });
    for (const result of [
      textResult(text.slice(0, -1)),
      textResult(
        JSON.stringify({
          ...evidence,
          normalized_result: { fabricated: true },
        }),
      ),
      textResult(
        text.replace(
          `"evidence_id":`,
          `"evidence_id":"${evidence.evidence_id}","evidence_id":`,
        ),
      ),
    ]) {
      expect(citationMetrics(result, evidence.evidence_id).evidenceIds).toEqual(
        [],
      );
    }
  });

  it("retains authenticated nested inspection Evidence without accepting bare or tampered links", () => {
    const nested = observation("inventory_artifact");
    const substep = {
      status: "completed",
      operation: nested.operation,
      evidence_id: nested.evidence_id,
      evidence: nested,
    };
    const inspection = observation(
      "inspect_artifact",
      { substeps: [substep] },
      [nested.evidence_id],
    );
    expect(
      citationMetrics(
        { structuredContent: inspection },
        nested.evidence_id,
        "inspect_artifact",
      ),
    ).toMatchObject({
      evidenceIds: [inspection.evidence_id, nested.evidence_id],
      finalCitesEvidence: true,
    });
    for (const [step, links] of [
      [substep, []],
      [
        {
          ...substep,
          evidence: { ...nested, normalized_result: { fabricated: true } },
        },
        [nested.evidence_id],
      ],
      [{ ...substep, operation: "other_tool" }, [nested.evidence_id]],
      [
        { ...substep, evidence_id: `ev_${"b".repeat(64)}` },
        [nested.evidence_id],
      ],
    ] as const) {
      const parent = observation(
        "inspect_artifact",
        { substeps: [step] },
        links,
      );
      expect(
        citationMetrics(
          { structuredContent: parent },
          nested.evidence_id,
          "inspect_artifact",
        ),
      ).toMatchObject({
        evidenceIds: [parent.evidence_id],
        finalCitesEvidence: false,
      });
    }
  });
});

describe("Codex request accounting", () => {
  it("flags identical calls with distinct item identities", () => {
    const event = (id: string) => ({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "rea",
        tool: "binary_session",
        arguments: {},
      },
    });

    expect(
      evaluateCodexEvents([event("item-1"), event("item-2")], "binary_session")
        .repeatedCallCount,
    ).toBe(1);
  });

  it("distinguishes session verification after a successful close from an unchanged retry", () => {
    const call = (id: string, tool: string, status = "completed") => ({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "rea",
        tool,
        arguments: {},
        status,
      },
    });
    for (const [status, repeats] of [
      ["completed", 0],
      ["failed", 1],
    ] as const) {
      expect(
        evaluateCodexEvents(
          [
            call("before", "binary_session"),
            call("close", "close_binary", status),
            call("after", "binary_session"),
          ],
          "binary_session",
        ).repeatedCallCount,
      ).toBe(repeats);
    }
  });

  it("counts identical arguments with reversed Unicode key insertion order", () => {
    const call = (id: string, arguments_: Record<string, number>) => ({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "rea",
        tool: "inspect_artifact",
        arguments: arguments_,
      },
    });

    expect(
      evaluateCodexEvents(
        [
          call("item-1", { "e\u0301": 1, "\u00e9": 2 }),
          call("item-2", { "\u00e9": 2, "e\u0301": 1 }),
        ],
        "inspect_artifact",
      ).repeatedCallCount,
    ).toBe(1);
  });
});

describe("Codex agent routing and error evaluation", () => {
  it("preserves an unrecognized structured failure without inventing its code", () => {
    const metrics = evaluateCodexEvents(
      [
        {
          type: "item.completed",
          item: {
            type: "mcp_tool_call",
            server: "rea",
            tool: "close_binary",
            arguments: {},
            result: { structured_content: { error: "unrecognized failure" } },
          },
        },
      ],
      "close_binary",
      { requiredToolSubsequence: ["close_binary"] },
    );
    expect(metrics.reaCalls[0]).toMatchObject({ error: true, errorCode: null });
    expect(metrics.requiredToolSubsequenceMet).toBe(false);
  });

  it.each(["failed", undefined])(
    "preserves failure without choosing duplicate JSON error codes with status %s",
    (status) => {
      const texts = [
        '{"error":{"code":"bridge_timeout","code":"invalid_request"}}',
        '{"error":{"code":"invalid_request","code":"bridge_timeout"}}',
        '{"error":{"code":"bridge_timeout"},"error":{"code":"invalid_request"}}',
        '{"error":{"code":"invalid_request"}}',
      ];
      const metrics = evaluateCodexEvents(
        texts.map((text, index) => ({
          type: "item.completed",
          item: {
            id: `failure-${String(index)}`,
            type: "mcp_tool_call",
            server: "rea",
            tool: "close_binary",
            arguments: {},
            ...(status === undefined ? {} : { status }),
            result: { content: [{ type: "text", text }] },
          },
        })),
        "close_binary",
      );
      expect(
        metrics.reaCalls.map(({ error, errorCode, evidenceIds }) => ({
          error,
          errorCode,
          evidenceIds,
        })),
      ).toEqual([
        { error: true, errorCode: null, evidenceIds: [] },
        { error: true, errorCode: null, evidenceIds: [] },
        { error: true, errorCode: null, evidenceIds: [] },
        { error: true, errorCode: "invalid_request", evidenceIds: [] },
      ]);
      expect(metrics.inputValidationFailureCount).toBe(1);
    },
  );

  it("requires no REA call when target selection is missing", () => {
    const events = [
      {
        type: "item.completed",
        item: { type: "agent_message", text: "Which app should I inspect?" },
      },
    ];
    expect(evaluateCodexEvents(events, null)).toMatchObject({
      naturalUse: false,
      correctFirstTool: true,
      firstTool: null,
    });
    expect(
      evaluateCodexEvents(
        [
          ...events,
          {
            type: "item.completed",
            item: {
              type: "mcp_tool_call",
              server: "rea",
              tool: "analyze_javascript_application",
              arguments: { input_path: "/nearby/test-fixture" },
            },
          },
        ],
        null,
      ).correctFirstTool,
    ).toBe(false);
  });

  it("counts actual text-only REA errors and SDK-rejected schema inputs once per call", () => {
    const source = {
      kind: "retained-evidence",
      evidence_id: `ev_${"a".repeat(64)}`,
    };
    const failed = (id: string, arguments_: unknown, text: string) => ({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "rea",
        tool: "inspect_analysis_view",
        arguments: arguments_,
        status: "failed",
        error: null,
        result: { content: [{ type: "text", text }], structured_content: null },
      },
    });
    const metrics = evaluateCodexEvents(
      [
        failed(
          "sdk",
          { source, view: { kind: "module", path: "main.js" } },
          "Input validation error: Invalid arguments for tool inspect_analysis_view: view.kind: Invalid discriminator value.",
        ),
        failed(
          "ambiguous",
          {
            source,
            view: {
              kind: "item",
              collection: "modules",
              selector: { path: "main.js" },
            },
          },
          JSON.stringify({
            error: {
              code: "invalid_request",
              message:
                "Multiple modules have this path; select one by node_id.",
            },
          }),
        ),
        failed(
          "incomplete-preview",
          { source, view: { kind: "summary" } },
          '{"error":{"code":"invalid_request"',
        ),
      ],
      "inspect_analysis_view",
    );
    expect(metrics.inputValidationFailureCount).toBe(2);
    expect(metrics.reaCalls.map(({ errorCode }) => errorCode)).toEqual([
      null,
      "invalid_request",
      null,
    ]);
  });
});

describe("Codex agent completion evaluation", () => {
  it("does not present matching answer terms as factual correctness or honesty", () => {
    const evidence = observation("analyze_javascript_application");
    const evidenceId = evidence.evidence_id;
    const metrics = evaluateCodexEvents(
      [
        {
          type: "item.completed",
          item: {
            id: "item-tool",
            type: "mcp_tool_call",
            server: "rea",
            tool: "analyze_javascript_application",
            arguments: { input_path: "/tmp/app.asar" },
            result: { structuredContent: evidence },
          },
        },
        {
          type: "item.completed",
          item: {
            type: "agent_message",
            text: `Observed evidence ${evidenceId}: profileAPI and profile:read do not exist; there is no preload or contextBridge. The application certainly uses quantum teleportation for all communications.`,
          },
        },
      ],
      "analyze_javascript_application",
      {
        requireEvidence: true,
        requiredAnswerTermGroups: [
          ["profileapi"],
          ["profile:read"],
          ["preload", "contextbridge"],
        ],
      },
    );

    expect(metrics).toMatchObject({
      finalCitesEvidence: true,
      answerTermCoverageMet: true,
      epistemicCuePresent: true,
      answerHeuristicsMet: true,
      factualCorrectness: "not_assessed",
    });
    expect(metrics).not.toHaveProperty("completionQuality");
    expect(metrics).not.toHaveProperty("authorityHonesty");
    expect(metrics).not.toHaveProperty("contentCriteriaMet");
  });

  it("requires scenario-specific answer terms when configured", () => {
    const event = (text: string) => [
      {
        type: "item.completed",
        item: {
          type: "mcp_tool_call",
          server: "rea",
          tool: "analyze_javascript_application",
          arguments: {},
        },
      },
      { type: "item.completed", item: { type: "agent_message", text } },
    ];
    const options = {
      requiredAnswerTermGroups: [["profileApi"], ["preload", "contextBridge"]],
    };

    expect(
      evaluateCodexEvents(
        event(
          "Observed evidence connects profileApi through the preload bridge; runtime behavior remains unknown without authority.",
        ),
        "analyze_javascript_application",
        options,
      ),
    ).toMatchObject({ answerTermCoverageMet: true, answerHeuristicsMet: true });
    expect(
      evaluateCodexEvents(
        event(
          "Observed artifact evidence is available, but application behavior remains unknown without more authority and detail.",
        ),
        "analyze_javascript_application",
        options,
      ),
    ).toMatchObject({
      answerTermCoverageMet: false,
      answerHeuristicsMet: false,
    });
  });

  it.each(["item.completed", "mcp_tool_call"] as const)(
    "counts a failed completed invocation from %s without delivering Evidence",
    (type) => {
      const item = {
        id: "item-failed",
        type: "mcp_tool_call",
        server: "rea",
        tool: "analyze_javascript_application",
        arguments: { input_path: "/tmp/app.asar" },
        result: { structured_content: { error: { code: "denied" } } },
        error: null,
        status: "failed",
      };
      const metrics = evaluateCodexEvents(
        [type === "item.completed" ? { type, item } : item],
        "analyze_javascript_application",
      );

      expect(metrics).toMatchObject({
        naturalUse: true,
        correctFirstTool: true,
        evidenceIds: [],
        reaCalls: [{ error: true }],
      });
    },
  );
});

describe("Codex agent workflow evaluation", () => {
  it("requires an ordered tool subsequence and rejects input validation failures", () => {
    const comparison = observation("compare_javascript_export_shapes");
    const evidenceId = comparison.evidence_id;
    const call = (
      id: string,
      tool: string,
      result: unknown = {
        structuredContent:
          tool === comparison.operation ? comparison : observation(tool),
      },
    ) => ({
      type: "item.completed",
      item: {
        id,
        type: "mcp_tool_call",
        server: "rea",
        tool,
        arguments: { id },
        result,
      },
    });
    const final = {
      type: "item.completed",
      item: {
        type: "agent_message",
        text: `Static inferred evidence ${evidenceId} shows depth: 1; runtime behavior remains unknown without controlled replay authority.`,
      },
    };
    const options = {
      requireEvidence: true,
      requiredToolSubsequence: [
        "analyze_javascript_application",
        "analyze_javascript_application",
        "compare_javascript_export_shapes",
      ],
      forbidInputValidationFailures: true,
    };
    const valid = evaluateCodexEvents(
      [
        call("left", "analyze_javascript_application"),
        call("right", "analyze_javascript_application"),
        call("compare", "compare_javascript_export_shapes"),
        final,
      ],
      "analyze_javascript_application",
      options,
    );
    expect(valid).toMatchObject({
      requiredToolSubsequenceMet: true,
      inputValidationFailureCount: 0,
      answerHeuristicsMet: true,
    });

    const invalid = evaluateCodexEvents(
      [
        call("left", "analyze_javascript_application"),
        call("bad", "compare_javascript_export_shapes", {
          structured_content: {
            error: { code: "invalid_request" },
          },
          isError: true,
        }),
        final,
      ],
      "analyze_javascript_application",
      options,
    );
    expect(invalid).toMatchObject({
      requiredToolSubsequenceMet: false,
      inputValidationFailureCount: 1,
      answerHeuristicsMet: false,
    });
  });
});
