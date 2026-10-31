import { z } from "incur";
import { ArtifactResourceScope } from "../artifacts/ArtifactResourceScope.js";
import {
  readGuidanceSection,
  searchGuidance,
} from "../application/GuidanceAccess.js";
import {
  readGuidanceSectionInputSchema,
  searchGuidanceLimitSchema,
  searchGuidanceInputSchema,
} from "../contracts/guidanceContracts.js";
import { CLI_COMMANDS } from "../cliCommandNames.js";
import { logCliCommand } from "../cliLogging.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import type { Logger } from "pino";
import type { CliInstance } from "./types.js";

/** Guidance descriptors owned by one CLI host. */
export class CliGuidanceResources {
  #retained: ArtifactResourceScope | undefined;

  resources(): ArtifactResourceScope {
    this.#retained ??= new ArtifactResourceScope();
    return this.#retained;
  }

  /** Release this host's descriptors, retaining failed cleanup for retry. */
  async close(): Promise<void> {
    const resources = this.#retained;
    if (resources === undefined) return;
    await resources.close();
    if (this.#retained === resources) this.#retained = undefined;
  }
}

/** Process CLI host used when a caller does not pass its own resources. */
const processGuidanceResources = new CliGuidanceResources();

/** Release CLI-owned guidance descriptors, retaining failed cleanup for retry. */
export const closeCliGuidanceResources = (
  resources: CliGuidanceResources = processGuidanceResources,
): Promise<void> => resources.close();

/** Register offline search and retrieval for the installed REA guide bundle. */
export const registerGuidanceCommands = (
  cli: CliInstance,
  logger: Logger,
  resources: CliGuidanceResources = processGuidanceResources,
): void => {
  cli.command(CLI_COMMANDS.guidance, {
    description: "Search or read the installed REA workflow guidance",
    args: z.object({}),
    options: z
      .object({
        action: z
          .enum(["search", "read"])
          .default("search")
          .describe("Guidance action to perform: search or read"),
        query: searchGuidanceInputSchema.shape.query
          .optional()
          .describe(
            "Required with search; all non-generic query words must match",
          ),
        locator: readGuidanceSectionInputSchema.shape.locator
          .optional()
          .describe("Required with --action read; locator returned by search"),
        limit: searchGuidanceLimitSchema
          .optional()
          .describe("Maximum search matches; search only, defaults to 8"),
        cursor: searchGuidanceInputSchema.shape.cursor
          .optional()
          .describe("Continue a search page; search only"),
      })
      .superRefine((options, context) => {
        if (options.action === "search") {
          if (options.query === undefined)
            context.addIssue({
              code: "custom",
              path: ["query"],
              message: "--query is required with --action search",
            });
          if (options.locator !== undefined)
            context.addIssue({
              code: "custom",
              path: ["locator"],
              message: "--locator can only be used with --action read",
            });
        } else {
          if (options.locator === undefined)
            context.addIssue({
              code: "custom",
              path: ["locator"],
              message: "--locator is required with --action read",
            });
          for (const option of ["query", "limit", "cursor"] as const)
            if (options[option] !== undefined)
              context.addIssue({
                code: "custom",
                path: [option],
                message: `--${option} can only be used with --action search`,
              });
        }
      }),
    run: ({ options }) =>
      logCliCommand(logger, CLI_COMMANDS.guidance, async () => {
        const result =
          options.action === "search"
            ? await searchGuidance(
                {
                  ...(options.query === undefined
                    ? {}
                    : { query: options.query }),
                  ...(options.limit === undefined
                    ? {}
                    : { limit: options.limit }),
                  ...(options.cursor === undefined
                    ? {}
                    : { cursor: options.cursor }),
                },
                resources.resources(),
              )
            : await readGuidanceSection(
                {
                  locator: options.locator,
                },
                resources.resources(),
              );
        return result.ok ? result.value : projectAnalysisError(result.error);
      }),
  });
};
