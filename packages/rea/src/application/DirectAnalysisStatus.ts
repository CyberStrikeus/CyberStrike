import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { jsonObjectSchema, type JsonValue } from "../domain/jsonValue.js";
import { createServerIdentity } from "../serverIdentity.js";
import { silentLogger } from "../logger.js";
import type { Logger } from "pino";
import type { DirectAnalysisDependencies } from "./DirectAnalysisDependencies.js";
import { providerCapabilitySet } from "../contracts/toolOutputSchemaPrimitives.js";
import { providerCapabilitySets } from "./binary/BinarySessionStatus.js";
import { sqliteDatabaseCapability } from "./sqlite/SqliteDatabaseCapability.js";
import { CURRENT_ENTRYPOINT_PATH } from "../process/CurrentEntrypointPath.js";
import { catalogIdentityForToolFamilies } from "../catalogIdentity.js";
import { compactPresentationForMcpInputSchemaProfile } from "../config/mcpInputSchemaProfile.js";
import {
  directAnalysisCleanupFailure,
  withSessionCleanup,
} from "./DirectAnalysisCleanup.js";
import { ok } from "../domain/result.js";

/** Read target-free provider status and operation availability. */
export const runSessionStatus = async (
  dependencies: Pick<
    DirectAnalysisDependencies,
    "createBinarySession" | "readConfiguration"
  >,
  logger: Logger = silentLogger,
): Promise<JsonValue> => {
  const config = dependencies.readConfiguration();
  if (!config.ok) return { error: projectAnalysisError(config.error) };
  const session = await dependencies.createBinarySession(config.value, logger);
  return withSessionCleanup<JsonValue>(
    session,
    async () => {
      const status = jsonObjectSchema.parse(await session.status());
      return {
        ...status,
        capabilities: [
          ...providerCapabilitySet.array().parse(status.capabilities),
          ...providerCapabilitySets([
            sqliteDatabaseCapability(process.versions.node),
          ]),
        ],
        server_identity: createServerIdentity({
          startedAt: new Date().toISOString(),
          commandPath: CURRENT_ENTRYPOINT_PATH,
          catalog: catalogIdentityForToolFamilies(
            compactPresentationForMcpInputSchemaProfile(
              config.value.mcpInputSchemaProfile,
            ),
            config.value.mcpOutputSchemaProfile ?? "full",
            config.value.mcpToolFamilies === undefined
              ? undefined
              : new Set(config.value.mcpToolFamilies),
          ),
        }),
      };
    },
    (status, cleanup) => directAnalysisCleanupFailure(ok(status), cleanup),
  );
};
