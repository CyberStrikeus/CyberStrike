import { basename, dirname, join, sep } from "node:path";

import { describe, expect, it } from "vitest";

import {
  CLAUDE_DESKTOP_PACKAGE_FAMILY,
  resolveWindowsClaudeDesktopLocation,
  type ClaudeDesktopLocationFileSystem,
} from "./ClaudeDesktopConfigLocation.js";
import {
  packagePrivateLauncherBlocker,
  packagePrivateStorageFamily,
  redirectedWriteBlocker,
  type MsixPackageView,
  windowsAppDataRoots,
} from "./MsixPackageStorage.js";

const home = join("/profile", "a");
const env = {
  APPDATA: join(home, "AppData", "Roaming"),
  LOCALAPPDATA: join(home, "AppData", "Local"),
};
const packages = join(env.LOCALAPPDATA, "Packages");
const appDataConfig = join(env.APPDATA, "Claude", "claude_desktop_config.json");
const privateConfig = join(
  packages,
  CLAUDE_DESKTOP_PACKAGE_FAMILY,
  "LocalCache",
  "Roaming",
  "Claude",
  "claude_desktop_config.json",
);

const failure = (code: string): Error =>
  Object.assign(new Error(`${code}: injected`), { code });

const file = { isFile: () => true, isDirectory: () => false };
const folder = { isFile: () => false, isDirectory: () => true };
const privateDirectory = dirname(privateConfig);
const privatePreferences = join(privateDirectory, "Preferences");
const appDataDirectory = dirname(appDataConfig);

it.each([undefined, ""])(
  "uses default AppData roots only for unset or empty values: %s",
  (value) => {
    expect(
      windowsAppDataRoots(home, { APPDATA: value, LOCALAPPDATA: value }),
    ).toEqual({ roaming: env.APPDATA, local: env.LOCALAPPDATA });
  },
);

it.each([" root with trailing space ", "   "])(
  "preserves a nonempty AppData root literally: %j",
  (value) => {
    expect(
      windowsAppDataRoots(home, { APPDATA: value, LOCALAPPDATA: value }),
    ).toEqual({ roaming: value, local: value });
  },
);

/** Package storage holding `privateFiles`; realpath decides the process view. */
const packagedFileSystem = (
  realpath: ClaudeDesktopLocationFileSystem["realpath"],
  privateFiles: readonly string[] = [privateConfig],
): ClaudeDesktopLocationFileSystem => ({
  readdir: (path) => {
    if (path === packages) return [CLAUDE_DESKTOP_PACKAGE_FAMILY];
    if (path === privateDirectory)
      return privateFiles.map((name) => basename(name));
    throw failure("ENOENT");
  },
  lstat: (path) => {
    if (!privateFiles.includes(path)) throw failure("ENOENT");
    return file;
  },
  realpath,
});

describe("Claude Desktop MSIX process view", () => {
  it("recognizes a process that sees the private copy at the AppData path", () => {
    const location = resolveWindowsClaudeDesktopLocation(
      home,
      env,
      packagedFileSystem((path) =>
        path === appDataConfig ? privateConfig : path,
      ),
    );
    expect(location).toEqual({
      ok: true,
      value: expect.objectContaining({
        configPath: privateConfig,
        msixPackage: expect.objectContaining({ processView: "redirected" }),
      }),
    });
  });

  it("treats an absent AppData file as an unredirected process", () => {
    const location = resolveWindowsClaudeDesktopLocation(
      home,
      env,
      packagedFileSystem((path) => {
        if (path === appDataConfig) throw failure("ENOENT");
        return path;
      }),
    );
    expect(location.ok && location.value.msixPackage?.processView).toBe(
      "direct",
    );
  });

  it("recognizes redirection through another private file before the configuration exists", () => {
    const location = resolveWindowsClaudeDesktopLocation(
      home,
      env,
      packagedFileSystem(
        (path) =>
          path === join(appDataDirectory, "Preferences")
            ? privatePreferences
            : path,
        [privatePreferences],
      ),
    );
    expect(location.ok && location.value.configPath).toBe(privateConfig);
    expect(location.ok && location.value.msixPackage?.processView).toBe(
      "redirected",
    );
  });

  it("continues after a listed private file disappears", () => {
    const fs = packagedFileSystem(
      (path) =>
        path === join(appDataDirectory, "Preferences")
          ? privatePreferences
          : path,
      [privatePreferences],
    );
    const location = resolveWindowsClaudeDesktopLocation(home, env, {
      ...fs,
      readdir: (path) =>
        path === privateDirectory
          ? ["vanished", "Preferences"]
          : fs.readdir(path),
    });
    expect(location.ok && location.value.msixPackage?.processView).toBe(
      "redirected",
    );
  });

  it("keeps the view unknown when the package has no private files", () => {
    const location = resolveWindowsClaudeDesktopLocation(
      home,
      env,
      packagedFileSystem((path) => path, []),
    );
    expect(location.ok && location.value.msixPackage?.processView).toBe(
      "unknown",
    );
  });

  it("keeps the view unknown when the AppData path cannot be resolved", () => {
    const location = resolveWindowsClaudeDesktopLocation(
      home,
      env,
      packagedFileSystem((path) => {
        if (path === appDataConfig) throw failure("EACCES");
        return path;
      }),
    );
    expect(location.ok && location.value.msixPackage?.processView).toBe(
      "unknown",
    );
  });
});

const privateRoaming = dirname(privateDirectory);

/**
 * Package storage whose private roaming root holds `files` (paths under that
 * root) and no Claude folder; `realpath` decides the process view and
 * `unreadable` folders refuse to be listed.
 */
const roamingFileSystem = (
  files: readonly string[],
  realpath: ClaudeDesktopLocationFileSystem["realpath"],
  unreadable: readonly string[] = [],
): ClaudeDesktopLocationFileSystem => {
  const absolute = files.map((path) => join(privateRoaming, path));
  const within = (path: string) => (entry: string) =>
    entry.startsWith(`${path}${sep}`);
  return {
    readdir: (path, limit) => {
      if (path === packages) return [CLAUDE_DESKTOP_PACKAGE_FAMILY];
      if (
        unreadable.some(
          (folderPath) => join(privateRoaming, folderPath) === path,
        )
      )
        throw failure("EACCES");
      const below = absolute.filter(within(path));
      if (path !== privateRoaming && below.length === 0)
        throw failure("ENOENT");
      return [
        ...new Set(
          below.map(
            (entry) => entry.slice(path.length + 1).split(sep)[0] ?? "",
          ),
        ),
      ].slice(0, limit);
    },
    lstat: (path) => {
      if (absolute.includes(path)) return file;
      if (absolute.some(within(path))) return folder;
      throw failure("ENOENT");
    },
    realpath,
  };
};

/** The process view a resolver reports for `fileSystem`. */
const viewOf = (fileSystem: ClaudeDesktopLocationFileSystem) => {
  const location = resolveWindowsClaudeDesktopLocation(home, env, fileSystem);
  return location.ok ? location.value.msixPackage?.processView : undefined;
};

describe("Claude Desktop MSIX process view from other roaming folders", () => {
  const telemetry = join("turborepo", "telemetry.json");

  it("compares a private file outside Claude Desktop's own folder", () => {
    expect(viewOf(roamingFileSystem([telemetry], (path) => path))).toBe(
      "direct",
    );
  });

  it("recognizes a redirected view through that file", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) =>
      path === join(env.APPDATA, telemetry)
        ? join(privateRoaming, telemetry)
        : path,
    );
    expect(viewOf(fileSystem)).toBe("redirected");
  });

  it("treats a private file missing at its AppData path as a direct view", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) => {
      if (path === join(env.APPDATA, telemetry)) throw failure("ENOENT");
      return path;
    });
    expect(viewOf(fileSystem)).toBe("direct");
  });

  it("skips a folder that cannot be listed and decides from another", () => {
    const fileSystem = roamingFileSystem(
      [join("Microsoft", "locked", "x"), telemetry],
      (path) =>
        path === join(env.APPDATA, telemetry)
          ? join(privateRoaming, telemetry)
          : path,
      ["Microsoft"],
    );
    expect(viewOf(fileSystem)).toBe("redirected");
  });

  it("spreads its probes so a crowded folder cannot hide a redirected one", () => {
    const crowded = Array.from({ length: 20 }, (_, index) =>
      join("ghidra", `log-${String(index).padStart(2, "0")}`),
    );
    const compared: string[] = [];
    const fileSystem = roamingFileSystem([...crowded, telemetry], (path) => {
      compared.push(path);
      return path === join(env.APPDATA, telemetry)
        ? join(privateRoaming, telemetry)
        : path;
    });
    expect(viewOf(fileSystem)).toBe("redirected");
    expect(
      compared.filter((path) =>
        path.startsWith(join(privateRoaming, "ghidra")),
      ),
    ).toHaveLength(2);
  });

  it("stops after a bounded number of probes", () => {
    const files = Array.from({ length: 30 }, (_, index) =>
      join(`folder-${String(index).padStart(2, "0")}`, "file"),
    );
    const compared: string[] = [];
    viewOf(
      roamingFileSystem(files, (path) => {
        compared.push(path);
        return path;
      }),
    );
    expect(
      compared.filter((path) => path.startsWith(privateRoaming)),
    ).toHaveLength(8);
  });

  it("keeps the view unknown when the roaming root has no private file", () => {
    expect(viewOf(roamingFileSystem([], (path) => path))).toBe("unknown");
  });
});

describe("Claude Desktop roaming enumeration budget", () => {
  const entryLimit = 1024;
  it("stops inspecting entries once its budget is spent", () => {
    const folders = Array.from({ length: 1500 }, (_, index) =>
      join(`folder-${String(index).padStart(4, "0")}`, "file"),
    );
    const fileSystem = roamingFileSystem(folders, (path) => path);
    let enumerated = 0;
    let inspected = 0;
    const requested: (number | undefined)[] = [];
    const view = viewOf({
      ...fileSystem,
      readdir: (path, limit) => {
        if (path === privateRoaming) requested.push(limit);
        const names = fileSystem.readdir(path, limit);
        if (
          path === privateRoaming ||
          path.startsWith(`${privateRoaming}${sep}`)
        )
          enumerated += names.length;
        return names;
      },
      lstat: (path) => {
        if (dirname(path) === privateRoaming) inspected += 1;
        return fileSystem.lstat(path);
      },
    });
    // The root lists only folders, so the budget runs out before any file.
    expect(view).toBe("unknown");
    expect(enumerated).toBe(1024);
    expect(inspected).toBe(1024);
    // The listing itself stops at the budget instead of reading all 1500 names.
    expect(requested).toEqual([1024]);
  });

  it("charges names materialized from an early queued leaf directory", () => {
    const files = Array.from({ length: 64 * 1000 }, (_, index) =>
      join(
        `folder-${String(Math.floor(index / 1000)).padStart(2, "0")}`,
        `file-${String(index % 1000).padStart(4, "0")}`,
      ),
    );
    const base = roamingFileSystem(files, (path) => path);
    let enumerated = 0;
    const requests: Array<{ path: string; limit: number | undefined }> = [];
    const view = viewOf({
      ...base,
      readdir: (path, limit) => {
        const names = base.readdir(path, limit);
        if (
          path === privateRoaming ||
          path.startsWith(`${privateRoaming}${sep}`)
        ) {
          enumerated += names.length;
          requests.push({ path, limit });
        }
        return names;
      },
    });

    expect(view).toBe("direct");
    expect(enumerated).toBe(entryLimit);
    expect(requests).toEqual([
      { path: privateRoaming, limit: entryLimit },
      {
        path: join(privateRoaming, "folder-00"),
        limit: entryLimit - 64,
      },
    ]);
  });

  it("bounds the preferred Claude folder before selecting its probes", () => {
    const files = Array.from({ length: 1500 }, (_, index) =>
      join("Claude", `file-${String(index).padStart(4, "0")}.log`),
    );
    const base = roamingFileSystem(files, (path) => path);
    const listed: number[] = [];
    let inspected = 0;
    const view = viewOf({
      ...base,
      readdir: (path, limit) => {
        if (path === join(privateRoaming, "Claude") && limit !== undefined)
          listed.push(limit);
        return base.readdir(path, limit);
      },
      lstat: (path) => {
        if (
          path.startsWith(`${join(privateRoaming, "Claude")}${sep}`) &&
          !path.endsWith(join("Claude", "claude_desktop_config.json"))
        )
          inspected += 1;
        return base.lstat(path);
      },
    });

    expect(view).toBe("direct");
    expect(listed).toEqual([1024]);
    // Each selected candidate is inspected once while listing and again during
    // the race-safe comparison; selection itself remains capped at eight.
    expect(inspected).toBe(16);
  });

  it("shares the entry budget between the preferred folder and fallback walk", () => {
    const folders = Array.from({ length: 1500 }, (_, index) =>
      join("Claude", `folder-${String(index).padStart(4, "0")}`, "file"),
    );
    const files = [...folders, join("turborepo", "telemetry.json")];
    const base = roamingFileSystem(files, (path) => path);
    const listed: Array<{ path: string; limit: number | undefined }> = [];
    let inspected = 0;
    const view = viewOf({
      ...base,
      readdir: (path, limit) => {
        listed.push({ path, limit });
        return base.readdir(path, limit);
      },
      lstat: (path) => {
        if (
          path.startsWith(`${join(privateRoaming, "Claude")}${sep}`) &&
          !path.endsWith(join("Claude", "claude_desktop_config.json"))
        )
          inspected += 1;
        return base.lstat(path);
      },
    });

    expect(view).toBe("unknown");
    expect(inspected).toBe(1024);
    expect(
      listed.filter(({ path }) => path === join(privateRoaming, "Claude")),
    ).toEqual([{ path: join(privateRoaming, "Claude"), limit: 1024 }]);
    expect(listed.some(({ path }) => path === privateRoaming)).toBe(false);
  });
});

describe("Claude Desktop MSIX process view when a probe changes during the comparison", () => {
  const telemetry = join("turborepo", "telemetry.json");

  it("does not count a private file deleted during the comparison as a direct view", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) => path);
    let deleted = false;
    const view = viewOf({
      ...fileSystem,
      realpath: (path) => {
        if (path !== join(env.APPDATA, telemetry)) return path;
        // A redirected view loses the file between the two comparisons.
        deleted = true;
        throw failure("ENOENT");
      },
      lstat: (path) => {
        if (deleted && path === join(privateRoaming, telemetry))
          throw failure("ENOENT");
        return fileSystem.lstat(path);
      },
    });
    expect(view).toBe("unknown");
  });

  it("does not count an ordinary copy reached after the private file was deleted as a direct view", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) => path);
    let deleted = false;
    const view = viewOf({
      ...fileSystem,
      realpath: (path) => {
        // The redirected view falls through to the ordinary AppData copy.
        if (path === join(env.APPDATA, telemetry)) deleted = true;
        return path;
      },
      lstat: (path) => {
        if (deleted && path === join(privateRoaming, telemetry))
          throw failure("ENOENT");
        return fileSystem.lstat(path);
      },
    });
    expect(view).toBe("unknown");
  });

  it("recognizes a redirected view through a private file recreated during the comparison", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) => path);
    let lookups = 0;
    const view = viewOf({
      ...fileSystem,
      realpath: (path) => {
        if (path !== join(env.APPDATA, telemetry)) return path;
        lookups += 1;
        // The first lookup lands while the file is being replaced.
        if (lookups === 1) throw failure("ENOENT");
        return join(privateRoaming, telemetry);
      },
    });
    expect(view).toBe("redirected");
  });

  it("does not decide from a probe whose AppData lookups disagree", () => {
    const fileSystem = roamingFileSystem([telemetry], (path) => path);
    let lookups = 0;
    const view = viewOf({
      ...fileSystem,
      realpath: (path) => {
        if (path !== join(env.APPDATA, telemetry)) return path;
        lookups += 1;
        if (lookups === 1) throw failure("ENOENT");
        return path;
      },
    });
    expect(view).toBe("unknown");
  });
});

describe("unresolved Claude Desktop package identity", () => {
  it.each(["AnthropicPBC.Claude_fnn82j28hfe8t", "Claude_fnn82j28hfe8t"])(
    "refuses an unrecognized package deployment %s instead of selecting AppData",
    (name) => {
      const location = resolveWindowsClaudeDesktopLocation(home, env, {
        readdir: () => [name],
        lstat: () => file,
        realpath: (path) => path,
      });
      expect(location).toMatchObject({
        ok: false,
        error: {
          path: join(packages, name),
          message: expect.stringContaining("does not fall back"),
        },
      });
    },
  );

  it.each([
    "Notes.AnthropicPBC.Claude_fnn82j28hfe8t",
    "AnthropicPBC.Claude_fnn82j28hfe8t.backup",
    "AnthropicPBCxClaude_fnn82j28hfe8t",
  ])("does not treat %s as a Claude package family", (name) => {
    const location = resolveWindowsClaudeDesktopLocation(home, env, {
      readdir: () => [name],
      lstat: () => file,
      realpath: (path) => path,
    });
    expect(location).toEqual({
      ok: true,
      value: { configPath: appDataConfig, markerPath: appDataDirectory },
    });
  });

  it("reports unreadable package storage instead of assuming AppData", () => {
    const location = resolveWindowsClaudeDesktopLocation(home, env, {
      readdir: () => {
        throw failure("EACCES");
      },
      lstat: () => file,
      realpath: (path) => path,
    });
    expect(location).toEqual({
      ok: false,
      error: {
        path: packages,
        message: expect.stringContaining("could not be inspected"),
      },
    });
  });

  it("reports an uninspectable private copy instead of choosing a file", () => {
    const location = resolveWindowsClaudeDesktopLocation(home, env, {
      readdir: () => [CLAUDE_DESKTOP_PACKAGE_FAMILY],
      lstat: () => {
        throw failure("EPERM");
      },
      realpath: (path) => path,
    });
    expect(location.ok).toBe(false);
    expect(!location.ok && location.error.path).toBe(privateConfig);
  });

  it("matches the package family case-insensitively, as Windows does", () => {
    const location = resolveWindowsClaudeDesktopLocation(home, env, {
      readdir: () => [CLAUDE_DESKTOP_PACKAGE_FAMILY.toUpperCase()],
      lstat: () => {
        throw failure("ENOENT");
      },
      realpath: (path) => path,
    });
    expect(location.ok && location.value.msixPackage?.packageFamilyName).toBe(
      CLAUDE_DESKTOP_PACKAGE_FAMILY.toUpperCase(),
    );
  });
});

describe("package-private REA launchers", () => {
  const launcher = join(
    env.APPDATA,
    "npm",
    "node_modules",
    "rea-agents",
    "scripts",
    "rea.mjs",
  );
  const stored = join(
    packages,
    CLAUDE_DESKTOP_PACKAGE_FAMILY,
    "LocalCache",
    "Roaming",
    "npm",
    "node_modules",
    "rea-agents",
    "scripts",
    "rea.mjs",
  );

  it("names the package that privately stores a path", () => {
    expect(packagePrivateStorageFamily(stored, packages)).toBe(
      CLAUDE_DESKTOP_PACKAGE_FAMILY,
    );
    expect(packagePrivateStorageFamily(launcher, packages)).toBeUndefined();
    expect(
      packagePrivateStorageFamily(
        join(packages, CLAUDE_DESKTOP_PACKAGE_FAMILY, "LocalState", "x"),
        packages,
      ),
    ).toBeUndefined();
  });

  it("blocks a launcher that only the package's processes can see", () => {
    const blocker = packagePrivateLauncherBlocker(
      [join("/Program Files", "nodejs", "node.exe"), launcher, "mcp"],
      packages,
      (path) => (path === launcher ? stored : path),
    );
    expect(blocker).toContain(stored);
    expect(blocker).toContain(CLAUDE_DESKTOP_PACKAGE_FAMILY);
    expect(blocker).toContain("npm install -g rea-agents");
  });

  it("compares the launcher with the canonical package storage path", () => {
    const shortProfilePackages = join(
      "/profile",
      "A~1",
      "AppData",
      "Local",
      "Packages",
    );
    const blocker = packagePrivateLauncherBlocker(
      [launcher, "mcp"],
      shortProfilePackages,
      (path) =>
        path === shortProfilePackages
          ? packages
          : path === launcher
            ? stored
            : path,
    );
    expect(blocker).toContain(CLAUDE_DESKTOP_PACKAGE_FAMILY);
  });

  it("allows ordinary and unresolvable launchers", () => {
    expect(
      packagePrivateLauncherBlocker(
        ["cmd.exe", "/d", "/c", "npx", "-y", "rea-agents@6.4.0", "mcp"],
        packages,
        () => {
          throw new Error("package runners are not resolved");
        },
      ),
    ).toBeUndefined();
    expect(
      packagePrivateLauncherBlocker([launcher, "mcp"], packages, () => {
        throw failure("ENOENT");
      }),
    ).toBeUndefined();
  });
});

describe("writes from a redirected AppData view", () => {
  const view: MsixPackageView = {
    packageFamilyName: CLAUDE_DESKTOP_PACKAGE_FAMILY,
    privateConfigPath: privateConfig,
    appDataConfigPath: appDataConfig,
    virtualizedRoots: [env.APPDATA, env.LOCALAPPDATA],
    processView: "redirected",
  };
  const vscode = join(env.APPDATA, "Code", "User", "mcp.json");
  const hermes = join(env.LOCALAPPDATA, "hermes", "config.yaml");
  const codex = join(home, ".codex", "config.toml");

  it("refuses only targets under the package's virtualized roots", () => {
    const blocker = redirectedWriteBlocker(
      view,
      [vscode, codex, hermes],
      "setup",
    );
    expect(blocker).toContain(`${vscode}, ${hermes}`);
    expect(blocker).not.toContain(codex);
    expect(blocker).toContain("Rerun setup from a terminal");
    expect(redirectedWriteBlocker(view, [codex], "setup")).toBeUndefined();
  });

  it("compares aliases through the existing parent of a new destination", () => {
    const alias = join(home, "skill-alias");
    const target = join(alias, "skills", "reverse-engineer-anything");
    const blocker = redirectedWriteBlocker(
      view,
      [target],
      "uninstall",
      (path) => {
        if (path === alias) return join(env.APPDATA, "dsh");
        if (path.startsWith(`${alias}${sep}`)) throw failure("ENOENT");
        return path;
      },
    );
    expect(blocker).toContain(target);
    expect(blocker).toContain("Rerun uninstall");
  });

  it("keeps canonicalization failures visible instead of assuming a target is outside AppData", () => {
    expect(
      redirectedWriteBlocker(view, [codex], "setup", () => {
        throw failure("EACCES");
      }),
    ).toContain("Cannot establish the MSIX write location");
  });

  it("allows every target without positive evidence of redirection", () => {
    for (const processView of ["direct", "unknown"] as const)
      expect(
        redirectedWriteBlocker({ ...view, processView }, [vscode], "uninstall"),
      ).toBeUndefined();
    expect(
      redirectedWriteBlocker(undefined, [vscode], "setup"),
    ).toBeUndefined();
  });
});
