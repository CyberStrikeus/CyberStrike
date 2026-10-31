import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";

import { FridaInstrumentationService } from "../application/frida/FridaInstrumentationService.js";
import type {
  FridaInstrumentationPort,
  FridaRemoteConnection,
} from "../application/frida/FridaInstrumentationPort.js";
import { FridaInstrumentationManager } from "../frida/FridaInstrumentationManager.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { ok } from "../domain/result.js";
import { FRIDA_KEEPALIVE_INTERVAL_DESCRIPTION } from "../contracts/fridaToolContracts.js";
import { isValidFridaRemoteAddress } from "../domain/fridaRemoteAddress.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";

/** Script sources stay optional in the options schema; exactly one is required. */
const exactlyOneScriptSource =
  "Provide exactly one of --script or --script-file.";

/** Register Frida discovery and one-shot instrumentation CLI operations. */
export const registerFridaCommands = (
  cli: CliInstance,
  logger: Logger,
  provider: FridaInstrumentationPort = new FridaInstrumentationManager(),
): void => {
  const service = new FridaInstrumentationService(provider);
  // CLI calls own a disposable provider; MCP retains its shared provider until
  // server shutdown. Await cleanup here, including failed startup resources.
  const cleanup = { close: () => provider.closeAll() };
  const remoteOptions = z.object({
    remoteAddress: z
      .string()
      .min(1)
      .max(2048)
      .refine(isValidFridaRemoteAddress)
      .optional()
      .describe("Remote Frida host address, optionally with a port"),
    token: z.string().min(1).optional().describe("Remote authentication token"),
    certificate: z
      .string()
      .min(1)
      .optional()
      .describe("Remote TLS certificate"),
    origin: z.string().min(1).optional().describe("Remote connection origin"),
    keepaliveInterval: z
      .number()
      .int()
      .positive()
      .optional()
      .describe(FRIDA_KEEPALIVE_INTERVAL_DESCRIPTION),
  });
  const remoteFrom = (
    options: z.infer<typeof remoteOptions>,
  ): FridaRemoteConnection | undefined =>
    options.remoteAddress === undefined
      ? undefined
      : {
          address: options.remoteAddress,
          ...(options.token === undefined ? {} : { token: options.token }),
          ...(options.certificate === undefined
            ? {}
            : { certificate: options.certificate }),
          ...(options.origin === undefined ? {} : { origin: options.origin }),
          ...(options.keepaliveInterval === undefined
            ? {}
            : { keepaliveInterval: options.keepaliveInterval }),
        };

  const remoteAddressRequired = (
    options: z.infer<typeof remoteOptions>,
  ): boolean =>
    options.remoteAddress !== undefined ||
    (options.token === undefined &&
      options.certificate === undefined &&
      options.origin === undefined &&
      options.keepaliveInterval === undefined);

  cli.command(CLI_COMMANDS.listFridaDevices, {
    description: "List local Frida devices and an optional remote endpoint",
    args: z.object({}),
    options: remoteOptions.refine(
      remoteAddressRequired,
      "Remote credentials and connection options require remoteAddress",
    ),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.listFridaDevices, () =>
          finishAnalysisCommand(
            () => service.listDevices(remoteFrom(options)),
            cleanup,
            "frida",
            "list_frida_devices",
            signal,
          ).then(projectCliAnalysisResult),
        ),
      ),
  });
  cli.command(CLI_COMMANDS.listFridaProcesses, {
    description: "List processes visible through a Frida device",
    args: z.object({}),
    options: remoteOptions
      .extend({
        deviceId: z
          .string()
          .min(1)
          .optional()
          .describe("Frida device identifier"),
      })
      .refine(
        (options) =>
          options.remoteAddress === undefined || options.deviceId === undefined,
        "Choose either deviceId or remoteAddress, not both",
      )
      .refine(
        remoteAddressRequired,
        "Remote credentials and connection options require remoteAddress",
      ),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.listFridaProcesses, () => {
          const remote = remoteFrom(options);
          return finishAnalysisCommand(
            () =>
              service.listProcesses(
                remote === undefined
                  ? { deviceId: options.deviceId ?? "local" }
                  : { remote },
              ),
            cleanup,
            "frida",
            "list_frida_processes",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.instrumentWithFrida, {
    description: `Run one Frida script against a selected process and detach. ${exactlyOneScriptSource}`,
    args: z.object({
      mode: z
        .enum(["attach", "spawn"])
        .describe("Attach to a PID or spawn a program"),
      target: z
        .string()
        .min(1)
        .describe("Process ID for attach or program path for spawn"),
    }),
    options: remoteOptions
      .extend({
        deviceId: z
          .string()
          .min(1)
          .optional()
          .describe("Frida device identifier"),
        script: z
          .string()
          .optional()
          .describe(`Inline JavaScript to load. ${exactlyOneScriptSource}`),
        scriptFile: z
          .string()
          .min(1)
          .optional()
          .describe(
            `Path to JavaScript source file. ${exactlyOneScriptSource}`,
          ),
        argument: z
          .array(z.string())
          .optional()
          .describe("Arguments passed to a spawned target"),
        durationMs: z
          .number()
          .int()
          .min(0)
          .max(60_000)
          .default(1_000)
          .describe("Instrumentation duration in milliseconds"),
      })
      .refine(
        (options) =>
          options.remoteAddress === undefined || options.deviceId === undefined,
        "Choose either deviceId or remoteAddress, not both",
      )
      .refine(
        remoteAddressRequired,
        "Remote credentials and connection options require remoteAddress",
      ),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.instrumentWithFrida, async () => {
          if (args.mode === "attach" && options.argument !== undefined)
            return projectAnalysisError(
              new AnalysisInputError(
                CLI_COMMANDS.instrumentWithFrida,
                undefined,
                [
                  {
                    path: ["argument"],
                    reason: "invalid_value",
                    message:
                      "--argument is only valid in spawn mode; remove it when attaching to a process.",
                  },
                ],
              ),
            );
          if (
            (options.script === undefined) ===
            (options.scriptFile === undefined)
          )
            return projectAnalysisError(
              new AnalysisInputError(
                CLI_COMMANDS.instrumentWithFrida,
                undefined,
                [
                  {
                    path: ["script"],
                    reason: "invalid_value",
                    message:
                      "Provide exactly one of --script or --script-file.",
                  },
                ],
              ),
            );
          const remote = remoteFrom(options);
          const selected =
            remote === undefined
              ? { deviceId: options.deviceId ?? "local" }
              : { remote };
          const targetInput =
            args.mode === "attach"
              ? /^[1-9][0-9]*$/u.test(args.target) &&
                Number.isSafeInteger(Number(args.target)) &&
                Number(args.target) > 0
                ? {
                    ...selected,
                    mode: "attach" as const,
                    pid: Number(args.target),
                  }
                : undefined
              : {
                  ...selected,
                  mode: "spawn" as const,
                  program: args.target,
                  ...(options.argument === undefined
                    ? {}
                    : { argv: options.argument }),
                };
          if (targetInput === undefined)
            return projectAnalysisError(
              new AnalysisInputError(
                CLI_COMMANDS.instrumentWithFrida,
                undefined,
                [
                  {
                    path: ["target"],
                    reason: "invalid_value",
                    message: "attach mode needs a positive integer process ID.",
                  },
                ],
              ),
            );
          return finishAnalysisCommand(
            async () => {
              const result = await service.instrument(
                {
                  ...targetInput,
                  source:
                    options.scriptFile === undefined
                      ? { sourceKind: "inline", source: options.script ?? "" }
                      : { sourceKind: "file", path: options.scriptFile },
                  durationMs: options.durationMs,
                },
                signal,
              );
              if (!result.ok) return result;
              if (result.value.cleanupError !== null) process.exitCode = 1;
              return ok(result.value.evidence);
            },
            cleanup,
            "frida",
            "instrument_with_frida",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
};
