import { dirname, isAbsolute, resolve, sep } from "node:path";
import { tmpdir } from "node:os";

/** Session roots may not contain a dot-prefixed path element. */
const hasDotPrefixElement = (directory: string): boolean =>
  resolve(directory)
    .split(sep)
    .some((element) => element.startsWith("."));

/** Nearest ancestor of `directory`, inclusive, that has no dot-prefixed element. */
const nearestSafeAncestor = (directory: string): string | undefined => {
  let current = resolve(directory);
  for (;;) {
    if (!hasDotPrefixElement(current)) return current;
    const parent = dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
};

/** Coordinates accepted by {@link ghidraSessionRoot}. */
export interface GhidraSessionRootOptions {
  /** Inherited base directory, normally `os.tmpdir()`. */
  readonly base?: string;
  /** Platform-specific dot-free fallback directory passed to `mkdtemp`. */
  readonly fallback?: string;
  /** Platform override used by deterministic boundary tests. */
  readonly platform?: NodeJS.Platform;
}

/**
 * Select a session root usable as the parent of a Ghidra project path.
 *
 * Ghidra validates every project path element with `NamingUtilities.checkName`
 * and aborts the headless analyzer on any element that starts with `.`, so an
 * inherited `TMPDIR` such as `~/.cache/<tool>` fails every Ghidra operation
 * with a generic analysis failure. Prefer the inherited base when it is usable,
 * then a dot-free platform temp directory, then the nearest dot-free ancestor.
 */
export const ghidraSessionRoot = (
  options: GhidraSessionRootOptions = {},
): string => {
  const base = resolve(options.base ?? tmpdir());
  if (!hasDotPrefixElement(base)) return base;
  const platform = options.platform ?? process.platform;
  const fallback =
    options.fallback ?? (platform === "win32" ? undefined : "/tmp");
  if (
    fallback !== undefined &&
    isAbsolute(fallback) &&
    !hasDotPrefixElement(fallback)
  )
    return resolve(fallback);
  return nearestSafeAncestor(base) ?? base;
};
