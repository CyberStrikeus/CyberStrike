import { lstatSync, opendirSync, readdirSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { err, ok, type Result } from "../domain/result.js";
import {
  windowsAppDataRoots,
  type MsixPackageView,
} from "./MsixPackageStorage.js";

const CONFIG_FILE = "claude_desktop_config.json";

/** Private files compared at most when looking for a redirected AppData view. */
const PROCESS_VIEW_PROBES = 8;

/**
 * Bounds of the walk through the package's private roaming root when Claude
 * Desktop's own folder holds no private file: directories listed or waiting
 * to be listed, their depth, entries inspected in all, and files taken from
 * one directory before moving on, so the probes spread across folders instead
 * of filling up from the first one.
 */
const ROAMING_DIRECTORY_LIMIT = 64;
const ROAMING_DEPTH_LIMIT = 4;
const ROAMING_ENTRY_LIMIT = 1024;
const PROBES_PER_DIRECTORY = 2;

/**
 * Claude Desktop's MSIX package family: package name `Claude` and the
 * publisher ID Windows derives from `CN="Anthropic, PBC", O="Anthropic, PBC",
 * L=San Francisco, S=California, C=US, …`.
 */
export const CLAUDE_DESKTOP_PACKAGE_FAMILY = "Claude_pzs8sxrjxfjjc";

/** Observed Claude package names plus Windows' 13-character publisher ID. */
const CLAUDE_PACKAGE_FAMILY =
  /^(?:AnthropicPBC\.)?Claude_[0-9a-hjkmnp-tv-z]{13}$/iu;

/** The configuration Claude Desktop reads and the evidence that it is installed. */
export interface ClaudeDesktopLocation {
  readonly configPath: string;
  readonly markerPath: string;
  readonly msixPackage?: MsixPackageView;
}

/** Unresolved Claude Desktop identity, reported instead of guessing a file. */
export interface ClaudeDesktopLocationFailure {
  readonly path: string;
  readonly message: string;
}

/** Synchronous probes; each throws for failures other than absence. */
export interface ClaudeDesktopLocationFileSystem {
  /** A directory's names; with `limit`, at most that many, in enumeration order. */
  readonly readdir: (path: string, limit?: number) => readonly string[];
  readonly lstat: (path: string) => {
    isFile(): boolean;
    isDirectory(): boolean;
  };
  readonly realpath: (path: string) => string;
}

/** Up to `limit` names from a directory, without enumerating the rest. */
const readNames = (path: string, limit: number): string[] => {
  const directory = opendirSync(path);
  const names: string[] = [];
  try {
    while (names.length < limit) {
      const entry = directory.readSync();
      if (entry === null) break;
      names.push(entry.name);
    }
  } finally {
    directory.closeSync();
  }
  return names;
};

const systemFileSystem: ClaudeDesktopLocationFileSystem = {
  readdir: (path, limit) =>
    limit === undefined ? readdirSync(path) : readNames(path, limit),
  lstat: (path) => lstatSync(path),
  realpath: (path) => realpathSync.native(path),
};

/**
 * Resolve the `claude_desktop_config.json` that Windows Claude Desktop reads.
 * Without its MSIX package storage, that is the AppData file. With it, the
 * package reads its private copy when one exists and the AppData file
 * otherwise; a new registration goes to the private copy. Other Claude
 * package identities and deployments leave the reader unknown.
 */
export const resolveWindowsClaudeDesktopLocation = (
  home: string,
  env: Readonly<NodeJS.ProcessEnv>,
  fileSystem: ClaudeDesktopLocationFileSystem = systemFileSystem,
): Result<ClaudeDesktopLocation, ClaudeDesktopLocationFailure> => {
  const roots = windowsAppDataRoots(home, env);
  const appDataDirectory = join(roots.roaming, "Claude");
  const appDataConfigPath = join(appDataDirectory, CONFIG_FILE);
  const packagesDirectory = join(roots.local, "Packages");
  let families: readonly string[];
  try {
    families = fileSystem
      .readdir(packagesDirectory)
      .filter((name) => CLAUDE_PACKAGE_FAMILY.test(name));
  } catch (cause: unknown) {
    if (!isMissing(cause))
      return err({
        path: packagesDirectory,
        message: `MSIX package storage ${packagesDirectory} could not be inspected, so REA cannot establish whether Claude Desktop reads ${appDataConfigPath} or a package-private copy: ${errorMessage(cause)}. Repair access to that directory, then rerun.`,
      });
    families = [];
  }
  const foreign = families.filter(
    (name) =>
      name.toLowerCase() !== CLAUDE_DESKTOP_PACKAGE_FAMILY.toLowerCase(),
  );
  if (foreign.length > 0)
    return err({
      path: join(packagesDirectory, foreign[0] ?? ""),
      message: `MSIX package storage ${foreign.map((name) => join(packagesDirectory, name)).join(", ")} has an unrecognized Claude Desktop package identity or deployment (the supported identity is ${CLAUDE_DESKTOP_PACKAGE_FAMILY}). REA cannot establish which ${CONFIG_FILE} that package reads and does not fall back to ${appDataConfigPath}. Quit Claude Desktop fully and register REA in the configuration the installed app reads.`,
    });
  const family = families[0];
  if (family === undefined)
    return ok({ configPath: appDataConfigPath, markerPath: appDataDirectory });
  const container = join(packagesDirectory, family);
  const privateRoaming = join(container, "LocalCache", "Roaming");
  const privateDirectory = join(privateRoaming, "Claude");
  const privateConfigPath = join(privateDirectory, CONFIG_FILE);
  const privateCopy = present(fileSystem, privateConfigPath);
  if (!privateCopy.ok) return privateCopy;
  const appDataCopy = privateCopy.value
    ? ok(false)
    : present(fileSystem, appDataConfigPath);
  if (!appDataCopy.ok) return appDataCopy;
  return ok({
    configPath:
      privateCopy.value || !appDataCopy.value
        ? privateConfigPath
        : appDataConfigPath,
    markerPath: container,
    msixPackage: {
      packageFamilyName: family,
      privateConfigPath,
      appDataConfigPath,
      virtualizedRoots: [roots.roaming, roots.local],
      processView: processView(
        fileSystem,
        privateRoaming,
        roots.roaming,
        privateCopy.value,
      ),
    },
  });
};

/**
 * A process the package started sees the package's private files at their
 * AppData paths; any other process sees the real AppData files or nothing.
 * The package redirects the whole roaming root: its manifest excludes
 * directories only under LocalAppData (version 2.42304.0.0, checked on
 * 2026-10-18), so a private file from any roaming folder shows which view
 * this is. Claude Desktop's own folder is compared first. Some hosts never
 * get one, because the running app writes the real `%APPDATA%\Claude`; there
 * the files the package or its processes wrote in other roaming folders
 * decide. `LocalCache\Local` is not compared: files under its excluded
 * directories are not redirected, so they could not tell the views apart.
 */
const processView = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  privateRoaming: string,
  appDataRoaming: string,
  privateConfig: boolean,
): MsixPackageView["processView"] => {
  const entryBudget = { inspected: 0 };
  const ownProbes = privateConfig
    ? [join("Claude", CONFIG_FILE)]
    : claudeFolderProbes(fileSystem, privateRoaming, entryBudget);
  const probes =
    ownProbes.length > 0
      ? ownProbes
      : roamingProbes(fileSystem, privateRoaming, entryBudget);
  let view: MsixPackageView["processView"] = "unknown";
  for (const probe of probes) {
    let privateTarget: string;
    try {
      privateTarget = fileSystem.realpath(join(privateRoaming, probe));
    } catch (cause: unknown) {
      // A private file that vanished cannot be compared; try another.
      void cause;
      continue;
    }
    const appDataPath = join(appDataRoaming, probe);
    const first = resolveAppData(fileSystem, appDataPath);
    if (first === undefined) return "unknown";
    if (first === privateTarget) return "redirected";
    // A private file deleted or replaced meanwhile no longer shadows its AppData
    // path, so a redirected view would also miss it or reach an ordinary copy
    // there. Count the probe only while the file is in place and a second
    // lookup agrees; a probe that changed between lookups decides nothing.
    if (!isPrivateFile(fileSystem, privateRoaming, probe)) continue;
    const second = resolveAppData(fileSystem, appDataPath);
    if (second === undefined) return "unknown";
    if (second === privateTarget) return "redirected";
    if (second === first) view = "direct";
  }
  return view;
};

/** Where an AppData path resolves: its target, `null` when it is missing, or `undefined` when it cannot be read. */
const resolveAppData = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  path: string,
): string | null | undefined => {
  try {
    return fileSystem.realpath(path);
  } catch (cause: unknown) {
    return isMissing(cause) ? null : undefined;
  }
};

/** Private files in Claude Desktop's own roaming folder, as paths under the roaming root. */
const claudeFolderProbes = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  privateRoaming: string,
  entryBudget: { inspected: number },
): readonly string[] => {
  try {
    const remaining = ROAMING_ENTRY_LIMIT - entryBudget.inspected;
    if (remaining <= 0) return [];
    const names = fileSystem.readdir(join(privateRoaming, "Claude"), remaining);
    // The filesystem has already materialized these names. Debit all returned
    // entries before selecting a handful of candidates so the budget covers
    // enumeration and sorting work as well as lstat calls.
    entryBudget.inspected += names.length;
    const probes: string[] = [];
    for (const name of names) {
      if (isPrivateFile(fileSystem, privateRoaming, join("Claude", name))) {
        probes.push(join("Claude", name));
        if (probes.length === PROCESS_VIEW_PROBES) break;
      }
    }
    return probes;
  } catch (cause: unknown) {
    // The folder may not exist; the rest of the roaming root can still decide.
    void cause;
    return [];
  }
};

/**
 * Private files anywhere under the roaming root, breadth first and within the
 * walk's bounds. Directories that cannot be listed are skipped, links are not
 * followed, and an entry is inspected only while the directory still needs a
 * file or the queue has room for a folder. A listing reads no more names than
 * the budget has left, so a crowded folder is never enumerated whole. A walk
 * that runs out of budget keeps the files it found; with none, the view stays
 * unknown.
 */
const roamingProbes = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  privateRoaming: string,
  entryBudget: { inspected: number },
): readonly string[] => {
  const probes: string[] = [];
  const queue: { readonly path: string; readonly depth: number }[] = [
    { path: "", depth: 0 },
  ];
  for (
    let listed = 0;
    listed < ROAMING_DIRECTORY_LIMIT &&
    probes.length < PROCESS_VIEW_PROBES &&
    entryBudget.inspected < ROAMING_ENTRY_LIMIT;
    listed++
  ) {
    const directory = queue.shift();
    if (directory === undefined) break;
    let names: readonly string[];
    try {
      const enumerated = fileSystem.readdir(
        join(privateRoaming, directory.path),
        ROAMING_ENTRY_LIMIT - entryBudget.inspected,
      );
      // `readdir` and sorting have already processed every returned name, even
      // when queue/file limits mean only a prefix can be inspected below.
      entryBudget.inspected += enumerated.length;
      names = [...enumerated].sort();
    } catch (cause: unknown) {
      // An unreadable folder cannot be compared; the others still can.
      void cause;
      continue;
    }
    let taken = 0;
    for (const name of names) {
      const wantsFile = taken < PROBES_PER_DIRECTORY;
      const wantsFolder =
        directory.depth < ROAMING_DEPTH_LIMIT &&
        listed + queue.length < ROAMING_DIRECTORY_LIMIT - 1;
      if (!wantsFile && !wantsFolder) break;
      const path = join(directory.path, name);
      const entry = entryKind(fileSystem, join(privateRoaming, path));
      if (entry === "file" && wantsFile) {
        probes.push(path);
        taken += 1;
        if (probes.length === PROCESS_VIEW_PROBES) break;
      } else if (entry === "directory" && wantsFolder)
        queue.push({ path, depth: directory.depth + 1 });
    }
  }
  return probes;
};

const isPrivateFile = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  privateRoaming: string,
  path: string,
): boolean => entryKind(fileSystem, join(privateRoaming, path)) === "file";

/** A listed entry's kind, without following links; one that vanished or is unreadable is neither. */
const entryKind = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  path: string,
): "file" | "directory" | undefined => {
  try {
    const entry = fileSystem.lstat(path);
    return entry.isFile()
      ? "file"
      : entry.isDirectory()
        ? "directory"
        : undefined;
  } catch (cause: unknown) {
    // A candidate may vanish or become unreadable while listed.
    void cause;
    return undefined;
  }
};

const present = (
  fileSystem: ClaudeDesktopLocationFileSystem,
  path: string,
): Result<boolean, ClaudeDesktopLocationFailure> => {
  try {
    fileSystem.lstat(path);
    return ok(true);
  } catch (cause: unknown) {
    if (isMissing(cause)) return ok(false);
    return err({
      path,
      message: `${path} could not be inspected, so REA cannot establish which ${CONFIG_FILE} Claude Desktop's MSIX package reads: ${errorMessage(cause)}. Repair access to that path, then rerun.`,
    });
  }
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : String(cause);
