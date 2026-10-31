import { satisfies } from "semver";

/** Supported runtime range, kept in sync with the published package engines. */
export const SUPPORTED_NODE_VERSION_RANGE = "^22.23.4 || ^24.22.1 || >=26.12.1";

/** Human-readable form of {@link SUPPORTED_NODE_VERSION_RANGE} for remediation. */
export const SUPPORTED_NODE_VERSION_PROSE =
  "Node.js 22.x (>=22.23.4), 24.x (>=24.22.1), or 26.12.1+";

/** Return whether a Node.js version satisfies REA's tested runtime families. */
export const supportsNodeVersion = (version: string): boolean =>
  satisfies(version, SUPPORTED_NODE_VERSION_RANGE);

/** JavaScript runtime executing REA. Bun also reports a Node.js compatibility version. */
export type JavaScriptRuntime =
  | { readonly id: "node"; readonly version: string }
  | {
      readonly id: "bun";
      readonly version: string;
      readonly nodeCompatibilityVersion: string;
    };

/** Identify the runtime from `process.versions`; only Bun reports `bun`. */
export const javaScriptRuntime = (versions: {
  readonly node: string;
  readonly bun?: string | undefined;
}): JavaScriptRuntime =>
  versions.bun === undefined
    ? { id: "node", version: versions.node }
    : {
        id: "bun",
        version: versions.bun,
        nodeCompatibilityVersion: versions.node,
      };

/** Bun is supported when its reported Node.js compatibility version is. */
export const supportsJavaScriptRuntime = (
  runtime: JavaScriptRuntime,
): boolean =>
  supportsNodeVersion(
    runtime.id === "node" ? runtime.version : runtime.nodeCompatibilityVersion,
  );
