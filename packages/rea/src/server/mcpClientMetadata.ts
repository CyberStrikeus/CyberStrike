import {
  CLIENT_CAPABILITIES_META_KEY,
  CLIENT_INFO_META_KEY,
  PROTOCOL_VERSION_META_KEY,
  type McpServer,
  type ServerContext,
} from "@modelcontextprotocol/server";

import type { ClientFeatureAvailability } from "../contracts/toolOutputSchemaPrimitives.js";
import type { ConnectedClientIdentity } from "../serverIdentity.js";

/** Initialize-scoped client metadata the SDK keeps for a 2025-era connection. */
export type McpConnectionClientMetadata = Pick<
  McpServer["server"],
  "getClientCapabilities" | "getClientVersion" | "getNegotiatedProtocolVersion"
>;

/**
 * Client metadata for the current request. A 2026-era request carries it in
 * its per-request envelope; a 2025-era connection sends no envelope, so its
 * `initialize` handshake supplies the values.
 */
export const mcpClientMetadata = (
  context: { readonly mcpReq: Pick<ServerContext["mcpReq"], "envelope"> },
  connection: McpConnectionClientMetadata,
) => {
  const envelope = context.mcpReq.envelope;
  // The SDK deprecates these accessors only in favor of the envelope, which
  // 2025-era requests do not carry; they still return initialize values.
  const value = (key: string, initialized: () => unknown): unknown =>
    envelope === undefined ? initialized() : Reflect.get(envelope, key);
  const client = implementation(
    value(CLIENT_INFO_META_KEY, () => connection.getClientVersion()),
  );
  const protocolVersion = value(PROTOCOL_VERSION_META_KEY, () =>
    connection.getNegotiatedProtocolVersion(),
  );
  return {
    ...(client === undefined ? {} : { client }),
    clientFeatures: capabilityFeatures(
      value(CLIENT_CAPABILITIES_META_KEY, () =>
        connection.getClientCapabilities(),
      ),
    ),
    ...(typeof protocolVersion === "string" ? { protocolVersion } : {}),
  };
};

const implementation = (value: unknown): ConnectedClientIdentity | undefined =>
  isRecord(value) &&
  typeof value.name === "string" &&
  typeof value.version === "string"
    ? { name: value.name, version: value.version }
    : undefined;

const capabilityFeatures = (value: unknown): ClientFeatureAvailability => {
  const capabilities = isRecord(value) ? value : {};
  const elicitation = isRecord(capabilities.elicitation)
    ? capabilities.elicitation
    : undefined;
  return {
    // A declared capability without modes retains the protocol's form-only
    // compatibility rule; a missing capability still grants no support.
    elicitation_form:
      elicitation !== undefined &&
      (elicitation.form !== undefined || elicitation.url === undefined),
    elicitation_url: elicitation?.url !== undefined,
    roots: capabilities.roots !== undefined,
    sampling: capabilities.sampling !== undefined,
  };
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
