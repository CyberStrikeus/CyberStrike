import { gt, valid } from "semver";

import { PRODUCT_IDENTITY } from "../identity.js";
import type { Result } from "../domain/result.js";
import type { IntegrationMaintenance } from "./UpdateMaintenance.js";

/** Global npm installation that owns the running package and its entry point. */
export interface NpmInstallation {
  readonly manager: "npm";
  readonly prefix: string;
  readonly packageRoot: string;
}

/** Bun global installation that owns the running package and its entry point. */
export interface BunInstallation {
  readonly manager: "bun";
  /** Bun's global project directory, which owns `node_modules/rea-agents`. */
  readonly globalDirectory: string;
  readonly packageRoot: string;
}

/** Global package-manager installation that owns the running package. */
export type UpdateInstallation = NpmInstallation | BunInstallation;

/** Output policy for the package manager subprocess. */
export type UpdateOutput = "human" | "structured";

/** Why release lookup failed before a version could be compared. */
export type ReleaseLookupFailure =
  | { readonly kind: "unavailable"; readonly detail: string }
  | {
      readonly kind: "package-manager-unavailable";
      readonly manager: "npm" | "bun";
      readonly detail: string;
    }
  | { readonly kind: "unsupported-package-manager"; readonly detail: string }
  | { readonly kind: "invalid-metadata"; readonly detail: string };

/** Effects used to update and verify one identified REA installation. */
export interface UpdateHost {
  installation(): Promise<UpdateInstallation | undefined>;
  latestVersion(
    installation: UpdateInstallation | undefined,
  ): Promise<Result<string, ReleaseLookupFailure>>;
  installVersion(
    installation: UpdateInstallation,
    version: string,
    output: UpdateOutput,
  ): Promise<Result<void, string>>;
  installedVersion(
    installation: UpdateInstallation,
  ): Promise<Result<string, string>>;
  planMaintenance(
    installation: UpdateInstallation,
  ): Promise<IntegrationMaintenance>;
  close?(): Promise<string | undefined>;
}

/** Verified update outcome, separate from the unapplied integration plan. */
export type UpdateResult = (
  | {
      readonly status: "current";
      readonly currentVersion: string;
      readonly latestVersion: string;
      readonly installMethod: UpdateInstallation["manager"] | "unknown";
    }
  | {
      readonly status: "updated";
      readonly previousVersion: string;
      readonly latestVersion: string;
      readonly installedVersion: string;
      readonly installMethod: UpdateInstallation["manager"];
      readonly command: readonly string[];
      readonly maintenance: IntegrationMaintenance;
      readonly remediation: string;
    }
  | {
      readonly status: "failed";
      readonly currentVersion: string;
      readonly latestVersion: string | null;
      readonly reason:
        | "unknown-install-method"
        | "version-check"
        | "install"
        | "verification";
      readonly installedVersion?: string;
      readonly remediation: string;
    }
) & { readonly cleanupFailure?: string };

/** Resolve the exact package-manager command for the identified installation and release. */
export const updateInstallCommand = (
  installation: UpdateInstallation,
  version: string,
): readonly string[] => {
  const release = `${PRODUCT_IDENTITY.packageName}@${version}`;
  const manager = installation.manager;
  switch (manager) {
    case "npm":
      return [
        "npm",
        "install",
        "--global",
        "--ignore-scripts",
        "--prefix",
        installation.prefix,
        release,
      ];
    case "bun":
      // The host pins Bun's global directory and working directory for this command.
      return ["bun", "add", "--global", "--ignore-scripts", release];
    default: {
      const exhaustive: never = manager;
      throw new TypeError(
        `Unhandled installation manager: ${String(exhaustive)}`,
      );
    }
  }
};

const versionCheckRemediation = (
  release: Result<string, ReleaseLookupFailure>,
): string => {
  if (release.ok) {
    return "REA received invalid version metadata. Check the installed version and npm registry, then rerun rea update.";
  }
  const failure = release.error;
  const kind = failure.kind;
  const detail = `${failure.detail}${failure.detail.endsWith(".") ? "" : "."}`;
  switch (kind) {
    case "unsupported-package-manager":
      return failure.detail;
    case "package-manager-unavailable":
      return `REA's local ${failure.manager} command failed: ${detail} Make ${failure.manager} available on PATH or repair its launcher, then rerun rea update.`;
    case "unavailable":
      return `REA could not resolve the latest release: ${detail} Check the package-manager diagnostic and registry access, then rerun rea update.`;
    case "invalid-metadata":
      return `REA could not resolve the latest release: ${detail} Check the npm release metadata, then rerun rea update.`;
    default: {
      const exhaustive: never = kind;
      throw new TypeError(
        `Unhandled release lookup failure: ${String(exhaustive)}`,
      );
    }
  }
};

/** Identify, resolve, install, and verify REA without applying setup changes. */
export const runUpdate = async (
  currentVersion: string,
  host: UpdateHost,
  output: UpdateOutput = "human",
): Promise<UpdateResult> => {
  let result: UpdateResult | undefined;
  let primaryFailure: unknown;
  let failed = false;
  try {
    result = await runUpdateWorkflow(currentVersion, host, output);
  } catch (cause: unknown) {
    failed = true;
    primaryFailure = cause;
  }
  let cleanupFailure: string | undefined;
  try {
    cleanupFailure = await host.close?.();
  } catch (cause: unknown) {
    cleanupFailure = `Update resource cleanup failed: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
  if (failed) {
    if (cleanupFailure !== undefined)
      throw new AggregateError(
        [primaryFailure, new Error(cleanupFailure)],
        "Update failed and its resource cleanup remains incomplete.",
        { cause: primaryFailure },
      );
    throw primaryFailure;
  }
  if (result === undefined) throw new Error("Update result was not produced.");
  return cleanupFailure === undefined ? result : { ...result, cleanupFailure };
};

const runUpdateWorkflow = async (
  currentVersion: string,
  host: UpdateHost,
  output: UpdateOutput,
): Promise<UpdateResult> => {
  const installation = await host.installation();
  const release = await host.latestVersion(installation);
  const latestVersion = release.ok ? release.value : null;
  const targetVersion = release.ok ? valid(release.value) : null;
  if (!release.ok || valid(currentVersion) === null || targetVersion === null)
    return {
      status: "failed",
      currentVersion,
      latestVersion,
      reason: "version-check",
      remediation: versionCheckRemediation(release),
    };
  if (!gt(targetVersion, currentVersion))
    return {
      status: "current",
      currentVersion,
      latestVersion: targetVersion,
      installMethod: installation?.manager ?? "unknown",
    };
  if (installation === undefined)
    return {
      status: "failed",
      currentVersion,
      latestVersion: targetVersion,
      reason: "unknown-install-method",
      remediation:
        "Update this installation with the package manager or source checkout that owns it. For a one-off latest invocation, use npx rea-agents@latest.",
    };
  const installed = await host.installVersion(
    installation,
    targetVersion,
    output,
  );
  if (!installed.ok)
    return {
      status: "failed",
      currentVersion,
      latestVersion: targetVersion,
      reason: "install",
      remediation: `REA could not install ${targetVersion} in ${installation.manager === "npm" ? installation.prefix : installation.globalDirectory}: ${installed.error}. Repair this ${installation.manager} installation, then rerun rea update.`,
    };
  const verified = await host.installedVersion(installation);
  if (!verified.ok || verified.value !== targetVersion)
    return {
      status: "failed",
      currentVersion,
      latestVersion: targetVersion,
      reason: "verification",
      ...(verified.ok ? { installedVersion: verified.value } : {}),
      remediation: `${installation.manager} completed, but REA could not verify ${targetVersion} in ${installation.packageRoot}: ${verified.ok ? `the executable reported ${verified.value}` : verified.error}. The installation may have changed; repair it before retrying.`,
    };
  const maintenance = await host.planMaintenance(installation);
  return {
    status: "updated",
    previousVersion: currentVersion,
    latestVersion: targetVersion,
    installedVersion: verified.value,
    installMethod: installation.manager,
    command: updateInstallCommand(installation, targetVersion),
    maintenance,
    remediation:
      maintenance.status === "planned"
        ? "REA is updated. Run the maintenance command to review and approve changes to existing REA integrations, then restart affected agents."
        : maintenance.status === "unavailable"
          ? "REA is updated. Integration maintenance could not be planned; inspect the maintenance diagnostic before changing configuration."
          : "REA is updated. Restart agents running this installation to load the new version.",
  };
};
