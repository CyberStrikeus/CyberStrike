import type {
  DoctorProviderCheck,
  DoctorProviderInspection,
} from "../application/Doctor.js";
import {
  readIdaConfiguration,
  type IdaConfiguration,
} from "./IdaConfiguration.js";
import type { Result } from "../domain/result.js";
import type { ConfigurationError } from "../domain/configurationErrors.js";
import { inspectIdaWorkspaceReadiness } from "./IdaWorkspaceReadiness.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";

/** Check the registration without launching IDA, and retain only the configuration file reference. */
export const inspectIdaRegistration = async (
  path: string | undefined,
  resourceScope: RetainedResourceScope,
  signal?: AbortSignal,
  registration?: Promise<Result<IdaConfiguration, ConfigurationError>>,
): Promise<DoctorProviderInspection> => {
  const parsed =
    path === undefined
      ? undefined
      : await (registration ??
          readIdaConfiguration(path, {
            resourceScope,
            ...(signal === undefined ? {} : { signal }),
          }));
  const valid = parsed?.ok === true;
  const workspaceChecks =
    parsed?.ok === true && parsed.value.mode === "headless"
      ? [await inspectPrivateWorkspace(parsed.value.workspaceRoot)]
      : [];
  return {
    id: "ida",
    configured: path !== undefined,
    available: valid && workspaceChecks.every(({ ok }) => ok),
    providerVersion: null,
    registrationEnvironment:
      valid && path !== undefined ? { REA_IDA_MCP_CONFIG: path } : {},
    checks: [
      {
        name: "registration",
        ok: valid,
        code: valid
          ? null
          : path === undefined
            ? "not_configured"
            : "invalid_configuration",
        detail: valid
          ? "IDA MCP registration is valid. Upstream availability, compatibility, and target binding are checked when analysis starts; no IDA process was launched."
          : parsed !== undefined && !parsed.ok
            ? parsed.error.message
            : "IDA MCP registration is not configured.",
        remediation: valid
          ? null
          : "Set REA_IDA_MCP_CONFIG to your upstream IDA MCP registration JSON; see docs/ida-provider.md.",
        classification:
          path === undefined ? "missing_analysis_engine" : "config_drift",
      },
      ...workspaceChecks,
    ],
  };
};

const inspectPrivateWorkspace = async (
  workspaceRoot: string | undefined,
): Promise<DoctorProviderCheck> => {
  const { privacy, unusable } =
    await inspectIdaWorkspaceReadiness(workspaceRoot);
  return {
    name: "private_workspace",
    ok: privacy.available && unusable === undefined,
    code: !privacy.available
      ? privacy.code
      : unusable === undefined
        ? null
        : "invalid_configuration",
    detail: !privacy.available
      ? privacy.reason
      : (unusable ??
        `Private workspace authority is available (${privacy.proof}) under ${workspaceRoot ?? "the system temporary directory"}.`),
    remediation: !privacy.available
      ? privacy.remediation
      : unusable === undefined
        ? null
        : "Set workspaceRoot to an existing directory REA can create entries in, or omit it to use the system temporary directory; see docs/ida-provider.md.",
    classification:
      !privacy.available && privacy.code === "runtime_missing"
        ? "missing_dependency"
        : !privacy.available && privacy.code === "runtime_unavailable"
          ? "runtime_failure"
          : unusable !== undefined
            ? "config_drift"
            : "unsupported_host",
  };
};
