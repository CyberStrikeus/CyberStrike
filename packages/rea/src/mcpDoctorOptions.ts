import { z } from "incur";

import { CLI_DOCUMENT_OUTPUT_FORMATS } from "./cliOutput.js";

/** The options accepted by the production MCP doctor entry. */
export const MCP_DOCTOR_OPTIONS = z.object({
  format: z
    .enum(CLI_DOCUMENT_OUTPUT_FORMATS)
    .optional()
    .describe("Output format"),
  json: z.boolean().optional().describe("Emit the report as JSON"),
  fullOutput: z.boolean().optional().describe("Show the full output envelope"),
  help: z.boolean().optional().describe("Show help"),
});

export const MCP_DOCTOR_ALIAS = { help: "h" } as const;
