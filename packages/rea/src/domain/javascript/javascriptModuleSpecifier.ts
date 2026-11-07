import { err, ok, type Result } from "../result.js";

/** Relative module syntax differs from an arbitrary dot-prefixed filename. */
export const isRelativeJavaScriptModuleSpecifier = (value: string): boolean =>
  value === "." ||
  value === ".." ||
  value.startsWith("./") ||
  value.startsWith("../");

/** Node file-module URL paths decode once and reject encoded separators. */
export const decodeJavaScriptModuleUrlPath = (
  value: string,
): Result<string, string> => {
  if (/%(?:2f|5c)/iu.test(value))
    return err(
      "ES module URL paths cannot contain percent-encoded slash or backslash bytes.",
    );
  try {
    const decoded = decodeURIComponent(value);
    return decoded.includes("\0")
      ? err("The decoded module URL path contains NUL.")
      : ok(decoded);
  } catch (cause: unknown) {
    if (!(cause instanceof URIError)) throw cause;
    return err("The module URL path contains malformed percent encoding.");
  }
};
