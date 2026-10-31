// A host deadline can discard the response before error remediation reaches the
// agent. Teach that distinction at initialization, not just in returned errors.
const RECOVERY_START =
  "Recovery: For invalid arguments, read the connected tool's input schema (refresh tools/list if stale), fix the reported fields and do not repeat the unchanged call. If the MCP connection drops, retry that call once only when it is safe to repeat or known not to have started. If it may already have changed the target, or it fails again, tell the user and ask them to restart the MCP client. If REA could not start its connection, retry once, then tell the user and ask them to restart the MCP client. Do not retry a startup failure that returns the same unchanged result. Run `rea doctor` when REA could not start or tools stay missing after that restart. A returned REA provider_timeout is a server/provider deadline: follow its remediation and reuse accessible partial Evidence. ";
const RUNTIME_SETTINGS_RECOVERY =
  "When a returned error names an editable setting and its bounds, call update_analysis_settings directly, then retry after work and cleanup settle; inspect_analysis_settings is optional when those facts are already supplied.";
const LAUNCH_SETTINGS_RECOVERY =
  "When a returned error names an editable setting and its bounds, change that launch setting and restart REA, or add application to REA_MCP_TOOL_FAMILIES and restart to enable runtime settings controls.";
const EXPLICIT_ARGUMENT_RECOVERY =
  " Explicit per-call arguments take precedence, so correct those fields when selected. Runtime updates affect new work only and do not clear cleanup blockers.";
const RECOVERY_END =
  " Change other request fields or REA_* settings only when remediation recommends it. Restart REA when that text says the value is read at startup. A mention that a control does not raise the deadline is not a recommendation to change it. A host error such as 'timed out awaiting tools/call' without a REA result is a client deadline, not proof that work or cleanup stopped. Do not repeat the unchanged analysis. Increase the host's tool deadline with execution/cleanup/delivery headroom; when configuration is not editable, report the required setting (Codex: mcp_servers.<server>.tool_timeout_sec, seconds). Server analysis_timeout_ms, when advertised, is a separate millisecond budget; raising it cannot fix a shorter client deadline. Session state does not establish completion of every target-free operation.";

/** Only direct callers to runtime settings tools when they are advertised. */
export const recoveryInstructions = (
  runtimeSettingsAvailable: boolean,
): string =>
  `${RECOVERY_START}${runtimeSettingsAvailable ? RUNTIME_SETTINGS_RECOVERY : LAUNCH_SETTINGS_RECOVERY}${EXPLICIT_ARGUMENT_RECOVERY}${RECOVERY_END}`;
