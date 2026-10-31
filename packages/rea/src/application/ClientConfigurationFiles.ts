import { err, ok, type Result } from "../domain/result.js";
import { RegularFileCleanupFailure } from "../filesystem/OwnedRegularFile.js";
import { readRegularFileText } from "./RegularFileRead.js";
import {
  effectiveClientServer,
  parseClientConfiguration,
  type ClientConfigurationDocument,
  type ClientRegistrationDialect,
} from "./ClientConfigurationDocument.js";
import type { SetupClient } from "./SupportedClients.js";
import { clientRegistrationEnvironment } from "./ClientRegistrationEnvironment.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import type { ConfigurationError } from "../domain/configurationErrors.js";
import { mergeEnvironmentOverrides } from "../process/snapshotEnvironment.js";
import { PRODUCT_IDENTITY } from "../identity.js";

/** A parsed layer retains its path so rereading the write target replaces only that layer. */
export interface ClientConfigurationSource extends ClientConfigurationDocument {
  readonly sourcePath: string;
}

const invalidEnvironment = (
  path: string,
  error: ConfigurationError,
  overrides: Readonly<Record<string, string>> = {},
  platform: NodeJS.Platform = process.platform,
): ClientConfigurationFileError => {
  const constraints = error.settings
    .map(({ setting, constraint }) => `${setting}: ${constraint}`)
    .join("; ");
  const overrideNames = new Set(
    Object.keys(overrides).map((name) =>
      platform === "win32" ? name.toUpperCase() : name,
    ),
  );
  const overrideSettings = error.settings
    .map(({ setting }) => setting)
    .filter((setting) =>
      overrideNames.has(platform === "win32" ? setting.toUpperCase() : setting),
    );
  const location =
    overrideSettings.length > 0
      ? `The proposed registration environment includes launch overrides (${overrideSettings.join(", ")}) that do not satisfy the effective REA configuration constraints`
      : overrideNames.size > 0
        ? `The effective REA server environment for ${path} is invalid; check the client configuration and proposed launch overrides`
        : `Configuration ${path} has an invalid REA server environment`;
  return {
    kind: "malformed",
    path,
    detail: `${location}: ${constraints}${constraints.endsWith(".") ? "" : "."} ${overrideNames.size === 0 ? "Repair it" : "Check the launch environment and any existing registration settings"} before rerunning setup.`,
  };
};

/** A named source failure that setup can explain without losing the bad path. */
export interface ClientConfigurationFileError {
  readonly kind: "unreadable" | "malformed";
  readonly path: string;
  readonly detail: string;
  readonly cleanupFailure?: RegularFileCleanupFailure;
}

/** Preserve named read failures and distinguish a missing source from an empty file. */
export const readConfigurationText = async (
  path: string,
  resources?: ArtifactResourceScope,
): Promise<Result<string | undefined, ClientConfigurationFileError>> => {
  try {
    return ok(
      await readRegularFileText(
        path,
        resources === undefined ? {} : { resources },
      ),
    );
  } catch (cause: unknown) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT")
      return ok(undefined);
    return err({
      kind: "unreadable",
      path,
      detail: `Configuration ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
      ...(cause instanceof RegularFileCleanupFailure
        ? { cleanupFailure: cause }
        : {}),
    });
  }
};

/** Read and parse one configuration at its source boundary. */
export const readConfigurationFile = async (
  path: string,
  format: SetupClient["format"],
  resources?: ArtifactResourceScope,
): Promise<
  Result<ClientConfigurationDocument | undefined, ClientConfigurationFileError>
> => {
  const source = await readConfigurationText(path, resources);
  if (!source.ok) return source;
  const content = source.value;
  if (content === undefined) return ok(undefined);
  try {
    return ok(parseClientConfiguration(content, format));
  } catch (cause: unknown) {
    return err({
      kind: "malformed",
      path,
      detail: `Configuration ${path} is malformed: ${cause instanceof Error ? cause.message : String(cause)}`,
    });
  }
};

/** Read each layer; setup may validate its writable layer with proposed overrides. */
export const readClientConfigurationFiles = async (
  client: SetupClient,
  resources?: ArtifactResourceScope,
  platform: NodeJS.Platform = process.platform,
  writeOverrides?: Readonly<Record<string, string>>,
): Promise<
  Result<readonly ClientConfigurationSource[], ClientConfigurationFileError>
> => {
  const documents: ClientConfigurationSource[] = [];
  for (const path of client.configPaths ?? [client.configPath]) {
    const document = await readConfigurationFile(
      path,
      client.format,
      resources,
    );
    if (!document.ok) return document;
    if (document.value !== undefined) {
      const environment = clientRegistrationEnvironment(
        document.value,
        path === client.configPath ? writeOverrides : undefined,
        "fragment",
        platform,
      );
      if (!environment.ok)
        return err(
          invalidEnvironment(
            path,
            environment.error,
            path === client.configPath ? writeOverrides : undefined,
            platform,
          ),
        );
      documents.push({ ...document.value, sourcePath: path });
    }
  }
  const environment = clientRegistrationEnvironment(
    effectiveClientConfiguration(documents, undefined, platform),
    writeOverrides,
    "effective",
    platform,
  );
  if (!environment.ok)
    return err(
      invalidEnvironment(
        client.configPath,
        environment.error,
        writeOverrides,
        platform,
      ),
    );
  return ok(documents);
};

/** OpenCode merges server objects in file order, replacing arrays and scalar values. */
const mergeConfigurationValue = (previous: unknown, next: unknown): unknown => {
  if (!isObject(previous) || !isObject(next)) return next;
  return Object.fromEntries(
    [...new Set([...Object.keys(previous), ...Object.keys(next)])].map(
      (key) => [
        key,
        Object.hasOwn(next, key)
          ? mergeConfigurationValue(previous[key], next[key])
          : previous[key],
      ],
    ),
  );
};
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Native OpenCode dialect applies across all selected configuration layers. */
export const clientWriteDialect = (
  dialect: ClientRegistrationDialect,
  sources: readonly ClientConfigurationDocument[],
): ClientRegistrationDialect =>
  dialect === "opencode" &&
  sources.some(({ dialect }) => dialect === "opencode_v2")
    ? "opencode_v2"
    : dialect;

/** Interpret the write fragment using the effective client dialect, preserving peers. */
export const clientConfigurationForWrite = (
  parsed: ClientConfigurationDocument,
  sources: readonly ClientConfigurationDocument[],
): ClientConfigurationDocument => {
  if (
    parsed.dialect !== "opencode" ||
    clientWriteDialect(parsed.dialect, sources) !== "opencode_v2"
  )
    return parsed;
  if (Object.hasOwn(parsed.servers, "servers"))
    throw new TypeError(
      "A legacy OpenCode server named servers conflicts with the effective native server table; repair this ambiguity before setup",
    );
  return {
    ...parsed,
    dialect: "opencode_v2",
    serversPath: ["mcp", "servers"],
    servers: {},
    legacyServers: parsed.servers,
  };
};

/** Project a client's effective user registration without modifying its source files. */
export const effectiveClientConfiguration = (
  sources: readonly ClientConfigurationSource[],
  target?: {
    readonly client: Pick<SetupClient, "configPath" | "configPaths">;
    readonly document: ClientConfigurationDocument | undefined;
  },
  platform: NodeJS.Platform = process.platform,
): ClientConfigurationDocument | undefined => {
  const documents =
    target === undefined
      ? sources
      : (target.client.configPaths ?? [target.client.configPath]).flatMap(
          (path) => {
            const document =
              path === target.client.configPath
                ? target.document
                : sources.find(({ sourcePath }) => sourcePath === path);
            return document === undefined ? [] : [document];
          },
        );
  const last = documents.at(-1);
  if (last === undefined) return undefined;
  if (documents.length === 1) return last;
  const servers: Record<string, unknown> = Object.create(null);
  for (const document of documents) {
    const names = new Set([
      ...Object.keys(document.legacyServers),
      ...Object.keys(document.servers),
    ]);
    for (const name of names) {
      const previous = servers[name];
      const next = effectiveClientServer(document, name);
      const merged = mergeConfigurationValue(previous, next);
      const key = document.environmentKey;
      if (
        name === PRODUCT_IDENTITY.mcpServerKey &&
        isObject(merged) &&
        isObject(merged[key])
      ) {
        const before =
          isObject(previous) && isObject(previous[key]) ? previous[key] : {};
        const after = isObject(next) && isObject(next[key]) ? next[key] : {};
        servers[name] = {
          ...merged,
          [key]: mergeEnvironmentOverrides(before, after, platform),
        };
      } else servers[name] = merged;
    }
  }
  return {
    ...last,
    dialect: clientWriteDialect(last.dialect, documents),
    servers,
    legacyServers: {},
  };
};

/** Read the configuration ZCode will load, preserving its same-scope fallback rule. */
export const readEffectiveClientRegistrationConfiguration = async (
  client: SetupClient,
  resources?: ArtifactResourceScope,
  platform: NodeJS.Platform = process.platform,
): Promise<
  Result<
    {
      readonly document: ClientConfigurationDocument | undefined;
      readonly configPath: string;
    },
    ClientConfigurationFileError
  >
> => {
  const nativeSources = await readClientConfigurationFiles(
    client,
    resources,
    platform,
  );
  if (!nativeSources.ok) return nativeSources;
  const nativeDocument = effectiveClientConfiguration(
    nativeSources.value,
    undefined,
    platform,
  );
  const fallbackPath =
    client.format === "zcode" ? client.zcodeFallbackPath : undefined;
  if (
    fallbackPath === undefined ||
    (nativeDocument !== undefined &&
      Object.keys(nativeDocument.servers).length > 0)
  )
    return ok({ document: nativeDocument, configPath: client.configPath });

  const fallbackClient: SetupClient = {
    ...client,
    configPath: fallbackPath,
    configPaths: [fallbackPath],
    format: "zcode_fallback",
  };
  const fallbackSources = await readClientConfigurationFiles(
    fallbackClient,
    resources,
    platform,
  );
  if (!fallbackSources.ok) return fallbackSources;
  const fallbackDocument = effectiveClientConfiguration(
    fallbackSources.value,
    undefined,
    platform,
  );
  return ok(
    fallbackDocument === undefined
      ? { document: nativeDocument, configPath: client.configPath }
      : { document: fallbackDocument, configPath: fallbackPath },
  );
};
