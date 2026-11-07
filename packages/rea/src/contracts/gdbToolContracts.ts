import { z } from "zod";

import { localPathStringSchema } from "../domain/localPath.js";
import {
  commandEvidenceDetailSchema,
  gdbCommandResultSchema,
} from "../domain/commandObservation.js";
import { gdbCommandSummaryViewResultSchema } from "../domain/analysisView/analysisView.js";
import type { ToolContract } from "./toolContractTypes.js";
import { analysisDetailOutputSchemaOf } from "./analysisDetail.js";
import { toolContractMetadata } from "./toolEffects.js";

const sessionId = z.string().uuid();

/** Persistent GDB/MI session contracts hosted by the existing REA MCP server. */
export const GDB_TOOL_CONTRACTS = [
  {
    name: "start_gdb_session",
    ...toolContractMetadata("start_gdb_session"),
    kind: "native-provider",
    description:
      "Start a BYO GDB process in MI3 mode when available, suppress startup files, and disable auto-loading. Persistent GDB sessions are available only on Linux, where REA can verify live inferior output descriptors through /proc before detaching; macOS descriptor verification is not implemented, and Windows Job Object cleanup can terminate debugger inferiors. Optionally set inferior_tty to a caller-selected terminal for future inferior runs; REA verifies the setting through GDB/MI before the session becomes ready. The selected terminal must remain available after GDB exits. A live inferior can be detached during close only while this durable output sink remains verified. The session persists in this REA MCP server process and receives an explicit session ID.",
    inputSchema: z.strictObject({
      inferior_tty: localPathStringSchema
        .optional()
        .describe(
          "Caller-selected terminal path for future inferior runs. GDB must report the exact configured path before the session is ready.",
        ),
    }),
    outputSchema: z.strictObject({
      session_id: sessionId,
      mi_version: z.enum(["mi3", "mi2"]),
    }),
    examples: [{ title: "Start GDB", input: {} }],
  },
  {
    name: "gdb_console",
    ...toolContractMetadata("gdb_console"),
    kind: "native-provider",
    description:
      "Run one unrestricted GDB CLI command through MI interpreter-exec console and return raw MI, console, target, and log records inline with Evidence. Default detail complete preserves the original Evidence. Explicit detail summary retains that complete parent and returns every ordered MI record once, omitting duplicate stream groupings and raw mirrors; parent_evidence_id supports later inspect_analysis_view summary queries and complete Evidence export. A command timeout preserves collected records with completion_status unknown and stops the owned debugger session. Commands can execute shell, alter target state, access files, and use network. Closing the debugger never implies target termination. In a shared MCP server, this admitted command closes any active binary-analysis session; after its effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: z.strictObject({
      session_id: sessionId,
      command: z.string().min(1),
      detail: commandEvidenceDetailSchema,
    }),
    outputSchema: analysisDetailOutputSchemaOf(
      gdbCommandResultSchema,
      gdbCommandSummaryViewResultSchema,
    ),
    examples: [
      {
        title: "Inspect loaded symbols",
        input: {
          session_id: "00000000-0000-4000-8000-000000000001",
          command: "info functions",
        },
      },
    ],
  },
  {
    name: "gdb_session_status",
    ...toolContractMetadata("gdb_session_status"),
    kind: "native-provider",
    description:
      "Return the observed lifecycle state and bounded recent MI records and process diagnostics for one persistent REA GDB session; truncation and invalid-UTF-8 fields report discarded or lossy data.",
    inputSchema: z.strictObject({ session_id: sessionId }),
    outputSchema: z.strictObject({
      session_id: sessionId,
      mi_version: z.enum(["mi3", "mi2"]),
      state: z.enum(["ready", "closed"]),
      recent_mi_records: z.array(z.string()),
      recent_mi_records_truncated: z.boolean(),
      mi_invalid_utf8: z.boolean(),
      stderr: z.string(),
      stderr_observed_bytes: z.int().nonnegative(),
      stderr_truncated: z.boolean(),
      stderr_invalid_utf8: z.boolean(),
      diagnostics_truncated: z.boolean(),
      inferior_tty: z.string().nullable(),
      inferior_tty_verified: z.boolean(),
    }),
    examples: [
      {
        title: "Check GDB session",
        input: { session_id: "00000000-0000-4000-8000-000000000001" },
      },
    ],
  },
  {
    name: "close_gdb_session",
    ...toolContractMetadata("close_gdb_session"),
    kind: "native-provider",
    description:
      "Close the owned GDB process after verifying the inferior state. When one live thread group has a verified durable output TTY, REA automatically detaches it, which may resume target execution; otherwise close reports that a disposition is required. REA never kills attached or remote targets as part of debugger cleanup. In a shared MCP server, this admitted close retires any active binary-analysis session; after target effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: z.strictObject({ session_id: sessionId }),
    outputSchema: z.strictObject({
      target_state: z.enum(["none_observed", "unknown"]),
    }),
    examples: [
      {
        title: "Close GDB session",
        input: { session_id: "00000000-0000-4000-8000-000000000001" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
