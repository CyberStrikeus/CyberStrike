import { projectCliAnalysisResult } from "./projectCliAnalysisResult.js";
import { inspectDevicetreeInputSchema } from "../domain/firmware/devicetree.js";
import { inspectPeLoadConfigInputSchema } from "../domain/native/peLoadConfig.js";
import { inspectByteEntropyInputSchema } from "../domain/native/byteEntropy.js";
import { z } from "incur";
import {
  createByteEntropyService,
  createRecordedCrashService,
  createBinaryLayoutService,
  createElfNotesService,
  createAppleIpsService,
  createDevicetreeService,
  createKernelModuleService,
  createPeLoadConfigService,
  createPeResourcesService,
  createPeCertificatesService,
  createPeImportsService,
  createNativeExportsService,
} from "../composition/binaryDiagnostics.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { inspectBinaryLayoutInputSchema } from "../domain/native/binaryLayout.js";
import { inspectRecordedCrashInputSchema } from "../domain/native/recordedCrash.js";
import { inspectPeResourcesInputSchema } from "../domain/native/peResources.js";
import { inspectPeCertificatesInputSchema } from "../domain/native/peCertificates.js";
import { inspectPeImportsInputSchema } from "../domain/native/peImports.js";
import { inspectNativeExportsInputSchema } from "../domain/native/nativeExports.js";
import { inspectElfNotesInputSchema } from "../domain/native/elfNotes.js";
import { inspectAppleIpsInputSchema } from "../domain/native/appleIps.js";
import { inspectKernelModuleInputSchema } from "../domain/native/kernelModule.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { finishCliEvidenceCommand } from "./cliEvidenceCallerPath.js";
import { withEvidenceCallerInputPath } from "../domain/evidence.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";

/** Inspect operator-selected files through the same shared workflow as MCP. */
export const registerBinaryDiagnosticsCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.inspectElfNotes, {
    description:
      "Inspect ELF PT_NOTE and SHT_NOTE identities without executing the image",
    args: z.object({
      path: localPathStringSchema.describe("Local ELF32/ELF64 image"),
    }),
    options: z.object({
      maxFileBytes: inspectElfNotesInputSchema.shape.max_file_bytes,
      maxEntries: inspectElfNotesInputSchema.shape.max_entries,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const elf = createElfNotesService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectElfNotes,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                elf.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_entries: options.maxEntries,
                  },
                  { signal },
                ),
              elf,
              "rea-elf-notes",
              "inspect_elf_notes",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectAppleIps, {
    description:
      "Inspect an Apple .ips crash report without executing a target",
    args: z.object({
      path: localPathStringSchema.describe("Local Apple .ips crash report"),
    }),
    options: z.object({
      maxFileBytes: inspectAppleIpsInputSchema.shape.max_file_bytes,
      maxThreads: inspectAppleIpsInputSchema.shape.max_threads,
      maxFrames: inspectAppleIpsInputSchema.shape.max_frames,
      maxImages: inspectAppleIpsInputSchema.shape.max_images,
      maxRegisters: inspectAppleIpsInputSchema.shape.max_registers,
      maxIntegerTextBytes:
        inspectAppleIpsInputSchema.shape.max_integer_text_bytes,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const ips = createAppleIpsService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectAppleIps,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                ips.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_threads: options.maxThreads,
                    max_frames: options.maxFrames,
                    max_images: options.maxImages,
                    max_registers: options.maxRegisters,
                    max_integer_text_bytes: options.maxIntegerTextBytes,
                  },
                  { signal },
                ),
              ips,
              "rea-apple-ips",
              "inspect_apple_ips",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectKernelModule, {
    description:
      "Inspect Linux kernel module metadata without executing the module",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local ELF32/ELF64 kernel module or compressed .ko container",
      ),
    }),
    options: z.object({
      maxFileBytes: inspectKernelModuleInputSchema.shape.max_file_bytes,
      maxEntries: inspectKernelModuleInputSchema.shape.max_entries,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const kernelModule = createKernelModuleService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectKernelModule,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                kernelModule.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_entries: options.maxEntries,
                  },
                  { signal },
                ),
              kernelModule,
              "rea-kernel-module",
              "inspect_kernel_module",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectPeLoadConfig, {
    description:
      "Inspect PE TLS callbacks and load configuration without executing the image",
    args: z.object({
      path: localPathStringSchema.describe("Local PE32/PE32+ image"),
    }),
    options: z.object({
      maxFileBytes: inspectPeLoadConfigInputSchema.shape.max_file_bytes,
      maxCallbacks: inspectPeLoadConfigInputSchema.shape.max_callbacks,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const elf = createPeLoadConfigService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectPeLoadConfig,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                elf.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_callbacks: options.maxCallbacks,
                  },
                  { signal },
                ),
              elf,
              "rea-pe-load-config",
              "inspect_pe_load_config",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  const entropy = createByteEntropyService();
  cli.command(CLI_COMMANDS.inspectByteEntropy, {
    description:
      "Inspect file-wide and block byte entropy without executing the file",
    args: z.object({ path: localPathStringSchema.describe("Local file") }),
    options: z.object({
      blockSize: inspectByteEntropyInputSchema.shape.block_size.describe(
        "Power-of-two block size from 256 to 65536 bytes (default 4096)",
      ),
      offset: inspectByteEntropyInputSchema.shape.offset.describe(
        "Window start as a decimal file byte offset (default 0)",
      ),
      length: inspectByteEntropyInputSchema.shape.length.describe(
        "Window length in bytes; omit to extend through EOF",
      ),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectByteEntropy, async () => {
          return await finishCliEvidenceCommand(
            args.path,
            () =>
              entropy.inspect(
                {
                  path: absoluteCallerPath(args.path),
                  block_size: options.blockSize,
                  offset: options.offset,
                  length: options.length,
                },
                { signal },
              ),
            entropy,
            "rea-byte-entropy",
            "inspect_byte_entropy",
            signal,
          ).then(projectCliAnalysisResult);
        }),
      ),
  });
  cli.command(CLI_COMMANDS.inspectPeCertificates, {
    description:
      "Inspect PE Authenticode certificate table identities without verifying signatures",
    args: z.object({
      path: localPathStringSchema.describe("Local PE32/PE32+ image"),
    }),
    options: z.object({
      maxFileBytes: inspectPeCertificatesInputSchema.shape.max_file_bytes,
      maxEntries: inspectPeCertificatesInputSchema.shape.max_entries,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const pe = createPeCertificatesService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectPeCertificates,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                pe.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_entries: options.maxEntries,
                  },
                  { signal },
                ),
              pe,
              "rea-pe-certificates",
              "inspect_pe_certificates",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectPeImports, {
    description:
      "Inspect PE import and delay-load table identities without executing the image",
    args: z.object({
      path: localPathStringSchema.describe("Local PE32/PE32+ image"),
    }),
    options: z.object({
      maxFileBytes: inspectPeImportsInputSchema.shape.max_file_bytes,
      maxDlls: inspectPeImportsInputSchema.shape.max_dlls,
      maxFunctions: inspectPeImportsInputSchema.shape.max_functions,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const pe = createPeImportsService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectPeImports,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                pe.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_dlls: options.maxDlls,
                    max_functions: options.maxFunctions,
                  },
                  { signal },
                ),
              pe,
              "rea-pe-imports",
              "inspect_pe_imports",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectPeResources, {
    description:
      "Inspect PE resource identities, payload ranges, hashes and icon-group relationships",
    args: z.object({
      path: localPathStringSchema.describe("Local PE32/PE32+ image"),
    }),
    options: z.object({
      maxFileBytes: inspectPeResourcesInputSchema.shape.max_file_bytes,
      maxEntries: inspectPeResourcesInputSchema.shape.max_entries,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const pe = createPeResourcesService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectPeResources,
          async () =>
            finishCliEvidenceCommand(
              args.path,
              () =>
                pe.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_entries: options.maxEntries,
                  },
                  { signal },
                ),
              pe,
              "rea-pe-resources",
              "inspect_pe_resources",
              signal,
            ).then(projectCliAnalysisResult),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectDevicetree, {
    description: "Inspect a flattened devicetree blob without executing it",
    args: z.object({
      path: localPathStringSchema.describe("Local flattened devicetree image"),
    }),
    options: z.object({
      maxFileBytes: inspectDevicetreeInputSchema.shape.max_file_bytes.describe(
        "Maximum FDT file size in bytes (default 4194304)",
      ),
      maxNodes: inspectDevicetreeInputSchema.shape.max_nodes.describe(
        "Maximum number of device-tree nodes (default 8192)",
      ),
      maxProperties: inspectDevicetreeInputSchema.shape.max_properties.describe(
        "Maximum number of device-tree properties (default 32768)",
      ),
      maxDepth: inspectDevicetreeInputSchema.shape.max_depth.describe(
        "Maximum device-tree nesting depth (default 64)",
      ),
      ...analysisEvidenceDeliveryOptions,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const devicetree = createDevicetreeService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectDevicetree,
          async () =>
            deliverCliAnalysisEvidence({
              callerInputPath: args.path,
              run: () =>
                devicetree.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                    max_nodes: options.maxNodes,
                    max_properties: options.maxProperties,
                    max_depth: options.maxDepth,
                  },
                  { signal },
                ),
              service: devicetree,
              providerId: "rea-devicetree",
              operation: "inspect_devicetree",
              signal,
              detail: options.detail,
              evidenceOutput: options.evidence_output,
            }),
        );
      }),
  });
  cli.command(CLI_COMMANDS.inspectNativeExports, {
    description:
      "Inspect a PE or ELF image's export table without executing it",
    args: z.object({
      path: localPathStringSchema.describe("Local PE or ELF image"),
    }),
    options: z.object({
      maxFileBytes: inspectNativeExportsInputSchema.shape.max_file_bytes,
      ...analysisEvidenceDeliveryOptions,
    }),
    run: ({ args, options }) =>
      withCommandCancellation(async (signal) => {
        const exports = createNativeExportsService();
        return await logCliCommand(
          logger,
          CLI_COMMANDS.inspectNativeExports,
          async () =>
            deliverCliAnalysisEvidence({
              callerInputPath: args.path,
              run: () =>
                exports.inspect(
                  {
                    path: absoluteCallerPath(args.path),
                    max_file_bytes: options.maxFileBytes,
                  },
                  { signal },
                ),
              service: exports,
              providerId: "rea-native-exports",
              operation: "inspect_native_exports",
              signal,
              detail: options.detail,
              evidenceOutput: options.evidence_output,
            }),
        );
      }),
  });
  const service = createBinaryLayoutService(environment);
  cli.command(CLI_COMMANDS.inspectBinaryLayout, {
    description:
      "Inspect binary file/linked layout without executing the selected object",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local ELF binary or relocatable object",
      ),
    }),
    options: z.object({
      pwntoolsTimeoutMs:
        inspectBinaryLayoutInputSchema.shape.pwntools_timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectBinaryLayout, async () => {
          const result = await service.inspectAndClose(
            {
              path: absoluteCallerPath(args.path),
              ...(options.pwntoolsTimeoutMs === undefined
                ? {}
                : { pwntools_timeout_ms: options.pwntoolsTimeoutMs }),
            },
            { signal },
          );
          return result.ok
            ? withEvidenceCallerInputPath(result.value, args.path)
            : projectAnalysisError(result.error);
        }),
      ),
  });
  const recorded = createRecordedCrashService(environment);
  cli.command(CLI_COMMANDS.inspectRecordedCrash, {
    description:
      "Inspect supplied core registers/signals and optional debugger mapping evidence",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local Linux ELF64 amd64 or AArch64 little-endian core",
      ),
    }),
    options: z.object({
      debuggerContext: z
        .boolean()
        .default(false)
        .describe("Add BYO core-only GDB/pwndbg mapping candidates"),
      pwntoolsTimeoutMs:
        inspectRecordedCrashInputSchema.shape.pwntools_timeout_ms,
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectRecordedCrash, async () => {
          const result = await recorded.inspectAndClose(
            {
              path: absoluteCallerPath(args.path),
              include_debugger_context: options.debuggerContext,
              ...(options.pwntoolsTimeoutMs === undefined
                ? {}
                : { pwntools_timeout_ms: options.pwntoolsTimeoutMs }),
            },
            { signal },
          );
          return result.ok
            ? withEvidenceCallerInputPath(result.value, args.path)
            : projectAnalysisError(result.error);
        }),
      ),
  });
};
