import { posix } from "node:path";
import { err, ok, type Result } from "./result.js";

export interface ReferenceSourcePathLookup {
  /** Whether an exact or canonical identity exists, including ambiguous ones. */
  readonly has: (path: string) => boolean;
  readonly resolve: (path: string) => string | undefined;
  readonly resolveCandidates: (paths: readonly string[]) => string | undefined;
  /** Resolve a path to the closest recorded parent identity. */
  readonly resolveAncestor: (path: string) => string | undefined;
}

/**
 * Reference inventories retain filesystem spelling. Prefer that exact identity;
 * canonical Unicode equivalence is a fallback only when it identifies one entry.
 */
export const createReferenceSourcePathLookup = (
  paths: Iterable<string>,
): ReferenceSourcePathLookup => {
  const exact = new Set(paths);
  const canonical = new Map<string, string | null>();
  for (const path of exact) {
    const key = path.normalize("NFC");
    canonical.set(key, canonical.has(key) ? null : path);
  }
  const equivalent = (path: string): string | undefined =>
    canonical.get(path.normalize("NFC")) ?? undefined;
  const has = (path: string): boolean =>
    exact.has(path) || canonical.has(path.normalize("NFC"));
  const resolve = (path: string): string | undefined =>
    exact.has(path) ? path : equivalent(path);
  return {
    has,
    resolve,
    resolveCandidates: (candidates) =>
      candidates.find((path) => exact.has(path)) ??
      candidates.map(equivalent).find((path) => path !== undefined),
    resolveAncestor: (path) => {
      for (
        let candidate = path;
        candidate !== "." && candidate !== "/";
        candidate = posix.dirname(candidate)
      ) {
        const found = resolve(candidate);
        if (found !== undefined) return found;
      }
      return undefined;
    },
  };
};

/** Symlink evidence can originate on a different OS from the graph reader. */
export const isPortableAbsoluteReferenceTarget = (target: string): boolean =>
  target.startsWith("/") ||
  /^[A-Za-z]:[\\/]/u.test(target) ||
  /^\\\\[^\\/]+[\\/][^\\/]+/u.test(target);

/** Decode one historical inventory URL path; backslash remains a filename byte. */
export const decodeReferenceSourceModuleUrlPath = (
  value: string,
): Result<string, string> => {
  if (/%2f/iu.test(value))
    return err(
      "Historical module URL paths cannot contain percent-encoded slash bytes.",
    );
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("\0")
      ? err("The decoded historical module URL path contains NUL.")
      : ok(decoded);
  } catch (cause: unknown) {
    if (!(cause instanceof URIError)) throw cause;
    return err(
      "The historical module URL path contains malformed percent encoding.",
    );
  }
};
