import { realpath, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { stripComments } from "jsonc-parser";
import { z } from "zod";
import { err, ok, type Result } from "../domain/result.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import type { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { currentClientRegistrationCommand } from "./ClientRegistrationIdentity.js";
import {
  clientConfigurationValuesEqual,
  clientRegistrationEntry,
  geminiServerPolicyBlock,
  parseGeminiMcpPolicy,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import {
  readConfigurationFile,
  readConfigurationText,
  type ClientConfigurationFileError,
} from "./ClientConfigurationFiles.js";
import type { SetupClient } from "./SupportedClients.js";

type SettingsSource = { path: string; document: ClientConfigurationDocument };
const folderTrustSchema = z
  .object({
    security: z
      .object({
        folderTrust: z
          .object({ enabled: z.boolean().optional() })
          .passthrough()
          .optional(),
      })
      .passthrough()
      .optional(),
  })
  .passthrough();
const trustRulesSchema = z.record(
  z.string(),
  z.enum(["TRUST_FOLDER", "TRUST_PARENT", "DO_NOT_TRUST"]),
);
const sourceFailure = (
  path: string,
  cause: unknown,
): ClientConfigurationFileError => ({
  kind: "malformed",
  path,
  detail: `Gemini settings in ${path} are malformed: ${cause instanceof Error ? cause.message : String(cause)}`,
});

// Gemini resolves symlinks when possible and compares macOS/Windows paths without case.
const normalizedPath = async (
  path: string,
  platform: NodeJS.Platform,
): Promise<string> => {
  const physical = await realpath(path).catch(() => path);
  const absolute = resolve(physical).replaceAll("\\", "/");
  return platform === "win32" || platform === "darwin"
    ? absolute.toLowerCase()
    : absolute;
};

const workspaceTrusted = async (
  settings: NonNullable<SetupClient["geminiSettings"]>,
  sources: readonly SettingsSource[],
  resources?: ArtifactResourceScope,
): Promise<Result<boolean, ClientConfigurationFileError>> => {
  let enabled = true;
  for (const { path, document } of sources) {
    const parsed = folderTrustSchema.safeParse(document.document);
    if (!parsed.success) return err(sourceFailure(path, parsed.error));
    enabled = parsed.data.security?.folderTrust?.enabled ?? enabled;
  }
  if (settings.trustOverride !== undefined) return ok(settings.trustOverride);
  if (!enabled) return ok(true);
  const text = await readConfigurationText(
    settings.trustedFoldersPath,
    resources,
  );
  if (!text.ok) return text;
  if (text.value === undefined) return ok(false);
  let rules: z.output<typeof trustRulesSchema>;
  try {
    // Gemini strips comments, but rejects trailing commas, BOMs and invalid trust levels.
    rules = trustRulesSchema.parse(JSON.parse(stripComments(text.value)));
  } catch (cause: unknown) {
    return err(sourceFailure(settings.trustedFoldersPath, cause));
  }
  const workspace = await normalizedPath(
    settings.workspaceDirectory,
    settings.platform,
  );
  let longest = -1;
  let trusted = false;
  for (const [path, level] of Object.entries(rules)) {
    const effective = await normalizedPath(
      level === "TRUST_PARENT" ? dirname(path) : path,
      settings.platform,
    );
    if (
      (workspace === effective ||
        workspace.startsWith(
          effective.endsWith("/") ? effective : `${effective}/`,
        )) &&
      path.length > longest
    ) {
      longest = path.length;
      trusted = level !== "DO_NOT_TRUST";
    }
  }
  return ok(trusted);
};

/**
 * Check Gemini scopes using the caller's user-file observation (undefined means absent).
 * Other settings sources are read here; transaction owners supply fresh user facts.
 */
export const readClientPolicyBlock = async (
  client: SetupClient,
  userDocument: ClientConfigurationDocument | undefined,
  desiredRegistration?: unknown,
  resources?: ArtifactResourceScope,
): Promise<Result<string | undefined, ClientConfigurationFileError>> => {
  if (client.name !== "gemini_cli" || client.geminiSettings === undefined)
    return ok(undefined);
  const settings = client.geminiSettings;
  const sources: SettingsSource[] = [];
  const higher: SettingsSource[] = [];
  for (const path of [
    settings.defaultsPath,
    client.configPath,
    settings.systemPath,
  ]) {
    const parsed =
      path === client.configPath
        ? ok(userDocument)
        : await readConfigurationFile(path, "json", resources);
    if (!parsed.ok) return parsed;
    if (parsed.value !== undefined)
      sources.push({ path, document: parsed.value });
  }
  const workspace = await normalizedPath(
    settings.workspaceDirectory,
    settings.platform,
  );
  const home = await normalizedPath(
    dirname(dirname(client.configPath)),
    settings.platform,
  );
  if (workspace !== home) {
    const path = resolve(
      settings.workspaceDirectory,
      ".gemini",
      "settings.json",
    );
    // Only ENOENT proves absence; preserve other metadata failures as unreadable.
    const present = await stat(path).then(
      () => ok(true),
      (cause: unknown) =>
        cause instanceof Error && "code" in cause && cause.code === "ENOENT"
          ? ok(false)
          : err({
              kind: "unreadable" as const,
              path,
              detail: `Configuration ${path} could not be read: ${cause instanceof Error ? cause.message : String(cause)}`,
            }),
    );
    if (!present.ok) return present;
    const includeWorkspace = present.value
      ? await workspaceTrusted(settings, sources, resources)
      : ok(false);
    if (!includeWorkspace.ok) return includeWorkspace;
    if (includeWorkspace.value) {
      const document = await readConfigurationFile(path, "json", resources);
      if (!document.ok) return document;
      if (document.value !== undefined) {
        const source = { path, document: document.value };
        const systemIndex = sources.findIndex(
          (item) => item.path === settings.systemPath,
        );
        sources.splice(
          systemIndex < 0 ? sources.length : systemIndex,
          0,
          source,
        );
        higher.push(source);
      }
    }
  }
  const system = sources.find(({ path }) => path === settings.systemPath);
  if (system !== undefined) higher.push(system);
  const policies: ReturnType<typeof parseGeminiMcpPolicy>[] = [];
  for (const { path, document } of sources) {
    try {
      policies.push(parseGeminiMcpPolicy(document));
    } catch (cause: unknown) {
      return err(sourceFailure(path, cause));
    }
  }
  const policy = geminiServerPolicyBlock(
    policies,
    PRODUCT_IDENTITY.mcpServerKey,
  );
  if (policy !== undefined)
    return ok(
      `${policy} Settings sources: ${sources.map(({ path }) => path).join(", ")}.`,
    );
  // mcpServers uses shallow merge: the entire same-name definition is replaced.
  const override = higher.findLast(({ document }) =>
    Object.hasOwn(document.servers, PRODUCT_IDENTITY.mcpServerKey),
  );
  const desired =
    desiredRegistration ??
    userDocument?.servers[PRODUCT_IDENTITY.mcpServerKey] ??
    clientRegistrationEntry("json", currentClientRegistrationCommand(), {});
  if (
    override !== undefined &&
    !clientConfigurationValuesEqual(
      override.document.servers[PRODUCT_IDENTITY.mcpServerKey],
      desired,
    )
  )
    return ok(
      `Gemini mcpServers.${PRODUCT_IDENTITY.mcpServerKey} in ${override.path} overrides the user registration. Review that settings file before rerunning setup; REA does not modify system or workspace settings.`,
    );
  return ok(undefined);
};
