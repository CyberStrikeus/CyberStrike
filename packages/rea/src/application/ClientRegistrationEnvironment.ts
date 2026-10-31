import {
  parseEnvironment,
  parseEnvironmentValues,
  type Environment,
} from "../config/environment.js";
import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import {
  effectiveClientServer,
  clientConfigurationRecordSchema,
  type ClientConfigurationDocument,
} from "./ClientConfigurationDocument.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { compareUnicodeCodePoints } from "../domain/unicodeCodePointOrder.js";
import {
  mergeEnvironmentOverrides,
  snapshotEnvironment,
} from "../process/snapshotEnvironment.js";
import { dshDocument } from "./DshCordisPatch.js";
import type { McpToolTimeoutInputs } from "../mcpStartupPolicy.js";
import type { AnalysisProviderSelector } from "../domain/providerSelection.js";

export type ProviderRequestBudgetResolver = (
  analysisProvider: AnalysisProviderSelector,
  environment: Readonly<Record<string, string>>,
) => Promise<Result<number | undefined, ConfigurationError>>;

export interface ClientRegistrationEnvironmentDetails {
  readonly values: Readonly<Record<string, string>>;
  readonly unresolvedSettings: ReadonlySet<string>;
  readonly timeoutInputs: McpToolTimeoutInputs | undefined;
}

interface ResolvedClientRegistrationEnvironmentDetails extends ClientRegistrationEnvironmentDetails {
  readonly timeoutInputs: McpToolTimeoutInputs;
}

const TIMEOUT_INPUT_SETTINGS: ReadonlySet<string> = new Set([
  "REA_ANALYSIS_PROVIDER",
  "REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS",
  "REA_GHIDRA_STARTUP_TIMEOUT_MS",
  "REA_HOPPER_STARTUP_TIMEOUT_MS",
  "REA_JEB_MCP_TIMEOUT_MS",
]);

const environmentSchema = clientConfigurationRecordSchema.transform(
  (values, context) => {
    const entries: [string, string][] = [];
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") entries.push([key, value]);
      else
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Environment values must be strings",
        });
    }
    return Object.fromEntries(entries);
  },
);

/** Read explicit REA overrides without dropping peers when one value is invalid. */
export const clientRegistrationEnvironment = (
  parsed: ClientConfigurationDocument | undefined,
  overrides: Readonly<Record<string, string>> = {},
  validation: "fragment" | "effective" = "effective",
  platform: NodeJS.Platform = process.platform,
): Result<Readonly<Record<string, string>>, ConfigurationError> => {
  const details = clientRegistrationEnvironmentDetails(
    parsed,
    overrides,
    validation,
    platform,
  );
  return details.ok ? ok(details.value.values) : details;
};

/** Retain original strings and the parser-owned timeout facts. */
export const clientRegistrationEnvironmentDetails = (
  parsed: ClientConfigurationDocument | undefined,
  overrides: Readonly<Record<string, string>> = {},
  validation: "fragment" | "effective" = "effective",
  platform: NodeJS.Platform = process.platform,
): Result<ClientRegistrationEnvironmentDetails, ConfigurationError> => {
  if (parsed?.dialect === "dsh") {
    const environment = dshDocument(parsed.document).environment(
      overrides,
      validation,
      platform,
    );
    if (!environment.ok) return environment;
    return ok(
      environmentDetails(
        environment.value.values,
        environment.value.configuration,
        environment.value.unresolvedSettings,
      ),
    );
  }
  const key = parsed?.environmentKey ?? "env";
  const registration =
    parsed === undefined
      ? undefined
      : effectiveClientServer(parsed, PRODUCT_IDENTITY.mcpServerKey);
  const raw =
    typeof registration === "object" && registration !== null
      ? Reflect.get(registration, key)
      : undefined;
  const existing = environmentSchema.safeParse(raw === undefined ? {} : raw);
  if (!existing.success)
    return err(
      new ConfigurationError("Invalid REA server environment", {
        settings: existing.error.issues.map((issue) => ({
          setting: [key, ...issue.path].join("."),
          constraint:
            "Server environment must be an object containing only string values",
        })),
      }),
    );
  // Validate known settings with the runtime's parser, but retain the original
  // string overrides, including unknown client-specific keys and no defaults.
  const environment = mergeEnvironmentOverrides(
    existing.data,
    overrides,
    platform,
  );
  return validatedDetails(environment, validation, platform);
};

/** Resolve the async provider-specific budget through its retained reader owner. */
export const clientRegistrationEnvironmentDetailsWithBudget = async (
  parsed: ClientConfigurationDocument | undefined,
  overrides: Readonly<Record<string, string>>,
  validation: "fragment" | "effective",
  resolveProviderRequestBudget: ProviderRequestBudgetResolver | undefined,
  platform: NodeJS.Platform = process.platform,
): Promise<
  Result<ResolvedClientRegistrationEnvironmentDetails, ConfigurationError>
> => {
  const details = clientRegistrationEnvironmentDetails(
    parsed,
    overrides,
    validation,
    platform,
  );
  if (!details.ok) return details;
  const unresolved = [...details.value.unresolvedSettings].filter(
    (setting) =>
      resolveProviderRequestBudget !== undefined ||
      TIMEOUT_INPUT_SETTINGS.has(setting),
  );
  if (details.value.timeoutInputs === undefined || unresolved.length > 0)
    return err(
      new ConfigurationError(
        "Cannot derive a provider request budget from expression-backed settings",
        {
          settings: unresolved.map((setting) => ({
            setting,
            constraint:
              "Resolve this setting to a literal before deriving a request budget",
          })),
        },
      ),
    );
  const resolved = {
    ...details.value,
    timeoutInputs: details.value.timeoutInputs,
  };
  if (resolveProviderRequestBudget === undefined) return ok(resolved);
  return validatedBudget(resolved, resolveProviderRequestBudget, platform);
};

const validatedDetails = (
  environment: Readonly<Record<string, string>>,
  validation: "fragment" | "effective",
  platform: NodeJS.Platform = process.platform,
): Result<ClientRegistrationEnvironmentDetails, ConfigurationError> => {
  const runtimeEnvironment = snapshotEnvironment(environment, platform);
  const validated =
    validation === "fragment"
      ? parseEnvironmentValues(runtimeEnvironment)
      : parseEnvironment(runtimeEnvironment);
  if (!validated.ok) return validated;
  return ok(environmentDetails(environment, validated.value));
};

const environmentDetails = (
  environment: Readonly<Record<string, string>>,
  configuration: Environment,
  unresolvedSettings: ReadonlySet<string> = new Set(),
): ClientRegistrationEnvironmentDetails => ({
  values: Object.fromEntries(
    Object.entries(environment).sort(([left], [right]) =>
      compareUnicodeCodePoints(left, right),
    ),
  ),
  unresolvedSettings,
  timeoutInputs: [...unresolvedSettings].some((setting) =>
    TIMEOUT_INPUT_SETTINGS.has(setting),
  )
    ? undefined
    : {
        analysisProvider: configuration.REA_ANALYSIS_PROVIDER,
        ghidraStartupTimeoutMs: configuration.REA_GHIDRA_STARTUP_TIMEOUT_MS,
        ...(configuration.REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS === undefined
          ? {}
          : {
              ghidraDecompileTimeoutMs:
                configuration.REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS * 1000,
            }),
        hopperStartupTimeoutMs: configuration.REA_HOPPER_STARTUP_TIMEOUT_MS,
        ...(configuration.REA_JEB_MCP_TIMEOUT_MS === undefined
          ? {}
          : { jebMcpTimeoutMs: configuration.REA_JEB_MCP_TIMEOUT_MS }),
      },
});

const validatedBudget = async (
  details: ResolvedClientRegistrationEnvironmentDetails,
  resolveProviderRequestBudget: ProviderRequestBudgetResolver,
  platform: NodeJS.Platform,
): Promise<
  Result<ResolvedClientRegistrationEnvironmentDetails, ConfigurationError>
> => {
  const providerBudget = await resolveProviderRequestBudget(
    details.timeoutInputs.analysisProvider,
    snapshotEnvironment(details.values, platform),
  );
  if (!providerBudget.ok) return providerBudget;
  return ok({
    ...details,
    timeoutInputs: {
      ...details.timeoutInputs,
      ...(providerBudget.value === undefined
        ? {}
        : { providerRequestTimeoutMs: providerBudget.value }),
    },
  });
};
