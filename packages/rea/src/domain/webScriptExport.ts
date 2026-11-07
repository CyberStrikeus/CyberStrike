import { z } from "zod";

import { browserCompletenessSchema } from "./browserCompleteness.js";
import { browserScenarioCompletenessSchema } from "./browserScenarioCaptureValues.js";
import { digestSchema, prefixedDigestSchema } from "./digests.js";
import { localPathStringSchema } from "./localPath.js";

/** Export already captured scripts into one absent, caller-selected directory. */
export const exportWebScriptsInputSchema = z.strictObject({
  capture_path: localPathStringSchema.describe(
    "Absolute filesystem path to saved inspect_web_page or capture_browser_scenario JSON, normalized result or complete Evidence",
  ),
  output_directory: localPathStringSchema.describe(
    "Absolute absent filesystem directory for verified scripts and manifest; parent directory must exist",
  ),
});
export type ExportWebScriptsInput = z.output<
  typeof exportWebScriptsInputSchema
>;

const sourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("page-script"),
    script_key: z.string().min(1),
    frame_id: z.string().nullable(),
    is_module: z.boolean().nullable(),
    language: z.string().nullable(),
    source_map_url: z.string().nullable(),
  }),
  z.strictObject({
    kind: z.literal("scenario-response"),
    transaction_id: z.string().min(1),
    request_sequence: z.int().min(1),
    response_sequence: z.int().min(1).nullable(),
    status: z.number().nullable(),
  }),
]);

/** Exact retained-source identity and publication outcome. */
export const exportedWebScriptSchema = z.strictObject({
  source: sourceSchema,
  url: z.string(),
  content: z.discriminatedUnion("state", [
    z.strictObject({
      state: z.literal("exported"),
      relative_path: z.string().min(1),
      layout: z.enum(["url-path", "isolated"]),
      layout_reason: z.string().nullable(),
      sha256: digestSchema,
      bytes: z.int().min(0),
      media_type: z.string().nullable(),
      redacted: z.boolean().nullable(),
      representation: z.enum([
        "debugger-source-utf8",
        "playwright-response-body-bytes",
        // Accept already-saved exports from before the response representation
        // was narrowed to the Playwright API result.
        "browser-decoded-response-bytes",
      ]),
    }),
    z.strictObject({
      state: z.literal("unavailable"),
      reason: z.string().min(1),
      message: z.string().min(1),
    }),
  ]),
});
export type ExportedWebScript = z.output<typeof exportedWebScriptSchema>;

/** Persisted manifest, also returned inline without duplicating script bytes. */
export const webScriptExportManifestSchema = z.strictObject({
  capture_path: z.string().min(1),
  capture_sha256: digestSchema,
  capture_kind: z.enum(["page-inspection", "browser-scenario"]),
  source_evidence_id: prefixedDigestSchema("ev").nullable(),
  capture_completeness: z.union([
    browserCompletenessSchema,
    browserScenarioCompletenessSchema,
  ]),
  output_directory: z.string().min(1),
  analysis_input: z
    .strictObject({
      input_path: z.string().min(1),
      format: z.literal("directory"),
    })
    .nullable(),
  scripts: z.array(exportedWebScriptSchema),
  limitations: z.array(z.string()),
});

/** Verified publication including the digest of the persisted manifest. */
export const webScriptExportResultSchema = webScriptExportManifestSchema.extend(
  {
    manifest: z.strictObject({
      path: z.string().min(1),
      sha256: digestSchema,
      bytes: z.int().min(0),
    }),
  },
);
export type WebScriptExportResult = z.output<
  typeof webScriptExportResultSchema
>;

/** Completed publication retained when cleanup fails after durable commit. */
export interface WebScriptExportPartialObservation {
  readonly kind: "web-script-export";
  readonly result: WebScriptExportResult;
}

/** Adapter input to the provider-neutral path planner and publisher. */
export interface CapturedWebScript {
  readonly source: ExportedWebScript["source"];
  readonly url: string;
  readonly content:
    | {
        readonly state: "captured";
        readonly bytes: Buffer;
        readonly sha256: string;
        readonly media_type: string | null;
        readonly redacted: boolean | null;
        readonly representation: Extract<
          ExportedWebScript["content"],
          { readonly state: "exported" }
        >["representation"];
      }
    | Extract<ExportedWebScript["content"], { state: "unavailable" }>;
}
