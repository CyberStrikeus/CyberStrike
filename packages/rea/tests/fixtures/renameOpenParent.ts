import { rename } from "node:fs/promises";

/** Attempt the inode-preserving parent swap; Windows may refuse it while the child is open. */
export const renameOpenParent = async (
  from: string,
  to: string,
  options: {
    readonly platform?: NodeJS.Platform;
    readonly rename?: typeof rename;
  } = {},
): Promise<{ kind: "renamed" } | { kind: "blocked"; cause: unknown }> => {
  try {
    await (options.rename ?? rename)(from, to);
    return { kind: "renamed" };
  } catch (cause: unknown) {
    if (
      (options.platform ?? process.platform) === "win32" &&
      cause instanceof Error &&
      "code" in cause &&
      cause.code === "EPERM"
    )
      return { kind: "blocked", cause };
    throw cause;
  }
};
