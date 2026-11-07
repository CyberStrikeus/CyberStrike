import { z } from "zod";
import { JAVASCRIPT_STATIC_FACT_BYTES } from "../domain/javascript/javascriptAnalysisResourceControls.js";
import { digestSchema } from "../domain/digests.js";
import { WEB_RUNTIME_LIMITS } from "../domain/webRuntime.js";
import { webPageInspectionSchema } from "../domain/browserObservationSchemas.js";
import { webTextArtifactSchema } from "../domain/webContentArtifact.js";
import {
  DEFAULT_WEB_BUNDLE_HEAP_MB,
  DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS,
  DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS,
} from "../domain/webBundleAnalysis.js";

/** Independent per-script worker limits for source records and control frames. */
export const WEB_BUNDLE_WORKER_LIMITS = {
  heapMb: DEFAULT_WEB_BUNDLE_HEAP_MB,
  scriptTimeoutMs: DEFAULT_WEB_BUNDLE_SCRIPT_TIMEOUT_MS,
  totalTimeoutMs: DEFAULT_WEB_BUNDLE_TOTAL_TIMEOUT_MS,
  protocolBytes: 64 * 1024,
  sourceBytes: 8 * WEB_RUNTIME_LIMITS.sourceBytes,
  resultBytes: JAVASCRIPT_STATIC_FACT_BYTES,
} as const;

const includedSourceSchema = z.strictObject({
  included: z.literal(true),
  artifact: webTextArtifactSchema.strict(),
});

const browserScriptSchema =
  webPageInspectionSchema.shape.scripts.shape.items.element;

/** Derive producer metadata rules; the worker requires captured source text. */
export const includedWebScriptSchema = browserScriptSchema
  .extend({ source: includedSourceSchema })
  .strict();

export const webBundleWorkerRequestSchema = z.strictObject({
  kind: z.literal("analyze"),
  id: z.uuid(),
  source: z.strictObject({
    bytes: z.number().int().min(0).max(WEB_BUNDLE_WORKER_LIMITS.sourceBytes),
    sha256: digestSchema,
  }),
  result_budget_bytes: z
    .number()
    .int()
    .min(0)
    .max(WEB_BUNDLE_WORKER_LIMITS.resultBytes),
});

const identity = { id: z.uuid() };

/** Control frames contain descriptors and progress only, never source or findings. */
export const webBundleWorkerMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready"),
    heap_limit_bytes: z.number().int().positive().nullable(),
  }),
  z.strictObject({
    kind: z.literal("phase"),
    ...identity,
    phase: z.literal("analyze"),
  }),
  z.strictObject({
    kind: z.literal("complete"),
    ...identity,
    result: z.strictObject({
      bytes: z.number().int().nonnegative(),
      sha256: digestSchema,
    }),
  }),
  z.strictObject({
    kind: z.literal("failure"),
    ...identity,
    reason: z.enum(["input", "resource", "output", "io"]),
    message: z.string(),
  }),
]);

export type WebBundleWorkerMessage = z.output<
  typeof webBundleWorkerMessageSchema
>;
