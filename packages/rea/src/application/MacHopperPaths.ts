import { readdirSync, type Dirent } from "node:fs";
import { readdir } from "node:fs/promises";
import { posix } from "node:path";
import { appendCallerPath } from "../filesystem/callerPath.js";

export const MAC_HOPPER_APPLICATION_DIRECTORY = "/Applications";
export const MAC_HOPPER_APPLICATION_NAME = "Hopper Disassembler.app";
export const MAC_HOPPER_USER_APPLICATIONS_DIRECTORY = "Applications";

export const MAC_HOPPER_SYSTEM_LAUNCHER = posix.join(
  MAC_HOPPER_APPLICATION_DIRECTORY,
  MAC_HOPPER_APPLICATION_NAME,
  "Contents/MacOS/hopper",
);

export const macHopperUserApplicationPath = (homeDirectory: string): string =>
  appendCallerPath(
    homeDirectory,
    `${MAC_HOPPER_USER_APPLICATIONS_DIRECTORY}/${MAC_HOPPER_APPLICATION_NAME}`,
    "darwin",
  );

export const macHopperApplicationRoots = (
  homeDirectory: string,
): readonly string[] => [
  MAC_HOPPER_APPLICATION_DIRECTORY,
  appendCallerPath(
    homeDirectory,
    MAC_HOPPER_USER_APPLICATIONS_DIRECTORY,
    "darwin",
  ),
];

export const macHopperCanonicalLauncherCandidates = (
  homeDirectory: string,
): readonly string[] => [
  MAC_HOPPER_SYSTEM_LAUNCHER,
  appendCallerPath(
    macHopperUserApplicationPath(homeDirectory),
    "Contents/MacOS/hopper",
    "darwin",
  ),
];

/** Build deterministic candidates from the discovered app bundle names. */
export const macHopperRenamedLauncherCandidates = (
  homeDirectory: string,
  bundleNamesByRoot: ReadonlyMap<string, readonly string[]>,
): readonly string[] =>
  macHopperApplicationRoots(homeDirectory).flatMap((root) =>
    [...new Set(bundleNamesByRoot.get(root) ?? [])]
      .filter(
        (name) =>
          /^Hopper.*\.app$/iu.test(name) &&
          name.toLocaleLowerCase("en-US") !==
            MAC_HOPPER_APPLICATION_NAME.toLocaleLowerCase("en-US"),
      )
      .sort()
      .map((name) =>
        appendCallerPath(root, `${name}/Contents/MacOS/hopper`, "darwin"),
      ),
  );

// A linked application bundle retains its selected spelling. Runtime and
// doctor validate the executable beneath each candidate, rejecting dangling
// links and links to ordinary files without interpreting the bundle again.
const possibleBundleNames = (entries: readonly Dirent[]): readonly string[] =>
  entries
    .filter((entry) => entry.isDirectory() || entry.isSymbolicLink())
    .map(({ name }) => name);

const localBundleNames = (root: string): readonly string[] => {
  try {
    return possibleBundleNames(readdirSync(root, { withFileTypes: true }));
  } catch (cause: unknown) {
    // Missing or unreadable optional app directories contain no candidates.
    void cause;
    return [];
  }
};

/** Yield renamed bundles from the local filesystem, reading each root only if needed. */
export function* localMacHopperRenamedLauncherCandidates(
  homeDirectory: string,
): Generator<string> {
  for (const root of macHopperApplicationRoots(homeDirectory))
    yield* macHopperRenamedLauncherCandidates(
      homeDirectory,
      new Map([[root, localBundleNames(root)]]),
    );
}

/** Read the same renamed bundles without blocking the event loop, for doctor. */
export const readMacHopperRenamedLauncherCandidates = async (
  homeDirectory: string,
): Promise<readonly string[]> => {
  const bundleNamesByRoot = new Map<string, readonly string[]>();
  for (const root of macHopperApplicationRoots(homeDirectory)) {
    try {
      bundleNamesByRoot.set(
        root,
        possibleBundleNames(await readdir(root, { withFileTypes: true })),
      );
    } catch (cause: unknown) {
      // Missing or unreadable optional app directories contain no candidates.
      void cause;
    }
  }
  return macHopperRenamedLauncherCandidates(homeDirectory, bundleNamesByRoot);
};
