import { z } from "incur";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { compareSourceToBundleCliInputSchema } from "../contracts/javascript/applicationWorkflowInputContracts.js";
import { withCommandCancellation } from "./commandCancellation.js";
import {
  evidenceBundleOption,
  runEvidenceInputCommand,
} from "./evidenceInputCommand.js";

/** CLI file transport delegates graph authentication and comparison to the same owners as MCP. */
export const registerSourceToBundleCommand = (
  cli: CliInstance,
  logger: Logger,
): void => {
  const name = CLI_COMMANDS.compareSourceToBundle;
  cli.command(name, {
    description:
      "Compare historical source (inline graph or reference {kind:file,path}) with authenticated application Evidence. Save the complete JSON to query with inspect-analysis-view.",
    args: z.object({
      inputJson: z.string().describe("Inline workflow JSON or JSON file path"),
    }),
    options: z.object({ evidenceBundle: evidenceBundleOption }),
    run: ({ args, options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, name, async () => {
          const input = await parseCliJsonInput(args.inputJson, name, signal);
          if (!input.ok) return input.error;
          const result = await runEvidenceInputCommand(
            "compare_source_to_bundle",
            options.evidenceBundle,
            signal,
            async (lookup, resources) => {
              const { executeSourceToBundleComparison } =
                await import("../application/javascript/JavaScriptApplicationWorkflowService.js");
              const compared = await executeSourceToBundleComparison(
                input.value,
                compareSourceToBundleCliInputSchema,
                lookup,
                resources,
                { signal },
              );
              return compared.ok
                ? { ok: true, value: compared.value.evidence }
                : compared;
            },
          );
          return result.ok
            ? result.value
            : { error: "Application workflow failed", ...result.error };
        }),
      ),
  });
};
