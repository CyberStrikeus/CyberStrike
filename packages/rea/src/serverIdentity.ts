import { dirname, basename, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { createCatalogIdentity } from "./catalogIdentity.js";
import { PRODUCT_IDENTITY, SDK_IDENTITY } from "./identity.js";

/** Optional observations supplied by a client comparing its expected server. */
export interface ExpectedServerIdentity {
  readonly package_version?: string;
  readonly catalog_digest?: string;
  readonly server_path?: string;
}

export interface ConnectedClientIdentity {
  readonly name: string;
  readonly version: string;
}

const packageRoot = (): string => {
  const moduleDirectory = dirname(fileURLToPath(import.meta.url));
  return basename(moduleDirectory) === "src" &&
    basename(dirname(moduleDirectory)) === "dist"
    ? resolve(moduleDirectory, "../..")
    : resolve(moduleDirectory, "..");
};

/** Build one runtime identity without claiming alignment from absent observations. */
export const createServerIdentity = (input: {
  readonly startedAt: string;
  readonly commandPath: string | undefined;
  readonly expected?: ExpectedServerIdentity;
  readonly client?: ConnectedClientIdentity;
  readonly protocolVersion?: string | undefined;
  readonly catalog: ReturnType<typeof createCatalogIdentity>;
}) => {
  const catalog = input.catalog;
  const serverPath = input.commandPath || undefined;
  const reasons: string[] = [];
  if (
    input.expected?.package_version !== undefined &&
    input.expected.package_version !== PRODUCT_IDENTITY.packageVersion
  )
    reasons.push("package_version_mismatch");
  if (
    input.expected?.catalog_digest !== undefined &&
    input.expected.catalog_digest !== catalog.digests.combined_sha256
  )
    reasons.push("catalog_digest_mismatch");
  if (
    input.expected?.server_path !== undefined &&
    serverPath !== undefined &&
    resolve(input.expected.server_path) !== serverPath
  )
    reasons.push("registration_path_mismatch");
  const observedExpectation =
    input.expected !== undefined &&
    Object.values(input.expected).some((value) => value !== undefined);
  const pathComparable =
    input.expected?.server_path === undefined || serverPath !== undefined;
  return {
    package: {
      name: PRODUCT_IDENTITY.packageName,
      version: PRODUCT_IDENTITY.packageVersion,
      root_path: packageRoot(),
      build_commit: process.env.REA_BUILD_COMMIT ?? null,
    },
    server: {
      name: PRODUCT_IDENTITY.mcpServerKey,
      version: PRODUCT_IDENTITY.packageVersion,
      started_at: input.startedAt,
      command_path: serverPath ?? null,
    },
    sdk: SDK_IDENTITY,
    negotiated_protocol_version: input.protocolVersion ?? null,
    client:
      input.client === undefined
        ? null
        : { name: input.client.name, version: input.client.version },
    skill: {
      name: PRODUCT_IDENTITY.skillName,
      expected_version: PRODUCT_IDENTITY.skillVersion,
    },
    catalog: {
      counts: catalog.counts,
      digests: catalog.digests,
    },
    protocol_features: {
      progress: true,
      cancellation: true,
      elicitation: false,
    },
    alignment: {
      state:
        reasons.length > 0
          ? "mcp_server_restart_required"
          : observedExpectation && pathComparable
            ? "aligned"
            : "unknown",
      reasons,
      remediation:
        reasons.length > 0
          ? "Restart the registered MCP server/client, then compare identity again."
          : observedExpectation && pathComparable
            ? null
            : input.expected?.server_path !== undefined &&
                serverPath === undefined
              ? "The server entrypoint path is unavailable, so registration identity cannot be compared."
              : "Supply expected package, catalog, or registration identity to compare the live server.",
    },
  } as const;
};
