import { z } from "zod";

import { localPathStringSchema } from "../domain/localPath.js";
import type { ToolContract } from "./toolContractTypes.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "./toolEffects.js";

const sessionId = z.string().uuid();
const commandResult = z.strictObject({
  command: z.string(),
  output: z.string(),
  output_scope: z.literal("command_and_interleaved_session_output"),
  output_truncated: z.boolean(),
  output_invalid_utf8: z.literal(true).optional(),
  completion_status: z.enum(["complete", "unknown"]),
  backend: z.string().nullable(),
});

/** Persistent Rizin debugger session contracts. */
export const RIZIN_DEBUG_TOOL_CONTRACTS = [
  {
    name: "start_rizin_debug_session",
    ...toolContractMetadata("start_rizin_debug_session"),
    kind: "native-provider",
    description:
      "Start a persistent Rizin debugger session using `-N` to suppress user settings and scripts while retaining plugins, `-0` for NUL framing, and `-d` with an optional caller-selected IO debugger backend. Requires a caller-selected Linux TTY for inferior stdout and stderr; the target may write directly to that terminal while running and after detach. REA verifies both destinations and `dbg.exitkills=false` before detaching. Backend and target capabilities depend on the installed build. The session lives in this REA MCP process. Persistent sessions require Linux `/proc` descriptor readback. In a shared MCP server, starting this session retires any active binary-analysis session; after target effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: z.strictObject({
      path: localPathStringSchema,
      inferior_tty: localPathStringSchema,
      backend: z.string().min(1).optional(),
    }),
    outputSchema: z.strictObject({
      session_id: sessionId,
      backend: z.string().nullable(),
    }),
    examples: [
      {
        title: "Start Rizin debugger",
        input: { path: "/tmp/program", inferior_tty: "/dev/pts/7" },
      },
    ],
  },
  {
    name: "rizin_debug_command",
    ...toolContractMetadata("rizin_debug_command"),
    kind: "native-provider",
    description:
      "Execute one unrestricted command in a persistent Rizin debugger session. Returns raw output inline with Evidence, including backend output interleaved before the completion marker. If the command exceeds the output-byte, frame-byte, or frame-count limit, `output_truncated` is true and `completion_status` is `unknown`; retained partial output is returned and the owned debugger session is stopped. Evidence names the cap that stopped capture. Unsolicited frames already queued before the command make the session unavailable because correlation is ambiguous. Commands can access local files, shell, network, plugins, and target state; effects depend on the active backend and target. In a shared MCP server, this admitted command closes any active binary-analysis session; after its effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: z.strictObject({
      session_id: sessionId,
      command: z
        .string()
        .min(1)
        .refine(
          (value) => !/[\r\n]/u.test(value),
          "A single command line is required",
        ),
    }),
    outputSchema: evidenceResultOf(commandResult),
    examples: [
      {
        title: "Inspect debugger state",
        input: {
          session_id: "00000000-0000-4000-8000-000000000001",
          command: "dr",
        },
      },
    ],
  },
  {
    name: "rizin_debug_session_status",
    ...toolContractMetadata("rizin_debug_session_status"),
    kind: "native-provider",
    description:
      "Return observed lifecycle state and bounded recent NUL-framed output and process diagnostics for one Rizin debugger session; truncation fields report discarded data, and output_invalid_utf8 reports whether invalid UTF-8 has been observed in session frame bytes; recent output may contain replacement characters.",
    inputSchema: z.strictObject({ session_id: sessionId }),
    outputSchema: z.strictObject({
      session_id: sessionId,
      state: z.enum(["ready", "closed"]),
      inferior_tty: z.string(),
      recent_output: z.array(z.string()),
      recent_output_truncated: z.boolean(),
      diagnostics_truncated: z.boolean(),
      output_invalid_utf8: z.boolean(),
    }),
    examples: [
      {
        title: "Check Rizin session",
        input: { session_id: "00000000-0000-4000-8000-000000000001" },
      },
    ],
  },
  {
    name: "close_rizin_debug_session",
    ...toolContractMetadata("close_rizin_debug_session"),
    kind: "native-provider",
    description:
      "Close the REA-owned Rizin debugger only after verifying no inferior remains or detaching one with a verified caller-selected TTY output sink. A detached target may continue running and write to that TTY; target state is otherwise reported as unknown. REA never signals an inferior based on PID or path. In a shared MCP server, this admitted close retires any active binary-analysis session; after target effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: z.strictObject({ session_id: sessionId }),
    outputSchema: z.strictObject({ target_state: z.literal("unknown") }),
    examples: [
      {
        title: "Close Rizin debugger",
        input: { session_id: "00000000-0000-4000-8000-000000000001" },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
