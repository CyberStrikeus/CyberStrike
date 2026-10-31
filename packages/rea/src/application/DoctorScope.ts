import { uniqueSorted } from "../domain/canonicalOrdering.js";
import { blocksProcessStart } from "../config/processStart.js";
import type {
  ClientRegistrationStatus,
  UnhealthyClientRegistrationStatus,
} from "./ClientRegistrationStatus.js";
import { manualRegistrationRemediation } from "./SupportedClients.js";
import type {
  DoctorCheck,
  DoctorProviderInspection,
  DoctorScope,
  DoctorSkillState,
} from "./Doctor.js";

/** Normalized readiness boundary included in every doctor response. */
export interface DoctorScopeReport {
  readonly mode: "audit-wide" | "explicit";
  readonly clients: readonly string[];
  readonly skill_clients?: readonly string[];
  readonly providers: readonly string[];
  readonly skill: boolean;
  readonly target: string | null;
}

interface DoctorProviderState {
  readonly hopperAvailable: boolean;
  readonly hopperConfigured: boolean;
  readonly providerInspections: readonly DoctorProviderInspection[] | undefined;
}

interface DoctorScopeInput {
  readonly checks: readonly DoctorCheck[];
  readonly registrations: readonly ClientRegistrationStatus[];
  readonly skillState: DoctorSkillState;
  readonly providers: DoctorProviderState;
  readonly scope: DoctorScopeReport;
}

/** Normalize a caller-selected doctor readiness boundary. */
export const normalizeDoctorScope = (
  requested: DoctorScope | undefined,
  target: string | undefined,
): DoctorScopeReport => ({
  mode: requested === undefined ? "audit-wide" : "explicit",
  clients: uniqueSorted(requested?.clients ?? []),
  ...(requested?.skillClients === undefined
    ? {}
    : { skill_clients: uniqueSorted(requested.skillClients) }),
  providers: uniqueSorted(requested?.providers ?? []),
  skill: requested?.skill === true,
  target: target ?? null,
});

/** Partition diagnostics into required and informational scope checks. */
export const scopeDoctorChecks = (
  input: DoctorScopeInput,
): {
  readonly healthy: boolean;
  readonly scopeChecks: readonly DoctorCheck[];
  readonly informationalChecks: readonly DoctorCheck[];
} => {
  const providerChecks = input.checks.filter((candidate) =>
    isProviderCheck(candidate.name, input.providers.providerInspections),
  );
  const coreChecks = input.checks.filter(
    ({ name }) =>
      name === "node" || (input.scope.target !== null && name === "target"),
  );
  const clientChecks = input.scope.clients.map((client) =>
    selectedRegistrationCheck(
      client,
      input.registrations.find((candidate) => candidate.client === client),
    ),
  );
  const skillChecks = input.scope.skill
    ? [selectedSkillCheck(input.skillState, input.checks)]
    : [];
  const selectedProviderChecks = input.scope.providers.flatMap((providerId) =>
    selectedProviderChecksFor(providerId, providerChecks, input.providers),
  );
  const hopperHostChecks = input.scope.providers.includes("hopper")
    ? input.checks.filter(({ name }) => name === "host")
    : [];
  // parseConfig rejects these before the MCP server starts. Hopper's own
  // scope already includes hopper-startup-timeout through its provider checks.
  const blocksMcpStartup = (check: DoctorCheck): boolean =>
    check.name.startsWith("runtime-configuration:") ||
    check.name === "hopper-startup-timeout";
  const blocksProcess = (check: DoctorCheck): boolean => {
    const setting = check.details?.setting;
    return (
      check.name.startsWith("runtime-configuration:") &&
      typeof setting === "string" &&
      blocksProcessStart(setting)
    );
  };
  const exercisesMcpStartup =
    input.scope.clients.length > 0 || input.scope.providers.length > 0;
  const startupChecks = (
    exercisesMcpStartup
      ? input.checks.filter(blocksMcpStartup)
      : input.checks.filter(blocksProcess)
  ).filter(
    (check) =>
      check.name !== "hopper-startup-timeout" ||
      !input.scope.providers.includes("hopper"),
  );
  const scopeChecks = [
    ...coreChecks,
    ...startupChecks,
    ...hopperHostChecks,
    ...selectedProviderChecks,
    ...clientChecks,
    ...skillChecks,
  ];
  const selectedNames = new Set(scopeChecks.map(({ name }) => name));
  return {
    healthy:
      coreChecks.every(({ ok }) => ok) &&
      startupChecks.every(({ ok }) => ok) &&
      hopperHostChecks.every(({ ok }) => ok) &&
      clientChecks.every(({ ok }) => ok) &&
      skillChecks.every(({ ok }) => ok) &&
      selectedProviderChecks.every(({ ok }) => ok),
    scopeChecks,
    informationalChecks: input.checks.filter(
      ({ name }) => !selectedNames.has(name),
    ),
  };
};

const isProviderCheck = (
  name: string,
  inspections: readonly DoctorProviderInspection[] | undefined,
): boolean =>
  name.startsWith("hopper") ||
  inspections?.some(({ id }) => doctorProviderCheckName(id, name)) === true;

const selectedProviderChecksFor = (
  providerId: string,
  checks: readonly DoctorCheck[],
  providers: DoctorProviderState,
): readonly DoctorCheck[] => {
  const selected = checks.filter(({ name }) =>
    providerId === "hopper"
      ? name.startsWith("hopper")
      : doctorProviderCheckName(providerId, name),
  );
  const available =
    providerId === "hopper"
      ? providers.hopperAvailable
      : providers.providerInspections?.find(({ id }) => id === providerId)
          ?.available === true;
  if (available && selected.every(({ ok }) => ok)) return selected;
  if (selected.some(({ ok }) => !ok)) return selected;
  return [
    ...selected,
    {
      name: `provider:${providerId}`,
      ok: false,
      classification: "missing_analysis_engine",
      detail: `Requested provider ${providerId} is unavailable.`,
      remediation: `Configure the ${providerId} provider, then rerun rea doctor.`,
    },
  ];
};

const selectedRegistrationCheck = (
  client: string,
  status: ClientRegistrationStatus | undefined,
): DoctorCheck => {
  const manual = manualRegistrationRemediation(client);
  if (status === undefined && manual !== undefined)
    return {
      name: `registration:${client}`,
      ok: false,
      classification: "config_drift",
      detail: `${client} is not registered through a local configuration file.`,
      remediation: manual,
    };
  return status === undefined
    ? {
        name: `registration:${client}`,
        ok: false,
        classification: "config_drift",
        detail: `Requested client ${client} was not detected.`,
        remediation: `Install or select ${client}, then run rea setup --client ${client}.`,
      }
    : status.state === "aligned"
      ? {
          name: `registration:${client}`,
          ok: true,
          classification: "healthy",
          detail: status.config_path,
        }
      : registrationCheck(status);
};

const registrationCheck = (
  status: UnhealthyClientRegistrationStatus,
): DoctorCheck => ({
  name: `registration:${status.client}`,
  ok: false,
  classification: status.state === "unknown" ? "unknown" : "config_drift",
  detail: status.config_path,
  remediation: status.remediation,
});

const selectedSkillCheck = (
  state: DoctorScopeInput["skillState"],
  checks: readonly DoctorCheck[],
): DoctorCheck =>
  checks.find(({ name }) => name === "skill:identity") ?? {
    name: "skill:identity",
    ok: state === "aligned",
    classification:
      state === "aligned"
        ? "healthy"
        : state === "unknown"
          ? "unknown"
          : "config_drift",
    ...(state === "aligned"
      ? { detail: "Installed REA skill identity is aligned." }
      : {
          remediation:
            state === "unmanaged"
              ? "Use regular skill directories, or run rea setup with --skill=false to configure the client without installing the skill."
              : state === "unknown"
                ? "Verify access to the reported skill files before retrying."
                : "Run rea setup to update the installed REA skill.",
        }),
  };

const doctorProviderCheckName = (providerId: string, name: string): boolean =>
  name === providerId || name.startsWith(`${providerId}-`);
