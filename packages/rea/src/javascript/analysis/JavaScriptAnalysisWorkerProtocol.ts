import { z } from "zod";
import { ANALYSIS_RESOURCE_KINDS } from "../../domain/analysisErrorCore.js";
import { jsonValueSchema } from "../../domain/jsonValue.js";
import { digestSchema } from "../../domain/digests.js";
import {
  JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS,
  JAVASCRIPT_STATIC_FACT_BYTES,
  JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM,
} from "../../domain/javascript/javascriptAnalysisResourceControls.js";
import { javaScriptAnalysisTransferDescriptorSchema } from "./JavaScriptAnalysisTransfer.js";

/** Independent worker execution budget; source length is not an admission rule. */
export const JAVASCRIPT_ANALYSIS_WORKER_DEFAULTS = {
  ...JAVASCRIPT_ANALYSIS_RESOURCE_DEFAULTS,
  checkpointBytes: JAVASCRIPT_STATIC_FACT_BYTES,
  protocolBytes: 64 * 1024,
} as const;

/** The static checkpoint byte ceiling has no caller argument. */
export const javaScriptCheckpointCeilingRemediation = (
  checkpointBytes: number,
): string =>
  `The JavaScript static checkpoint ceiling is ${String(checkpointBytes)} bytes. This release has no runtime override. Raising max_heap_mb does not raise it. Paging or exporting session Evidence does not admit the omitted checkpoint.`;

/** Caller-selected artifact identity, separate from the decoded source-text digest. */
export const javaScriptWorkerRequestSchema = z.strictObject({
  id: z.uuid(),
  unknown_budget: z.int().min(0).max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM),
  node_budget: z.int().min(0).max(JAVASCRIPT_SEMANTIC_ITEM_MAXIMUM),
  text_sha256: digestSchema,
  file: z.strictObject({
    path: z.string(),
    sha256: digestSchema,
    container_sha256: digestSchema,
    bytes: z.int().nonnegative(),
    inventory_artifact_id: z.string(),
    kind: z.literal("javascript"),
    unpacked: z.boolean(),
  }),
});

/** Parent admission after validated static observations have been retained. */
export const javaScriptWorkerAdmissionSchema = z.strictObject({
  id: z.uuid(),
  semantic_result_budget_bytes: z.int().nonnegative(),
});

const identity = { id: z.uuid() };

/** Control frames never contain AST, full IR, graph rows or source text. */
export const javaScriptWorkerMessageSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("ready"),
    // Null when the worker runtime (Bun) does not enforce V8 heap flags.
    heap_limit_bytes: z.int().positive().nullable(),
  }),
  z.strictObject({
    kind: z.literal("phase"),
    ...identity,
    phase: z.enum(["parse", "static", "semantic", "projection", "transfer"]),
  }),
  z.strictObject({
    kind: z.literal("static"),
    ...identity,
    bytes: z.int().nonnegative(),
    sha256: digestSchema,
  }),
  z.strictObject({
    kind: z.literal("complete"),
    ...identity,
    descriptor: javaScriptAnalysisTransferDescriptorSchema.nullable(),
  }),
  z.strictObject({
    kind: z.literal("failure"),
    ...identity,
    reason: z.enum(["resource", "output", "io"]),
    resource: z.enum(ANALYSIS_RESOURCE_KINDS).nullable(),
    limits: z.record(z.string(), jsonValueSchema).nullable(),
    message: z.string(),
  }),
]);

/** One decoded control frame from the independently owned worker. */
export type JavaScriptWorkerMessage = z.output<
  typeof javaScriptWorkerMessageSchema
>;
