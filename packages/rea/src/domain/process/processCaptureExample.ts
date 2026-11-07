import type { JsonValue } from "../jsonValue.js";
import { digestProcessCommitment } from "./processScenario.js";

const normalization = {
  paths: true,
  pids: true,
  ports: true,
  time_bucket_ms: 10,
  patterns: [],
};
const scenario = { executable_sha256: "0".repeat(64) };
const comparisonContract = {};

/** Minimal valid process capture retained as a public contract example. */
export const EMPTY_PROCESS_CAPTURE_EXAMPLE = {
  manifest: {
    rea_version: "1.1.0",
    provider_version: "3",
    platform: "fixture",
    architecture: "fixture",
    pty_backend: "node-pty",
    started_at: "2026-01-01T00:00:00.000Z",
    completed_at: "2026-01-01T00:00:00.001Z",
    scenario,
    comparison_contract: comparisonContract,
    full_scenario_sha256: digestProcessCommitment(scenario),
    comparison_contract_sha256: digestProcessCommitment(comparisonContract),
    selected_executable_sha256: "0".repeat(64),
    executable_sha256: "0".repeat(64),
    executable_identity: {
      state: "path_metadata_unchanged",
      reason: null,
    },
    normalization_sha256: digestProcessCommitment(normalization),
  },
  normalization,
  frames: [],
  rendered_frames: [],
  interaction_events: [],
  exit: { code: 0, signal: null, reason: "exited" },
  settlement: {
    state: "quiesced",
    elapsed_ms: 50,
    cleanup_outcome: "not_required",
  },
  process_samples: [],
  filesystem_checkpoints: [
    { name: "before", at_ms: 0, files: [], effects: [], truncated: false },
    {
      name: "after_settlement",
      at_ms: 50,
      files: [],
      effects: [],
      truncated: false,
    },
  ],
  event_journal: [],
  files_before: [],
  files_after: [],
  filesystem_effects: [],
  truncated: false,
  truncation_details: {
    raw_terminal: {
      budget_bytes: 1_000_000,
      observed_bytes: 0,
      retained_bytes: 0,
      observed_frames: 0,
      retained_frames: 0,
    },
    rendered_terminal: {
      budget_bytes: 1_000_000,
      observed_bytes: 0,
      retained_bytes: 0,
      observed_frames: 0,
      retained_frames: 0,
    },
    filesystem_before: {
      files_limit: 10_000,
      depth_limit: 16,
      enumeration_truncated: false,
      enumeration_reasons: [],
      enumeration_omissions: [],
      hash_budget_bytes: 10_000_000,
      hashed_bytes: 0,
      hash_omissions: [],
    },
    filesystem_after: {
      files_limit: 10_000,
      depth_limit: 16,
      enumeration_truncated: false,
      enumeration_reasons: [],
      enumeration_omissions: [],
      hash_budget_bytes: 10_000_000,
      hashed_bytes: 0,
      hash_omissions: [],
    },
    process: {
      sample_limit: 1_000,
      sampling_partial: false,
      retained_samples: 0,
      sample_limit_reached: false,
      sampling_failures: 0,
      first_sampling_failure: null,
      coverage: "sampled",
    },
  },
  limitations: [],
  residual_unknowns: [],
  cleanup: {
    owned_process_group: "verified",
    temporary_root: "removed",
  },
} satisfies JsonValue;
