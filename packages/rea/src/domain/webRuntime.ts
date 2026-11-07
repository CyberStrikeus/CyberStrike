import { z } from "zod";
import {
  browserAllowedOriginsSchema,
  browserEndpointSchema,
} from "./browserObservation.js";
import {
  CDP_CLEANUP_GRACE_MS,
  DEFAULT_CDP_COMMAND_TIMEOUT_MS,
  webRuntimeCommandTimeoutSchema,
} from "./browserDeadline.js";
import { jsonObjectSchema } from "./jsonValue.js";

// CDP positions are zero-based and relative to the resource named by url.
// With a script ID that is the script's enclosing resource: the script file,
// or the HTML document for an inline script. An empty script ID marks a
// position a request initiator reported, such as parser markup or a module
// import in a script file; it still locates url, but has no session-script
// association to join captured source or resource_start.
// trace_web_source_location takes one-based, script-relative lines, so the
// advertised units keep callers from passing a position off by one or by an
// inline script's offset.
const SCRIPT_ID =
  "CDP session script ID; empty for a position a request initiator reported, which has no session-script association for joining captured source or resource_start.";
const RESOURCE_LINE =
  "Zero-based line in the resource named by url, as reported by CDP: the script file for an external script (including a module-import initiator), or the HTML document for an inline script or parser markup.";
const RESOURCE_COLUMN =
  "Zero-based UTF-16 column on that line of the resource named by url, as reported by CDP.";
const START_LINE =
  "Zero-based line where the script text starts in its enclosing resource (the HTML document for an inline script).";
const START_COLUMN =
  "Zero-based UTF-16 column where the script text starts on that line of its enclosing resource.";

/** Scope for one externally owned page; omitted origins select its current origin. */
export const webRuntimeScopeSchema = z.strictObject({
  cdp_endpoint: browserEndpointSchema,
  allowed_origins: browserAllowedOriginsSchema,
  target_id: z.string().min(1),
  command_timeout_ms: webRuntimeCommandTimeoutSchema,
});

/** Source evidence is bound by the selected CDP session's script ID, never URL equality. */
export const webRuntimeSourceSchema = z.object({
  script_id: z.string().min(1),
  url: z.string(),
  execution_context_id: z.int().nullable(),
  reported_execution_context: jsonObjectSchema.nullable(),
  reported_script_context_aux_data: jsonObjectSchema.nullable(),
  frame_id: z.string().nullable(),
  producer_hash: z.string().nullable(),
  source_map_url: z.string().nullable(),
  has_source_url: z.boolean().nullable(),
  language: z.string().nullable(),
  resource_start: z
    .object({
      line_number: z.int().min(0).describe(START_LINE),
      column_number: z.int().min(0).describe(START_COLUMN),
    })
    .nullable(),
  source: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("captured"),
      text: z.string(),
      sha256: z.string().regex(/^[a-f0-9]{64}$/u),
      utf8_bytes: z.int().min(0),
      utf16_units: z.int().min(0),
    }),
    z.object({
      state: z.enum(["unavailable", "excluded"]),
      reason: z.string().min(1),
    }),
  ]),
});
export type WebRuntimeSource = z.infer<typeof webRuntimeSourceSchema>;

/** Producer callsite coordinates are zero-based resource lines and UTF-16 columns. */
export const webRuntimeLocationSchema = z.object({
  script_id: z.string().describe(SCRIPT_ID),
  url: z.string().nullable(),
  line_number: z.int().min(0).describe(RESOURCE_LINE),
  column_number: z.int().min(0).nullable().describe(RESOURCE_COLUMN),
  function_name: z.string().nullable(),
  source_association: z.enum(["script_id", "unknown"]),
});

/** Common identity for a selected live page document. */
export const webRuntimeTargetSchema = z.object({
  target_id: z.string().min(1),
  origin: z.string().min(1),
  initial_url: z.string(),
  frame_id: z.string().min(1),
  loader_id: z.string().nullable(),
});

/** Complete runtime evidence has explicit byte budgets rather than silent item truncation. */
export const WEB_RUNTIME_LIMITS = {
  protocolBytes: 64 * 1024 * 1024,
  retainedEventBytes: 8 * 1024 * 1024,
  sourceBytes: 32 * 1024 * 1024,
  commandTimeoutMs: DEFAULT_CDP_COMMAND_TIMEOUT_MS,
  cleanupTimeoutMs: CDP_CLEANUP_GRACE_MS,
} as const;
