import { expect, it } from "vitest";

import {
  DEBUGGER_COMMAND_DEADLINE_SETTING,
  resolveDebuggerSessionLimits,
} from "../../../src/config/debuggerSessionLimits.js";
import { DEFAULT_DEBUGGER_COMMAND_DEADLINE_MS } from "../../../src/domain/analysisResourceLimits.js";
import {
  createRizinCommandTimeoutEvidence,
  rizinCommandTimeoutLimitation,
} from "../../../src/rizin/RizinDebugSessionManager.js";

it("preserves every field of partial Rizin timeout Evidence", () => {
  const result = {
    command: "dr",
    output: "partial register output",
    output_scope: "command_and_interleaved_session_output" as const,
    output_truncated: true,
    completion_status: "unknown" as const,
    backend: null,
  };

  const evidence = createRizinCommandTimeoutEvidence({
    sessionId: "session-123",
    command: "dr",
    result,
    inferiorTty: "/dev/pts/7",
    cleanupFailure: undefined,
    launchProvenance: {
      caller_selected_path: "./sample/../program",
      resolved_path: "/workspace/program",
    },
  });

  expect(evidence.parameters).toEqual({
    session_id: "session-123",
    command: "dr",
    inferior_tty: "/dev/pts/7",
    launch_provenance: {
      caller_selected_path: "./sample/../program",
      resolved_path: "/workspace/program",
    },
  });
  expect(evidence.raw_result).toEqual(result);
  expect(evidence.normalized_result).toEqual(result);
  const deadline = resolveDebuggerSessionLimits({}).commandDeadline;
  expect(deadline).toMatchObject({
    setting: DEBUGGER_COMMAND_DEADLINE_SETTING,
    value: DEFAULT_DEBUGGER_COMMAND_DEADLINE_MS,
    source: "default",
    unit: "ms",
  });
  expect(evidence.limitations).toEqual([
    "The current debugger target identity is not established by the Rizin session identifier.",
    rizinCommandTimeoutLimitation(deadline),
    "The owned debugger session was stopped because output correlation could no longer be guaranteed.",
    "The command is unrestricted and may access local files, the shell, network, or mutate the target.",
    "Interrupted output may include an incomplete completion-marker prefix; it is retained because it cannot be distinguished from command diagnostics.",
    "Launch provenance records the original and resolved startup paths; it does not establish the current target after unrestricted debugger commands.",
  ]);
});
