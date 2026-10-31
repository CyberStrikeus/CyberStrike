import { z } from "zod";
import { digestSchema } from "../digests.js";

const packageIdentitySchema = z.strictObject({
  path: z.string().min(1),
  sha256: digestSchema,
  container_sha256: digestSchema,
});
export const nextAppSourceContextSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("app-directory"),
    directory: z.string().min(1),
    package: packageIdentitySchema,
  }),
  z.strictObject({
    kind: z.literal("compiled-directory"),
    directory: z.string().min(1),
    package: packageIdentitySchema,
  }),
  z.strictObject({
    kind: z.literal("outside-app-directory"),
    package: packageIdentitySchema,
  }),
  z.strictObject({
    kind: z.literal("unknown"),
    reason: z.string(),
    package: packageIdentitySchema.nullable(),
  }),
]);
export type NextAppSourceContext = z.infer<typeof nextAppSourceContextSchema>;
export type NextAppRouteContext =
  | { readonly kind: "source-path"; readonly source: NextAppSourceContext }
  | { readonly kind: "script-url" }
  | {
      readonly kind: "source-literal";
      readonly runtime: "next" | "unknown";
    }
  | { readonly kind: "source-reference" };

/** URL route syntax, independent of filesystem path normalization. */
export const routePath = (
  value: string,
  options: { relative?: boolean; navigation?: boolean } = {},
): string | undefined => {
  const end = options.navigation ? value.search(/[?#]/u) : -1;
  const path = end < 0 ? value : value.slice(0, end);
  if (!path || /[\u0000-\u0020\u007f\\]/u.test(path) || path.startsWith("//"))
    return;
  if (!path.startsWith("/") && !options.relative) return;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(path)) return;
  return path.startsWith("/") ? path : `/${path}`;
};

export type NextAppRoutePath =
  | { readonly kind: "known"; readonly path: string }
  | { readonly kind: "unknown"; readonly reason: string };

/**
 * Test /(?:^|\/)app\/(?:[\s\S]*\/)?page(?:\.[cm]?[jt]sx?|-[^/?#]+\.js|)(?:[?#].*)?$/u
 * in linear time; every source literal reaches this test. The first `app/`
 * segment admits every later page segment, and `.` cannot cross a line
 * terminator, so a query or fragment after the page filename starts on the
 * last line. Retrying from each `app/` or `?` instead is quadratic.
 */
const isPageShapedPath = (value: string): boolean => {
  const app = /(?:^|\/)app\//u.exec(value);
  if (app === null) return false;
  const tail = value.slice(app.index + app[0].length);
  const lastLineStart =
    Math.max(
      tail.lastIndexOf("\n"),
      tail.lastIndexOf("\r"),
      tail.lastIndexOf("\u2028"),
      tail.lastIndexOf("\u2029"),
    ) + 1;
  for (const page of tail.matchAll(
    /(?:^|\/)page(?:\.[cm]?[jt]sx?|-[^/?#]+\.js|)(?=[?#]|$)/gu,
  ))
    if (page.index + page[0].length >= lastLineStart) return true;
  return false;
};

/** Classify a page filename without treating missing routing context as absence. */
export const classifyNextAppRoutePath = (
  raw: string,
  context: NextAppRouteContext,
): NextAppRoutePath | undefined => {
  if (raw.includes("\\") || context.kind === "source-reference") return;
  let value = raw;
  const urlPath =
    context.kind === "script-url" ||
    (context.kind === "source-literal" && raw.includes("://"));
  if (urlPath) {
    try {
      value = new URL(raw).pathname;
    } catch {
      return;
    }
  }
  // Ownership selects the routing root before page-segment conversion.
  let relative: string | undefined;
  let chunk = false;
  if (context.kind === "source-path") {
    if (context.source.kind === "outside-app-directory") return;
    if (
      context.source.kind === "app-directory" ||
      context.source.kind === "compiled-directory"
    ) {
      const prefix = `${context.source.directory}/`;
      if (!value.startsWith(prefix)) return;
      relative = value.slice(prefix.length);
      chunk = context.source.kind === "compiled-directory";
    }
  } else if (context.kind === "script-url" || context.runtime === "next") {
    const boundary = "/_next/static/chunks/app/";
    const assetRoot = value.indexOf(boundary);
    const localChunk = ["static/chunks/app/", ".next/static/chunks/app/"].find(
      (prefix) => value.startsWith(prefix),
    );
    if (assetRoot >= 0) {
      relative = value.slice(assetRoot + boundary.length);
      chunk = true;
    } else if (context.kind === "source-literal" && localChunk !== undefined) {
      relative = value.slice(localChunk.length);
      chunk = true;
    } else if (context.kind === "source-literal") {
      const prefix = value.startsWith("src/app/") ? "src/app/" : "app/";
      if (value.startsWith(prefix)) relative = value.slice(prefix.length);
    }
  }
  if (relative === undefined) {
    if (isPageShapedPath(value))
      return {
        kind: "unknown",
        reason:
          context.kind === "source-path" && context.source.kind === "unknown"
            ? context.source.reason
            : "The page-shaped path has no established Next App Router root or runtime context.",
      };
    return;
  }
  if (urlPath) {
    // Captured script URLs encode filesystem segments. Decode once here, after
    // selecting the Next asset root; source paths retain their literal spelling.
    if (/%(?:2f|5c)/iu.test(relative))
      return {
        kind: "unknown",
        reason: "A Next script URL contains an encoded path separator.",
      };
    try {
      relative = decodeURIComponent(relative);
    } catch (cause: unknown) {
      if (!(cause instanceof URIError)) throw cause;
      return {
        kind: "unknown",
        reason: "A Next script URL contains malformed percent encoding.",
      };
    }
  }
  const match =
    /^(?:([\s\S]*?)\/)?page(?:-([^/?#]+)\.js|\.(?:[cm]?jsx?|tsx?)|)([?#].*)?$/u.exec(
      relative,
    );
  if (
    match === null ||
    (match[2] !== undefined && !chunk) ||
    // URL parsing already removed URL suffixes. Any decoded delimiter is a
    // filename byte, as it is in an inventoried filesystem source path.
    (match[3] !== undefined && (urlPath || context.kind === "source-path"))
  )
    return;
  if (/[\u0000-\u001f\u007f]/u.test(relative))
    return {
      kind: "unknown",
      reason: "A Next page filename contains a control character.",
    };
  const sourceSegments = (match[1] ?? "").split("/");
  // A private folder excludes the whole page, including intercepted ancestors.
  // Keep filesystem segment spelling: only Next's explicit %5F escape is
  // normalized below; generic URI decoding merges distinct source filenames.
  if (sourceSegments.some((segment) => segment.startsWith("_"))) return;
  const segments: string[] = [];
  for (const sourceSegment of sourceSegments) {
    const segment = sourceSegment.replace(/%5F/gu, "_");
    if (/^\([^)]*\)$/u.test(segment) || segment.startsWith("@")) continue;
    // Intercepted routes need a parent routing context that a filename does not establish.
    if (segment.startsWith("("))
      return {
        kind: "unknown",
        reason:
          "An intercepted Next page route requires parent routing context unavailable from its filename.",
      };
    if (segment.includes("/") || segment === "." || segment === "..") return;
    const optional = /^\[\[\.\.\.([^\]]+)\]\]$/u.exec(segment);
    const catchAll = /^\[\.\.\.([^\]]+)\]$/u.exec(segment);
    const parameter = /^\[([^\]]+)\]$/u.exec(segment);
    segments.push(
      optional
        ? `:${optional[1]}*`
        : catchAll
          ? `:${catchAll[1]}+`
          : parameter
            ? `:${parameter[1]}`
            : segment,
    );
  }
  // These are filename-derived patterns, not navigation URLs. Preserve spaces
  // and literal delimiters rather than applying URL syntax validation.
  return { kind: "known", path: `/${segments.filter(Boolean).join("/")}` };
};

export const nextScriptBasePath = (source: string): string | undefined => {
  let path = source;
  if (/^https?:\/\//iu.test(source)) {
    try {
      path = new URL(source).pathname;
    } catch {
      return;
    }
  } else if (!source.startsWith("/")) return;
  const at = path.indexOf("/_next/");
  return at < 0 ? undefined : path.slice(0, at);
};
