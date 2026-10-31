import {
  ghidraProjectPathSchema,
  ghidraProgramNameSchema,
} from "./ghidraExistingProject.js";
import { z } from "zod";
import { mcpInputBudgetSchema } from "./mcpInputBudget.js";
import { isAbsolute } from "node:path";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";
import { analysisProviderSelectorSchema } from "../domain/providerSelection.js";
import {
  ghidraCompilerSpecIdSchema,
  ghidraLanguageIdSchema,
} from "./ghidraLanguageOverride.js";
import { ghidraDisabledAnalyzersSchema } from "./ghidraDisabledAnalyzers.js";
import {
  DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS,
  ghidraDecompileTimeoutSchema,
  providerStartupTimeoutSchema,
} from "./providerStartupTimeout.js";
import {
  DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS,
  DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS,
  DEFAULT_HOPPER_STARTUP_TIMEOUT_MS,
} from "../domain/analysisResourceLimits.js";
import { mcpInputSchemaProfileSchema } from "./mcpInputSchemaProfile.js";
import { mcpOutputSchemaProfileSchema } from "./mcpOutputSchemaProfile.js";
import { mcpResponseBudgetSchema } from "./mcpResponseBudget.js";
import { asarMaxHeaderBytesSchema } from "./asarHeaderAdmission.js";
import { bridgeMaxRequestBytesSchema } from "./bridgeMaxRequestBytes.js";
import { captureDecoderOldGenerationMiBSchema } from "./captureDecoderHeap.js";
import { debuggerSessionLimitEnvironmentShape } from "./debuggerSessionLimits.js";
import { regexMatchingDeadlineMsSchema } from "./regexMatchingDeadline.js";
import { regexWorkerHeapRequestMiBSchema } from "./regexWorkerHeapRequest.js";
import {
  mcpDoctorDeadlineMsSchema,
  mcpFirstCatalogBudgetMsSchema,
  mcpInitializeBudgetMsSchema,
  mcpToolsListBudgetMsSchema,
} from "./mcpStartupBudgets.js";
import { mcpToolFamiliesSchema } from "./mcpToolFamilies.js";
import { parseLoaderArgs, parseStringArray } from "./parsers.js";
import { processStartConfigurationSchema } from "./processStart.js";
import { parseJebMcpEndpoint } from "./jebMcpEndpoint.js";

const environmentSchema = z.object({
  ...debuggerSessionLimitEnvironmentShape,
  REA_ANALYSIS_PROVIDER: analysisProviderSelectorSchema.default("auto"),
  REA_BRIDGE_MAX_REQUEST_BYTES: bridgeMaxRequestBytesSchema.optional(),
  REA_MCP_MAX_RESPONSE_BYTES: mcpResponseBudgetSchema.optional(),
  REA_MCP_MAX_INPUT_ELEMENTS: mcpInputBudgetSchema.optional(),
  REA_ASAR_MAX_HEADER_BYTES: asarMaxHeaderBytesSchema.optional(),
  REA_CAPTURE_DECODER_OLD_GENERATION_MIB:
    captureDecoderOldGenerationMiBSchema.optional(),
  REA_REGEX_MATCHING_DEADLINE_MS: regexMatchingDeadlineMsSchema.optional(),
  REA_REGEX_WORKER_HEAP_REQUEST_MIB: regexWorkerHeapRequestMiBSchema.optional(),
  REA_MCP_INITIALIZE_BUDGET_MS: mcpInitializeBudgetMsSchema.optional(),
  REA_MCP_TOOLS_LIST_BUDGET_MS: mcpToolsListBudgetMsSchema.optional(),
  REA_MCP_FIRST_CATALOG_BUDGET_MS: mcpFirstCatalogBudgetMsSchema.optional(),
  REA_MCP_DOCTOR_DEADLINE_MS: mcpDoctorDeadlineMsSchema.optional(),
  REA_MCP_INPUT_SCHEMA_PROFILE: mcpInputSchemaProfileSchema.optional(),
  REA_MCP_TOOL_FAMILIES: mcpToolFamiliesSchema.optional(),
  REA_MCP_OUTPUT_SCHEMA_PROFILE: mcpOutputSchemaProfileSchema.optional(),
  REA_IDA_MCP_CONFIG: z
    .string()
    .min(1)
    .refine(isAbsolute, "REA_IDA_MCP_CONFIG must be absolute")
    .optional(),
  REA_JEB_MCP_TIMEOUT_MS: providerStartupTimeoutSchema.optional(),
  REA_JEB_MCP_URL: z
    .string()
    .superRefine((value, context) => {
      const parsed = parseJebMcpEndpoint(value);
      if (!parsed.ok)
        context.addIssue({
          code: "custom",
          message:
            typeof parsed.error.cause === "string"
              ? parsed.error.cause
              : parsed.error.message,
        });
    })
    .optional(),
  GHIDRA_INSTALL_DIR: z
    .string()
    .min(1)
    .refine(isAbsolute, "GHIDRA_INSTALL_DIR must be absolute")
    .optional(),
  JAVA_HOME: z
    .string()
    .min(1)
    .refine(isAbsolute, "JAVA_HOME must be absolute")
    .optional(),
  REA_GHIDRA_NATIVEAOT_JAR: z
    .string()
    .min(1)
    .refine(isAbsolute, "REA_GHIDRA_NATIVEAOT_JAR must be absolute")
    .optional(),
  REA_GHIDRA_STARTUP_TIMEOUT_MS: providerStartupTimeoutSchema.default(
    DEFAULT_GHIDRA_STARTUP_TIMEOUT_MS,
  ),
  REA_HOPPER_STARTUP_TIMEOUT_MS: providerStartupTimeoutSchema.default(
    DEFAULT_HOPPER_STARTUP_TIMEOUT_MS,
  ),
  REA_HOPPER_CALLER_SCAN_BUDGET_MS: providerStartupTimeoutSchema.default(
    DEFAULT_HOPPER_CALLER_SCAN_BUDGET_MS,
  ),
  REA_SWIFTC_COMPILE_TIMEOUT_MS: providerStartupTimeoutSchema.default(
    DEFAULT_SWIFTC_COMPILE_TIMEOUT_MS,
  ),
  REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: ghidraDecompileTimeoutSchema.optional(),
  REA_GHIDRA_PROJECT_PATH: ghidraProjectPathSchema.optional(),
  REA_GHIDRA_PROGRAM_NAME: ghidraProgramNameSchema.optional(),
  REA_GHIDRA_LANGUAGE_ID: ghidraLanguageIdSchema.optional(),
  REA_GHIDRA_COMPILER_SPEC_ID: ghidraCompilerSpecIdSchema.optional(),
  REA_GHIDRA_DISABLED_ANALYZERS: ghidraDisabledAnalyzersSchema.optional(),
  REA_GHIDRA_SEED_FILE: z
    .string()
    .min(1)
    .refine(isAbsolute, "REA_GHIDRA_SEED_FILE must be absolute")
    .optional(),
  REA_ILSPY_CMD_PATH: z
    .string()
    .min(1)
    .refine(isAbsolute, "REA_ILSPY_CMD_PATH must be absolute")
    .optional(),
  HOPPER_LAUNCHER_PATH: z.string().min(1).optional(),
  HOPPER_TARGET_PATH: z.string().min(1).optional(),
  HOPPER_TARGET_KIND: z.enum(["executable", "database"]).default("executable"),
  HOPPER_LOADER_ARGS_JSON: z.string().optional(),
  REA_LOG_LEVEL: processStartConfigurationSchema.shape.REA_LOG_LEVEL,
  REA_REFERENCE_SECRET_PATTERNS_JSON: z.string().default("[]"),
});

/** Parse the JEB-only timeout at its isolated provider-composition boundary. */
export const parseJebMcpTimeoutMs = (
  value: string | undefined,
): Result<number | undefined, ConfigurationError> => {
  if (value === undefined) return ok(undefined);
  const parsed = providerStartupTimeoutSchema.safeParse(value);
  if (parsed.success) return ok(parsed.data);
  return err(
    new ConfigurationError("Invalid REA environment configuration", {
      cause: parsed.error,
      settings: [
        {
          setting: "REA_JEB_MCP_TIMEOUT_MS",
          constraint:
            parsed.error.issues[0]?.message ?? "must be a valid timeout",
        },
      ],
    }),
  );
};

export type Environment = Omit<
  z.infer<typeof environmentSchema>,
  "HOPPER_LOADER_ARGS_JSON" | "REA_REFERENCE_SECRET_PATTERNS_JSON"
> & {
  readonly loaderArgs: readonly string[];
  readonly referenceSecretPatterns: readonly string[];
};

/** Parse individual settings before layered registration fragments are merged. */
export const parseEnvironmentValues = (
  environment: Readonly<Record<string, string | undefined>>,
  unresolvedSettings: ReadonlySet<string> = new Set(),
): Result<Environment, ConfigurationError> => {
  // Unknown client-specific entries are preserved by registration owners and
  // still cross the child-process boundary. Check their byte admission before
  // the known-setting schema strips them; never include rejected values.
  // Cordis expression values stay unknown, but their literal names are known.
  const keys = new Set([...Object.keys(environment), ...unresolvedSettings]);
  const invalidEntries = [...keys]
    .filter(
      (key) =>
        key.includes("\0") ||
        (Object.hasOwn(environment, key) && environment[key]?.includes("\0")),
    )
    .map((setting) => ({
      setting,
      constraint:
        "Environment variable names and values must not contain NUL bytes",
    }));
  if (invalidEntries.length > 0)
    return err(
      new ConfigurationError("Invalid REA environment configuration", {
        settings: invalidEntries,
      }),
    );
  const parsed = environmentSchema.safeParse(environment);
  if (!parsed.success) {
    // Zod messages name the constraint, never the rejected value.
    const settings = parsed.error.issues.map((issue) => ({
      setting: String(issue.path[0] ?? "environment"),
      constraint: issue.message,
    }));
    return err(
      new ConfigurationError("Invalid REA environment configuration", {
        cause: parsed.error,
        settings,
      }),
    );
  }
  const {
    HOPPER_LOADER_ARGS_JSON: encodedLoaderArgs,
    REA_REFERENCE_SECRET_PATTERNS_JSON: encodedSecretPatterns,
    ...env
  } = parsed.data;
  const loaderArgs = parseLoaderArgs(encodedLoaderArgs);
  if (!loaderArgs.ok) return loaderArgs;
  const secretPatterns = parseStringArray(
    encodedSecretPatterns,
    "REA_REFERENCE_SECRET_PATTERNS_JSON",
  );
  if (!secretPatterns.ok) return secretPatterns;
  return ok({
    ...env,
    loaderArgs: loaderArgs.value,
    referenceSecretPatterns: secretPatterns.value,
  });
};

/** Validate complete runtime semantics without probing the host or persisting defaults. */
export const parseEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
  // Registration expressions are not evaluated; their absence is not proven.
  unresolvedSettings: ReadonlySet<string> = new Set(),
): Result<Environment, ConfigurationError> => {
  const parsed = parseEnvironmentValues(environment, unresolvedSettings);
  if (!parsed.ok) return parsed;
  const env = parsed.value;
  const project = env.REA_GHIDRA_PROJECT_PATH;
  const incompatible =
    project === undefined
      ? env.REA_GHIDRA_PROGRAM_NAME === undefined ||
        unresolvedSettings.has("REA_GHIDRA_PROJECT_PATH")
        ? []
        : ["REA_GHIDRA_PROGRAM_NAME"]
      : [
          "REA_GHIDRA_LANGUAGE_ID",
          "REA_GHIDRA_COMPILER_SPEC_ID",
          "REA_GHIDRA_SEED_FILE",
          "REA_GHIDRA_DISABLED_ANALYZERS",
          "REA_GHIDRA_NATIVEAOT_JAR",
        ].filter(
          (setting) =>
            // Blank analyzer lists parse to no override, so they cannot conflict.
            (setting === "REA_GHIDRA_DISABLED_ANALYZERS"
              ? env[setting]
              : environment[setting]) !== undefined,
        );
  if (incompatible.length > 0)
    return err(
      new ConfigurationError("Invalid existing Ghidra project configuration", {
        settings: incompatible.map((setting) => ({
          setting,
          constraint:
            project === undefined
              ? "requires REA_GHIDRA_PROJECT_PATH"
              : "Import and analysis overrides cannot be combined with an existing project",
        })),
      }),
    );
  // Ghidra's analyzeHeadless accepts -cspec only together with -processor.
  if (
    env.REA_GHIDRA_COMPILER_SPEC_ID !== undefined &&
    env.REA_GHIDRA_LANGUAGE_ID === undefined &&
    !unresolvedSettings.has("REA_GHIDRA_LANGUAGE_ID")
  )
    return err(
      new ConfigurationError("Invalid REA environment configuration", {
        settings: [
          {
            setting: "REA_GHIDRA_COMPILER_SPEC_ID",
            constraint: "requires REA_GHIDRA_LANGUAGE_ID",
          },
        ],
      }),
    );
  return parsed;
};
