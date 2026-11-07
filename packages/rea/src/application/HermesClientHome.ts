import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { userInfo, type UserInfo } from "node:os";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";
import {
  absoluteCallerPath,
  appendCallerPath,
} from "../filesystem/callerPath.js";

/** An unresolved Hermes profile must not be configured as the default home. */
export class HermesClientPathError extends Error {
  constructor(
    readonly path: string,
    message: string,
  ) {
    super(message);
    this.name = "HermesClientPathError";
  }
}

const defaultDirectory = (
  home: string,
  platform: NodeJS.Platform,
  env: Readonly<NodeJS.ProcessEnv>,
): string => {
  const suffix = env.HERMES_DATA_DIR_SUFFIX ?? "";
  return platform === "win32"
    ? join(
        env.LOCALAPPDATA?.trim() || join(home, "AppData", "Local"),
        `hermes${suffix}`,
      )
    : appendCallerPath(home, `.hermes${suffix}`, platform);
};
const expandedDirectory = (
  home: string,
  platform: NodeJS.Platform,
  env: Readonly<NodeJS.ProcessEnv>,
): string | undefined => {
  const override = env.HERMES_HOME?.trim();
  if (!override) return undefined;
  const variables = override.replace(
    /\$(\w+|\{[^}]*\})/gu,
    (match, variable: string) => {
      const key = variable.startsWith("{") ? variable.slice(1, -1) : variable;
      return env[key] ?? match;
    },
  );
  const expanded =
    platform === "win32"
      ? variables.replace(
          /%([^%]+)%/gu,
          (match, variable: string) => env[variable] ?? match,
        )
      : variables;
  if (expanded === "~") return home;
  if (
    expanded.startsWith("~/") ||
    (platform === "win32" && expanded.startsWith("~\\"))
  )
    return absoluteCallerPath(
      appendCallerPath(home, expanded.slice(2), platform),
    );
  if (expanded.startsWith("~")) {
    // Named POSIX homes come from the account database, not HOME/USERPROFILE.
    // Only the current account has a portable Node API; unresolved names must
    // not become writable relative paths in the caller's working directory.
    if (platform !== "win32") {
      const separator = expanded.indexOf("/");
      const username = expanded.slice(1, separator < 0 ? undefined : separator);
      let account: UserInfo<string>;
      try {
        account = userInfo();
      } catch {
        throw new HermesClientPathError(
          override,
          "Cannot resolve the OS account for this named Hermes home. Set an absolute HERMES_HOME before configuring Hermes.",
        );
      }
      if (account.username === username && isAbsolute(account.homedir))
        return separator < 0
          ? account.homedir
          : absoluteCallerPath(
              appendCallerPath(account.homedir, expanded.slice(separator + 1)),
            );
    }
    throw new HermesClientPathError(
      override,
      "Cannot resolve this named Hermes home. Set an absolute HERMES_HOME before configuring Hermes.",
    );
  }
  // Hermes expands environment/user syntax and then opens the resulting Path;
  // preserve POSIX symlink/.. traversal when making a relative override absolute.
  return absoluteCallerPath(expanded);
};
// Resolve existing directory aliases even when setup will create the final home.
// An unreadable path or dangling alias cannot prove root identity.
const physicalPath = (path: string): string => {
  let ancestor = absoluteCallerPath(path);
  const missing: string[] = [];
  try {
    while (true) {
      try {
        return join(realpathSync(ancestor), ...missing);
      } catch (cause: unknown) {
        if (
          !(cause instanceof Error) ||
          !("code" in cause) ||
          cause.code !== "ENOENT" ||
          dirname(ancestor) === ancestor ||
          basename(ancestor) === ".."
        )
          throw cause;
        // ENOENT may mean a dangling symlink rather than an absent entry. Do
        // not reclassify such an alias as a literal child of its lexical parent.
        if (lstatSync(ancestor, { throwIfNoEntry: false })?.isSymbolicLink())
          throw cause;
        missing.unshift(basename(ancestor));
        ancestor = dirname(ancestor);
      }
    }
  } catch {
    throw new HermesClientPathError(
      path,
      "Cannot resolve the Hermes home root. Restore access to this path before configuring Hermes.",
    );
  }
};
const within = (root: string, path: string): boolean => {
  const difference = relative(physicalPath(root), physicalPath(path));
  return (
    difference === "" ||
    (!isAbsolute(difference) &&
      difference !== ".." &&
      !difference.startsWith(`..${sep}`))
  );
};
const PROFILE_MARKERS = [
  "config.yaml",
  ".env",
  "SOUL.md",
  "profile.yaml",
  "auth.json",
  "state.db",
];
const RESERVED_PROFILES = new Set(["hermes", "test", "tmp", "root", "sudo"]);
const liveProfile = (path: string): boolean => {
  try {
    if (!statSync(path).isDirectory()) return false;
    try {
      statSync(appendCallerPath(dirname(path), `.deleted/${basename(path)}`));
      return false;
    } catch {
      /* No tombstone. */
    }
    return PROFILE_MARKERS.some((marker) => {
      try {
        const status = lstatSync(appendCallerPath(path, marker));
        return status.isFile() || status.isSymbolicLink();
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
};

/** Match Hermes CLI sticky-profile selection while retaining the configured path spelling. */
export const resolveHermesClientHome = (
  home: string,
  platform: NodeJS.Platform,
  env: Readonly<NodeJS.ProcessEnv>,
): string => {
  const native = defaultDirectory(home, platform, env);
  const root = expandedDirectory(home, platform, env) ?? native;
  // An explicit named profile bypasses the root's sticky selection in Hermes CLI.
  if (basename(dirname(root)) === "profiles") return root;
  const stickyRoot = within(native, root) ? native : root;
  let name: string;
  try {
    // Python uses utf-8-sig and ignores unreadable / invalid-UTF8 active_profile files.
    name = new TextDecoder("utf-8", { fatal: true })
      .decode(readFileSync(appendCallerPath(stickyRoot, "active_profile")))
      .trim();
  } catch {
    return root;
  }
  if (name === "" || name === "default") return root;
  const canonical = name.toLowerCase();
  if (canonical === "default") return root;
  if (
    !/^[a-z0-9][a-z0-9_-]{0,63}$/u.test(canonical) ||
    RESERVED_PROFILES.has(canonical)
  )
    throw new HermesClientPathError(
      appendCallerPath(stickyRoot, "active_profile"),
      `Invalid saved Hermes profile ${JSON.stringify(name)}. Run 'hermes profile use default' or repair active_profile.`,
    );
  // Hermes resolves both sticky selection and named profiles from its default
  // root (including overrides beneath the native home), never mixed roots.
  const selected = appendCallerPath(stickyRoot, `profiles/${canonical}`);
  if (!liveProfile(selected))
    throw new HermesClientPathError(
      selected,
      `Saved Hermes profile ${JSON.stringify(name)} is missing, deleted, or has no profile identity. Run 'hermes profile use default' or restore that profile before configuring it.`,
    );
  return selected;
};
