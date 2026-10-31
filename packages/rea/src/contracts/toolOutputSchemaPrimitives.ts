import { procedureInfoSchema } from "../domain/native/procedureInfo.js";
import { z } from "zod";
import { utcDateTimeSchema } from "../domain/offsetDateTime.js";

import { functionDossierSchema } from "../domain/native/functionDossier.js";
import { analysisProfileSchema } from "../domain/analysisProfile.js";
import {
  evidenceSchema,
  validateAnalysisProfileProvider,
} from "../domain/evidence.js";
import { jsonObjectSchema } from "../domain/jsonValue.js";
import {
  PROVIDER_REJECTION_CODES,
  type ProviderRejectionCode,
} from "../domain/providerSelection.js";
import {
  PROVIDER_FAILURE_STAGES,
  PROVIDER_OPERATION_STATES,
  PROVIDER_RETRY_ACTIONS,
} from "../domain/providerOperationHealth.js";
import {
  objcClassDiscoveryCoverageSchema,
  objcClassImportIdentitySchema,
} from "../domain/native/objcSwiftMetadata.js";
import { BINARY_SESSION_SUMMARY_OMITTED_FIELDS } from "./sessionStatusContract.js";

/** Specialize the single normalized result inside a complete Evidence record. */
export const evidenceResultOf = <Schema extends z.ZodType>(schema: Schema) =>
  z
    .strictObject({ ...evidenceSchema.shape, normalized_result: schema })
    .superRefine(validateAnalysisProfileProvider);

/** Wrap a lifecycle result while preserving its exact schema type. */
export const lifecycleResultOf = <Schema extends z.ZodType>(schema: Schema) =>
  z.object({ result: schema });

/** Resolve a required named output schema or reject contract drift. */
export const requireOutputSchema = <
  Schemas extends Readonly<Record<string, z.ZodObject>>,
  Name extends keyof Schemas & string,
>(
  schemas: Schemas,
  name: Name,
): Schemas[Name] => {
  const schema = schemas[name];
  if (schema === undefined)
    throw new Error(`Missing output schema for ${name}`);
  return schema;
};

const providerCapabilityFacts = {
  operation: z.string(),
  effects: z.object({
    mutates_artifact: z.boolean(),
    launches_process: z.boolean(),
    may_show_ui: z.boolean(),
    may_access_network: z.boolean(),
    may_write_filesystem: z.boolean(),
    changes_permissions: z.boolean(),
    requires_root: z.boolean(),
  }),
  limitations: z.array(z.string()),
};

export const providerCapability = z.discriminatedUnion("available", [
  z.object({
    ...providerCapabilityFacts,
    available: z.literal(true),
    reason: z.null(),
    availability_code: z.null(),
  }),
  z.object({
    ...providerCapabilityFacts,
    available: z.literal(false),
    reason: z.string().nullable(),
    availability_code: z.enum(PROVIDER_REJECTION_CODES).nullable(),
  }),
]);
export type ProviderCapability = z.output<typeof providerCapability>;

/** Listed effects are true; all other members of this closed vocabulary are false. */
export const PROVIDER_EFFECT_NAMES = Object.keys(
  providerCapabilityFacts.effects.shape,
) as (keyof z.output<typeof providerCapabilityFacts.effects>)[];

export const providerIdentity = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string().nullable(),
});

const providerCapabilityGroupFacts = {
  operations: z.array(z.string().min(1)).min(1),
  effects: z.array(providerCapabilityFacts.effects.keyof()),
  limitations: z.array(z.string()),
};

const providerCapabilityGroup = z.discriminatedUnion("available", [
  z.strictObject({
    ...providerCapabilityGroupFacts,
    available: z.literal(true),
    reason: z.null(),
    availability_code: z.null(),
  }),
  z.strictObject({
    ...providerCapabilityGroupFacts,
    available: z.literal(false),
    reason: z.string().nullable(),
    availability_code: z.enum(PROVIDER_REJECTION_CODES).nullable(),
  }),
]);

/** Shared limitations precede each group's suffix, preserving exact source order. */
export const providerCapabilitySet = z.strictObject({
  provider: providerIdentity,
  shared_limitations: z.array(z.string()),
  groups: z.array(providerCapabilityGroup),
});
export type ProviderCapabilitySet = z.output<typeof providerCapabilitySet>;

/** Decode one status scope without losing provider identity or limitation order. */
export const expandProviderCapabilities = (
  sets: readonly ProviderCapabilitySet[],
): readonly (ProviderCapability & {
  readonly provider: z.output<typeof providerIdentity>;
})[] =>
  sets.flatMap((set) =>
    set.groups.flatMap((group) =>
      group.operations.map((operation) => ({
        ...providerCapability.parse({
          operation,
          available: group.available,
          reason: group.reason,
          availability_code: group.availability_code,
          effects: Object.fromEntries(
            PROVIDER_EFFECT_NAMES.map((name) => [
              name,
              group.effects.includes(name),
            ]),
          ),
          limitations: [...set.shared_limitations, ...group.limitations],
        }),
        provider: set.provider,
      })),
    ),
  );

const processCoordinates = {
  launcher_pid: z.int().min(1),
  process_group_id: z.int().min(1),
};

const processLineageObservation = z.discriminatedUnion("status", [
  z.object({
    status: z.literal("unavailable"),
    observed_at: utcDateTimeSchema,
    ...processCoordinates,
    reason: z.string().min(1),
  }),
  z.object({
    status: z.literal("verified"),
    observed_at: utcDateTimeSchema,
    ...processCoordinates,
    launcher_parent_pid: z.int().min(0),
    descendants: z.array(
      z.object({
        pid: z.int().min(1),
        parent_pid: z.int().min(0),
        process_group_id: z.int().min(1),
      }),
    ),
  }),
]);

const analysisRun = z
  .object({
    run_id: z.string().uuid(),
    process_lineage: z.discriminatedUnion("status", [
      z.object({ status: z.literal("not_observed") }),
      z.object({
        status: z.literal("snapshots"),
        snapshots: z.array(
          z.object({
            provider: providerIdentity,
            observation: processLineageObservation,
          }),
        ),
      }),
    ]),
  })
  .nullable();

export const analysisActivity = z.object({
  status: z.enum(["not_observed", "idle", "busy"]),
  providers: z.array(
    z.object({
      provider: providerIdentity,
      active: z
        .object({
          request_id: z.int().min(1),
          operation: z.string().min(1),
          elapsed_ms: z.int().min(0),
          caller_state: z.enum(["waiting", "cancelled"]),
        })
        .nullable(),
      queued_requests: z.int().min(0),
    }),
  ),
});

const providerOperationRequest = z.object({
  request_id: z.int().min(1),
  operation: z.string().min(1),
  stage: z.enum(PROVIDER_FAILURE_STAGES),
});

export const providerOperationHealth = z
  .object({
    state: z.enum(PROVIDER_OPERATION_STATES),
    stage: z.enum(PROVIDER_FAILURE_STAGES).nullable(),
    retry_action: z.enum(PROVIDER_RETRY_ACTIONS).nullable(),
    exit_code: z.int().nullable(),
    requests: z.array(providerOperationRequest),
  })
  .nullable();

const providerRejectionCode: z.ZodType<ProviderRejectionCode> = z.enum(
  PROVIDER_REJECTION_CODES,
);

const providerAvailabilityStates = {
  unknown: z.object({
    status: z.literal("unknown"),
    code: z.null(),
    reason: z.string().min(1),
  }),
  available: z.object({
    status: z.literal("available"),
    code: z.null(),
    reason: z.null(),
  }),
  unavailable: z.object({
    status: z.literal("unavailable"),
    code: providerRejectionCode,
    reason: z.string().min(1),
  }),
};

const providerAvailability = z.discriminatedUnion("status", [
  providerAvailabilityStates.unknown.extend({
    diagnostics: jsonObjectSchema,
  }),
  providerAvailabilityStates.available.extend({
    diagnostics: jsonObjectSchema,
  }),
  providerAvailabilityStates.unavailable.extend({
    diagnostics: jsonObjectSchema,
  }),
]);

const providerTargetSupportStates = {
  unknown: z.object({
    status: z.literal("unknown"),
    code: z.null(),
    reason: z.string().min(1),
  }),
  supported: z.object({
    status: z.literal("supported"),
    code: z.null(),
    reason: z.null(),
  }),
  unsupported: z.object({
    status: z.literal("unsupported"),
    code: z.enum([
      "target_kind_unsupported",
      "target_format_unsupported",
      "architecture_unsupported",
      "target_role_unsupported",
      "managed_target_unsupported",
    ]),
    reason: z.string().min(1),
  }),
};

const providerTargetSupport = z.discriminatedUnion("status", [
  providerTargetSupportStates.unknown.extend({
    diagnostics: jsonObjectSchema,
  }),
  providerTargetSupportStates.supported.extend({
    diagnostics: jsonObjectSchema,
  }),
  providerTargetSupportStates.unsupported.extend({
    diagnostics: jsonObjectSchema,
  }),
]);

/** Complete candidate facts, including provider-owned diagnostics and capability sets. */
export const analysisProviderCandidate = z.object({
  provider: providerIdentity,
  availability: providerAvailability,
  target_support: providerTargetSupport,
  selected: z.boolean(),
  capabilities: z.array(providerCapabilitySet),
});

/** Summary candidate: the same status, code, and reason without diagnostics or capabilities. */
export const analysisProviderCandidateSummary = z.strictObject({
  provider: providerIdentity,
  availability: z.discriminatedUnion("status", [
    providerAvailabilityStates.unknown.strict(),
    providerAvailabilityStates.available.strict(),
    providerAvailabilityStates.unavailable.strict(),
  ]),
  target_support: z.discriminatedUnion("status", [
    providerTargetSupportStates.unknown.strict(),
    providerTargetSupportStates.supported.strict(),
    providerTargetSupportStates.unsupported.strict(),
  ]),
  selected: z.boolean(),
});

const clientFeatureNameSchema = z.enum([
  "elicitation_form",
  "elicitation_url",
  "roots",
  "sampling",
]);

/** Negotiated MCP client features that affect REA workflow availability. */
export const clientFeatureAvailabilitySchema = z.object({
  elicitation_form: z.boolean(),
  elicitation_url: z.boolean(),
  roots: z.boolean(),
  sampling: z.boolean(),
});
export type ClientFeatureAvailability = z.infer<
  typeof clientFeatureAvailabilitySchema
>;

const toolAvailabilityMode = z.discriminatedUnion("available", [
  z.object({
    name: z.string(),
    available: z.literal(true),
    missing_operations: z.array(z.string()).length(0),
    remediation: z.null(),
  }),
  z.object({
    name: z.string(),
    available: z.literal(false),
    missing_operations: z.array(z.string()).min(1),
    remediation: z.string().nullable(),
  }),
]);
export type ToolAvailabilityMode = z.output<typeof toolAvailabilityMode>;

const toolAvailabilityFacts = {
  name: z.string(),
  surface: z.string(),
  default_mode_available: z.boolean().optional(),
  modes: z.array(toolAvailabilityMode).optional(),
  client_requirements: z.object({
    required: z.array(clientFeatureNameSchema),
    optional: z.array(clientFeatureNameSchema),
    missing_required: z.array(clientFeatureNameSchema),
    missing_optional: z.array(clientFeatureNameSchema),
  }),
  effects: z.strictObject({
    mutatesTarget: z.boolean(),
    mutatesSession: z.boolean(),
    writesFilesystem: z.boolean(),
    launchesProcess: z.boolean(),
    accessesNetwork: z.boolean(),
    changesUiState: z.boolean(),
    mayDiscardData: z.boolean(),
    executesForeignCode: z.boolean(),
    mutatesDevice: z.boolean(),
    idempotent: z.boolean(),
  }),
  annotations: z.object({
    read_only: z.boolean(),
    destructive: z.boolean(),
    idempotent: z.boolean(),
    open_world: z.boolean(),
  }),
};

export const toolUnavailabilityReason = z.enum([
  "client_capability_missing",
  "target_required",
  "provider_missing",
  "provider_unavailable",
  "target_unsupported",
  "unsupported_host",
]);

export const toolAvailability = z.discriminatedUnion("available", [
  z.object({
    ...toolAvailabilityFacts,
    available: z.literal(true),
    reason: z.literal("available"),
    remediation: z.null(),
  }),
  z.object({
    ...toolAvailabilityFacts,
    available: z.literal(false),
    reason: toolUnavailabilityReason,
    remediation: z.string().nullable(),
  }),
]);
export type ToolAvailability = z.output<typeof toolAvailability>;
export type ToolUnavailabilityReason = z.output<
  typeof toolUnavailabilityReason
>;

export const TOOL_EFFECT_NAMES = Object.keys(
  toolAvailabilityFacts.effects.shape,
) as (keyof z.output<typeof toolAvailabilityFacts.effects>)[];
export const TOOL_ANNOTATION_NAMES = Object.keys(
  toolAvailabilityFacts.annotations.shape,
) as (keyof z.output<typeof toolAvailabilityFacts.annotations>)[];

const toolAvailabilityStatusGroupFacts = {
  names: z.array(z.string().min(1)).min(1),
  default_mode_available: toolAvailabilityFacts.default_mode_available,
  modes: toolAvailabilityFacts.modes,
  client_requirements: toolAvailabilityFacts.client_requirements.optional(),
};

const toolAvailabilityGroupFacts = {
  names: toolAvailabilityStatusGroupFacts.names,
  surface: toolAvailabilityFacts.surface,
  default_mode_available:
    toolAvailabilityStatusGroupFacts.default_mode_available,
  modes: toolAvailabilityStatusGroupFacts.modes,
  client_requirements: toolAvailabilityStatusGroupFacts.client_requirements,
  effects: z.array(toolAvailabilityFacts.effects.keyof()),
  annotations: z.array(toolAvailabilityFacts.annotations.keyof()),
};

const toolAvailabilityGroupOf = <Facts extends z.ZodRawShape>(facts: Facts) =>
  z.discriminatedUnion("available", [
    z.strictObject({
      ...facts,
      available: z.literal(true),
      reason: z.literal("available"),
      remediation: z.null(),
    }),
    z.strictObject({
      ...facts,
      available: z.literal(false),
      reason: toolUnavailabilityReason,
      remediation: z.string().nullable(),
    }),
  ]);

/** Complete inventory with explicit inherited client requirements and enabled flags. */
export const toolAvailabilityInventory = z.strictObject({
  client_requirements: toolAvailabilityFacts.client_requirements,
  groups: z.array(toolAvailabilityGroupOf(toolAvailabilityGroupFacts)),
});
export type ToolAvailabilityInventory = z.output<
  typeof toolAvailabilityInventory
>;

/**
 * Summary inventory: every tool name with its current availability, reason,
 * remediation, modes, and client requirements, grouped by those facts alone.
 * Static surface, effect, and annotation flags are omitted, not false.
 */
export const toolAvailabilitySummaryInventory = z.strictObject({
  client_requirements: toolAvailabilityFacts.client_requirements,
  groups: z.array(toolAvailabilityGroupOf(toolAvailabilityStatusGroupFacts)),
});
export type ToolAvailabilitySummaryInventory = z.output<
  typeof toolAvailabilitySummaryInventory
>;

/** One tool's current availability without its static catalog flags. */
export type ToolAvailabilitySummary = Omit<
  ToolAvailability,
  "surface" | "effects" | "annotations"
>;

const isCompleteToolAvailabilityInventory = (
  inventory: ToolAvailabilityInventory | ToolAvailabilitySummaryInventory,
): inventory is ToolAvailabilityInventory =>
  inventory.groups.every((group) => "surface" in group);

/** Expand the wire representation once at the consuming boundary. */
export function expandToolAvailability(
  inventory: ToolAvailabilityInventory,
): readonly ToolAvailability[];
export function expandToolAvailability(
  inventory: ToolAvailabilityInventory | ToolAvailabilitySummaryInventory,
): readonly (ToolAvailability | ToolAvailabilitySummary)[];
export function expandToolAvailability(
  inventory: ToolAvailabilityInventory | ToolAvailabilitySummaryInventory,
): readonly (ToolAvailability | ToolAvailabilitySummary)[] {
  if (!isCompleteToolAvailabilityInventory(inventory))
    return inventory.groups.flatMap(({ names, ...group }) =>
      names.map((name) => ({
        ...group,
        name,
        client_requirements:
          group.client_requirements ?? inventory.client_requirements,
      })),
    );
  return inventory.groups.flatMap((group) =>
    group.names.map((name) =>
      toolAvailability.parse({
        ...group,
        name,
        client_requirements:
          group.client_requirements ?? inventory.client_requirements,
        effects: Object.fromEntries(
          TOOL_EFFECT_NAMES.map((effect) => [
            effect,
            group.effects.includes(effect),
          ]),
        ),
        annotations: Object.fromEntries(
          TOOL_ANNOTATION_NAMES.map((annotation) => [
            annotation,
            group.annotations.includes(annotation),
          ]),
        ),
      }),
    ),
  );
}

/** Session status facts shared by every detail level and session kind. */
export const sessionProviderFacts = z
  .object({
    cleanup_pending: z.boolean(),
    capabilities: z.array(providerCapabilitySet),
    analysis_run: analysisRun,
    analysis_activity: analysisActivity,
    provider_operation_health: providerOperationHealth,
    analysis_provider_binding: z
      .object({
        provider: providerIdentity,
        selection_source: z.enum([
          "request",
          "environment",
          "auto-single-candidate",
        ]),
        analysis_profile: analysisProfileSchema,
      })
      .nullable(),
    client_features: z.object({
      elicitation_form: z.boolean(),
      elicitation_url: z.boolean(),
      roots: z.boolean(),
      sampling: z.boolean(),
    }),
    server_identity: z.object({
      package: z.object({
        name: z.string(),
        version: z.string(),
        root_path: z.string(),
        build_commit: z.string().nullable(),
      }),
      server: z.object({
        name: z.string(),
        version: z.string(),
        started_at: z.string(),
        command_path: z.string().nullable(),
      }),
      sdk: z.object({
        server: z.string(),
        client_test: z.string(),
        core: z.string(),
      }),
      negotiated_protocol_version: z.string().nullable(),
      client: z.object({ name: z.string(), version: z.string() }).nullable(),
      skill: z.object({ name: z.string(), expected_version: z.string() }),
      catalog: z.strictObject({
        counts: z.strictObject({
          cli_commands: z.int().min(0),
          mcp_tools: z.int().min(0),
          mcp_prompts: z.int().min(0),
        }),
        digests: z.strictObject({
          tools_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          prompts_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
          combined_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
        }),
      }),
      protocol_features: z.object({
        progress: z.boolean(),
        cancellation: z.boolean(),
        elicitation: z.boolean(),
      }),
      alignment: z.object({
        state: z.enum(["aligned", "mcp_server_restart_required", "unknown"]),
        reasons: z.array(z.string()),
        remediation: z.string().nullable(),
      }),
    }),
  })
  .passthrough();

/**
 * Fields whose shape `detail` selects. A summary must list what it omits and
 * carry only summary candidates and tool groups; complete detail must carry
 * diagnostics, candidate capabilities and static tool flags, and no omission list.
 */
export const sessionStatusDetailShapes = [
  {
    detail: z.literal("summary"),
    omitted_fields: z
      .array(z.enum(BINARY_SESSION_SUMMARY_OMITTED_FIELDS))
      .min(1),
    analysis_provider_candidates: z.array(analysisProviderCandidateSummary),
    tool_availability: toolAvailabilitySummaryInventory,
  },
  {
    detail: z.literal("complete"),
    omitted_fields: z.never().optional(),
    analysis_provider_candidates: z.array(analysisProviderCandidate),
    tool_availability: toolAvailabilityInventory,
  },
] as const;

export const nullableText = z.string().nullable();
export const addressedEntry = z.object({
  address: z.string(),
  name: z.string(),
});
const unavailable = z.object({
  available: z.literal(false),
  reason: z.string(),
});

const availableMemoryPermissions = z.object({
  available: z.literal(true),
  source: z.literal("ghidra-memory-block"),
});

const memoryRegionOutput = z.object({
  name: z.string(),
  start: z.string(),
  end: z.string(),
  readable: z.boolean().nullable(),
  writable: z.boolean().nullable(),
  executable: z.boolean().nullable(),
  permissions: z.union([unavailable, availableMemoryPermissions]),
  provenance: z.enum(["hopper-public-python-api", "ghidra-memory-block"]),
  address_space: z.string().optional(),
  image_base: z.string().optional(),
  initialized: z.boolean().optional(),
  overlay: z.boolean().optional(),
});

export const segmentOutput = evidenceResultOf(
  z.array(memoryRegionOutput.extend({ sections: z.array(memoryRegionOutput) })),
);

export const procedureInfoOutput = evidenceResultOf(procedureInfoSchema);

export const symbolDiscoveryOutput = (property: "classes" | "protocols") =>
  evidenceResultOf(
    z.object({
      count: z.int().min(0),
      [property]: z.array(addressedEntry),
    }),
  );

export const objcClassDiscoveryOutput = evidenceResultOf(
  z.object({
    count: z.int().min(0),
    classes: z.array(
      addressedEntry.extend({
        binding_identity: objcClassImportIdentitySchema
          .extend({
            slot_addresses: z.array(z.string().min(1)).min(1),
          })
          .optional(),
      }),
    ),
    identity_coverage: objcClassDiscoveryCoverageSchema,
  }),
);

export const functionDossierOutput = evidenceResultOf(functionDossierSchema);
