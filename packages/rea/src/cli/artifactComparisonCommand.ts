import { z } from "incur";
import type { Logger } from "pino";

import {
  compareArtifactEvidence,
  resolveArtifactComparisonSources,
} from "../application/artifacts/ArtifactComparisonEvidence.js";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { parseCliJsonInput, resolveCliJsonPaths } from "../cliJsonInput.js";
import { logCliCommand } from "../cliLogging.js";
import { ARTIFACT_COMPARISON_PROVIDER } from "../domain/comparisonEvidenceIdentity.js";
import { withCommandCancellation } from "./commandCancellation.js";
import { finishAnalysisCommand } from "./finishAnalysisCommand.js";
import type { CliInstance } from "./types.js";

const OPERATION = "compare_artifacts";

/** Compare artifact inventories through the same source owners and workflow as MCP. */
export const registerArtifactComparisonCommand = (
  cli: CliInstance,
  logger: Logger,
): void => {
  const name = CLI_COMMANDS.compareArtifacts;
  cli.command(name, {
    description:
      'Compare two artifact inventories named as {left, right}: complete Evidence or {kind:"evidence-file",path,evidence_id?}. A one-shot command retains no session Evidence for retained-evidence references.',
    args: z.object({
      inputJson: z.string().describe("Inline workflow JSON or JSON file path"),
    }),
    run: ({ args }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, name, async () => {
          const input = await parseCliJsonInput(
            args.inputJson,
            OPERATION,
            signal,
          );
          if (!input.ok) return input.error;
          // Evidence-file paths are resolved against the operator's working directory.
          const value = resolveCliJsonPaths(input.value, [
            ["left", "path"],
            ["right", "path"],
          ]);
          const resources = new ArtifactResourceScope();
          const result = await finishAnalysisCommand(
            async () => {
              const sources = await resolveArtifactComparisonSources(
                value,
                undefined,
                { signal, resources },
              );
              if (!sources.ok) return sources;
              const compared = compareArtifactEvidence(sources.value);
              return compared.ok
                ? { ok: true as const, value: compared.value.evidence }
                : compared;
            },
            resources,
            ARTIFACT_COMPARISON_PROVIDER.id,
            OPERATION,
            signal,
          );
          return result.ok
            ? result.value
            : { error: "Application workflow failed", ...result.error };
        }),
      ),
  });
};
