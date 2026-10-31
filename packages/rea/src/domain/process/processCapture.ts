import { z } from "zod";
import { observedSymlinkTarget } from "../symlinkTarget.js";
import { utcDateTimeSchema } from "../offsetDateTime.js";
import { jsonValueSchema } from "../jsonValue.js";

import { normalizationSchema } from "./processScenario.js";
import {
  collectProcessCaptureIssues,
  finalizationAgreementIssue,
  finalizationConsistencyIssue,
  finalizationManifestIssue,
} from "./processCaptureValidation.js";
import {
  filesystemCoverageSchema,
  processCaptureTruncationDetailsSchema,
  type FilesystemCoverage,
  type ProcessCaptureTruncationDetails,
} from "./processCaptureCoverage.js";

/** Normalized raw PTY chunk, preserving transport-level output differences. */
export interface TerminalFrame {
  readonly sequence: number;
  readonly at_ms: number;
  readonly data: string;
  /** Pre-normalization PTY projection; sensitive captures redact it, older captures may omit it. */
  readonly raw_data?: string | undefined;
}

/** Terminal state after control/resize parsing; sensitive captures use redacted PTY input. */
export interface RenderedTerminalFrame {
  readonly sequence: number;
  readonly at_ms: number;
  readonly columns: number;
  readonly rows: number;
  readonly cursor_x: number;
  readonly cursor_y: number;
  readonly active_buffer: "normal" | "alternate";
  readonly lines: readonly string[];
  readonly serialized_state: string;
}

/** Scheduled interaction; new private facts are paired, legacy records remain valid. */
const interactionEventSchema = z
  .object({
    sequence: z.int().nonnegative(),
    scheduled_at_ms: z.int().nonnegative(),
    dispatched_at_ms: z.int().nonnegative(),
    type: z.enum(["input", "resize", "signal"]),
    data: z.string(),
    sensitive: z.literal(true).optional(),
    input_bytes: z.int().nonnegative().optional(),
    outcome: z.enum(["dispatched", "target_exited", "failed"]),
  })
  .superRefine((event, context) => {
    if (
      (event.sensitive === true) !== (event.input_bytes !== undefined) ||
      (event.sensitive === true &&
        (event.type !== "input" || event.data !== ""))
    )
      context.addIssue({
        code: "custom",
        message:
          "Private input facts require input type, empty data, sensitive: true and input_bytes together.",
      });
  });
export type InteractionEvent = Readonly<z.infer<typeof interactionEventSchema>>;

/** Observed finalization attempts after a deadline fired. */
export interface ProcessCaptureFinalization {
  readonly requested_ms: number;
  readonly elapsed_ms: number | null;
  /** Code the PTY reported for an exit not caused by a signal; otherwise null. */
  readonly exit_code: number | null;
  readonly signals: readonly {
    readonly signal: "SIGTERM" | "SIGKILL";
    readonly sent_at_ms: number;
    readonly delivery: "signaled" | "gone" | "identity-changed" | "unverified";
    /** Why delivery could not be verified; present only for unverified attempts. */
    readonly reason?: string | undefined;
  }[];
}

/** One filesystem state used for before/after comparison. */
interface FileStateIdentity {
  readonly path: string;
  readonly mode: number;
  readonly size: number;
}

export type FileState = FileStateIdentity &
  (
    | {
        readonly type: "file";
        readonly sha256: string | null;
        readonly symlink_target: null;
      }
    | {
        readonly type: "symlink";
        readonly sha256: null;
        readonly symlink_target: string | null;
        /** Exact stored target bytes; omitted by legacy captures. */
        readonly symlink_target_hex?: string | undefined;
      }
    | {
        readonly type: "directory" | "other";
        readonly sha256: null;
        readonly symlink_target: null;
      }
  );

/** Complete metadata returned for one root-aliased filesystem checkpoint. */
export interface ProcessFilesystemSnapshot {
  readonly files: readonly FileState[];
  readonly truncated: boolean;
  /** Physical root enumeration exhausted; unfollowed symlink scopes remain unknown. */
  readonly completeRoots: readonly string[];
  readonly coverage: FilesystemCoverage;
}

interface FileEffectIdentity {
  readonly path: string;
}

type FileEffect = FileEffectIdentity &
  (
    | {
        readonly status: "created";
        readonly before: null;
        readonly after: FileState;
      }
    | {
        readonly status: "deleted";
        readonly before: FileState;
        readonly after: null;
      }
    | {
        readonly status: "modified" | "unchanged";
        readonly before: FileState;
        readonly after: FileState;
      }
    | {
        readonly status: "unknown";
        readonly before: FileState | null;
        readonly after: FileState | null;
        readonly reason: string;
      }
  );

/** A sampled owned-process observation; sampling cannot prove syscall completeness. */
export interface ProcessSample {
  readonly at_ms: number;
  readonly pid: number;
  readonly parent_pid: number;
  readonly command: string;
  readonly process_group_id: number | null;
  readonly session_id: number | null;
}

/** Initial or final filesystem snapshot selected for observation. */
export interface FilesystemCheckpoint {
  readonly name: string;
  readonly at_ms: number;
  readonly files: readonly FileState[];
  readonly effects: readonly FileEffect[];
  readonly truncated: boolean;
}

/** Capture collection whose members participate in global observation order. */
export const PROCESS_CAPTURE_EVENT_COLLECTIONS = [
  "frames",
  "rendered_frames",
  "interaction_events",
  "lifecycle",
  "process_samples",
  "filesystem_checkpoints",
] as const;

export type ProcessCaptureEventCollection =
  (typeof PROCESS_CAPTURE_EVENT_COLLECTIONS)[number];

/** One reference from global observation order into a capture collection. */
export interface ProcessCaptureEventJournalEntry {
  readonly capture_order: number;
  readonly collection: ProcessCaptureEventCollection;
  readonly index: number;
}

/** Shared observation callback used by every process-capture producer. */
export type RecordProcessCaptureEvent = (
  collection: ProcessCaptureEventCollection,
  index: number,
) => void;

/** Observed process-tree settlement and the cleanup required by that state. */
export type ProcessSettlement =
  | VerifiedProcessSettlement
  | {
      readonly state: "quiesced";
      readonly elapsed_ms: number;
      readonly cleanup_outcome: "failed";
    };

export type VerifiedProcessSettlement =
  | {
      readonly state: "quiesced";
      readonly elapsed_ms: number;
      readonly cleanup_outcome: "not_required";
    }
  | {
      readonly state: "alive_at_deadline" | "unverifiable";
      readonly elapsed_ms: number;
      readonly cleanup_outcome: "cleaned" | "failed";
    };

/**
 * Process capture observation set.
 *
 * `truncated` and `residual_unknowns` are semantic evidence: consumers must not
 * infer equivalence from matching bounded observations when either is present.
 */
export interface UnverifiedProcessCapture {
  readonly manifest: {
    readonly rea_version: string;
    readonly provider_version: string;
    readonly platform: string;
    readonly architecture: string;
    readonly pty_backend: "node-pty";
    readonly started_at: string;
    readonly completed_at: string;
    readonly scenario: Readonly<Record<string, unknown>>;
    readonly comparison_contract: Readonly<Record<string, unknown>>;
    readonly full_scenario_sha256: string;
    readonly comparison_contract_sha256: string;
    /** Digest of the selected file sampled before spawn, when readable. */
    readonly selected_executable_sha256: string | null;
    /** Digest associated with the launch only when path metadata stayed stable across spawn. */
    readonly executable_sha256: string | null;
    readonly executable_identity: {
      readonly state: "path_metadata_unchanged" | "unknown";
      readonly reason: string | null;
    };
    readonly normalization_sha256: string;
  };
  readonly normalization: z.infer<typeof normalizationSchema>;
  readonly frames: readonly TerminalFrame[];
  readonly rendered_frames: readonly RenderedTerminalFrame[];
  readonly interaction_events: readonly InteractionEvent[];
  readonly exit: {
    readonly code: number | null;
    readonly signal: number | null;
    readonly reason: "exited" | "timeout" | "idle_timeout";
    readonly finalization?: ProcessCaptureFinalization | undefined;
  };
  readonly settlement: VerifiedProcessSettlement;
  readonly process_samples: readonly ProcessSample[];
  readonly filesystem_checkpoints: readonly FilesystemCheckpoint[];
  /** Global observation order across independently recorded collections. */
  readonly event_journal: readonly ProcessCaptureEventJournalEntry[];
  readonly files_before: readonly FileState[];
  readonly files_after: readonly FileState[];
  readonly filesystem_effects: readonly FileEffect[];
  readonly truncated: boolean;
  /** Per-source accounting for the producer's actual capture coverage. */
  readonly truncation_details: ProcessCaptureTruncationDetails;
  readonly limitations: readonly string[];
  readonly residual_unknowns: readonly {
    readonly scope:
      | "terminal"
      | "interaction"
      | "exit"
      | "process"
      | "filesystem"
      | "cleanup"
      | "network"
      | "environment";
    readonly reason: string;
  }[];
  readonly cleanup: {
    readonly owned_process_group: "verified";
    readonly temporary_root: "removed";
    /** Unrelated processes whose ownership token the host could not expose. */
    readonly unverified_processes?:
      | readonly UnverifiedCleanupProcess[]
      | undefined;
  };
}

const fileStateShape = {
  path: z.string(),
  mode: z.int().nonnegative(),
  size: z.int().nonnegative(),
};

/** An unrelated process left untouched because its ownership is unknown. */
export interface UnverifiedCleanupProcess {
  readonly pid: number;
  readonly reason: string;
}

/** A resource cleanup result retained when observations cannot be verified. */
export interface ProcessCaptureResourceCleanup {
  readonly state: "cleaned" | "failed" | "unverified" | "not_required";
  readonly reason: string | null;
  readonly unverified_processes?:
    | readonly UnverifiedCleanupProcess[]
    | undefined;
}

export interface ProcessCaptureCleanupReport {
  readonly owned_process_group: ProcessCaptureResourceCleanup;
  readonly terminal_renderer: ProcessCaptureResourceCleanup;
  readonly temporary_root: ProcessCaptureResourceCleanup;
}

/** One observation field that may be unavailable when capture completion fails. */
export type PartialProcessObservationField<T> =
  | { readonly state: "available"; readonly value: T }
  | { readonly state: "unavailable"; readonly reason: string };

/** Available and unavailable fields when a run never becomes a full capture. */
export interface IncompleteProcessCaptureObservations {
  readonly target_pid: PartialProcessObservationField<number>;
  readonly frames: PartialProcessObservationField<readonly TerminalFrame[]>;
  readonly rendered_frames: PartialProcessObservationField<
    readonly RenderedTerminalFrame[]
  >;
  readonly interaction_events: PartialProcessObservationField<
    readonly InteractionEvent[]
  >;
  readonly exit: PartialProcessObservationField<{
    readonly code: number | null;
    readonly signal: number | null;
    readonly reason: "exited" | "timeout" | "idle_timeout" | "cancelled";
    readonly finalization?: ProcessCaptureFinalization | undefined;
  }>;
  readonly finalization?:
    | PartialProcessObservationField<ProcessCaptureFinalization>
    | undefined;
  readonly settlement: PartialProcessObservationField<{
    readonly state: "quiesced" | "alive_at_deadline" | "unverifiable";
    readonly elapsed_ms: number;
  }>;
  readonly process_samples: PartialProcessObservationField<
    readonly ProcessSample[]
  >;
  readonly filesystem_snapshots: {
    readonly before: PartialProcessObservationField<ProcessFilesystemSnapshot>;
    readonly after: PartialProcessObservationField<ProcessFilesystemSnapshot>;
  };
  readonly event_journal: PartialProcessObservationField<
    readonly ProcessCaptureEventJournalEntry[]
  >;
  readonly manifest: PartialProcessObservationField<
    UnverifiedProcessCapture["manifest"]
  >;
}

const fileStateSchema = z.discriminatedUnion("type", [
  z.object({
    ...fileStateShape,
    type: z.literal("file"),
    sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    symlink_target: z.null(),
  }),
  z
    .object({
      ...fileStateShape,
      type: z.literal("symlink"),
      sha256: z.null(),
      symlink_target: z.string().nullable(),
      symlink_target_hex: z
        .string()
        .regex(/^(?:[a-f0-9]{2})+$/u)
        .optional(),
    })
    .superRefine((file, context) => {
      if (file.symlink_target_hex === undefined) {
        if (file.symlink_target === null)
          context.addIssue({
            code: "custom",
            message: "An unknown symlink target requires its exact bytes",
          });
        return;
      }
      const { text } = observedSymlinkTarget(
        Buffer.from(file.symlink_target_hex, "hex"),
      );
      if (file.symlink_target !== text)
        context.addIssue({
          code: "custom",
          message: "Symlink target text contradicts its exact bytes",
        });
    }),
  z.object({
    ...fileStateShape,
    type: z.enum(["directory", "other"]),
    sha256: z.null(),
    symlink_target: z.null(),
  }),
]);
/** Canonical checkpoint facts retained even when capture completion fails. */
export const processFilesystemSnapshotSchema = z.strictObject({
  files: z.array(fileStateSchema),
  truncated: z.boolean(),
  completeRoots: z.array(z.string()),
  coverage: filesystemCoverageSchema,
});
const fileEffectSchema = z.discriminatedUnion("status", [
  z.object({
    path: z.string(),
    status: z.literal("created"),
    before: z.null(),
    after: fileStateSchema,
  }),
  z.object({
    path: z.string(),
    status: z.literal("deleted"),
    before: fileStateSchema,
    after: z.null(),
  }),
  z.object({
    path: z.string(),
    status: z.enum(["modified", "unchanged"]),
    before: fileStateSchema,
    after: fileStateSchema,
  }),
  z.object({
    path: z.string(),
    status: z.literal("unknown"),
    before: fileStateSchema.nullable(),
    after: fileStateSchema.nullable(),
    reason: z.string().min(1),
  }),
]);
/** Exact serialized shape of a process capture. */
const processSettlementSchema = z.discriminatedUnion("state", [
  z.object({
    state: z.literal("quiesced"),
    elapsed_ms: z.int().nonnegative(),
    cleanup_outcome: z.enum(["not_required", "failed"]),
  }),
  z.object({
    state: z.enum(["alive_at_deadline", "unverifiable"]),
    elapsed_ms: z.int().nonnegative(),
    cleanup_outcome: z.enum(["cleaned", "failed"]),
  }),
]);

const unverifiedCleanupProcessesSchema = z.array(
  z.strictObject({ pid: z.int().positive(), reason: z.string() }),
);

const processCaptureFinalizationSchema = z
  .strictObject({
    requested_ms: z.int().safe().positive(),
    elapsed_ms: z.int().nonnegative().nullable(),
    exit_code: z.int().nonnegative().nullable(),
    signals: z
      .array(
        z.strictObject({
          signal: z.enum(["SIGTERM", "SIGKILL"]),
          sent_at_ms: z.int().nonnegative(),
          delivery: z.enum([
            "signaled",
            "gone",
            "identity-changed",
            "unverified",
          ]),
          reason: z.string().min(1).optional(),
        }),
      )
      .min(1),
  })
  .superRefine((finalization, context) => {
    if (finalization.exit_code !== null && finalization.elapsed_ms === null)
      context.addIssue({
        code: "custom",
        path: ["exit_code"],
        message: "finalization exit_code requires an observed exit",
      });
    for (const [index, attempt] of finalization.signals.entries())
      if (attempt.reason !== undefined && attempt.delivery !== "unverified")
        context.addIssue({
          code: "custom",
          path: ["signals", index, "reason"],
          message:
            "finalization reason is only allowed for an unverified delivery",
        });
  });

const processCaptureShapeSchema = z.strictObject({
  manifest: z.strictObject({
    rea_version: z.string().min(1),
    provider_version: z.string().min(1),
    platform: z.string().min(1),
    architecture: z.string().min(1),
    pty_backend: z.literal("node-pty"),
    started_at: utcDateTimeSchema,
    completed_at: utcDateTimeSchema,
    scenario: z.record(z.string(), jsonValueSchema),
    comparison_contract: z.record(z.string(), jsonValueSchema),
    full_scenario_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    comparison_contract_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
    selected_executable_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    executable_sha256: z
      .string()
      .regex(/^[a-f0-9]{64}$/u)
      .nullable(),
    executable_identity: z.strictObject({
      state: z.enum(["path_metadata_unchanged", "unknown"]),
      reason: z.string().nullable(),
    }),
    normalization_sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  }),
  normalization: normalizationSchema,
  frames: z.array(
    z.object({
      sequence: z.int().nonnegative(),
      at_ms: z.int().nonnegative(),
      data: z.string(),
      raw_data: z.string().optional(),
    }),
  ),
  rendered_frames: z.array(
    z.object({
      sequence: z.int().nonnegative(),
      at_ms: z.int().nonnegative(),
      columns: z.int().positive(),
      rows: z.int().positive(),
      cursor_x: z.int().nonnegative(),
      cursor_y: z.int().nonnegative(),
      active_buffer: z.enum(["normal", "alternate"]),
      lines: z.array(z.string()),
      serialized_state: z.string(),
    }),
  ),
  interaction_events: z.array(interactionEventSchema),
  exit: z.object({
    code: z.int().nullable(),
    signal: z.int().nullable(),
    reason: z.enum(["exited", "timeout", "idle_timeout"]),
    finalization: processCaptureFinalizationSchema.optional(),
  }),
  settlement: z.discriminatedUnion("state", [
    z.object({
      state: z.literal("quiesced"),
      elapsed_ms: z.int().nonnegative(),
      cleanup_outcome: z.literal("not_required"),
    }),
    z.object({
      state: z.enum(["alive_at_deadline", "unverifiable"]),
      elapsed_ms: z.int().nonnegative(),
      cleanup_outcome: z.enum(["cleaned", "failed"]),
    }),
  ]),
  process_samples: z.array(
    z.object({
      at_ms: z.int().nonnegative(),
      pid: z.int().positive(),
      parent_pid: z.int().nonnegative(),
      command: z.string(),
      process_group_id: z.int().positive().nullable(),
      session_id: z.int().nonnegative().nullable(),
    }),
  ),
  filesystem_checkpoints: z.array(
    z.object({
      name: z.enum(["before", "after_settlement"]),
      at_ms: z.int().nonnegative(),
      files: z.array(fileStateSchema),
      effects: z.array(fileEffectSchema),
      truncated: z.boolean(),
    }),
  ),
  event_journal: z.array(
    z.object({
      capture_order: z.int().nonnegative(),
      collection: z.enum(PROCESS_CAPTURE_EVENT_COLLECTIONS),
      index: z.int().nonnegative(),
    }),
  ),
  files_before: z.array(fileStateSchema),
  files_after: z.array(fileStateSchema),
  filesystem_effects: z.array(fileEffectSchema),
  truncated: z.boolean(),
  truncation_details: processCaptureTruncationDetailsSchema,
  limitations: z.array(z.string()),
  residual_unknowns: z.array(
    z.object({
      scope: z.enum([
        "terminal",
        "interaction",
        "exit",
        "process",
        "filesystem",
        "cleanup",
        "network",
        "environment",
      ]),
      reason: z.string(),
    }),
  ),
  cleanup: z.object({
    owned_process_group: z.literal("verified"),
    temporary_root: z.literal("removed"),
    unverified_processes: unverifiedCleanupProcessesSchema.optional(),
  }),
});

const processCleanupResourceSchema = z.strictObject({
  state: z.enum(["cleaned", "failed", "unverified", "not_required"]),
  reason: z.string().nullable(),
  unverified_processes: unverifiedCleanupProcessesSchema.optional(),
});

const partialObservationFieldSchema = <Schema extends z.ZodType>(
  value: Schema,
) =>
  z.discriminatedUnion("state", [
    z.strictObject({ state: z.literal("available"), value }),
    z.strictObject({ state: z.literal("unavailable"), reason: z.string() }),
  ]);

const incompleteProcessCaptureObservationsSchema = z.strictObject({
  target_pid: partialObservationFieldSchema(z.int().positive()),
  frames: partialObservationFieldSchema(processCaptureShapeSchema.shape.frames),
  rendered_frames: partialObservationFieldSchema(
    processCaptureShapeSchema.shape.rendered_frames,
  ),
  interaction_events: partialObservationFieldSchema(
    processCaptureShapeSchema.shape.interaction_events,
  ),
  exit: partialObservationFieldSchema(
    z.strictObject({
      code: z.int().nullable(),
      signal: z.int().nullable(),
      reason: z.enum(["exited", "timeout", "idle_timeout", "cancelled"]),
      finalization: processCaptureFinalizationSchema.optional(),
    }),
  ),
  finalization: partialObservationFieldSchema(
    processCaptureFinalizationSchema,
  ).optional(),
  settlement: partialObservationFieldSchema(
    z.strictObject({
      state: z.enum(["quiesced", "alive_at_deadline", "unverifiable"]),
      elapsed_ms: z.int().nonnegative(),
    }),
  ),
  process_samples: partialObservationFieldSchema(
    processCaptureShapeSchema.shape.process_samples,
  ),
  filesystem_snapshots: z.strictObject({
    before: partialObservationFieldSchema(processFilesystemSnapshotSchema),
    after: partialObservationFieldSchema(processFilesystemSnapshotSchema),
  }),
  event_journal: partialObservationFieldSchema(
    processCaptureShapeSchema.shape.event_journal,
  ),
  manifest: partialObservationFieldSchema(
    processCaptureShapeSchema.shape.manifest,
  ),
});

const partialCleanupReportSchema = z.strictObject({
  owned_process_group: processCleanupResourceSchema,
  terminal_renderer: processCleanupResourceSchema,
  temporary_root: processCleanupResourceSchema,
});
const partialObservationMetadataSchema = z.strictObject({
  cleanup: partialCleanupReportSchema,
  execution_failure: z.string().nullable(),
});
const completedCaptureObservationSchema = z.strictObject({
  capture: processCaptureShapeSchema
    .omit({ cleanup: true })
    .extend({ settlement: processSettlementSchema }),
});
const incompleteCaptureObservationSchema = z.strictObject({
  observations: incompleteProcessCaptureObservationsSchema,
});

/** Validated, non-comparable process observations attached to execution or cleanup errors. */
export const partialProcessCaptureObservationSchema = z
  .union([
    completedCaptureObservationSchema.extend(
      partialObservationMetadataSchema.shape,
    ),
    incompleteCaptureObservationSchema.extend(
      partialObservationMetadataSchema.shape,
    ),
  ])
  .superRefine((partial, context) => {
    const cleanupIncomplete = Object.values(partial.cleanup).some(
      ({ state }) => state === "failed" || state === "unverified",
    );
    if (!cleanupIncomplete && partial.execution_failure === null)
      context.addIssue({
        code: "custom",
        path: ["execution_failure"],
        message:
          "partial observations require incomplete cleanup or an execution failure",
      });

    const observedExit =
      "capture" in partial
        ? partial.capture.exit
        : partial.observations.exit.state === "available"
          ? partial.observations.exit.value
          : undefined;
    const observedFinalization =
      "observations" in partial &&
      partial.observations.finalization?.state === "available"
        ? partial.observations.finalization.value
        : undefined;
    const committedManifest =
      "capture" in partial
        ? partial.capture.manifest
        : partial.observations.manifest.state === "available"
          ? partial.observations.manifest.value
          : undefined;
    const manifestFinalizationIssue = finalizationManifestIssue(
      committedManifest?.scenario,
      committedManifest?.comparison_contract,
    );
    const exitFinalizationIssue =
      manifestFinalizationIssue ??
      (observedExit === undefined
        ? undefined
        : finalizationConsistencyIssue(
            observedExit,
            committedManifest?.scenario,
            committedManifest?.comparison_contract,
          ));
    const incompleteFinalizationIssue =
      manifestFinalizationIssue ??
      (observedFinalization === undefined
        ? undefined
        : finalizationConsistencyIssue(
            observedExit === undefined
              ? undefined
              : { reason: observedExit.reason, signal: observedExit.signal },
            committedManifest?.scenario,
            committedManifest?.comparison_contract,
            { finalization: observedFinalization, allowNullElapsedMs: true },
          ));
    if (exitFinalizationIssue !== undefined)
      context.addIssue({
        code: "custom",
        path: ["exit"],
        message: exitFinalizationIssue,
      });
    if (incompleteFinalizationIssue !== undefined)
      context.addIssue({
        code: "custom",
        path: ["finalization"],
        message: incompleteFinalizationIssue,
      });

    const agreementIssue = finalizationAgreementIssue(
      observedExit?.finalization,
      observedFinalization,
    );
    if (agreementIssue !== undefined)
      context.addIssue({
        code: "custom",
        path: ["finalization"],
        message: agreementIssue,
      });
    if (
      "observations" in partial &&
      partial.observations.exit.state === "unavailable" &&
      observedFinalization !== undefined &&
      observedFinalization?.elapsed_ms !== null
    )
      context.addIssue({
        code: "custom",
        path: ["finalization"],
        message:
          "finalization elapsed_ms must be null when the exit observation is unavailable",
      });

    if ("observations" in partial) {
      const { observations } = partial;
      if (
        ![
          observations.frames,
          observations.interaction_events,
          observations.process_samples,
          observations.filesystem_snapshots.before,
          observations.event_journal,
        ].some(({ state }) => state === "available")
      )
        context.addIssue({
          code: "custom",
          path: ["observations"],
          message: "incomplete observations contain no collected evidence",
        });
      return;
    }

    const { capture } = partial;
    const settlement =
      capture.settlement.state === "quiesced"
        ? {
            ...capture.settlement,
            cleanup_outcome: "not_required" as const,
          }
        : { ...capture.settlement, cleanup_outcome: "cleaned" as const };
    const validationCapture: UnverifiedProcessCapture = {
      ...capture,
      settlement,
      cleanup: {
        owned_process_group: "verified",
        temporary_root: "removed",
      },
    };
    for (const issue of collectProcessCaptureIssues(validationCapture))
      context.addIssue({
        code: "custom",
        path: ["capture", ...issue.path.split(".")],
        message: issue.message,
      });
  });

/** One collected payload: completed capture data or explicit unavailable fields. */
export type PartialProcessCaptureObservation = z.infer<
  typeof partialProcessCaptureObservationSchema
>;

/** Exact serialized shape plus all process-capture semantic invariants. */
export const processCaptureSchema = processCaptureShapeSchema
  .superRefine((capture, context) => {
    if (capture.settlement.cleanup_outcome === "failed")
      context.addIssue({
        code: "custom",
        path: ["settlement", "cleanup_outcome"],
        message: "verified captures cannot contain failed cleanup",
      });
    for (const issue of collectProcessCaptureIssues(capture))
      context.addIssue({
        code: "custom",
        path: issue.path.split("."),
        message: issue.message,
      });
  })
  .describe(
    "The capture must preserve its canonical scenario, comparison, and normalization SHA-256 commitments; ordered capture timestamps and contiguous sequence numbers; before and final filesystem snapshots with truncation propagated; and exit-code consistency with deadline termination. The event journal is required; empty journals are valid. A non-empty journal must reference every captured observation exactly once with unique in-range references. These cross-field invariants are checked by REA after capture.",
  );
