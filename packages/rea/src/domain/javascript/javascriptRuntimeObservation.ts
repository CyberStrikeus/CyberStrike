import { z } from "zod";

import { browserEndpointSchema } from "../browserObservation.js";
import { prefixedDigestSchema } from "../digests.js";

const observationTextSchema = z.string().min(1);

const runtimeEndpoint = {
  inspector_endpoint: browserEndpointSchema,
};

/** Input for listing targets exposed by an explicit Node/Electron Inspector endpoint. */
export const listJavaScriptRuntimeTargetsInputSchema = z.strictObject({
  ...runtimeEndpoint,
});
export type ListJavaScriptRuntimeTargetsInput = z.infer<
  typeof listJavaScriptRuntimeTargetsInputSchema
>;

export const javascriptRuntimeKindSchema = z.enum([
  "node",
  "electron-main",
  "electron-preload",
  "electron-renderer",
]);
const observedJavaScriptRuntimeKindSchema = javascriptRuntimeKindSchema.or(
  z.literal("unknown"),
);

/** Input for one passive attach-only V8 Inspector observation. */
export const observeJavaScriptRuntimeInputSchema = z.strictObject({
  ...runtimeEndpoint,
  target_id: z.string().min(1),
  runtime_kind: javascriptRuntimeKindSchema.optional(),
  observation_ms: z.int().min(0).default(100),
});
export type ObserveJavaScriptRuntimeInput = z.infer<
  typeof observeJavaScriptRuntimeInputSchema
>;

export const javascriptRuntimeVersionSchema = z.strictObject({
  product: z.string().min(1),
  protocol_version: z.string().min(1),
  v8_version: z.string().nullable(),
});

export const javascriptRuntimeLocationSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("file"),
    file_path: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("url"),
    origin: z.string().min(1),
    sanitized_url: z.string().min(1),
  }),
  z.strictObject({
    kind: z.literal("builtin"),
    specifier: z.string().min(1),
  }),
]);
export type JavaScriptRuntimeLocation = z.infer<
  typeof javascriptRuntimeLocationSchema
>;

/** Discovery metadata can identify an endpoint target without verifying its file location. */
export const javascriptRuntimeUnresolvedLocationSchema = z.strictObject({
  kind: z.literal("unresolved"),
  reported_url: z
    .string()
    .describe(
      "Raw Inspector URL, which may be empty for anonymous or evaluated code.",
    ),
  reason: z.enum([
    "unverifiable-file-location",
    "location-authorization-not-attempted",
  ]),
});

/** Verified locations and explicitly unresolved discovery metadata. */
export const javascriptRuntimeTargetLocationSchema = z.union([
  javascriptRuntimeLocationSchema,
  javascriptRuntimeUnresolvedLocationSchema,
]);
export type JavaScriptRuntimeTargetLocation = z.infer<
  typeof javascriptRuntimeTargetLocationSchema
>;

const javascriptRuntimeTargetSchema = z.strictObject({
  target_id: z.string().min(1),
  protocol_type: z.string().min(1),
  attached: z
    .boolean()
    .nullable()
    .describe(
      "Discovery-reported debugger attachment state; null means unknown",
    ),
  location: javascriptRuntimeTargetLocationSchema,
});

/** Complete V8 Inspector target inventory exposed by the selected endpoint. */
export const javascriptRuntimeTargetListSchema = z.strictObject({
  runtime: javascriptRuntimeVersionSchema,
  targets: z.array(javascriptRuntimeTargetSchema),
  excluded: z.strictObject({
    unsupported_location: z.int().min(0),
    unconnectable: z.int().min(0),
  }),
  limitations: z.array(observationTextSchema),
});
export type JavaScriptRuntimeTargetList = z.infer<
  typeof javascriptRuntimeTargetListSchema
>;

const javascriptRuntimeScriptSchema = z.strictObject({
  script_key: prefixedDigestSchema("v8_script"),
  location: javascriptRuntimeTargetLocationSchema,
  reported_url: z
    .string()
    .optional()
    .describe(
      "Exact Inspector URL for an authorized file script, retained separately from its verified filesystem path.",
    ),
  execution_context_key: z.string().nullable(),
  cdp_hash: z.string().nullable(),
  length: z
    .int()
    .min(0)
    .nullable()
    .describe("Producer-reported script length; null when unavailable."),
  is_module: z
    .boolean()
    .nullable()
    .describe(
      "Producer-reported module classification; null when unavailable.",
    ),
  status: z.literal("observed-loaded"),
});

const javascriptRuntimeContextSchema = z.strictObject({
  context_key: z.string().min(1),
  state: z.enum(["created", "destroyed", "cleared"]),
  name: z.string().nullable(),
  origin: z.string().nullable(),
});

/** Deterministic passive script/context snapshot from one bounded window. */
export const javascriptRuntimeObservationSchema = z.strictObject({
  runtime: javascriptRuntimeVersionSchema,
  target: javascriptRuntimeTargetSchema.extend({
    runtime_kind: observedJavaScriptRuntimeKindSchema,
    runtime_kind_authority: z.enum([
      "caller-declared-unverified",
      "not-declared",
    ]),
  }),
  capture: z.strictObject({
    observation_ms: z.int().min(0),
    events_observed: z.int().min(0),
    events_retained: z.int().min(0),
    events_dropped: z.int().min(0),
    metadata_bytes_retained: z.int().min(0),
    truncated: z.boolean(),
    truncation_reasons: z.array(observationTextSchema),
  }),
  scripts: z.strictObject({
    items: z.array(javascriptRuntimeScriptSchema),
    observed_total: z.int().min(0),
    parse_failed_total: z
      .int()
      .min(0)
      .optional()
      .describe(
        "Valid scriptFailedToParse events observed; absent in legacy snapshots.",
      ),
    excluded: z.strictObject({
      unsupported_location: z.int().min(0),
      invalid_protocol_value: z.int().min(0),
    }),
  }),
  execution_contexts: z.array(javascriptRuntimeContextSchema),
  directly_observed: z.array(observationTextSchema),
  unavailable_without_instrumentation: z.array(observationTextSchema),
  unknowns: z.array(observationTextSchema),
  limitations: z.array(observationTextSchema),
});
export type JavaScriptRuntimeObservation = z.infer<
  typeof javascriptRuntimeObservationSchema
>;
