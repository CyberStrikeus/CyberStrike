import { describe, expect, it } from "vitest";

import { evaluateCodexEvents } from "./CodexAgentEval.js";
import { agentEvaluationPassed } from "./AgentEvaluationReport.js";
import {
  MISSING_TARGET_SCENARIO,
  nativeProviderScenario,
} from "./AgentEvaluationScenarios.js";

const call = (id: string, tool: string, errorCode?: string) => ({
  type: "item.completed",
  item: {
    id,
    type: "mcp_tool_call",
    server: "rea",
    tool,
    arguments: tool === "open_binary" ? { path: "/bin/true" } : {},
    status: "completed",
    result:
      errorCode === undefined
        ? { content: [{ type: "text", text: "Operation completed." }] }
        : { isError: true, structuredContent: { error: { code: errorCode } } },
  },
});

const completion = (text: string) => [
  { type: "item.completed", item: { type: "agent_message", text } },
  { type: "turn.completed", usage: { input_tokens: 100, output_tokens: 30 } },
];

describe("native provider scenario", () => {
  const scenario = nativeProviderScenario("/bin/true");
  const opened = call("open", "open_binary");
  const closed = call("close", "close_binary");
  const unavailable = call("open", "open_binary", "provider_unavailable");

  it.each([
    ["expected provider refusal", [unavailable], "provider-unavailable"],
    ["opened session with cleanup", [opened, closed], "opened-and-closed"],
    ["unclosed session", [opened], "failed"],
    ["cleanup without acquisition", [unavailable, closed], "failed"],
    [
      "failed cleanup",
      [opened, call("close", "close_binary", "cleanup_incomplete")],
      "failed",
    ],
    [
      "unexpected provider error",
      [call("open", "open_binary", "configuration_invalid")],
      "failed",
    ],
    [
      "invalid request",
      [call("open", "open_binary", "invalid_request")],
      "failed",
    ],
    ["no attempted open", [], "failed"],
    [
      "second unclosed session",
      [opened, closed, call("reopen", "open_binary")],
      "failed",
    ],
  ] as const)(
    "grades %s through the transcript parser and release gate",
    (_, calls, expected) => {
      const final =
        expected === "provider-unavailable"
          ? "The native provider is unavailable, so no analysis session was opened. Static provider evidence remains unknown; the target was not executed."
          : "The returned static artifact evidence describes the selected native program. Runtime behavior remains unknown; the analysis session was closed.";
      const metrics = evaluateCodexEvents(
        [...calls, ...completion(final)],
        scenario.expectedFirstTool,
        scenario,
      );
      const outcome = scenario.assess(metrics);
      expect(outcome).toBe(expected);
      expect(
        agentEvaluationPassed({
          ...metrics,
          expectedFirstTool: scenario.expectedFirstTool,
          exitCode: 0,
          scenarioOutcomePassed: outcome !== "failed",
        }),
      ).toBe(expected !== "failed");
    },
  );
});

describe("missing-target scenario", () => {
  const answer = JSON.stringify({
    status: "needs_target",
    requested_input: "app_name_or_artifact_path",
    question: "Which app name or artifact path should I inspect?",
  });

  it("advertises and grades the same JSON-only clarification grammar", () => {
    expect(MISSING_TARGET_SCENARIO.prompt).toContain(
      "Return only one JSON object, without prose or Markdown fences",
    );
    const metrics = evaluateCodexEvents(completion(answer), null);
    expect(
      agentEvaluationPassed({
        ...metrics,
        expectedFirstTool: null,
        exitCode: 0,
        targetClarificationPassed:
          MISSING_TARGET_SCENARIO.validTargetClarification(
            metrics.finalMessage,
          ),
      }),
    ).toBe(true);
    for (const message of [
      `Please choose an app.\n${answer}`,
      `\`\`\`json\n${answer}\n\`\`\``,
      answer.replace("needs_target", "analyzed"),
      answer.replace("app_name_or_artifact_path", "unknown"),
      JSON.stringify({
        status: "needs_target",
        requested_input: "app_name_or_artifact_path",
        question: "   ",
      }),
    ])
      expect(MISSING_TARGET_SCENARIO.validTargetClarification(message)).toBe(
        false,
      );
  });

  it("rejects analysis of a nearby target even with a valid final clarification", () => {
    const metrics = evaluateCodexEvents(
      [call("open", "open_binary"), ...completion(answer)],
      null,
    );
    expect(
      agentEvaluationPassed({
        ...metrics,
        expectedFirstTool: null,
        exitCode: 0,
        targetClarificationPassed:
          MISSING_TARGET_SCENARIO.validTargetClarification(
            metrics.finalMessage,
          ),
      }),
    ).toBe(false);
  });
});
