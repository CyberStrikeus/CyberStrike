import { existsSync, statSync } from "node:fs";
import { win32 } from "node:path";
import { windowsPathEntries } from "../process/WindowsExecutable.js";

export interface WindowsExecutableLookup {
  /** Windows-formatted working directory; defaults to the process CWD. */
  readonly cwd?: string;
  /** Test seam for Windows paths when running on a non-Windows host. */
  readonly isFile?: (path: string) => boolean;
}

const isRegularFile = (path: string): boolean => {
  try {
    return existsSync(path) && statSync(path).isFile();
  } catch {
    return false;
  }
};

/** Resolve Windows bare command names against the captured child environment. */
export const resolveWindowsProviderExecutable = (
  executable: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  lookup: WindowsExecutableLookup = {},
): string => {
  const cwd = lookup.cwd ?? process.cwd();
  const absolute = (...paths: string[]): string => win32.resolve(cwd, ...paths);
  if (
    win32.isAbsolute(executable) ||
    executable.includes("/") ||
    executable.includes("\\") ||
    win32.parse(executable).root !== ""
  )
    return absolute(executable);

  const pathValue = environment.PATH ?? environment.Path ?? environment.path;
  if (pathValue === undefined) return executable;
  const pathEntries = windowsPathEntries(pathValue);
  const explicitExtension = win32.extname(executable).toLowerCase();
  if (explicitExtension !== "" && ![".com", ".exe"].includes(explicitExtension))
    return executable;
  const extensions =
    explicitExtension !== ""
      ? [""]
      : (environment.PATHEXT ?? environment.PathExt ?? ".COM;.EXE")
          .split(";")
          .filter((extension) =>
            [".com", ".exe"].includes(extension.toLowerCase()),
          );

  for (const entry of pathEntries) {
    if (entry.length === 0) continue;
    for (const extension of extensions) {
      const candidate = absolute(entry, `${executable}${extension}`);
      if ((lookup.isFile ?? isRegularFile)(candidate)) return candidate;
    }
  }
  return executable;
};
