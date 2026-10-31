import { z } from "zod";
import {
  httpHostnameSchema,
  type HttpHostname,
} from "../domain/httpHostname.js";

import {
  ConfigurationError,
  type ConfigurationSettingIssue,
} from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/** The loopback default keeps the listener local-only until an operator opts out. */
export const DEFAULT_MCP_HTTP_HOST = "127.0.0.1";
/** Port 0 asks the host for an ephemeral port, reported by the listening log line. */
export const DEFAULT_MCP_HTTP_PORT = 0;

/** A listener may request an ephemeral port with 0; connected endpoints may not. */
export const mcpHttpListenerPortSchema = z.number().int().min(0).max(65535);

/** Decimal TCP port text, shared by the `--port` flag and `MCP_PORT`. */
export const mcpHttpPortSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d*)$/u)
  .transform(Number)
  .pipe(mcpHttpListenerPortSchema);

const mcpHttpHostSchema = z.string().trim().min(1);

export const MCP_HTTP_PORT_CONSTRAINT =
  "MCP_PORT must be a decimal integer between 0 and 65535.";
export const MCP_HTTP_HOST_CONSTRAINT =
  "MCP_HOST must be a non-empty host name or IP address.";
export const MCP_ALLOWED_HOSTS_CONSTRAINT =
  "MCP_ALLOWED_HOSTS must list at least one host name or IP address, separated by commas, without URL components or ports.";
export const MCP_ALLOWED_HOSTS_FLAG_CONSTRAINT =
  "must list at least one host name or IP address, separated by commas, without URL components or ports.";

/** Comma-separated operator-declared Host/Origin names for a non-loopback bind. */
export const mcpAllowedHostsTextSchema = z
  .string()
  .transform((text, context) => {
    const entries = text.split(",").map((entry) => entry.trim());
    if (entries.some((entry) => entry.length === 0)) {
      context.addIssue({
        code: "custom",
        message: MCP_ALLOWED_HOSTS_CONSTRAINT,
      });
      return z.NEVER;
    }
    return entries;
  })
  .pipe(z.array(httpHostnameSchema))
  .transform((names) => [...new Set(names)]);

/** Where the streamable HTTP listener binds. */
export interface McpHttpEndpoint {
  readonly host: string;
  readonly port: number;
  /** Operator-declared Host/Origin names; required before a non-loopback bind serves. */
  readonly allowedHosts?: readonly HttpHostname[];
}

/** Resolve the endpoint: explicit values, then MCP_HOST/MCP_PORT, then loopback defaults. */
export const parseMcpHttpEndpoint = (
  environment: Readonly<NodeJS.ProcessEnv>,
  overrides: Partial<McpHttpEndpoint> = {},
): Result<McpHttpEndpoint, ConfigurationError> => {
  const issues: ConfigurationSettingIssue[] = [];
  let host = overrides.host ?? DEFAULT_MCP_HTTP_HOST;
  let port = overrides.port ?? DEFAULT_MCP_HTTP_PORT;
  let allowedHosts = overrides.allowedHosts;
  if (overrides.host === undefined && environment.MCP_HOST !== undefined) {
    const parsed = mcpHttpHostSchema.safeParse(environment.MCP_HOST);
    if (parsed.success) host = parsed.data;
    else
      issues.push({
        setting: "MCP_HOST",
        constraint: MCP_HTTP_HOST_CONSTRAINT,
      });
  }
  if (overrides.port === undefined && environment.MCP_PORT !== undefined) {
    const parsed = mcpHttpPortSchema.safeParse(environment.MCP_PORT);
    if (parsed.success) port = parsed.data;
    else
      issues.push({
        setting: "MCP_PORT",
        constraint: MCP_HTTP_PORT_CONSTRAINT,
      });
  }
  if (
    overrides.allowedHosts === undefined &&
    environment.MCP_ALLOWED_HOSTS !== undefined
  ) {
    const parsed = mcpAllowedHostsTextSchema.safeParse(
      environment.MCP_ALLOWED_HOSTS,
    );
    if (parsed.success) allowedHosts = parsed.data;
    else
      issues.push({
        setting: "MCP_ALLOWED_HOSTS",
        constraint: MCP_ALLOWED_HOSTS_CONSTRAINT,
      });
  }
  if (issues.length > 0)
    return err(
      new ConfigurationError(
        issues.map(({ constraint }) => constraint).join(" "),
        { settings: issues },
      ),
    );
  return ok({
    host,
    port,
    ...(allowedHosts === undefined ? {} : { allowedHosts }),
  });
};
