/** Runtime policy overrides, separate from target state and launch environment. */
export interface AnalysisSettingValues {
  readonly "asar.max_header_bytes": number;
  readonly "ghidra.startup_timeout_ms": number;
  readonly "hopper.startup_timeout_ms": number;
  readonly "ghidra.decompile_timeout_seconds": number | null;
  readonly "jadx.operation_timeout_ms": number;
  readonly "regex.matching_deadline_ms": number;
  readonly "regex.worker_heap_request_mib": number;
  readonly "capture.decoder_old_generation_mib": number;
  readonly "javascript.analysis_timeout_ms": number;
  readonly "javascript.max_heap_mb": number;
  readonly "wasm.command_timeout_ms": number;
  readonly "native.matching_representation_bytes": number;
}
export type AnalysisSettingId = keyof AnalysisSettingValues;
export interface AnalysisSettingsSnapshot {
  readonly revision: number;
  readonly overrides: Readonly<Partial<AnalysisSettingValues>>;
}
/** Injected by the runtime owner; reads the accepted operation's immutable snapshot. */
export type AnalysisSettingsReader = () => AnalysisSettingsSnapshot;

/** Limit facts supplied by the failing owner, never inferred from error prose. */
export interface AnalysisSettingLimit {
  readonly setting: AnalysisSettingId;
  readonly effective_value: number | null;
  readonly unit: "bytes" | "ms" | "seconds" | "MiB";
  readonly minimum: number;
  readonly maximum: number;
  readonly source?: "default" | "setting" | "runtime" | "request";
  readonly applies_at: "next_operation" | "next_worker" | "next_startup";
  readonly agent_editable: true;
  readonly scope: "rea-runtime";
  readonly rea_restart_required: false;
  readonly required_value?: number;
  readonly parameter?: string;
}
