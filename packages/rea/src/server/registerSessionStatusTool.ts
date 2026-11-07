import {
  BINARY_SESSION_SUMMARY_OMITTED_FIELDS,
  type BinarySessionDetail,
} from "../contracts/sessionStatusContract.js";
import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import type { BinarySessionPort } from "../application/binary/BinarySessionPort.js";
import type { ProviderAvailability } from "../application/AnalysisProvider.js";
import type { JebAnalysisAvailability } from "../application/jeb/JebAnalysisPort.js";
import { AnalysisError } from "../domain/analysisErrorBase.js";
import {
  buildCapabilityInventory,
  compactToolAvailability,
} from "../application/CapabilityInventory.js";
import { restrictAdvertisedCapabilities } from "../application/binary/BinarySessionStatus.js";
import { toolContract } from "../contracts/toolContracts.js";
import type { ToolFamilyId } from "../contracts/toolFamilyIds.js";
import type {
  ClientFeatureAvailability,
  ToolAvailability,
} from "../contracts/toolOutputSchemaPrimitives.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import { createServerIdentity } from "../serverIdentity.js";
import { mcpClientMetadata } from "./mcpClientMetadata.js";
import type { AvailabilityPolicy } from "../application/CapabilityInventory.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";
import { err } from "../domain/result.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";

/** Provider-owned live probes used by session discovery. */
export interface SessionAvailabilityProbes {
  readonly androidAnalysisAvailability: (
    signal: AbortSignal,
  ) => Promise<ProviderAvailability>;
  readonly adbAnalysisAvailability?: (
    signal: AbortSignal,
  ) => Promise<ProviderAvailability>;
  readonly apktoolAnalysisAvailability?: (
    signal: AbortSignal,
  ) => Promise<ProviderAvailability>;
  readonly jebAnalysisAvailability?: (
    signal: AbortSignal,
  ) => Promise<JebAnalysisAvailability>;
  readonly evmLimiterAvailability?: (
    signal: AbortSignal,
  ) => Promise<ProviderAvailability | undefined>;
}

/** Inputs required to register the binary session status tool. */
export interface SessionStatusToolOptions extends SessionAvailabilityProbes {
  readonly server: EvidenceMcpServer;
  readonly session: BinarySessionPort;
  readonly contract: ReturnType<typeof toolContract<"binary_session">>;
  readonly startedAt: string;
  readonly availabilityPolicy: () => AvailabilityPolicy;
}

/**
 * Probe only families this registration advertises. Scoped-out providers keep
 * the established not-configured shape instead of launching probes whose tools
 * cannot appear in the response.
 */
const probeSessionAvailability = (
  probes: SessionAvailabilityProbes,
  signal: AbortSignal,
  advertisesFamily: (family: ToolFamilyId) => boolean,
): Promise<{
  readonly android: ProviderAvailability | undefined;
  readonly adb: ProviderAvailability | undefined;
  readonly apktool: ProviderAvailability | undefined;
  readonly jeb: JebAnalysisAvailability | undefined;
  readonly evmLimiter: ProviderAvailability | undefined;
}> =>
  Promise.all([
    advertisesFamily("android")
      ? probes.androidAnalysisAvailability(signal)
      : undefined,
    advertisesFamily("adb")
      ? (probes.adbAnalysisAvailability?.(signal) ?? undefined)
      : undefined,
    advertisesFamily("apktool")
      ? (probes.apktoolAnalysisAvailability?.(signal) ?? undefined)
      : undefined,
    advertisesFamily("jeb")
      ? (probes.jebAnalysisAvailability?.(signal) ?? undefined)
      : undefined,
    advertisesFamily("artifact")
      ? (probes.evmLimiterAvailability?.(signal) ?? undefined)
      : undefined,
  ] as const).then(([android, adb, apktool, jeb, evmLimiter]) => ({
    android,
    adb,
    apktool,
    jeb,
    evmLimiter,
  }));

/** Register the read-only provider and target status operation. */
export const registerSessionStatusTool = (
  options: SessionStatusToolOptions,
): void => {
  const { server, session, contract, startedAt, availabilityPolicy } = options;
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    async (input, context) => {
      const { client, clientFeatures, protocolVersion } = mcpClientMetadata(
        context,
        server.server,
      );
      let availabilityResults: Awaited<
        ReturnType<typeof probeSessionAvailability>
      >;
      let status: JsonValue;
      try {
        availabilityResults = await probeSessionAvailability(
          options,
          context.mcpReq.signal,
          (family) => server.advertisesFamily(family),
        );
        status = await session.status({
          signal: context.mcpReq.signal,
          detail: input.detail,
        });
      } catch (cause) {
        if (!(cause instanceof AnalysisError)) throw cause;
        return server.delivery.toCallToolResult(err(cause), contract);
      }
      const statusObject = jsonObjectSchema.parse(status);
      // Availability must be derived from the complete provider facts: an
      // advertised composed tool still depends on direct operations the
      // registration hides. Narrow the public report only after this.
      const toolAvailability = buildCapabilityInventory(status, {
        ...availabilityPolicy(),
        ...(availabilityResults.android === undefined
          ? {}
          : { androidAnalysisAvailability: availabilityResults.android }),
        ...(availabilityResults.adb === undefined
          ? {}
          : { adbAnalysisAvailability: availabilityResults.adb }),
        ...(availabilityResults.apktool === undefined
          ? {}
          : { apktoolAnalysisAvailability: availabilityResults.apktool }),
        ...(availabilityResults.jeb === undefined
          ? {}
          : { jebAnalysisAvailability: availabilityResults.jeb }),
        ...(availabilityResults.evmLimiter === undefined
          ? {}
          : { evmLimiterAvailability: availabilityResults.evmLimiter }),
      }).filter(({ name }) => server.advertisesTool(name));
      const serverIdentity = createServerIdentity({
        startedAt,
        commandPath: CURRENT_ENTRYPOINT_PATH,
        catalog: server.catalogIdentity,
        expected: {
          ...(input.expected_package_version === undefined
            ? {}
            : { package_version: input.expected_package_version }),
          ...(input.expected_catalog_digest === undefined
            ? {}
            : { catalog_digest: input.expected_catalog_digest }),
          ...(input.expected_server_path === undefined
            ? {}
            : { server_path: input.expected_server_path }),
        },
        ...(client === undefined ? {} : { client }),
        ...(protocolVersion === undefined ? {} : { protocolVersion }),
      });
      return server.delivery.toCallToolResult(
        {
          ok: true,
          value: projectSessionStatus({
            detail: input.detail,
            status:
              server.advertisedToolFamilies === undefined
                ? statusObject
                : restrictAdvertisedCapabilities(statusObject, (operation) =>
                    server.advertisesTool(operation),
                  ),
            toolAvailability,
            serverIdentity,
            clientFeatures,
          }),
        },
        contract,
      );
    },
  );
};

const projectSessionStatus = (options: {
  readonly detail: BinarySessionDetail;
  readonly status: Readonly<
    Record<string, import("../domain/jsonValue.js").JsonValue>
  >;
  readonly toolAvailability: readonly ToolAvailability[];
  readonly serverIdentity: ReturnType<typeof createServerIdentity>;
  readonly clientFeatures: ClientFeatureAvailability;
}) =>
  jsonObjectSchema.parse({
    ...options.status,
    detail: options.detail,
    ...(options.detail === "summary"
      ? { omitted_fields: [...BINARY_SESSION_SUMMARY_OMITTED_FIELDS] }
      : {}),
    tool_availability: compactToolAvailability(
      options.toolAvailability,
      options.detail,
    ),
    client_features: options.clientFeatures,
    server_identity: options.serverIdentity,
  });
