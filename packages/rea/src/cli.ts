import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { writeAmpRegistrationBackup } from "./cli/ampRegistrationBackup.js";
import { registerToolFamilies } from "./contracts/toolFamilyIds.js";
import { registerGpuCommands } from "./cli/gpuCommands.js";
import { registerNativeFunctionMatchingCommands } from "./cli/nativeFunctionMatchingCommands.js";
import { registerCaptureCommands } from "./cli/captureCommands.js";
import { registerSignalCommands } from "./cli/signalCommands.js";
import { registerWasmCommands } from "./cli/wasmCommands.js";
import { registerApkSignatureCommands } from "./cli/apkSignatureCommands.js";
import { snapshotEnvironment } from "./process/snapshotEnvironment.js";
import { createDirectAnalysis } from "./composition/directAnalysis.js";
import { registerEvmCommands } from "./cli/evmCommands.js";
import { registerDesktopApplicationCommands } from "./cli/desktopApplicationCommands.js";
import { registerGoCommands } from "./cli/goCommands.js";
import { registerModelCommands } from "./cli/modelCommands.js";
import { registerIl2cppCommands } from "./cli/il2cppCommands.js";
import { registerRustCommands } from "./cli/rustCommands.js";
import { registerPythonPycCommands } from "./cli/pythonPycCommands.js";
import { registerErlangCommands } from "./cli/erlangCommands.js";
import { registerSqliteCommands } from "./cli/sqliteCommands.js";
import { registerAnalysisViewCommands } from "./cli/analysisViewCommands.js";
import { registerBinaryDiagnosticsCommands } from "./cli/binaryDiagnosticsCommands.js";
import { registerFridaCommands } from "./cli/fridaCommands.js";
import type { FridaInstrumentationPort } from "./application/frida/FridaInstrumentationPort.js";
import { Cli, z } from "incur";
import {
  adaptCliOutputArgumentsForIncur,
  normalizeCliArguments,
  splitIncurBuiltinArguments,
} from "./cliBuiltinArguments.js";
import {
  parseCliOutputArguments,
  renderCliDocument,
  renderCliOutputArgumentError,
} from "./cliOutput.js";

import { createLogger } from "./logger.js";
import { parseLogLevel } from "./config/processStart.js";
import { PRODUCT_IDENTITY } from "./identity.js";
import { currentClientRegistrationCommand } from "./application/ClientRegistrationIdentity.js";
import { clientRegistrationCommandText } from "./cli/clientRegistrationCommandText.js";
import { registerSetupCommands } from "./cli/setupCommands.js";
import { registerCoreAnalysisCommands } from "./cli/coreAnalysisCommands.js";
import { registerUtilityCommands } from "./cli/utilityCommands.js";
import { registerArtifactCommands } from "./cli/artifactCommands.js";
import { registerManagedCommands } from "./cli/managedCommands.js";
import { registerFirmwareCommands } from "./cli/firmwareCommands.js";
import { registerAndroidCommands } from "./cli/androidCommands.js";
import { registerApktoolCommands } from "./cli/apktoolCommands.js";
import { registerPcapCommands } from "./cli/pcapCommands.js";
import { registerFlutterCommands } from "./cli/flutterCommands.js";
import { registerJebCommands } from "./cli/jebCommands.js";
import { registerAdbCommands } from "./cli/adbCommands.js";
import { registerEvidenceCommands } from "./cliEvidenceCommands.js";
import { registerEnvironmentCommands } from "./cli/environmentCommands.js";
import { registerProcessCommands } from "./cli/processCommands.js";
import { registerBrowserCommands } from "./cli/browserCommands.js";
import { registerWebScriptCommands } from "./cli/webScriptCommands.js";
import { registerWebModuleCommands } from "./cli/webModuleCommands.js";
import { registerWebSourceLocationCommands } from "./cli/webSourceLocationCommands.js";
import { registerWebRuntimeCommands } from "./cli/webRuntimeCommands.js";
import { registerWebNetworkCaptureCommands } from "./cli/webNetworkCaptureCommands.js";
import { registerJavaScriptRecoveryCommands } from "./cli/javascriptRecoveryCommands.js";
import { registerAdvancedBrowserCommands } from "./cli/browserAdvancedCommands.js";
import { registerBrowserScenarioCommands } from "./cliBrowserScenarioCommands.js";
import { registerElectronCommands } from "./cli/electronCommands.js";
import { registerJavaScriptRuntimeObservationCommands } from "./cli/javascriptRuntimeCommands.js";
import { registerApplicationCommands } from "./cli/applicationCommands.js";
import { presentOmittableDefaults } from "./cli/omittableDefaults.js";
import type { CliInstance } from "./cli/types.js";
import {
  streamCliCommandResults,
  type CliResultOutput,
} from "./cli/cliResultOutput.js";
import { registerReverseEngineeringCommands } from "./cli/reverseEngineeringCommands.js";
import { registerCutterCommands } from "./cli/cutterCommands.js";
import { excludeDeclaredSensitiveArguments } from "./cli/explicitSensitiveArguments.js";
import { rejectSurplusCliArguments } from "./cli/strictPositionals.js";
import { presentCliArgumentErrors } from "./cli/argumentErrors.js";
import { completionHelpNote, createCliCompletions } from "./cli/completions.js";
import {
  closeCliGuidanceResources,
  registerGuidanceCommands,
} from "./cli/guidanceCommands.js";
import { closeCliJavaScriptResources } from "./cli/javascriptApplicationAnalysis.js";
import { registerGuidedWorkflowCommands } from "./cli/guidedWorkflowCommands.js";

/** Close every process-owned resource used by CLI commands. */
export const closeCliResources = async (): Promise<void> => {
  const results = await Promise.allSettled([
    closeCliJavaScriptResources(),
    closeCliGuidanceResources(),
  ]);
  const failures = results.flatMap((result) =>
    result.status === "rejected" ? [result.reason] : [],
  );
  if (failures.length === 1) throw failures[0];
  if (failures.length > 1)
    throw new AggregateError(failures, "CLI resource cleanup failed");
};

/**
 * Build the one-shot Incur CLI without starting Hopper at import time.
 * Analysis commands acquire and close their own sessions; bare `mcp` and
 * `--mcp` are intercepted by the executable dispatcher before this module loads.
 */
export const createCli = (
  selectedEnvironment: Readonly<
    Record<string, string | undefined>
  > = process.env,
  resultOutput?: CliResultOutput,
  fridaInstrumentation?: FridaInstrumentationPort,
): CliInstance => {
  const environment = snapshotEnvironment(selectedEnvironment);
  const analysis = createDirectAnalysis(environment);
  // The executable reports an invalid level before every command except doctor.
  // Doctor keeps going so its readiness report can name REA_LOG_LEVEL.
  const level =
    environment.REA_LOG_LEVEL === undefined
      ? undefined
      : parseLogLevel(environment.REA_LOG_LEVEL);
  const logger = createLogger(
    "cli",
    level?.ok === true ? level.value : "silent",
  );
  const timedCli = Cli.create(PRODUCT_IDENTITY.cliBinary, {
    version: PRODUCT_IDENTITY.packageVersion,
    description: "Reverse engineer anything from your terminal or agent.",
    globals: z.object({
      timings: z
        .boolean()
        .default(false)
        .describe("Write measured command timing to stderr."),
    }),
    mcp: {
      command: clientRegistrationCommandText(
        currentClientRegistrationCommand({ environment }),
      ),
      instructions:
        "Ask what software, artifact, protocol, or behavior the user wants to understand, then choose the available investigation capabilities that can produce evidence.",
    },
    sync: false,
    update: {
      // Incur's update:false only suppresses notices. Reject its explicit
      // installer so ambiguous flags cannot bypass REA's verified workflow.
      install: () => {
        throw new Error(
          "Use 'rea update' to update the identified installation. The '--update' alias accepts only global output flags.",
        );
      },
    },
  });

  timedCli.use(async (context, next) => {
    if (!context.globals.timings) return next();
    const started = performance.now();
    try {
      await next();
    } finally {
      // This interval covers CLI command dispatch, including result delivery.
      // It is not a provider-only or analysis-only measurement.
      process.stderr.write(
        `${JSON.stringify({ rea_timings: { version: 1, command_ms: Math.round(performance.now() - started) } })}\n`,
      );
    }
  });
  // Command registrars do not inspect global options; preserve their existing
  // type while Incur owns parsing and the middleware owns this added flag.
  const cli = timedCli as unknown as CliInstance;

  registerSetupCommands(cli, logger, environment);
  registerToolFamilies({
    direct: () =>
      registerCoreAnalysisCommands(
        cli,
        logger,
        analysis.runDirectAnalysis,
        environment,
      ),
    // Enhanced workflows are MCP tools. Their CLI entry points live with core analysis.
    enhanced: () => undefined,
    native: () => {
      registerReverseEngineeringCommands(cli, logger, environment);
      registerCutterCommands(cli, logger, environment);
      registerUtilityCommands(cli, logger, environment, analysis);
      registerBinaryDiagnosticsCommands(cli, logger, environment);
    },
    artifact: () => {
      registerWasmCommands(cli, logger, environment);
      registerApkSignatureCommands(cli, logger, environment);
      registerCaptureCommands(cli, logger, environment);
      registerSignalCommands(cli, logger, environment);
      registerEvmCommands(cli, logger, environment);
      registerDesktopApplicationCommands(cli, logger);
      registerGoCommands(cli, logger);
      registerIl2cppCommands(cli, logger);
      registerModelCommands(cli, logger);
      registerGpuCommands(cli, logger);
      registerRustCommands(cli, logger);
      registerPythonPycCommands(cli, logger);
      registerErlangCommands(cli, logger);
      registerSqliteCommands(cli, logger, environment);
      registerArtifactCommands(cli, logger, analysis.runProviderAnalysis);
    },
    managed: () =>
      registerManagedCommands(cli, logger, analysis.runProviderAnalysis),
    firmware: () => registerFirmwareCommands(cli, logger, environment),
    android: () => registerAndroidCommands(cli, logger, environment),
    pcap: () => registerPcapCommands(cli, logger, environment),
    flutter: () => registerFlutterCommands(cli, logger),
    frida: () => registerFridaCommands(cli, logger, fridaInstrumentation),
    apktool: () => registerApktoolCommands(cli, logger, environment),
    jeb: () => registerJebCommands(cli, logger, environment),
    adb: () => registerAdbCommands(cli, logger, environment),
    browser: () => {
      registerBrowserCommands(cli, logger);
      registerWebRuntimeCommands(cli, logger);
      registerWebNetworkCaptureCommands(cli, logger, environment);
      registerAdvancedBrowserCommands(cli, logger);
      registerBrowserScenarioCommands(cli, logger, environment);
    },
    electron: () => registerElectronCommands(cli, logger, environment),
    "javascript-runtime": () =>
      registerJavaScriptRuntimeObservationCommands(cli, logger, environment),
    application: () => {
      registerGuidanceCommands(cli, logger);
      registerGuidedWorkflowCommands(cli, logger);
      registerAnalysisViewCommands(cli, logger);
      registerEvidenceCommands(cli, logger);
      registerEnvironmentCommands(cli, logger, environment);
      registerProcessCommands(cli, logger, environment);
      registerJavaScriptRecoveryCommands(cli, logger, environment);
      registerWebScriptCommands(cli, logger);
      registerWebModuleCommands(cli, logger, environment);
      registerWebSourceLocationCommands(cli, logger, environment);
      registerApplicationCommands(cli, logger);
    },
    session: () =>
      registerNativeFunctionMatchingCommands(cli, logger, environment),
  });
  presentOmittableDefaults(cli);
  if (resultOutput !== undefined) streamCliCommandResults(cli, resultOutput);
  const serveStrict = rejectSurplusCliArguments(cli);
  presentCliArgumentErrors(cli);
  const serveDeclared = excludeDeclaredSensitiveArguments(cli);
  const serve = cli.serve.bind(cli);
  const complete = createCliCompletions(
    cli as unknown as Parameters<typeof createCliCompletions>[0],
    environment,
  );
  cli.serve = (arguments_ = process.argv.slice(2), options) => {
    if (complete(arguments_, options ?? {})) return Promise.resolve();
    const normalized = normalizeCliArguments(arguments_);
    const { command, flags } = splitIncurBuiltinArguments(normalized);
    const builtin = command[0] === PRODUCT_IDENTITY.cliBinary ? 1 : 0;
    if (
      command[builtin] === "mcp" &&
      command[builtin + 1] === "add" &&
      !flags.has("--help") &&
      !flags.has("-h") &&
      !flags.has("--llms") &&
      !flags.has("--llms-full")
    ) {
      const write =
        options?.stdout ?? ((text: string) => process.stdout.write(text));
      if (flags.has("--version")) {
        write(`${PRODUCT_IDENTITY.packageVersion}\n`);
        return Promise.resolve();
      }
      if (flags.has("--schema")) {
        const output = parseCliOutputArguments(normalized);
        if (!output.validation.ok)
          write(renderCliOutputArgumentError(output.validation));
        else if (output.format === "csv" || output.format === "tsv")
          write(
            renderCliOutputArgumentError({
              ok: false,
              format: "json",
              code: "UNSUPPORTED_OUTPUT_COMBINATION",
              message:
                "CSV/TSV output cannot represent the mcp add schema discovery error. Use a document format instead.",
            }),
          );
        else
          write(
            renderCliDocument(
              {
                code: "SCHEMA_UNAVAILABLE",
                message:
                  "Schema discovery is not supported for mcp add. Use 'rea mcp add --help' for its options.",
              },
              output.format,
              process.stdout.isTTY === true,
            ),
          );
        (
          options?.exit ??
          ((code: number) => {
            process.exitCode = code;
          })
        )(1);
        return Promise.resolve();
      }
      // Incur's mcp add parser only understands spaced `--agent amp` forms; an
      // equals form like `--agent=amp` is silently ignored, which would drop
      // the requested agent and register against the default target. Normalize
      // equals forms back to spaced forms before handing over to Incur.
      const serveArguments = normalized.flatMap((token) => {
        if (token.startsWith("--agent=") || token.startsWith("--command=")) {
          const separator = token.indexOf("=");
          const value = token.slice(separator + 1);
          return value === "" ? [token] : [token.slice(0, separator), value];
        }
        return [token];
      });
      // Incur's Amp registration overwrites an existing rea entry (dropping its
      // environment map) and reports success even when the settings file
      // prevents a save. Guard that path: reject a settings file REA cannot
      // update, back up the file, preserve the caller's environment, and verify
      // the registration landed.
      const ampRequested =
        command.some(
          (token, index) => token === "--agent" && command[index + 1] === "amp",
        ) || command.includes("--agent=amp");
      if (ampRequested) {
        const settingsPath = join(homedir(), ".config", "amp", "settings.json");
        let priorEnv: unknown;
        let guardError: string | undefined;
        let settingsText: string | undefined;
        let parsedSettings: Record<string, unknown> | undefined;
        try {
          if (existsSync(settingsPath))
            settingsText = readFileSync(settingsPath, "utf8");
        } catch (cause) {
          guardError = `Unable to read Amp settings.json: ${
            cause instanceof Error ? cause.message : String(cause)
          }`;
        }
        if (settingsText !== undefined) {
          try {
            const parsed: unknown = JSON.parse(settingsText);
            if (
              typeof parsed !== "object" ||
              parsed === null ||
              Array.isArray(parsed)
            )
              guardError = "Amp settings.json must contain a JSON object.";
            else parsedSettings = parsed as Record<string, unknown>;
          } catch (cause) {
            guardError = `Amp settings.json is not valid JSON: ${
              cause instanceof Error ? cause.message : String(cause)
            }`;
          }
        }
        if (parsedSettings !== undefined && settingsText !== undefined) {
          const servers = parsedSettings["amp.mcpServers"];
          if (
            servers !== undefined &&
            (typeof servers !== "object" ||
              servers === null ||
              Array.isArray(servers))
          )
            guardError =
              "amp.mcpServers must be an object in Amp settings.json.";
          else {
            const entry =
              typeof servers === "object" && servers !== null
                ? (servers as Record<string, unknown>)["rea"]
                : undefined;
            if (typeof entry === "object" && entry !== null)
              priorEnv = (entry as Record<string, unknown>)["env"];
          }
        }
        const reportValidationError = (message: string): void => {
          const output = parseCliOutputArguments(normalized);
          if (!output.validation.ok)
            write(renderCliOutputArgumentError(output.validation));
          else
            write(
              renderCliDocument(
                {
                  code: "VALIDATION_ERROR",
                  message,
                  fieldErrors: [
                    {
                      code: "invalid_value",
                      missing: false,
                      path: "amp",
                      message,
                    },
                  ],
                },
                output.format,
                process.stdout.isTTY === true,
              ),
            );
          (
            options?.exit ??
            ((code: number) => {
              process.exitCode = code;
            })
          )(1);
        };
        if (guardError !== undefined) {
          reportValidationError(`${guardError} Fix it before registering.`);
          return Promise.resolve();
        }

        const runRegistration = (backupPath?: string): Promise<void> => {
          const result = serveStrict(
            serveArguments,
            options ?? {},
            (tokens, selected) =>
              serveDeclared(tokens, selected, (declared, declaredOptions) =>
                serve(
                  adaptCliOutputArgumentsForIncur(declared),
                  declaredOptions,
                ),
              ),
          );
          return result.then(() => {
            let failure: string | undefined;
            try {
              if (!existsSync(settingsPath))
                failure = "Amp settings.json was not created.";
              else {
                const text = readFileSync(settingsPath, "utf8");
                const parsed = JSON.parse(text) as Record<string, unknown>;
                const servers = parsed["amp.mcpServers"];
                if (
                  typeof servers !== "object" ||
                  servers === null ||
                  Array.isArray(servers) ||
                  !("rea" in servers)
                )
                  failure =
                    "Amp settings.json does not contain the rea registration after mcp add.";
                else {
                  const entry = (servers as Record<string, unknown>)["rea"];
                  if (
                    priorEnv !== undefined &&
                    typeof entry === "object" &&
                    entry !== null &&
                    (entry as Record<string, unknown>)["env"] === undefined
                  ) {
                    (entry as Record<string, unknown>)["env"] = priorEnv;
                    writeFileSync(
                      settingsPath,
                      `${JSON.stringify(parsed, null, 2)}\n`,
                    );
                  }
                }
              }
            } catch (cause) {
              failure = cause instanceof Error ? cause.message : String(cause);
            }
            if (failure !== undefined) {
              const output = parseCliOutputArguments(normalized);
              if (output.validation.ok)
                write(
                  renderCliDocument(
                    {
                      code: "VALIDATION_ERROR",
                      message: failure,
                      fieldErrors: [
                        {
                          code: "invalid_value",
                          missing: false,
                          path: "amp",
                          message: failure,
                        },
                      ],
                    },
                    output.format,
                    process.stdout.isTTY === true,
                  ),
                );
              (
                options?.exit ??
                ((code: number) => {
                  process.exitCode = code;
                })
              )(1);
            } else if (backupPath !== undefined)
              process.stderr.write(
                `Amp MCP registration backup retained at ${backupPath}\n`,
              );
          });
        };

        if (settingsText === undefined) return runRegistration();
        return writeAmpRegistrationBackup(settingsPath, settingsText).then(
          (backup) => {
            if (!backup.ok) {
              const { kind, path, detail } = backup.error;
              reportValidationError(
                `Unable to create Amp settings backup (${kind}) at ${path}: ${detail}`,
              );
              return;
            }
            return runRegistration(backup.value);
          },
          (cause: unknown) => {
            const detail =
              cause instanceof Error ? cause.message : String(cause);
            reportValidationError(
              `Unable to create Amp settings backup: ${detail}`,
            );
          },
        );
      }
    }
    const result = serveStrict(normalized, options ?? {}, (tokens, selected) =>
      serveDeclared(tokens, selected, (declared, declaredOptions) =>
        serve(adaptCliOutputArgumentsForIncur(declared), declaredOptions),
      ),
    );
    const note = completionHelpNote(normalized);
    if (note === undefined) return result;
    return result.then(() => {
      const write =
        options?.stdout ?? ((text: string) => process.stdout.write(text));
      write(`\n${note}`);
    });
  };
  return cli;
};
