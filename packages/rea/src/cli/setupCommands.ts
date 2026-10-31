import { withCommandCancellation } from "./commandCancellation.js";
import { z } from "incur";

import type { DoctorScope } from "../application/Doctor.js";
import { DOCTOR_PROVIDER_IDS } from "../application/DoctorProviderIds.js";
import {
  isSetupFailure,
  type SetupOptions,
} from "../application/SetupTypes.js";
import { isUninstallFailure } from "../application/UninstallFailure.js";
import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import {
  mcpToolFamiliesSchema,
  toolFamiliesConstraint,
} from "../config/mcpToolFamilies.js";
import { isUpdateFailure } from "../application/UpdateFailure.js";
import {
  confirmInteractiveSetup,
  renderSetupDryRun,
  renderInteractiveSetupResult,
  renderSetupProgress,
} from "./interactiveSetup.js";
import { PRODUCT_IDENTITY } from "../identity.js";
import { logCliCommand } from "../cliLogging.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { SUPPORTED_CLIENT_DEFINITIONS } from "../application/SupportedClients.js";

const supportedClientIds = SUPPORTED_CLIENT_DEFINITIONS.map(({ name }) => name);
const supportedClientSchema = z.enum(supportedClientIds);
const skillClientSchema = z.union([z.literal("shared"), supportedClientSchema]);

/** Register setup, doctor, uninstall, and update CLI commands. */
export const registerSetupCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  registerSetupCommand(cli, logger, environment);
  registerDoctorCommand(cli, logger, environment);
  registerMaintenanceCommands(cli, logger, environment);
};

const registerSetupCommand = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.setup, {
    description: "Configure agent integrations and optional analysis providers",
    outputPolicy: "agent-only",
    options: z.object({
      yes: z
        .boolean()
        .default(false)
        .describe("Approve user-owned setup actions without prompting"),
      installHopper: z
        .boolean()
        .default(false)
        .describe("Also approve Hopper installation with --yes"),
      client: z
        .array(supportedClientSchema)
        .default([])
        .describe("Agent integration to configure; repeat for multiple agents"),
      skillClient: z
        .array(skillClientSchema)
        .default([])
        .describe("Existing client skill destination to update; repeatable"),
      toolFamilies: z
        .string()
        .optional()
        .refine(
          (value) =>
            value === undefined ||
            mcpToolFamiliesSchema.safeParse(value).success,
          { message: toolFamiliesConstraint },
        )
        .describe(
          "Comma-separated tool families this registration advertises; omit to preserve the saved selection, or advertise every tool if none is saved. To restore every tool, remove REA_MCP_TOOL_FAMILIES from the client's registration and restart the client.",
        ),
      allDetected: z
        .boolean()
        .default(false)
        .describe("Configure every detected supported agent"),
      skill: z
        .boolean()
        .optional()
        .describe(
          "Override the bundled skill included with agent integrations",
        ),
      dryRun: z
        .boolean()
        .default(false)
        .describe("Print the resolved plan without applying it"),
      accessible: z
        .boolean()
        .default(false)
        .describe("Use sequential accessible setup prompts"),
    }),
    alias: { yes: "y" },
    run: ({ options, formatExplicit }) =>
      logCliCommand(
        logger,
        CLI_COMMANDS.setup,
        () => runSetupCommand({ options, formatExplicit }, environment),
        isSetupFailure,
      ),
  });
};

const registerDoctorCommand = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.doctor, {
    description: "Check whether REA is ready",
    options: z.object({
      target: z.string().optional().describe("Optional app path to check"),
      client: z
        .array(supportedClientSchema)
        .default([])
        .describe("Agent registration whose readiness is required; repeatable"),
      provider: z
        .array(z.enum(DOCTOR_PROVIDER_IDS))
        .default([])
        .describe("Deep-analysis provider whose readiness is required"),
      skill: z
        .boolean()
        .optional()
        .describe("Require the installed REA skill identity to be aligned"),
    }),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, "doctor", async () => {
          const [{ runDoctorOwned }, { createSystemDoctorHost }] =
            await Promise.all([
              import("../application/Doctor.js"),
              import("../doctorRuntime.js"),
            ]);
          return runDoctorOwned(
            options.target,
            createSystemDoctorHost(environment, signal),
            doctorScope(options),
          );
        }),
      ),
  });
};

const registerMaintenanceCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.uninstall, {
    description: "Remove REA-owned agent configuration and skill files",
    options: z.object({
      purgeData: z
        .boolean()
        .default(false)
        .describe("Also remove REA caches and state"),
    }),
    run: ({ options }) =>
      logCliCommand(
        logger,
        "uninstall",
        async () => {
          const { runUninstall, systemUninstallHost } =
            await import("../application/Uninstall.js");
          return runUninstall(
            options.purgeData,
            systemUninstallHost(
              homeDirectoryFromEnvironment(environment, process.platform),
              undefined,
              environment,
            ),
          );
        },
        isUninstallFailure,
      ),
  });
  cli.command(CLI_COMMANDS.update, {
    description:
      "Update this REA installation and verify the installed release",
    run: ({ formatExplicit }) =>
      logCliCommand(
        logger,
        CLI_COMMANDS.update,
        async () => {
          const [{ runUpdate }, { systemUpdateHost }] = await Promise.all([
            import("../application/Update.js"),
            import("../application/UpdateRuntime.js"),
          ]);
          return runUpdate(
            PRODUCT_IDENTITY.packageVersion,
            systemUpdateHost(undefined, undefined, environment),
            formatExplicit ? "structured" : "human",
          );
        },
        isUpdateFailure,
      ),
  });
};

interface SetupCommandOptions {
  readonly yes: boolean;
  readonly installHopper: boolean;
  readonly client: readonly string[];
  readonly skillClient: readonly string[];
  readonly toolFamilies?: string | undefined;
  readonly allDetected: boolean;
  readonly skill?: boolean | undefined;
  readonly dryRun: boolean;
  readonly accessible: boolean;
}

const runSetupCommand = async (
  input: {
    readonly options: SetupCommandOptions;
    readonly formatExplicit: boolean;
  },
  environment: Readonly<NodeJS.ProcessEnv>,
) => {
  const { options } = input;
  const interactive = setupIsInteractive(options, input.formatExplicit);
  const hasExplicitScope = setupHasExplicitScope(options);
  const [{ runSetup }, { systemSetupHost }, { createSystemDoctorHost }] =
    await Promise.all([
      import("../application/Setup.js"),
      import("../application/SetupHost.js"),
      import("../doctorRuntime.js"),
    ]);
  const result = await runSetup(
    setupRunOptions(input, interactive, hasExplicitScope),
    systemSetupHost(createSystemDoctorHost(environment), environment),
    interactive
      ? (actions, context) =>
          confirmInteractiveSetup(actions, options.accessible, context)
      : undefined,
  );
  if (interactive) renderInteractiveSetupResult(result, environment);
  else if (
    options.dryRun &&
    !input.formatExplicit &&
    hasInteractiveTerminal()
  ) {
    if (result.status === "planned") renderSetupDryRun(result.plannedActions);
    else renderInteractiveSetupResult(result, environment);
  }
  return result;
};

const setupRunOptions = (
  input: {
    readonly options: SetupCommandOptions;
    readonly formatExplicit: boolean;
  },
  interactive: boolean,
  hasExplicitScope: boolean,
): SetupOptions => {
  const { options } = input;
  const agentIntegrationSelected =
    options.allDetected ||
    options.client.length > 0 ||
    options.skillClient.length > 0;
  const hasSelectedClients =
    hasExplicitScope &&
    (options.client.length > 0 || options.skillClient.length > 0);
  return {
    approved: options.yes && !options.dryRun,
    installHopper: options.installHopper,
    structured: input.formatExplicit || options.dryRun,
    dryRun: options.dryRun,
    allDetectedClients: options.allDetected,
    proposeHopper: interactive || options.installHopper,
    ...(hasSelectedClients ? { clientIds: options.client } : {}),
    ...(options.skillClient.length > 0
      ? { skillClientIds: options.skillClient }
      : {}),
    ...(hasExplicitScope
      ? { installSkill: options.skill ?? agentIntegrationSelected }
      : {}),
    ...(options.toolFamilies === undefined
      ? {}
      : { toolFamilies: options.toolFamilies }),
    ...(interactive ? { onProgress: renderSetupProgress } : {}),
    ...(hasSelectedClients && !options.allDetected
      ? {
          readinessScope: {
            clients: options.client,
            ...(options.skillClient.length > 0
              ? { skillClients: options.skillClient }
              : {}),
            providers: options.installHopper ? ["hopper"] : [],
            skill: options.skill ?? agentIntegrationSelected,
          },
        }
      : {}),
  };
};

const setupIsInteractive = (
  options: SetupCommandOptions,
  formatExplicit: boolean,
): boolean =>
  !options.yes &&
  !options.dryRun &&
  !formatExplicit &&
  hasInteractiveTerminal();

const hasInteractiveTerminal = (): boolean =>
  process.stdin.isTTY === true &&
  process.stdout.isTTY === true &&
  process.stderr.isTTY === true;

const setupHasExplicitScope = (options: SetupCommandOptions): boolean =>
  options.allDetected ||
  options.client.length > 0 ||
  options.skillClient.length > 0 ||
  options.skill !== undefined ||
  options.installHopper;

const doctorScope = (options: {
  readonly client: readonly string[];
  readonly provider: readonly string[];
  readonly skill?: boolean | undefined;
}): DoctorScope | undefined =>
  options.client.length === 0 &&
  options.provider.length === 0 &&
  options.skill === undefined
    ? undefined
    : {
        clients: options.client,
        providers: options.provider,
        skill: options.skill === true,
      };
