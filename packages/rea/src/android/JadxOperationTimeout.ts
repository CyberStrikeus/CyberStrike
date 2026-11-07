import { analysisSettingLimit } from "../domain/analysisSettingDefinitions.js";
import { DEFAULT_JADX_OPERATION_TIMEOUT_MS } from "../domain/analysisResourceLimits.js";

/** Remediation when the JADX operation deadline override is malformed. */
export const JADX_OPERATION_TIMEOUT_REMEDIATION = `Set REA_JADX_OPERATION_TIMEOUT_MS to a decimal millisecond count from 1 to 2147483647, or unset it to keep the ${String(DEFAULT_JADX_OPERATION_TIMEOUT_MS)} ms default.`;

/** Name the launch-environment deadline when a JADX operation reaches it. */
export const jadxOperationTimeoutGuidance = (timeoutMs: number) => ({
  limit: analysisSettingLimit(
    "jadx.operation_timeout_ms",
    timeoutMs,
    undefined,
  ),
  userMessage: `JADX reached its configured operation deadline of ${String(timeoutMs)} ms (deadlineExpired).`,
  remediationAction: `Set REA_JADX_OPERATION_TIMEOUT_MS in REA's launch environment to an integer from 1 to 2147483647 milliseconds (omitted means ${String(DEFAULT_JADX_OPERATION_TIMEOUT_MS)} ms). For a running MCP server, use update_analysis_settings with setting jadx.operation_timeout_ms and action set; it applies to the next operation without restarting REA. Environment changes apply on the next REA process start. The effective deadline for this attempt was ${String(timeoutMs)} ms. It does not raise the bridge's 30000 ms startup handshake. Raising only the MCP client deadline does not change this budget. Allow execution, cleanup and delivery headroom in the outer MCP client deadline. Confirm outstanding work and cleanup before retrying.`,
});
