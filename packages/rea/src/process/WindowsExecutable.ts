import { stat } from "node:fs/promises";
import { win32 } from "node:path";

import { err, ok, type Result } from "../domain/result.js";
import { ABORTED, waitForAbortable } from "./AbortablePromise.js";
import { snapshotEnvironment } from "./snapshotEnvironment.js";

/** Parse PATH once, preserving quoted semicolons and explicit relative entries. */
export const windowsPathEntries = (value: string): readonly string[] => {
  const entries: string[] = [];
  let start = 0;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    if (value[index] === '"') quoted = !quoted;
    else if (value[index] === ";" && !quoted) {
      entries.push(value.slice(start, index));
      start = index + 1;
    }
  }
  entries.push(value.slice(start));
  return entries.flatMap((entry) => {
    if (entry === "") return [];
    if (entry.startsWith('"') && entry.endsWith('"') && entry.length >= 2)
      return entry.length === 2 ? [] : [entry.slice(1, -1)];
    return entry.includes('"') ? [] : [entry];
  });
};

export type WindowsExecutableFailure =
  | { readonly kind: "missing" }
  | { readonly kind: "interrupted" }
  | { readonly kind: "invalid_extension"; readonly extension: string }
  | {
      readonly kind: "inspection";
      readonly path: string;
      readonly code: string | null;
      readonly cause: unknown;
    };

/**
 * Resolve a default bare command against PATH/PATHEXT only. Never return a bare
 * name on failure: handing it to Windows would restart implicit CWD lookup.
 * Callers own the lookup deadline and translation to their operation errors.
 */
export const findWindowsExecutable = async (
  executable: string,
  environment: Readonly<NodeJS.ProcessEnv>,
  options: {
    readonly signal: AbortSignal;
    readonly cwd?: string;
    readonly allowBatch?: boolean;
  },
): Promise<Result<string, WindowsExecutableFailure>> => {
  if (options.signal.aborted) return err({ kind: "interrupted" });
  const selected = snapshotEnvironment(environment, "win32");
  const extensions = (selected.PATHEXT ?? ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .filter((extension) => extension !== "");
  for (const extension of extensions)
    if (!extension.startsWith(".") || /[\\/:\0]/u.test(extension))
      return err({ kind: "invalid_extension", extension });
  const explicitExtension = win32.extname(executable);
  const allowed =
    explicitExtension !== ""
      ? options.allowBatch === true ||
        [".exe", ".com"].includes(explicitExtension.toLowerCase())
        ? [""]
        : []
      : options.allowBatch === true
        ? extensions
        : extensions.filter((extension) =>
            [".exe", ".com"].includes(extension.toLowerCase()),
          );
  const cwd = options.cwd ?? process.cwd();
  for (const directory of windowsPathEntries(selected.PATH ?? "")) {
    for (const extension of allowed) {
      if (options.signal.aborted) return err({ kind: "interrupted" });
      const candidate = win32.resolve(
        cwd,
        directory,
        `${executable}${extension}`,
      );
      try {
        const metadata = await waitForAbortable(
          stat(candidate),
          options.signal,
        );
        if (metadata === ABORTED || options.signal.aborted)
          return err({ kind: "interrupted" });
        if (metadata.isFile()) return ok(candidate);
      } catch (cause: unknown) {
        if (options.signal.aborted) return err({ kind: "interrupted" });
        const code =
          typeof cause === "object" && cause !== null
            ? Reflect.get(cause, "code")
            : undefined;
        if (code === "ENOENT" || code === "ENOTDIR") continue;
        return err({
          kind: "inspection",
          path: candidate,
          code: typeof code === "string" ? code : null,
          cause,
        });
      }
    }
  }
  return err({ kind: "missing" });
};
