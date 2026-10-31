import { constants } from "node:fs";
import { access, lstat, stat } from "node:fs/promises";
import { dirname, posix, win32 } from "node:path";

import type {
  DoctorProviderCheck,
  DoctorProviderInspection,
} from "../application/Doctor.js";
import { readKunaConfiguration } from "./KunaConfiguration.js";
import type { RetainedResourceScope } from "../application/AnalysisProvider.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { kunaRetainedResourceCleanupError } from "./KunaCommand.js";
import {
  createKunaResourceScope,
  inspectKunaInstallation,
  kunaInstallationFailureDiagnostics,
  type KunaReadinessFailure,
} from "./KunaInstallation.js";
import {
  KUNA_COMMAND_REMEDIATION,
  KUNA_PROVIDER_ID,
  KUNA_UNSUPPORTED_HOST_REMEDIATION,
  KUNA_VERIFIED_VERSION,
  KUNA_VERSION_PROBE_REMEDIATION,
} from "./KunaRelease.js";

/** Settings a registration may carry; only those the caller set explicitly. */
const REGISTRATION_SETTINGS = [
  "REA_KUNA_COMMAND",
  "REA_KUNA_CACHE_DIR",
  "REA_KUNA_CACHE_MAX_BYTES",
  "REA_KUNA_PROJECT_TIMEOUT_MS",
  "REA_KUNA_TIMEOUT_MS",
  "REA_KUNA_JOBS",
] as const;

/** Project Kuna readiness into the doctor contract without writing anything. */
export const inspectKunaProvider = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform = process.platform,
  options: {
    readonly resourceScope: RetainedResourceScope;
    readonly signal?: AbortSignal;
  },
): Promise<DoctorProviderInspection> => {
  const kunaResources = createKunaResourceScope(options.resourceScope);
  let installation: Awaited<ReturnType<typeof inspectKunaInstallation>>;
  try {
    installation = await inspectKunaInstallation(environment, {
      platform,
      resourceScope: kunaResources.owner,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  } catch (cause: unknown) {
    const retainedCleanup = kunaRetainedResourceCleanupError(cause, "doctor");
    if (retainedCleanup !== undefined)
      return {
        id: KUNA_PROVIDER_ID,
        configured: environment.REA_KUNA_COMMAND !== undefined,
        available: false,
        providerVersion: null,
        registrationEnvironment: {},
        checks: [
          {
            name: "installation",
            ok: false,
            code: "cleanup_incomplete",
            detail: retainedCleanup.message,
            remediation: null,
            classification: "config_drift",
            details: {
              cleanup_incomplete: true,
              cleanup_resources: [...retainedCleanup.cleanupResources],
            },
          },
        ],
      };
    if (!(cause instanceof RegularFileCleanupFailure)) {
      const cancellation = kunaResources.installationCancellationError(
        cause,
        "doctor",
      );
      if (cancellation !== undefined) throw cancellation;
      throw cause;
    }
    return {
      id: KUNA_PROVIDER_ID,
      configured: environment.REA_KUNA_COMMAND !== undefined,
      available: false,
      providerVersion: null,
      registrationEnvironment: {},
      checks: [
        {
          name: "installation",
          ok: false,
          code: "cleanup_incomplete",
          detail: `Kuna installation inspection could not confirm file cleanup: ${cause instanceof Error ? cause.message : String(cause)}`,
          remediation: null,
          classification: "config_drift",
          details: {
            cleanup_incomplete: true,
            ...kunaInstallationFailureDiagnostics(cause),
          },
        },
      ],
    };
  }
  const configured =
    environment.REA_KUNA_COMMAND !== undefined &&
    environment.REA_KUNA_COMMAND.length > 0;
  const base = {
    id: KUNA_PROVIDER_ID,
    configured,
    available: false,
    providerVersion: null,
    registrationEnvironment: {},
  } as const;
  if (!installation.ok) {
    const check = installationFailure(installation.error, configured);
    const cleanupResources = kunaResources.cleanupResources;
    if (!kunaResources.hasPending) return { ...base, checks: [check] };
    return {
      ...base,
      checks: [
        {
          ...check,
          code: "cleanup_incomplete",
          details: {
            ...installation.error.diagnostics,
            cleanup_incomplete: true,
            ...(cleanupResources === undefined
              ? {}
              : { cleanup_resources: [...cleanupResources] }),
          },
        },
      ],
    };
  }
  const { value } = installation;
  const cache = await cacheCheck(environment, platform);
  const versionGuidance = value.verified
    ? null
    : `To use the verified release, select Kuna ${KUNA_VERIFIED_VERSION} by setting REA_KUNA_COMMAND to its absolute executable path in the environment that starts REA, then restart REA. You may continue with the selected unverified release.`;
  return {
    id: KUNA_PROVIDER_ID,
    configured,
    available: cache.ok,
    providerVersion: value.version,
    registrationEnvironment: Object.fromEntries(
      REGISTRATION_SETTINGS.flatMap((name) => {
        const setting = environment[name];
        return setting === undefined ? [] : [[name, setting]];
      }),
    ),
    checks: [
      {
        name: "installation",
        ok: true,
        code: null,
        detail: `${value.executable} reports Kuna ${value.version} (sha256 ${value.sha256})${
          value.verified
            ? "."
            : `; REA verified ${KUNA_VERIFIED_VERSION}, so this release's project layout is unverified. ${versionGuidance}`
        }`,
        remediation: versionGuidance,
        classification: "config_drift",
        details: {
          executable: value.executable,
          version: value.version,
          verified_version: KUNA_VERIFIED_VERSION,
          sha256: value.sha256,
        },
      },
      cache,
    ],
  };
};

const installationFailure = (
  failure: KunaReadinessFailure,
  configured: boolean,
): DoctorProviderCheck => ({
  name: "installation",
  ok: false,
  code: failure.code,
  detail: failure.reason,
  remediation:
    failure.remediation ??
    (failure.code === "unsupported_host"
      ? KUNA_UNSUPPORTED_HOST_REMEDIATION
      : failure.code === "version_unresolved"
        ? KUNA_VERSION_PROBE_REMEDIATION
        : KUNA_COMMAND_REMEDIATION),
  classification:
    failure.code === "unsupported_host"
      ? "unsupported_host"
      : configured
        ? "config_drift"
        : "missing_analysis_engine",
  details: failure.diagnostics,
});

/** The cache root may not exist yet; doctor reports it without creating it. */
const cacheCheck = async (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
): Promise<DoctorProviderCheck> => {
  const configuration = readKunaConfiguration(environment, platform);
  if (!configuration.ok)
    return {
      name: "cache",
      ok: false,
      code: configuration.error.code,
      detail: configuration.error.reason,
      remediation: KUNA_COMMAND_REMEDIATION,
      classification: "config_drift",
    };
  const { cacheRoot, cacheMaxBytes } = configuration.value;
  const details = { cache_root: cacheRoot, cache_max_bytes: cacheMaxBytes };
  // A trailing separator makes lstat follow a dangling link and report ENOENT.
  const inspected = cacheRootWithoutTrailingSeparator(cacheRoot, platform);
  try {
    if (!(await stat(inspected)).isDirectory())
      return {
        name: "cache",
        ok: false,
        code: "open_options_invalid",
        detail: `The Kuna cache root ${cacheRoot} exists but is not a directory.`,
        remediation:
          "Set REA_KUNA_CACHE_DIR to a directory REA may own, or remove the conflicting file.",
        classification: "config_drift",
        details,
      };
    await access(inspected, constants.W_OK | constants.X_OK);
  } catch (cause: unknown) {
    if (isMissing(cause)) {
      const creatable = await nearestDirectoryWritable(inspected);
      return creatable.ok
        ? {
            name: "cache",
            ok: true,
            code: null,
            detail: `REA creates the Kuna project cache at ${cacheRoot} on first use.`,
            remediation: null,
            classification: "config_drift",
            details,
          }
        : {
            name: "cache",
            ok: false,
            code: "open_options_invalid",
            detail: `REA cannot create the Kuna cache root ${cacheRoot}: ${creatable.reason}`,
            remediation:
              "Set REA_KUNA_CACHE_DIR to a directory the REA process user can create or write.",
            classification: "config_drift",
            details,
          };
    }
    return {
      name: "cache",
      ok: false,
      code: "open_options_invalid",
      detail: `REA cannot write the Kuna cache root ${cacheRoot}: ${cause instanceof Error ? cause.message : String(cause)}`,
      remediation:
        "Set REA_KUNA_CACHE_DIR to a directory the REA process user can write.",
      classification: "config_drift",
      details,
    };
  }
  return {
    name: "cache",
    ok: true,
    code: null,
    detail: `Kuna project exports are cached in ${cacheRoot} (at most ${String(cacheMaxBytes)} bytes).`,
    remediation: null,
    classification: "config_drift",
    details,
  };
};

/**
 * Whether the nearest existing entry on `path` is a directory REA may create
 * entries in. A missing target is only absent when no entry occupies its name;
 * a dangling symbolic link blocks creation just as a regular file does.
 * `path` must not end in a separator, or lstat follows a dangling link.
 */
const nearestDirectoryWritable = async (
  path: string,
): Promise<
  { readonly ok: true } | { readonly ok: false; readonly reason: string }
> => {
  let candidate = path;
  for (;;) {
    try {
      if (!(await stat(candidate)).isDirectory())
        return { ok: false, reason: `${candidate} is not a directory.` };
      await access(candidate, constants.W_OK | constants.X_OK);
      return { ok: true };
    } catch (cause: unknown) {
      const parent = dirname(candidate);
      const absent = isMissing(cause) ? await entryAbsent(candidate) : false;
      if (absent !== true || parent === candidate)
        return {
          ok: false,
          reason:
            typeof absent === "string"
              ? absent
              : `${candidate} is not writable: ${cause instanceof Error ? cause.message : String(cause)}`,
        };
      candidate = parent;
    }
  }
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

/** True when nothing occupies `path`; otherwise why its name is unusable. */
const entryAbsent = async (path: string): Promise<true | string> => {
  try {
    return (await lstat(path)).isSymbolicLink()
      ? `${path} is a symbolic link whose target does not exist.`
      : `${path} exists but cannot be resolved.`;
  } catch (cause: unknown) {
    return isMissing(cause)
      ? true
      : `${path} cannot be inspected: ${cause instanceof Error ? cause.message : String(cause)}`;
  }
};

/**
 * Drop a terminal separator without turning a filesystem root into its parent.
 * On Darwin and Linux, `\` is a filename character, so only `/` is removed.
 */
const cacheRootWithoutTrailingSeparator = (
  cacheRoot: string,
  platform: NodeJS.Platform,
): string => {
  const pathApi = platform === "win32" ? win32 : posix;
  const root = pathApi.parse(cacheRoot).root;
  const separator = pathApi.sep.charCodeAt(0);
  let end = cacheRoot.length;
  while (end > root.length && cacheRoot.charCodeAt(end - 1) === separator)
    end -= 1;
  return end === cacheRoot.length ? cacheRoot : cacheRoot.slice(0, end);
};
