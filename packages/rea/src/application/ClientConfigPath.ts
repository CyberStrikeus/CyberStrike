import { lstat, realpath } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

interface ClientConfigPathStats {
  readonly uid?: number;
  isFile?(): boolean;
  isSymbolicLink(): boolean;
}

interface ClientConfigPathFileSystem {
  lstat(path: string): Promise<ClientConfigPathStats>;
  realpath?(path: string): Promise<string>;
}

const systemFileSystem: ClientConfigPathFileSystem = { lstat, realpath };

/**
 * Resolve one stable transaction path for a configuration file.
 * An existing user-owned config symlink resolves to its target file.
 * Parent-directory aliases resolve for regular and missing files, so a
 * directory symlink and its real directory share one queue key. Missing
 * paths stay eligible for first-run creation.
 */
export const resolveClientConfigTransactionPath = async (
  requestedPath: string,
  fileSystem: ClientConfigPathFileSystem = systemFileSystem,
): Promise<string | undefined> => {
  let requestedStats: ClientConfigPathStats | undefined;
  try {
    requestedStats = await fileSystem.lstat(requestedPath);
  } catch (cause: unknown) {
    if (!isMissing(cause)) return undefined;
  }
  if (requestedStats?.isSymbolicLink() === true)
    return resolveOwnedConfigSymlink(requestedPath, requestedStats, fileSystem);
  return canonicalRegularConfigPath(requestedPath, fileSystem);
};

const resolveOwnedConfigSymlink = async (
  requestedPath: string,
  requestedStats: ClientConfigPathStats,
  fileSystem: ClientConfigPathFileSystem,
): Promise<string | undefined> => {
  const currentUid =
    typeof process.getuid === "function" ? process.getuid() : undefined;
  if (
    currentUid === undefined ||
    requestedStats.uid !== currentUid ||
    fileSystem.realpath === undefined
  )
    return undefined;

  try {
    const canonicalPath = await fileSystem.realpath(requestedPath);
    const targetStats = await fileSystem.lstat(canonicalPath);
    return targetStats.isFile?.() === true && targetStats.uid === currentUid
      ? canonicalPath
      : undefined;
  } catch (cause: unknown) {
    // best-effort cleanup: unreadable or vanishing config paths mean no registration.
    void cause;
    return undefined;
  }
};

/**
 * Resolve parent-directory aliases, including when the file or an intermediate
 * directory is absent. A realpath failure keeps the requested spelling.
 */
const canonicalRegularConfigPath = async (
  requestedPath: string,
  fileSystem: ClientConfigPathFileSystem,
): Promise<string | undefined> => {
  if (fileSystem.realpath === undefined) return requestedPath;
  let ancestor = absoluteCallerPath(requestedPath);
  const directoryRequired =
    process.platform !== "win32" && ancestor.endsWith("/");
  const missing: string[] = [];
  while (true) {
    try {
      const canonical = join(await fileSystem.realpath(ancestor), ...missing);
      // Reconstructing missing children must retain the caller's directory
      // requirement; otherwise a missing `config.json/` becomes a writable file.
      return directoryRequired && !canonical.endsWith("/")
        ? `${canonical}/`
        : canonical;
    } catch (cause: unknown) {
      if (!isAbsentPath(cause) || dirname(ancestor) === ancestor)
        return requestedPath;
      // An absent directory before '..' cannot establish the selected parent.
      if (basename(ancestor) === "..") return undefined;
      missing.unshift(basename(ancestor));
      ancestor = dirname(ancestor);
    }
  }
};

const isMissing = (cause: unknown): boolean =>
  cause instanceof Error && "code" in cause && cause.code === "ENOENT";

const isAbsentPath = (cause: unknown): boolean =>
  cause instanceof Error &&
  "code" in cause &&
  (cause.code === "ENOENT" || cause.code === "ENOTDIR");
