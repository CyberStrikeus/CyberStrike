import { z } from "zod";
import { utcDateTimeSchema } from "./offsetDateTime.js";

import { browserCompletenessSchema } from "./browserCompleteness.js";
import {
  cdpDomSnapshotSchema,
  cdpScriptSourceSchema,
  cdpScriptMetadataSchema,
} from "./cdpObservationSchemas.js";
import { jsonShapeSchema } from "./jsonShape.js";
import { prefixedDigestSchema } from "./digests.js";

/** Shared CDP/browser version identity carried on observation Evidence. */
export const browserVersionSchema = z.object({
  product: z.string(),
  protocol_version: z.string(),
  revision: z.string(),
  user_agent: z.string(),
  js_version: z.string(),
});

const browserTargetSchema = z.object({
  target_id: z.string(),
  type: z.string(),
  title: z.string(),
  url: z.string(),
  origin: z.string(),
  attached: z
    .boolean()
    .nullable()
    .describe(
      "Discovery-reported debugger attachment state; null means unknown",
    ),
});

/** Complete policy-filtered browser target discovery result. */
export const browserTargetListSchema = z.object({
  browser: browserVersionSchema,
  targets: z.array(browserTargetSchema),
  excluded: z.object({
    disallowed_origin: z.int().min(0),
    unsupported_url: z.int().min(0),
    non_page: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});
export type BrowserTargetList = z.infer<typeof browserTargetListSchema>;

const browserFrameSchema = z.object({
  frame_id: z.string(),
  parent_frame_id: z.string().nullable(),
  url: z.string(),
  origin: z.string().nullable(),
});
const browserAxNodeSchema = z.object({
  node_id: z.string(),
  parent_id: z.string().nullable(),
  role: z.string().nullable(),
  name: z.string().nullable(),
  description: z.string().nullable(),
  ignored: z.boolean(),
  states: z
    .array(
      z.object({
        name: z.string(),
        value: z.union([z.boolean(), z.number(), z.string()]),
      }),
    )
    .default([]),
});
const browserResourceReconciliationSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("exact"), resource_key: z.string() }),
  z.object({
    status: z.literal("ambiguous"),
    candidate_resource_keys: z.array(z.string()),
  }),
  z.object({
    status: z.literal("unmatched"),
    reason: z.literal("no_exact_sanitized_url"),
  }),
]);
const browserScriptSchema = z.object({
  script_key: z.string().regex(/^scr_[a-f0-9]{64}(?:_[0-9]+)?$/u),
  frame_id: z.string().nullable().default(null),
  url: z.string(),
  origin: z.string().nullable(),
  ...cdpScriptMetadataSchema.shape,
  source_map_url: z.string().nullable(),
  resource_reconciliation: browserResourceReconciliationSchema,
  source: cdpScriptSourceSchema,
});
const browserResourceSchema = z.object({
  resource_key: prefixedDigestSchema("res"),
  url: z.string(),
  origin: z.string().nullable(),
  type: z.string(),
  mime_type: z.string(),
  content_size: z.number().min(0).nullable(),
});
const browserNetworkRequestSchema = z.object({
  request_id: z.string(),
  url: z.string(),
  origin: z.string().nullable(),
  method: z.string(),
  resource_type: z.string().nullable(),
  status: z.number().nullable(),
  mime_type: z.string().nullable(),
  encoded_data_length: z.number().min(0).nullable(),
  redirects: z
    .array(
      z.object({
        url: z.string(),
        response_url: z.string(),
        method: z.string(),
        resource_type: z.string().nullable(),
        status: z.number().nullable(),
        mime_type: z.string().nullable(),
        encoded_data_length: z.number().min(0).nullable(),
        request_timestamp: z.number().nullable(),
        redirect_event_timestamp: z.number().nullable(),
      }),
    )
    .optional(),
  initiator: z.object({
    type: z.string(),
    url: z.string().nullable(),
    line: z.int().min(0).nullable(),
    column: z.int().min(0).nullable(),
  }),
  body_shapes: z.object({
    status: z.enum(["not_approved", "included", "partial", "unavailable"]),
    request: jsonShapeSchema.nullable(),
    response: jsonShapeSchema.nullable(),
  }),
});
const browserConsoleEventSchema = z.object({
  type: z.string(),
  timestamp: z
    .number()
    .nullable()
    .describe(
      "CDP Runtime.Timestamp in milliseconds since Unix epoch; null when the producer value is absent or invalid.",
    ),
  argument_types: z
    .array(z.string())
    .nullable()
    .describe(
      "CDP argument types by argument position; null when the producer argument inventory is absent or not an array.",
    ),
  url: z.string().nullable(),
  line: z.int().min(0).nullable(),
  column: z.int().min(0).nullable(),
  text_capture: z.object({
    status: z.enum(["not_approved", "included", "unavailable"]),
    values: z.array(
      z.object({
        argument_index: z.int().min(0),
        type: z.string(),
        text: z.string(),
      }),
    ),
    retained_bytes: z.int().min(0),
  }),
});
const browserWebSocketFrameSchema = z.object({
  direction: z.enum(["sent", "received"]),
  opcode: z.int().min(0).max(15).nullable(),
  payload_bytes: z.int().min(0).nullable(),
  payload_shape: z
    .object({
      format: z.enum(["json", "text", "binary"]),
      json_shape: jsonShapeSchema.nullable(),
    })
    .nullable(),
});
const browserWebSocketConnectionSchema = z.object({
  request_id: z.string(),
  url: z.string(),
  events: z.array(browserWebSocketFrameSchema),
});
const browserWorkerSchema = z.object({
  target_id: z.string(),
  type: z.string(),
  url: z.string(),
  origin: z.string().nullable(),
  attached: z.boolean(),
  opener_target_id: z.string().nullable().default(null),
  parent_frame_id: z.string().nullable().default(null),
});
const browserCspSourceSchema = z.object({
  kind: z.enum([
    "keyword",
    "scheme",
    "approved_origin",
    "external_origin",
    "other",
  ]),
  value: z.string().nullable(),
});
const browserLinkMetadataSchema = z.object({
  href: z.string().nullable(),
  destination_scope: z.enum(["approved", "outside_policy", "unsupported"]),
  context_url: z.string().nullable().optional(),
  context_scope: z
    .enum(["approved", "outside_policy", "unsupported"])
    .optional(),
  rel: z.array(z.string()),
  as: z.string().nullable(),
  type: z.string().nullable(),
  crossorigin: z.string().nullable(),
});
const browserAgentHintSchema = z.object({
  mechanism: z.enum([
    "link_rel",
    "dom_link_rel",
    "well_known_resource",
    "response_header",
  ]),
  declaration: z.string(),
  url: z.string().nullable(),
  trust: z.literal("page-declared-untrusted"),
});
const browserSafeMetadataSchema = z.object({
  responses: z.array(
    z.object({
      request_id: z.string(),
      url: z.string(),
      mime_type: z.string().nullable(),
      content_length: z.int().min(0).nullable(),
      content_encoding: z.string().nullable(),
      csp: z.object({
        directives: z.array(
          z.object({
            name: z.string(),
            sources: z.array(browserCspSourceSchema),
          }),
        ),
        nonce_count: z.int().min(0),
        hash_count: z.int().min(0),
      }),
      links: z.array(browserLinkMetadataSchema),
      policies: z.object({
        coop: z.string().nullable(),
        coep: z.string().nullable(),
        corp: z.string().nullable(),
        referrer_policy: z.string().nullable(),
        x_content_type_options: z.string().nullable(),
        permissions_policy_features: z.array(z.string()),
      }),
    }),
  ),
  dom_urls: z.array(
    z.object({
      node_index: z.int().min(0),
      attribute: z.enum(["href", "src", "action", "formaction", "poster"]),
      url: z.string().nullable(),
      destination_scope: z.enum(["approved", "outside_policy", "unsupported"]),
    }),
  ),
  agent_hints: z.array(browserAgentHintSchema),
  excluded_dom_urls: z.int().min(0),
  headers_allowlisted: z.literal(true),
});

/** Provider-neutral normalized result for one passive web-page observation. */
export const webPageInspectionSchema = z.object({
  browser: browserVersionSchema,
  target: browserTargetSchema,
  capture_window: z.object({
    started_at: utcDateTimeSchema,
    ended_at: utcDateTimeSchema,
    observation_ms: z.int().min(0),
  }),
  completeness: browserCompletenessSchema,
  frames: z.array(browserFrameSchema),
  dom: cdpDomSnapshotSchema,
  accessibility: z.object({
    total_nodes: z.int().min(0),
    text_capture: z.object({
      status: z.enum(["not_approved", "included", "unavailable"]),
      retained_bytes: z.int().min(0),
      excluded_fields: z.int().min(0),
    }),
    nodes: z.array(browserAxNodeSchema),
  }),
  scripts: z.object({
    total: z.int().min(0),
    items: z.array(browserScriptSchema),
  }),
  resources: z.array(browserResourceSchema),
  network: z.object({
    requests: z.array(browserNetworkRequestSchema),
    websocket_connections: z.array(browserWebSocketConnectionSchema),
    coverage_started_at: utcDateTimeSchema,
    prior_activity_available: z.literal(false),
  }),
  console: z.object({
    events: z.array(browserConsoleEventSchema),
    coverage_started_at: utcDateTimeSchema,
    prior_activity_available: z.literal(false),
  }),
  workers: z.array(browserWorkerSchema),
  metadata: browserSafeMetadataSchema,
  storage: z.object({
    origin: z.string(),
    usage_bytes: z.number().min(0).nullable(),
    quota_bytes: z.number().min(0).nullable(),
    local_storage_keys: z.array(z.string()),
    session_storage_keys: z.array(z.string()),
    indexed_db_names: z.array(z.string()),
    cache_names: z.array(z.string()),
    content_fingerprints: z
      .array(
        z.object({
          scope: z.enum([
            "cookie",
            "local_storage",
            "session_storage",
            "indexed_db_schema",
            "indexed_db_record",
            "cache_entry",
          ]),
          identity_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          value_sha256: z
            .string()
            .regex(/^[a-f0-9]{64}$/u)
            .nullable(),
          projection_version: z
            .literal(2)
            .optional()
            .describe(
              "IndexedDB schema projection including database version; absent on historical store-only fingerprints.",
            ),
          complete: z.boolean(),
        }),
      )
      .default([]),
    fingerprint_algorithm: z.literal("sha256").default("sha256"),
    fingerprints_complete: z.boolean().default(false),
    values_redacted: z.literal(true),
  }),
  limitations: z.array(z.string()),
});
export type WebPageInspection = z.infer<typeof webPageInspectionSchema>;
