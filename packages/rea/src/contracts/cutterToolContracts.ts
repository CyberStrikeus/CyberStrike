import { z } from "zod";
import { jsonValueSchema } from "../domain/jsonValue.js";
import { cutterDiscoverySchema } from "../domain/cutterDiscovery.js";
import type { ToolContract } from "./toolContractTypes.js";
import { evidenceResultOf } from "./toolOutputSchemaPrimitives.js";
import { toolContractMetadata } from "./toolEffects.js";

/** List live Cutter plugin bridge sessions. */
export const cutterListInputSchema = z.strictObject({});

/** Execute a command in a selected live Cutter instance and observed document generation. */
export const cutterCommandInputSchema = z.strictObject({
  session_id: z.string().uuid(),
  expected_generation: z.int().nonnegative(),
  command: z
    .string()
    .min(1)
    .refine(
      (value) => !/[\r\n]/u.test(value),
      "A single Rizin command line is required",
    ),
  json: z.boolean().default(false),
});

export const cutterCommandResultSchema = z.strictObject({
  command: z.string(),
  output: jsonValueSchema.nullable(),
  execution_state: z.enum(["not_started", "complete", "failed", "unknown"]),
  error: z.string().nullable(),
  message: z.string().nullable(),
  output_truncated: z.boolean(),
  cutter_version: z.string().nullable(),
  current_file: z.string().nullable(),
  document_generation: z.int().nonnegative(),
  identity_status: z.literal("partial"),
});

/** Live Cutter discovery and arbitrary Rizin command contracts. */
export const CUTTER_TOOL_CONTRACTS = [
  {
    name: "list_cutter_sessions",
    ...toolContractMetadata("list_cutter_sessions"),
    kind: "native-provider",
    description:
      "List live REA bridge sessions hosted by upstream Cutter instances, including observed document identity and bridge-directory security status. Discovery admits at most 256 descriptor candidates (16 MiB at the descriptor byte limit). That candidate budget is separate from REA_BRIDGE_MAX_REQUEST_BYTES and has no runtime override. Discovery reads and probes at most eight concurrently, and reports bridge_directory_capacity_exceeded rather than claiming no sessions when that budget is exceeded.",
    inputSchema: cutterListInputSchema,
    outputSchema: cutterDiscoverySchema,
    examples: [{ title: "List open Cutter instances", input: {} }],
  },
  {
    name: "cutter_command",
    ...toolContractMetadata("cutter_command"),
    kind: "native-provider",
    description:
      "Run one arbitrary Rizin command in a selected live Cutter session. Commands may edit and persist analysis state or execute plugin-provided effects; completion uncertainty is returned as Evidence and must not be retried automatically. The authenticated request and response frame is bounded by REA_BRIDGE_MAX_REQUEST_BYTES (default 16777216 bytes, floor 7464, maximum 536870887). The payload budget excludes the terminating LF. An out-of-band Cutter process without the setting uses 16777216 bytes; a mismatch is refused before the command is sent. In a shared MCP server, this admitted command closes any active binary-analysis session; after its effects have settled, call open_binary before further analysis. Close an active Ghidra session explicitly first.",
    inputSchema: cutterCommandInputSchema,
    outputSchema: evidenceResultOf(cutterCommandResultSchema),
    examples: [
      {
        title: "Inspect active binary metadata",
        input: {
          session_id: "00000000-0000-4000-8000-000000000001",
          expected_generation: 0,
          command: "ij",
          json: true,
        },
      },
    ],
  },
] as const satisfies readonly ToolContract[];
