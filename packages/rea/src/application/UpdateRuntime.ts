import { realpath, stat } from "node:fs/promises";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lt, valid } from "semver";

import { PRODUCT_IDENTITY } from "../identity.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { err, ok, type Result } from "../domain/result.js";
import { safeParseJson } from "../domain/safeJson.js";
import {
  updateInstallCommand,
  type BunInstallation,
  type NpmInstallation,
  type ReleaseLookupFailure,
  type UpdateHost,
  type UpdateInstallation,
} from "./Update.js";
import { planIntegrationMaintenance } from "./UpdateMaintenance.js";
import { UpdateCommandRunner } from "./UpdateCommandRunner.js";

/** npm filesystem queries used to identify the installation being updated. */
export interface NpmInstallationHost {
  canonicalPath(path: string): Promise<string>;
  globalRoot(): Promise<string>;
  globalPrefix(): Promise<string>;
}

/** Filesystem queries used to identify a Bun global installation. */
export interface BunInstallationHost {
  canonicalPath(path: string): Promise<string>;
  isFile(path: string): Promise<boolean>;
}

/** Resolve the global prefix only when it owns the running package. */
export const detectNpmInstallation = async (
  packageRoot: string,
  host: NpmInstallationHost,
): Promise<NpmInstallation | undefined> => {
  let canonicalPackageRoot: string;
  try {
    canonicalPackageRoot = await host.canonicalPath(packageRoot);
  } catch (cause: unknown) {
    // best-effort cleanup: optional install-location probing; unknown means not npm-managed.
    void cause;
    return undefined;
  }
  try {
    const npmRoot = await host.globalRoot();
    const globalPackageRoot = await host.canonicalPath(
      resolve(npmRoot, PRODUCT_IDENTITY.packageName),
    );
    if (canonicalPackageRoot === globalPackageRoot) {
      const prefix = await host.globalPrefix();
      return prefix.length === 0
        ? undefined
        : { manager: "npm", prefix, packageRoot: canonicalPackageRoot };
    }
  } catch (cause: unknown) {
    // The curl installer uses a Unix prefix that may differ from npm's current default.
    void cause;
  }
  const nodeModules = dirname(canonicalPackageRoot);
  const library = dirname(nodeModules);
  if (
    basename(canonicalPackageRoot) !== PRODUCT_IDENTITY.packageName ||
    basename(nodeModules) !== "node_modules" ||
    basename(library) !== "lib"
  )
    return undefined;
  return {
    manager: "npm",
    prefix: dirname(library),
    packageRoot: canonicalPackageRoot,
  };
};

const nonemptyEnvironment = (value: string | undefined): string | undefined =>
  value === undefined || value.length === 0 ? undefined : value;

/**
 * Bun's global project directory for the selected environment, in Bun's precedence:
 * BUN_INSTALL_GLOBAL_DIR, then $BUN_INSTALL/install/global, then
 * $XDG_CACHE_HOME/.bun/install/global, then ~/.bun/install/global.
 * Resolve against the caller's cwd before reusing the path as a subprocess cwd.
 */
export const bunGlobalDirectory = (
  environment: Readonly<NodeJS.ProcessEnv>,
  platform: NodeJS.Platform,
): string => {
  const explicit = nonemptyEnvironment(environment.BUN_INSTALL_GLOBAL_DIR);
  // Bun opens the explicit project path with native filesystem traversal;
  // its derived BUN_INSTALL/XDG paths below are normalized lexically instead.
  if (explicit !== undefined) return absoluteCallerPath(explicit);
  const installRoot = nonemptyEnvironment(environment.BUN_INSTALL);
  if (installRoot !== undefined)
    return resolve(installRoot, "install", "global");
  const cacheRoot =
    nonemptyEnvironment(environment.XDG_CACHE_HOME) ??
    homeDirectoryFromEnvironment(environment, platform);
  return resolve(cacheRoot, ".bun", "install", "global");
};

/**
 * Identify the running package as Bun's global installation.
 * Bun walks up to an ancestor project when its global directory has no
 * package.json, so the global manifest must exist before `bun add --global`
 * can be trusted to update this package root.
 */
export const detectBunInstallation = async (
  packageRoot: string,
  globalDirectory: string,
  host: BunInstallationHost,
): Promise<BunInstallation | undefined> => {
  try {
    const canonicalPackageRoot = await host.canonicalPath(packageRoot);
    const canonicalGlobalDirectory = await host.canonicalPath(globalDirectory);
    const globalPackageRoot = await host.canonicalPath(
      join(
        canonicalGlobalDirectory,
        "node_modules",
        PRODUCT_IDENTITY.packageName,
      ),
    );
    if (
      canonicalPackageRoot !== globalPackageRoot ||
      !(await host.isFile(join(canonicalGlobalDirectory, "package.json")))
    )
      return undefined;
    return {
      manager: "bun",
      globalDirectory: canonicalGlobalDirectory,
      packageRoot: canonicalPackageRoot,
    };
  } catch (cause: unknown) {
    // best-effort cleanup: optional install-location probing; unknown means not Bun-managed.
    void cause;
    return undefined;
  }
};

const INVALID_NPM_RELEASE_METADATA =
  "Invalid npm release metadata: expected a version string or a single-element version array.";

/** bun info arguments for dist-tags.latest; Bun resolves its configured registry. */
export const BUN_LATEST_VERSION_COMMAND: readonly string[] = [
  "bun",
  "info",
  PRODUCT_IDENTITY.packageName,
  "dist-tags.latest",
  "--json",
];

/** npm view arguments for dist-tags.latest, scoped to the owning prefix when known. */
export const npmLatestVersionCommand = (
  installation: NpmInstallation | undefined,
): readonly string[] => [
  "npm",
  "view",
  "--global",
  ...(installation === undefined ? [] : ["--prefix", installation.prefix]),
  PRODUCT_IDENTITY.packageName,
  "dist-tags.latest",
  "--json",
  "--fetch-retries=0",
  "--fetch-timeout=10000",
];

/**
 * Read one latest version from `npm view --json`.
 * npm 11 emits a JSON string. npm 12 emits that string as a one-element array.
 */
export const parseNpmLatestVersion = (
  metadata: string,
): Result<string, string> => {
  const decoded = safeParseJson(metadata);
  if (!decoded.ok) return err(decoded.error);
  const version = readNpmLatestVersion(decoded.value);
  return version === undefined
    ? err(INVALID_NPM_RELEASE_METADATA)
    : ok(version);
};

const readNpmLatestVersion = (value: unknown): string | undefined => {
  if (typeof value === "string") return nonemptyVersion(value);
  if (!Array.isArray(value) || value.length !== 1) return undefined;
  const only = value[0];
  return typeof only === "string" ? nonemptyVersion(only) : undefined;
};

const nonemptyVersion = (value: string): string | undefined =>
  value.length === 0 ? undefined : value;

/** Classify `npm view` or `bun info` output as a version or a lookup failure. */
export const npmReleaseLookup = (
  response: Result<string, string>,
): Result<string, ReleaseLookupFailure> => {
  if (!response.ok) return err({ kind: "unavailable", detail: response.error });
  const parsed = parseNpmLatestVersion(response.value);
  return parsed.ok
    ? ok(parsed.value)
    : err({ kind: "invalid-metadata", detail: parsed.error });
};

const isFile = async (path: string): Promise<boolean> => {
  try {
    return (await stat(path)).isFile();
  } catch (cause: unknown) {
    // best-effort cleanup: a missing or unreadable manifest is not an owned Bun global project.
    void cause;
    return false;
  }
};

/**
 * Environment and working directory for package-manager subprocesses.
 * Bun commands run inside the identified global project with that directory
 * pinned, so the caller's current project and Bun's ancestor search are never
 * selected. npm keeps the caller's working directory; its prefix is explicit.
 */
const packageManagerContext = (
  installation: UpdateInstallation | undefined,
  environment: Readonly<NodeJS.ProcessEnv>,
): {
  readonly environment: Readonly<NodeJS.ProcessEnv>;
  readonly workingDirectory: string | undefined;
} =>
  installation?.manager === "bun"
    ? {
        environment: {
          ...environment,
          BUN_INSTALL_GLOBAL_DIR: installation.globalDirectory,
        },
        workingDirectory: installation.globalDirectory,
      }
    : { environment, workingDirectory: undefined };

/** Create package-manager, registry, verification, and read-only maintenance effects. */
export const systemUpdateHost = (
  packageRoot = fileURLToPath(new URL("../..", import.meta.url)),
  home: string | undefined = undefined,
  environment: Readonly<NodeJS.ProcessEnv> = process.env,
): UpdateHost => {
  const resources = new ArtifactResourceScope();
  const commands = new UpdateCommandRunner();
  const requireOutput = async (command: readonly string[]): Promise<string> => {
    const result = await commands.runProbe(command, environment);
    if (!result.ok) throw new Error(result.error.detail);
    return result.value;
  };
  return {
    installation: async () =>
      (await detectBunInstallation(
        packageRoot,
        bunGlobalDirectory(environment, process.platform),
        { canonicalPath: realpath, isFile },
      )) ??
      detectNpmInstallation(packageRoot, {
        canonicalPath: realpath,
        globalRoot: () => requireOutput(["npm", "root", "--global"]),
        globalPrefix: () => requireOutput(["npm", "prefix", "--global"]),
      }),
    latestVersion: async (installation) => {
      const context = packageManagerContext(installation, environment);
      if (installation?.manager === "bun") {
        const version = await commands.runProbe(
          ["bun", "--version"],
          context.environment,
          "structured",
          context.workingDirectory,
        );
        if (!version.ok)
          return err({
            kind: "package-manager-unavailable",
            manager: "bun",
            detail: version.error.detail,
          });
        const bunVersion = valid(version.value);
        // bun info was introduced in 1.2.17; older releases reserve the command.
        if (bunVersion === null || lt(bunVersion, "1.2.17"))
          return err({
            kind: "unsupported-package-manager",
            detail: `REA updates for Bun global installations require Bun 1.2.17 or later; bun --version returned ${JSON.stringify(version.value)}. Upgrade Bun manually, then rerun rea update.`,
          });
      }
      const result = await commands.runProbe(
        installation?.manager === "bun"
          ? BUN_LATEST_VERSION_COMMAND
          : npmLatestVersionCommand(installation),
        context.environment,
        "structured",
        context.workingDirectory,
      );
      if (!result.ok && result.error.kind === "launch")
        return err({
          kind: "package-manager-unavailable",
          manager: installation?.manager ?? "npm",
          detail: result.error.detail,
        });
      return npmReleaseLookup(result.ok ? result : err(result.error.detail));
    },
    installVersion: async (installation, version, output) => {
      const context = packageManagerContext(installation, environment);
      const result = await commands.runInstall(
        updateInstallCommand(installation, version),
        context.environment,
        output,
        context.workingDirectory,
      );
      return result.ok ? ok(undefined) : result;
    },
    installedVersion: async (installation) => {
      const result = await commands.runProbe(
        [
          process.execPath,
          join(installation.packageRoot, "scripts", "rea.mjs"),
          "--version",
        ],
        environment,
      );
      return result.ok ? result : err(result.error.detail);
    },
    planMaintenance: (installation) =>
      planIntegrationMaintenance(
        home ?? homeDirectoryFromEnvironment(environment, process.platform),
        join(installation.packageRoot, "scripts", "rea.mjs"),
        environment,
        async (command) => {
          const result = await commands.runProbe(command, environment);
          return result.ok ? result : err(result.error.detail);
        },
        resources,
      ),
    close: async () => {
      const results = await Promise.allSettled([
        commands.close(),
        resources.close(),
      ]);
      const failures = results.flatMap((result) =>
        result.status === "rejected"
          ? [
              result.reason instanceof Error
                ? result.reason.message
                : String(result.reason),
            ]
          : [],
      );
      return failures.length === 0
        ? undefined
        : `Update resource cleanup failed: ${failures.join("; ")}`;
    },
  };
};
