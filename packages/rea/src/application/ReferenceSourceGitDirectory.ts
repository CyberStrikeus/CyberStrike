import { lstat, realpath, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { absoluteCallerPath } from "../filesystem/callerPath.js";

/** Parsed repository locations shared by HEAD and local ignore-policy readers. */
export interface ReferenceSourceGitDirectory {
  readonly repository: string;
  readonly gitDirectory: string;
  readonly commonDirectory: string;
}

/** Locate the nearest repository without running Git or following config includes. */
export const locateReferenceSourceGitDirectory = async (
  root: string,
  readText: (path: string) => Promise<string>,
  signal?: AbortSignal,
): Promise<ReferenceSourceGitDirectory | undefined> => {
  let repository = root;
  for (;;) {
    signal?.throwIfAborted();
    const dotgit = join(repository, ".git");
    let metadata;
    try {
      metadata = await lstat(dotgit);
    } catch (cause: unknown) {
      if (!hasCode(cause, "ENOENT")) throw cause;
      const parent = dirname(repository);
      if (parent === repository) return undefined;
      repository = parent;
      continue;
    }
    let selectedGitDirectory = dotgit;
    if (metadata.isFile()) {
      const pointer = (await readText(dotgit)).replace(/\r?\n$/u, "");
      if (!pointer.startsWith("gitdir: ") || pointer.length === 8)
        throw new Error("Invalid Git directory pointer");
      selectedGitDirectory = absoluteCallerPath(pointer.slice(8), {
        cwd: repository,
      });
    }
    // Derived joins and the Git library normalize paths lexically. Admit the
    // physical directory first, while the source pointer stays in its file.
    const gitDirectory = await resolveGitDirectory(selectedGitDirectory);
    let common: string | undefined;
    try {
      common = (await readText(join(gitDirectory, "commondir"))).replace(
        /\r?\n$/u,
        "",
      );
    } catch (cause: unknown) {
      if (!hasCode(cause, "ENOENT")) throw cause;
    }
    if (common === "") throw new Error("Invalid Git common-directory pointer");
    const commonDirectory =
      common === undefined
        ? gitDirectory
        : await resolveGitDirectory(
            absoluteCallerPath(common, { cwd: gitDirectory }),
          );
    return { repository, gitDirectory, commonDirectory };
  }
};

const resolveGitDirectory = async (path: string): Promise<string> => {
  // Darwin realpath can collapse file/.. even when native lookup rejects it.
  // Admit the selected traversal before deriving paths for metadata consumers.
  if (!(await stat(path)).isDirectory())
    throw Object.assign(
      new Error(`Git metadata path is not a directory: ${path}`),
      {
        code: "ENOTDIR",
        path,
      },
    );
  return realpath(path);
};

const hasCode = (cause: unknown, code: string): boolean =>
  typeof cause === "object" &&
  cause !== null &&
  "code" in cause &&
  cause.code === code;
