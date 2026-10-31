import { z } from "zod";
import { PRODUCT_IDENTITY } from "../identity.js";
import { jsonRecordSchema } from "../domain/jsonRecord.js";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  MCP_STARTUP_POLICY,
  recommendedMcpToolTimeoutMs,
  recommendedMcpToolTimeoutSeconds,
  type McpToolTimeoutInputs,
} from "../mcpStartupPolicy.js";
import {
  clientConfigurationRecordSchema,
  clientRegistrationEntry,
  type ClientRegistrationDialect,
} from "./ClientConfigurationDocument.js";
import type { SetupClient } from "./SupportedClients.js";
import {
  classifyClientRegistrationCommand,
  equivalentClientRegistrationCommands,
  type ClientRegistrationCommandIdentity,
} from "./ClientRegistrationIdentity.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";

const tomlTimeoutSchema = z.union([
  z.number().positive(),
  z.bigint().positive(),
]);

const launcherSchema = z
  .object({
    command: z.string().min(1),
    args: z.array(z.string()).default([]),
  })
  .passthrough();
const opencodeLauncherSchema = z
  .object({
    type: z.literal("local"),
    command: z.array(z.string()).min(1),
  })
  .passthrough();
const normalizeOpencodeLauncher = (
  entry: z.output<typeof opencodeLauncherSchema>,
): z.output<typeof launcherSchema> => {
  const [command = "", ...args] = entry.command;
  return { ...entry, command, args };
};

const registrationSchema = launcherSchema.extend({
  startup_timeout_sec: tomlTimeoutSchema.optional(),
  tool_timeout_sec: tomlTimeoutSchema.optional(),
  startupTimeoutMs: z.number().positive().optional(),
  toolTimeoutMs: z.number().positive().optional(),
  type: z.string().optional(),
  transport: z.string().optional(),
  serverName: z.string().optional(),
  disabled: z.boolean().optional(),
  enabled: z.boolean().optional(),
});

export type ClientRegistration = z.output<typeof registrationSchema>;

// https://developers.openai.com/codex/config-reference/#mcp_servers
const codexApprovalModeSchema = z.enum(["auto", "prompt", "writes", "approve"]);
const codexToolPolicySchema = z
  .object({
    approval_mode: codexApprovalModeSchema.optional(),
    output_token_limit: z
      .union([z.number().int().positive(), z.bigint().positive()])
      .optional(),
  })
  .passthrough();
const codexPolicySchema = z
  .object({
    default_tools_approval_mode: codexApprovalModeSchema.optional(),
    enabled_tools: z.array(z.string()).optional(),
    disabled_tools: z.array(z.string()).optional(),
    tools: clientConfigurationRecordSchema
      .superRefine((tools, context) => {
        for (const [name, value] of Object.entries(tools)) {
          const policy = codexToolPolicySchema.safeParse(value);
          if (!policy.success)
            for (const issue of policy.error.issues)
              context.addIssue({ ...issue, path: [name, ...issue.path] });
        }
      })
      .optional(),
  })
  .passthrough();

const registrationError = (error: z.ZodError): ConfigurationError =>
  new ConfigurationError("Invalid client registration settings", {
    settings: error.issues.map((issue) => ({
      setting: issue.path.join("."),
      constraint: issue.message,
    })),
  });

/** Launcher identity remains usable when unrelated readiness settings are invalid. */
export const parseClientRegistrationLauncher = (
  value: unknown,
  client: SetupClient,
): Result<{ command: string; args: string[] }, ConfigurationError> => {
  const parsed =
    client.format === "opencode"
      ? opencodeLauncherSchema
          .transform(normalizeOpencodeLauncher)
          .safeParse(value)
      : launcherSchema.safeParse(value);
  return parsed.success
    ? ok({ command: parsed.data.command, args: parsed.data.args })
    : err(registrationError(parsed.error));
};

/** Launcher ownership is independent of readiness and caller-owned policy. */
export const clientRegistrationOwnership = (
  value: unknown,
  client: SetupClient,
): ClientRegistrationCommandIdentity => {
  const parsed = parseClientRegistrationLauncher(value, client);
  return parsed.ok
    ? classifyClientRegistrationCommand(
        [parsed.value.command, ...parsed.value.args],
        CURRENT_ENTRYPOINT_PATH,
      )
    : "unknown";
};

/** Explain the same ownership admission decision in setup and doctor. */
export const clientRegistrationOwnershipRemediation = (
  ownership: Exclude<ClientRegistrationCommandIdentity, "owned">,
  paths: readonly string[],
): string =>
  `The existing "${PRODUCT_IDENTITY.mcpServerKey}" registration read from ${paths.join(", ")} has ${ownership} ownership and was not changed. Review its launcher and manually rename or remove that registration before rerunning setup. A different installation path does not prove REA ownership.`;

/** Policy belongs to the client dialect, and is validated before refresh writes. */
const validateClientPolicy = (
  value: unknown,
  client: SetupClient,
): Result<void, ConfigurationError> => {
  const policy =
    client.name === "codex"
      ? codexPolicySchema.safeParse(value)
      : client.format === "copilot_cli"
        ? z.object({ tools: z.array(z.string()).optional() }).safeParse(value)
        : undefined;
  return policy === undefined || policy.success
    ? ok(undefined)
    : err(registrationError(policy.error));
};

/** Normalize launcher facts once; policy fields keep their dialect-specific shape. */
export const parseClientRegistration = (
  value: unknown,
  client: SetupClient,
): Result<ClientRegistration, ConfigurationError> => {
  const policy = validateClientPolicy(value, client);
  if (!policy.ok) return policy;
  if (client.format === "dsh") {
    const parsed = registrationSchema
      .pick({ command: true, args: true, serverName: true, transport: true })
      .strip()
      .safeParse(value);
    return parsed.success
      ? ok(parsed.data)
      : err(registrationError(parsed.error));
  }
  if (client.format === "opencode") {
    const entry = opencodeLauncherSchema
      .extend({
        environment: jsonRecordSchema(z.string()).optional(),
      })
      .transform(normalizeOpencodeLauncher)
      .safeParse(value);
    if (!entry.success) return err(registrationError(entry.error));
    value = entry.data;
  }
  const parsed = registrationSchema.safeParse(value);
  if (!parsed.success) return err(registrationError(parsed.error));
  const registration = parsed.data;
  const transportInvalid =
    ((client.format === "kimi" || client.format === "commandcode") &&
      registration.transport !== undefined &&
      registration.transport !== "stdio") ||
    (client.format === "commandcode" && registration.transport === undefined);
  const typeInvalid =
    ((client.format === "vscode" || client.format === "copilot_cli") &&
      registration.type !== "stdio") ||
    ((client.format === "kimi" ||
      client.format === "omp" ||
      client.format === "pi") &&
      registration.type !== undefined &&
      registration.type !== "stdio");
  if (transportInvalid || typeInvalid)
    return err(
      new ConfigurationError("Expected an stdio registration", {
        settings: [
          {
            setting: transportInvalid ? "transport" : "type",
            constraint: "Expected stdio",
          },
        ],
      }),
    );
  return ok(registration);
};

// These fields select REA's connection and activation. Everything else belongs
// to the caller/client, including future policy keys. Client-specific timeout
// defaults and preservation rules are applied below.
const managedConnectionKeys = new Set([
  "command",
  "args",
  "env",
  "environment",
  "type",
  "transport",
  "enabled",
  "disabled",
  "enable",
  "serverName",
  "url",
  "httpUrl",
]);

/** Whether a rea setup repair for this target preserves the row's
 * `enable: false` instead of dropping it. Shared registration doubles as
 * ZCode's fallback, so the activation fact belongs to every reader; a repair
 * preserves it instead of silently re-enabling a row it does not own. A
 * client's own native storage has a single reader, so an explicitly selected
 * setup may still repair it. Doctor's remediation reads this same rule so a
 * preserved disable never points at an ineffective setup run. */
export const setupPreservesDisabledActivation = (
  client: Pick<SetupClient, "sharedRegistration">,
  format: string | undefined,
): boolean => client.sharedRegistration === true || format === "zcode_fallback";

/** Patch a source fragment, retaining client-owned settings rather than rebuilding it. */
export const refreshClientRegistration = (
  client: SetupClient,
  dialect: ClientRegistrationDialect,
  command: readonly string[],
  environment: Readonly<Record<string, string>>,
  previous: unknown,
  timeoutInputs: McpToolTimeoutInputs,
): Result<Record<string, unknown>, ConfigurationError> => {
  const source = clientConfigurationRecordSchema.safeParse(previous);
  const existing = source.success ? source.data : {};
  const policy = validateClientPolicy(existing, client);
  if (!policy.ok) return policy;
  const prior = parseClientRegistrationLauncher(existing, client);
  const priorCommand = prior.ok
    ? [prior.value.command, ...prior.value.args]
    : undefined;
  const launcher =
    priorCommand !== undefined &&
    equivalentClientRegistrationCommands(priorCommand, command)
      ? priorCommand
      : command;
  const registration = {
    ...clientRegistrationEntry(dialect, launcher, environment),
    ...Object.fromEntries(
      Object.entries(existing).filter(
        ([key]) => !managedConnectionKeys.has(key),
      ),
    ),
  };
  if (
    setupPreservesDisabledActivation(client, dialect) &&
    existing.enable === false
  )
    registration.enable = false;
  if (client.name === "codex" || client.name === "grok_build")
    registration.startup_timeout_sec =
      positiveTimeout(existing.startup_timeout_sec) ??
      MCP_STARTUP_POLICY.codexStartupTimeoutSeconds;
  if (client.name === "codex")
    registration.tool_timeout_sec =
      positiveTimeout(existing.tool_timeout_sec) ??
      recommendedMcpToolTimeoutSeconds(timeoutInputs);
  if (client.name === "kimi") {
    registration.startupTimeoutMs =
      positiveTimeout(existing.startupTimeoutMs) ??
      MCP_STARTUP_POLICY.kimiStartupTimeoutMs;
    registration.toolTimeoutMs =
      positiveTimeout(existing.toolTimeoutMs) ??
      recommendedMcpToolTimeoutMs(timeoutInputs);
  }
  return ok(registration);
};

const positiveTimeout = (value: unknown): number | bigint | undefined => {
  // TOML keeps integers beyond the safe Number range exact as bigint.
  if (typeof value === "bigint") return value > 0n ? value : undefined;
  return typeof value === "number" && Number.isFinite(value) && value > 0
    ? value
    : undefined;
};
