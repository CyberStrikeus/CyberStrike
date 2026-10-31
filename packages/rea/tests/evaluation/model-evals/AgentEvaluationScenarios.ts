import { z } from "zod";

import type { CodexAgentMetrics } from "./CodexAgentEval.js";

const clarificationSchema = z.strictObject({
  status: z.literal("needs_target"),
  requested_input: z.literal("app_name_or_artifact_path"),
  question: z.string().refine((value) => value.trim().length > 0),
});

/** The missing-target prompt and its whole-answer grammar share one owner. */
export const MISSING_TARGET_SCENARIO = {
  id: "missing-target",
  expectedFirstTool: null,
  requiresEvidence: false,
  requiredAnswerTermGroups: [],
  prompt:
    'Reverse engineer my desktop app and explain how it saves user settings. Use static analysis; do not install software. Return only one JSON object, without prose or Markdown fences, containing status ("needs_target" or "analyzed"), requested_input ("app_name_or_artifact_path" or null), and question (a string or null).',
  validTargetClarification(message: string): boolean {
    try {
      return clarificationSchema.safeParse(JSON.parse(message)).success;
    } catch (cause: unknown) {
      if (cause instanceof SyntaxError) return false;
      throw cause;
    }
  },
} as const;

type NativeSessionOutcome =
  | "provider-unavailable"
  | "opened-and-closed"
  | "failed";

/** Expected refusal is distinct from acquisition, which always requires close. */
const nativeSessionOutcome = ({
  reaCalls,
}: CodexAgentMetrics): NativeSessionOutcome => {
  if (reaCalls.some(({ tool, error }) => error && tool !== "open_binary"))
    return "failed";
  const lifecycle = reaCalls.filter(
    ({ tool }) => tool === "open_binary" || tool === "close_binary",
  );
  const open = lifecycle[0];
  if (open?.tool !== "open_binary") return "failed";
  if (open.error)
    return lifecycle.length === 1 && open.errorCode === "provider_unavailable"
      ? "provider-unavailable"
      : "failed";
  return lifecycle.length === 2 &&
    lifecycle[1]?.tool === "close_binary" &&
    !lifecycle[1].error
    ? "opened-and-closed"
    : "failed";
};

/** Routing/cleanup trial; it does not establish real-engine analysis correctness. */
export const nativeProviderScenario = (target: string) => ({
  id: "native",
  expectedFirstTool: "open_binary",
  requiresEvidence: false,
  requiredAnswerTermGroups: [],
  approvedTools: ["open_binary", "close_binary"],
  assess: nativeSessionOutcome,
  prompt: `Explain what static artifact evidence establishes about the shipped native program at ${target}. Do not execute the target or install tools. If the provider is unavailable, state that limitation and that no session was opened. If a session opens, report the available evidence and close it before finishing.`,
});
