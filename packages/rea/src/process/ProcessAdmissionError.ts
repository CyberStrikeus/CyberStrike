const PROCESS_ADMISSION_CODES = [
  "runtime_closing",
  "stdout_missing",
  "request_stream_failed",
  "finalization_unobserved",
  "prefix_identity_lost",
  "prefix_unavailable",
  "identity_snapshot_unavailable",
  "current_process_unreported",
  "baseline_unavailable",
  "memory_limit_unsupported",
  "launcher_pid_missing",
  "duplicate_key",
  "reader_closed",
  "token_json_invalid",
  "token_response_invalid",
  "token_pid_set",
  "token_pid_incomplete",
  "identity_json_invalid",
  "identity_response_invalid",
  "identity_pid_set",
  "identity_pid_incomplete",
  "limit_unreadable",
  "limit_invalid",
  "report_exceeds_budget",
] as const;

export type ProcessAdmissionCode = (typeof PROCESS_ADMISSION_CODES)[number];

/** Process ownership, worker, or limit admission failure. `code` is the stable identity. */
export class ProcessAdmissionError extends Error {
  readonly _tag = "ProcessAdmissionError";

  constructor(
    readonly code: ProcessAdmissionCode,
    readonly detail?: Readonly<Record<string, string | number>>,
    options?: ErrorOptions,
  ) {
    super(code, options);
    this.name = "ProcessAdmissionError";
  }
}
