import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { z } from "incur";
import { AndroidAnalysisService } from "../application/android/AndroidAnalysisService.js";
import { createAndroidAnalysisProvider } from "../composition/android.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { AndroidOperation } from "../domain/android/androidAnalysis.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import { bindCliEvidenceCallerPath } from "./cliEvidenceCallerPath.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
  parseCliAnalysisEvidenceDelivery,
} from "./analysisEvidenceDelivery.js";
import { androidPackageDeliverySchema } from "../domain/android/androidPackageQuery.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { parseAnalysisInput } from "../application/AnalysisInput.js";
import { androidJniSelectionSchema } from "../domain/android/androidJniBindings.js";
import { androidJniDeliverySchema } from "../domain/android/androidJniQuery.js";
import { cliIntegerArgument } from "./options.js";

/** Expose the same explicit APK requests through one-shot CLI commands. */
export const registerAndroidCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<Record<string, string | undefined>>,
): void => {
  const provider = createAndroidAnalysisProvider(environment);
  const service = new AndroidAnalysisService(provider);
  const execute = (
    name: string,
    operation: AndroidOperation,
    input: unknown,
    callerPath: string,
    delivery?: {
      readonly detail: "complete" | "summary";
      readonly evidence_output?: string | undefined;
    },
  ) =>
    withCommandCancellation((signal) =>
      logCliCommand(logger, name, () => {
        const run = bindCliEvidenceCallerPath(callerPath, () =>
          service.execute(operation, input, { signal }),
        );
        const cleanup = { close: () => provider.close() };
        if (delivery !== undefined)
          return deliverCliAnalysisEvidence({
            run,
            service: cleanup,
            providerId: "jadx",
            operation,
            signal,
            detail: delivery.detail,
            evidenceOutput: delivery.evidence_output,
          });
        return finishAnalysisCommand(
          run,
          cleanup,
          "jadx",
          operation,
          signal,
        ).then(projectCliAnalysisResult);
      }),
    );
  const path = z.string().describe("Local standalone APK path");
  const className = z.string().describe("Exact fully qualified class name");
  const mappingPath = z
    .string()
    .optional()
    .describe(
      "Absolute local R8/ProGuard mapping.txt; names are annotated, never replaced",
    );
  const mappingInput = (path: string | undefined) =>
    path === undefined ? {} : { mapping_path: path };
  cli.command(CLI_COMMANDS.inspectAndroidJniBindings, {
    description:
      "Link raw DEX native declarations to static JNI export/table candidates without executing the APK",
    args: z.object({ path }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      query: z
        .string()
        .optional()
        .describe(
          "JSON selection: class_name, method_names, descriptors, abis, library_paths; arrays preserve exact names",
        ),
      view: z
        .string()
        .optional()
        .describe(
          "JSON android-jni collection page; requires --detail summary and --evidence_output",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(
          logger,
          CLI_COMMANDS.inspectAndroidJniBindings,
          async () => {
            const operation = "inspect_android_jni_bindings";
            const delivery = parseCliAnalysisEvidenceDelivery(
              operation,
              options,
              androidJniDeliverySchema,
            );
            if (!delivery.ok) return projectAnalysisError(delivery.error);
            let query: unknown = {};
            try {
              if (options.query !== undefined)
                query = JSON.parse(options.query);
            } catch (cause: unknown) {
              return projectAnalysisError(
                new AnalysisInputError(operation, { cause }, [
                  {
                    path: ["query"],
                    reason: "invalid_format",
                    message: "query must be a JSON selection object.",
                  },
                ]),
              );
            }
            const selected = parseAnalysisInput(
              operation,
              query,
              androidJniSelectionSchema,
              signal,
            );
            if (!selected.ok) return projectAnalysisError(selected.error);
            return deliverCliAnalysisEvidence({
              callerInputPath: args.path,
              run: () =>
                service.execute(
                  operation,
                  { ...selected.value, path: args.path },
                  { signal },
                ),
              service: { close: () => provider.close() },
              providerId: "jadx",
              operation,
              signal,
              detail: delivery.value.detail,
              evidenceOutput: delivery.value.evidenceOutput,
              ...(delivery.value.view === undefined
                ? {}
                : { view: delivery.value.view }),
            });
          },
        ),
      ),
  });
  cli.command(CLI_COMMANDS.inspectAndroidPackage, {
    description:
      "Inspect APK declarations and decoded manifest without executing it",
    args: z.object({ path }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON android manifest/components/component-summary view; requires --detail summary and --evidence_output",
        ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectAndroidPackage, async () => {
          const delivery = parseCliAnalysisEvidenceDelivery(
            "inspect_android_package",
            options,
            androidPackageDeliverySchema,
          );
          if (!delivery.ok) return projectAnalysisError(delivery.error);
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.execute("inspect_android_package", args, { signal }),
            service: { close: () => provider.close() },
            providerId: "jadx",
            operation: "inspect_android_package",
            signal,
            detail: delivery.value.detail,
            evidenceOutput: delivery.value.evidenceOutput,
            ...(delivery.value.view === undefined
              ? {}
              : { view: delivery.value.view }),
          });
        }),
      ),
  });
  cli.command(CLI_COMMANDS.searchAndroidClasses, {
    description: "Search APK class names; empty query inventories all classes",
    args: z.object({
      path,
      query: z
        .string()
        .describe(
          "Case-sensitive class-name substring; empty lists all classes",
        ),
    }),
    run: ({ args }) =>
      execute(
        CLI_COMMANDS.searchAndroidClasses,
        "search_android_classes",
        args,
        args.path,
      ),
  });
  cli.command(CLI_COMMANDS.inspectAndroidClass, {
    description: "Inspect one exact APK class's member inventory",
    args: z.object({ path, className }),
    options: z.object({ mappingPath, ...analysisEvidenceDeliveryOptions }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.inspectAndroidClass,
        "inspect_android_class",
        {
          path: args.path,
          class_name: args.className,
          ...mappingInput(options.mappingPath),
        },
        args.path,
        options,
      ),
  });
  cli.command(CLI_COMMANDS.inspectAndroidMethod, {
    description: "Decompile one APK method with explicit overload selection",
    args: z.object({
      path,
      className,
      methodName: z.string().describe("Exact declared method name"),
    }),
    options: z.object({
      overloadIndex: cliIntegerArgument(0)
        .optional()
        .describe(
          "Explicit zero-based index among same-name methods; required when ambiguous",
        ),
      mappingPath,
      ...analysisEvidenceDeliveryOptions,
    }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.inspectAndroidMethod,
        "inspect_android_method",
        {
          path: args.path,
          class_name: args.className,
          method_name: args.methodName,
          ...mappingInput(options.mappingPath),
          ...(options.overloadIndex === undefined
            ? {}
            : { overload_index: options.overloadIndex }),
        },
        args.path,
        options,
      ),
  });
  cli.command(CLI_COMMANDS.traceAndroidReferences, {
    description:
      "Trace APK using nodes for a defined class/method or an externally invoked DEX method",
    args: z.object({ path, className }),
    options: z.object({
      methodName: z
        .string()
        .optional()
        .describe(
          "Defined or directly referenced external method; omit for APK class references",
        ),
      overloadIndex: cliIntegerArgument(0)
        .optional()
        .describe(
          "Index among defined methods or observed external prototypes listed by an ambiguous query",
        ),
    }),
    run: ({ args, options }) =>
      execute(
        CLI_COMMANDS.traceAndroidReferences,
        "trace_android_references",
        {
          path: args.path,
          class_name: args.className,
          ...(options.methodName === undefined
            ? {}
            : { method_name: options.methodName }),
          ...(options.overloadIndex === undefined
            ? {}
            : { overload_index: options.overloadIndex }),
        },
        args.path,
      ),
  });
};
