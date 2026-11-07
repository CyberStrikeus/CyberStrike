import { z } from "zod";
import { utcDateTimeSchema } from "../offsetDateTime.js";

import { webRuntimeCommandTimeoutSchema } from "../browserDeadline.js";
import { browserCompletenessSchema } from "../browserCompleteness.js";
import { browserEndpointSchema } from "../browserObservation.js";
import { browserVersionSchema } from "../browserObservationSchemas.js";
import {
  cdpDomSnapshotSchema,
  cdpScriptSourceSchema,
  cdpScriptMetadataSchema,
} from "../cdpObservationSchemas.js";
import { prefixedDigestSchema } from "../digests.js";

const approvedElectronInput = {
  cdp_endpoint: browserEndpointSchema,
};

/** Input for listing local file:// page targets from an explicit Electron CDP endpoint. */
export const listElectronTargetsInputSchema = z.strictObject({
  ...approvedElectronInput,
});
export type ListElectronTargetsInput = z.infer<
  typeof listElectronTargetsInputSchema
>;

/** Input for passive structural inspection of one Electron file page. */
const inspectElectronPageFacts = {
  ...approvedElectronInput,
  target_id: z.string().min(1),
  observation_ms: z.int().min(0).default(100),
  command_timeout_ms: webRuntimeCommandTimeoutSchema,
} as const;
export const inspectElectronPageInputSchema = z.union([
  z.strictObject({
    ...inspectElectronPageFacts,
    include_script_sources: z.literal(false).default(false),
  }),
  z.strictObject({
    ...inspectElectronPageFacts,
    include_script_sources: z.literal(true),
  }),
]);
export type InspectElectronPageInput = z.infer<
  typeof inspectElectronPageInputSchema
>;

const electronTargetSchema = z.object({
  target_id: z.string(),
  type: z.string(),
  title: z.string(),
  file_path: z.string(),
  attached: z
    .boolean()
    .nullable()
    .describe(
      "Discovery-reported debugger attachment state; null means unknown",
    ),
});

/** Complete local file target inventory from one Electron CDP endpoint. */
export const electronTargetListSchema = z.object({
  browser: browserVersionSchema,
  targets: z.array(electronTargetSchema),
  excluded: z.object({
    unsupported_url: z.int().min(0),
    non_page: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});
export type ElectronTargetList = z.infer<typeof electronTargetListSchema>;

const electronScriptFrameClaimsSchema = z.object({
  script_event_frame_id: z.string().exactOptional(),
  execution_context_frame_id: z.string().exactOptional(),
});
/** Actual reported claims remain available when their resolved association is unknown. */
export type ElectronScriptFrameClaims = z.infer<
  typeof electronScriptFrameClaimsSchema
>;

/** Provider-neutral passive Electron file-page structure and script inventory. */
export const electronPageInspectionSchema = z.object({
  browser: browserVersionSchema,
  target: electronTargetSchema,
  capture_window: z.object({
    started_at: utcDateTimeSchema,
    ended_at: utcDateTimeSchema,
    observation_ms: z.int().min(0),
  }),
  completeness: browserCompletenessSchema,
  frames: z.array(
    z.object({
      frame_id: z.string(),
      parent_frame_id: z.string().nullable(),
      file_path: z.string(),
    }),
  ),
  dom: cdpDomSnapshotSchema,
  scripts: z.object({
    total: z.int().min(0),
    items: z.array(
      z.object({
        script_key: prefixedDigestSchema("electron_script"),
        frame_id: z.string().nullable().default(null),
        frame_scope: z.enum(["authorized", "unknown"]).exactOptional(),
        frame_claims: electronScriptFrameClaimsSchema.exactOptional(),
        file_path: z.string(),
        has_source_url: z.boolean().nullable().exactOptional(),
        reported_url: z.string().exactOptional(),
        ...cdpScriptMetadataSchema.shape,
        source: cdpScriptSourceSchema,
      }),
    ),
  }),
  resources: z.array(
    z.object({
      resource_key: prefixedDigestSchema("electron_resource"),
      file_path: z.string(),
      type: z.string(),
      mime_type: z.string(),
      content_size: z.number().min(0).nullable(),
    }),
  ),
  workers: z
    .array(
      z.object({
        target_id: z.string().min(1),
        type: z.string().min(1),
        file_path: z.string(),
        attached: z.boolean(),
        opener_target_id: z.string().min(1).nullable(),
        parent_frame_id: z.string().min(1).nullable(),
      }),
    )
    .default([]),
  limitations: z.array(z.string()),
});
export type ElectronPageInspection = z.infer<
  typeof electronPageInspectionSchema
>;

/** Completed Electron facts retained when later request finalization fails. */
export interface ElectronPagePartialObservation {
  readonly kind: "electron-page-observation";
  readonly inspection: ElectronPageInspection;
  /** REA's CDP transport closed; target shutdown is never implied. */
  readonly cleanup: "transport-closed" | "incomplete";
}
