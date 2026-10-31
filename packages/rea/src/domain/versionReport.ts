import { z } from "zod";

import {
  javaScriptRuntime,
  SUPPORTED_NODE_VERSION_RANGE,
  supportsJavaScriptRuntime,
} from "./runtimeVersion.js";

/**
 * Machine-readable `rea --version` report for support requests. Every field
 * comes from package metadata or the runtime's own identity; it never carries
 * a path, an environment value, or a user or host name.
 */
export const versionReportSchema = z.strictObject({
  name: z.string(),
  version: z.string(),
  runtime: z.discriminatedUnion("id", [
    z.strictObject({ id: z.literal("node"), version: z.string() }),
    z.strictObject({
      id: z.literal("bun"),
      version: z.string(),
      node_compatibility_version: z.string(),
    }),
  ]),
  platform: z.string(),
  architecture: z.string(),
  supported_runtime: z.strictObject({
    range: z.string(),
    satisfied: z.boolean(),
  }),
});

export type VersionReport = z.infer<typeof versionReportSchema>;

/** Facts the report is built from, injected so it is independent of globals. */
export interface VersionReportHost {
  readonly packageName: string;
  readonly packageVersion: string;
  readonly versions: { readonly node: string; readonly bun?: string };
  readonly platform: string;
  readonly architecture: string;
}

/** Build the report; runtime support uses the same rule as `rea doctor`. */
export const versionReport = (host: VersionReportHost): VersionReport => {
  const runtime = javaScriptRuntime(host.versions);
  return {
    name: host.packageName,
    version: host.packageVersion,
    runtime:
      runtime.id === "node"
        ? { id: "node", version: runtime.version }
        : {
            id: "bun",
            version: runtime.version,
            node_compatibility_version: runtime.nodeCompatibilityVersion,
          },
    platform: host.platform,
    architecture: host.architecture,
    supported_runtime: {
      range: SUPPORTED_NODE_VERSION_RANGE,
      satisfied: supportsJavaScriptRuntime(runtime),
    },
  };
};
