import { inspectGpuCodeObjectsInputSchema } from "../domain/gpu/gpuCodeObjects.js";
import { analysisInputErrorFromIssues } from "../domain/inputIssueProjection.js";
import { AnalysisInputError } from "../domain/analysisErrorCore.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { safeParseJson } from "../domain/safeJson.js";
import { z } from "incur";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { localPathStringSchema } from "../domain/localPath.js";
import { absoluteCallerPath } from "../filesystem/callerPath.js";
import { createGpuCodeObjectsService } from "../composition/gpu.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  analysisEvidenceDeliveryOptions,
  deliverCliAnalysisEvidence,
} from "./analysisEvidenceDelivery.js";

/** One-shot summaries export the same complete observations used by MCP retained pages. */
export const registerGpuCommands = (cli: CliInstance, logger: Logger): void => {
  cli.command(CLI_COMMANDS.inspectGpuCodeObjects, {
    description:
      "Inspect embedded CUDA/HIP targets and selected static kernel metadata",
    args: z.object({
      path: localPathStringSchema.describe(
        "Local ELF/PE, CUDA fatbin, CUBIN, PTX or HIP bundle",
      ),
    }),
    options: z.object({
      ...analysisEvidenceDeliveryOptions,
      view: z
        .string()
        .optional()
        .describe(
          "JSON GPU object/kernel/PTX page selection; requires --detail summary and --evidence_output",
        ),
      analysis: z
        .enum(["inventory", "kernels"])
        .default("inventory")
        .describe("Inventory GPU targets or decode selected kernel metadata"),
      expected_sha256: z
        .string()
        .optional()
        .describe("Inventory SHA-256; required with --object_ids"),
      object_ids: z
        .string()
        .optional()
        .describe("JSON array of exact object IDs to decode"),
      targets: z
        .string()
        .optional()
        .describe("JSON array of exact target declarations to decode"),
    }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.inspectGpuCodeObjects, async () => {
          const selectors: Partial<
            Record<"object_ids" | "targets" | "view", unknown>
          > = {};
          for (const name of ["object_ids", "targets", "view"] as const) {
            const value = options[name];
            if (value === undefined) continue;
            const decoded = safeParseJson(value);
            if (!decoded.ok) {
              return projectAnalysisError(
                new AnalysisInputError(
                  "inspect_gpu_code_objects",
                  { cause: decoded.cause },
                  [
                    {
                      path: [name],
                      reason: "invalid_format",
                      message: `${name} must be valid JSON`,
                    },
                  ],
                ),
              );
            }
            selectors[name] = decoded.value;
          }
          const rawInput = {
            path: absoluteCallerPath(args.path),
            analysis: options.analysis,
            ...(options.expected_sha256 === undefined
              ? {}
              : { expected_sha256: options.expected_sha256 }),
            ...selectors,
            detail: options.detail,
          };
          const selected = inspectGpuCodeObjectsInputSchema.safeParse(rawInput);
          if (!selected.success)
            return projectAnalysisError(
              analysisInputErrorFromIssues(
                "inspect_gpu_code_objects",
                selected.error.issues,
                rawInput,
              ),
            );
          const service = createGpuCodeObjectsService();
          return deliverCliAnalysisEvidence({
            callerInputPath: args.path,
            run: () =>
              service.inspect(
                {
                  path: selected.data.path,
                  analysis: selected.data.analysis,
                  ...(selected.data.expected_sha256 === undefined
                    ? {}
                    : { expected_sha256: selected.data.expected_sha256 }),
                  ...(selected.data.object_ids === undefined
                    ? {}
                    : { object_ids: selected.data.object_ids }),
                  ...(selected.data.targets === undefined
                    ? {}
                    : { targets: selected.data.targets }),
                  detail: "complete",
                },
                { signal },
              ),
            service,
            providerId: "gpu-code-objects",
            operation: "inspect_gpu_code_objects",
            signal,
            detail: options.detail,
            evidenceOutput: options.evidence_output,
            ...(selected.data.view === undefined
              ? {}
              : {
                  view: {
                    kind: "gpu-code-objects" as const,
                    ...selected.data.view,
                  },
                }),
          });
        }),
      ),
  });
};
