import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { normalizeTestTemporaryPrefix } from "../../../scripts/lib/test-temporary-ownership.mjs";

/** An isolated filesystem and environment projection owned by one test. */
export interface TestWorkspace {
  readonly root: string;
  readonly home: string;
  readonly environment: NodeJS.ProcessEnv;
  path(...segments: readonly string[]): string;
  mkdir(relativePath: string): Promise<string>;
  write(relativePath: string, contents: string | Uint8Array): Promise<string>;
}

/** Remove a workspace previously returned by createTestWorkspace. */
export const removeTestWorkspace = async (root: string): Promise<void> => {
  await rm(root, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 25,
  });
};

/** Create one isolated workspace for a fixture composition root. */
export const createTestWorkspace = async (
  prefix = "rea-test-workspace-",
): Promise<TestWorkspace> => {
  const canonicalTemporaryRoot = await realpath(tmpdir());
  const root = await realpath(
    await mkdtemp(
      join(canonicalTemporaryRoot, normalizeTestTemporaryPrefix(prefix)),
    ),
  );
  const home = join(root, "home");
  const xdgConfigHome = join(root, "xdg", "config");
  const xdgCacheHome = join(root, "xdg", "cache");
  await Promise.all([
    mkdir(home, { recursive: true }),
    mkdir(xdgConfigHome, { recursive: true }),
    mkdir(xdgCacheHome, { recursive: true }),
  ]);

  const resolvePath = (...segments: readonly string[]): string => {
    const path = resolve(root, ...segments);
    const displacement = relative(root, path);
    if (displacement === ".." || displacement.startsWith(`..${sep}`)) {
      throw new TypeError("Test workspace paths must remain beneath its root");
    }
    if (isAbsolute(displacement)) {
      throw new TypeError("Test workspace paths must remain beneath its root");
    }
    return path;
  };

  return {
    root,
    home,
    environment: {
      HOME: home,
      XDG_CONFIG_HOME: xdgConfigHome,
      XDG_CACHE_HOME: xdgCacheHome,
    },
    path: resolvePath,
    mkdir: async (relativePath) => {
      const path = resolvePath(relativePath);
      await mkdir(path, { recursive: true });
      return path;
    },
    write: async (relativePath, contents) => {
      const path = resolvePath(relativePath);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, contents);
      return path;
    },
  };
};
