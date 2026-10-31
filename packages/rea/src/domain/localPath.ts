import { isAbsolute, relative, sep } from "node:path";
import { z } from "zod";

/**
 * Reject OS-invalid NUL bytes in a local filesystem name. This is not a path
 * shape check: an empty or relative value is admitted here and narrowed by the
 * callers that need a nonempty or absolute path.
 *
 * The pattern spells NUL as `\x00` rather than `\u0000`. Both accept exactly the
 * same strings. The hex form also avoids the short `\0` spelling rejected by
 * strict schema consumers. A client can reject its entire tool request when
 * one advertised pattern cannot compile. See `offsetDateTimeSchema` for the
 * same hex-escape convention.
 */
export const nulFreeStringSchema = z
  .string()
  .regex(/^[^\x00]*$/u, "Local filesystem paths cannot contain NUL");

/** A selected local filesystem path: nonempty and free of NUL bytes. */
export const localPathStringSchema = nulFreeStringSchema.min(1);

/**
 * A Windows absolute path: rooted, UNC, or drive-qualified. The classes spell
 * backslash and slash as `\x5C` and `\x2F` because `v` mode rejects an
 * unescaped `/` inside a class, and Windows hosts advertise this pattern.
 */
export const windowsAbsolutePathPattern =
  /^(?:[\x5C\x2F]|[A-Za-z]:[\x5C\x2F])/u;

/** A caller-selected path that is absolute on the host running REA. */
export const absoluteLocalPathStringSchema = localPathStringSchema.regex(
  process.platform === "win32" ? windowsAbsolutePathPattern : /^\//u,
  "must be an absolute local filesystem path",
);

/** Test lexical containment on the host platform; callers must resolve symlinks first. */
export const isPathWithinRoot = (root: string, path: string): boolean => {
  const value = relative(root, path);
  return (
    value === "" ||
    (value !== ".." && !value.startsWith(`..${sep}`) && !isAbsolute(value))
  );
};
