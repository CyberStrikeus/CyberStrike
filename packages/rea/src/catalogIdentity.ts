import { createHash } from "node:crypto";

import canonicalize from "canonicalize";

import { contractsForToolFamilies } from "./contracts/toolFamilies.js";
import { promptsForToolFamilies } from "./contracts/promptToolFamilyScope.js";
import { PROMPT_CONTRACTS } from "./contracts/promptContracts.js";
import type { PromptContract } from "./contracts/promptContracts.js";
import { TOOL_CONTRACTS } from "./contracts/toolContracts.js";
import type { ToolContract } from "./contracts/toolContractTypes.js";
import { CLI_COMMAND_NAMES } from "./cliCommandNames.js";
import { compareUnicodeCodePoints } from "./domain/unicodeCodePointOrder.js";
import {
  advertisedInputJsonSchema,
  toolOutputSchemaWithMetadata,
} from "./contracts/toolSchemaMetadata.js";
import {
  presentAdvertisedInputSchema,
  type CompactInputSchemaPresentation,
} from "./contracts/compactInputSchema.js";
import {
  presentAdvertisedOutputSchema,
  type CompactOutputSchemaPresentation,
} from "./contracts/compactOutputSchema.js";
import {
  COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES,
  compactPresentationForMcpOutputSchemaProfile,
  type McpOutputSchemaProfile,
} from "./config/mcpOutputSchemaProfile.js";
import {
  COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
  compactPresentationForMcpInputSchemaProfile,
  type McpInputSchemaProfile,
} from "./config/mcpInputSchemaProfile.js";
import { RECORDED_CATALOG_DIGEST_PROFILES } from "./recordedCatalogDigests.js";

/**
 * Digested per-tool projection. Every contract field that changes what a
 * client receives belongs here, including `returns_target_content`: a server
 * that predates the untrusted-content framing must not digest equal to one
 * that emits `_meta.provenance`, or a stale process would report aligned.
 */
const createToolCatalog = (contracts: readonly ToolContract[]) =>
  contracts.map((contract) => ({
    name: contract.name,
    title: contract.title,
    surface: contract.kind,
    description: contract.description,
    effects: { ...contract.effects },
    returns_target_content: contract.returnsTargetContent,
    annotations: contract.annotations,
    input_schema: advertisedInputJsonSchema(contract),
    output_schema: toolOutputSchemaWithMetadata(contract)[
      "~standard"
    ].jsonSchema.output({ target: "draft-2020-12" }),
  }));

const presentToolCatalog = (
  catalog: ReturnType<typeof createToolCatalog>,
  presentation: CompactInputSchemaPresentation | undefined,
  outputPresentation: CompactOutputSchemaPresentation | undefined = undefined,
) =>
  presentation === undefined && outputPresentation === undefined
    ? catalog
    : catalog.map((tool) => ({
        ...tool,
        ...(presentation === undefined
          ? {}
          : {
              input_schema: presentAdvertisedInputSchema(
                tool.input_schema,
                presentation,
              ),
            }),
        ...(outputPresentation === undefined
          ? {}
          : {
              output_schema: presentAdvertisedOutputSchema(
                tool.output_schema,
                outputPresentation,
              ),
            }),
      }));

const createPromptCatalog = (contracts: readonly PromptContract[]) =>
  contracts
    .map((contract) => ({
      name: contract.name,
      title: contract.title,
      description: contract.description,
      objective: contract.objective,
      arguments: contract.arguments,
      steps: contract.steps,
    }))
    .sort((left, right) => compareUnicodeCodePoints(left.name, right.name));

const sortByName = (
  contracts: readonly ToolContract[],
): readonly ToolContract[] =>
  [...contracts].sort((left, right) =>
    compareUnicodeCodePoints(left.name, right.name),
  );

const digest = (value: unknown): string => {
  const encoded = canonicalize(value);
  if (encoded === undefined)
    throw new TypeError("Catalog is not canonical JSON");
  return createHash("sha256").update(encoded).digest("hex");
};

const digestCatalogs = (
  catalog: ReturnType<typeof createToolCatalog>,
  prompts: ReturnType<typeof createPromptCatalog>,
  outputSchemaProfile: McpOutputSchemaProfile,
) => {
  const tools = {
    output_schema_profile: outputSchemaProfile,
    catalog,
  };
  return {
    tools_sha256: digest(tools),
    prompts_sha256: digest(prompts),
    combined_sha256: digest({
      cli: CLI_COMMAND_NAMES,
      tools,
      prompts,
    }),
  } as const;
};

/**
 * Catalog digests over the given tool contracts. Exported so tests can prove
 * which contract fields the identity covers; production uses
 * {@link FULL_CATALOG_IDENTITY}.
 */
export const createCatalogDigests = (
  contracts: readonly ToolContract[] = TOOL_CONTRACTS,
  promptContracts: readonly PromptContract[] = PROMPT_CONTRACTS,
  compactPresentation: CompactInputSchemaPresentation | undefined = undefined,
  outputSchemaProfile: McpOutputSchemaProfile = "full",
) =>
  digestCatalogs(
    presentToolCatalog(
      createToolCatalog(sortByName(contracts)),
      compactPresentation,
      compactPresentationForMcpOutputSchemaProfile(outputSchemaProfile),
    ),
    createPromptCatalog(promptContracts),
    outputSchemaProfile,
  );

export type CatalogDigests = ReturnType<typeof digestCatalogs>;
export type CatalogDigestProfiles = Readonly<
  Record<
    McpInputSchemaProfile,
    Readonly<Record<McpOutputSchemaProfile, CatalogDigests>>
  >
>;

/** Build-time identities share schema conversion across the six supported profiles. */
export const createCatalogDigestProfiles = (
  contracts: readonly ToolContract[] = TOOL_CONTRACTS,
  promptContracts: readonly PromptContract[] = PROMPT_CONTRACTS,
): CatalogDigestProfiles => {
  const full = createToolCatalog(sortByName(contracts));
  const compact = presentToolCatalog(full, {
    budgetBytes: COMPACT_INPUT_SCHEMA_BUDGET_BYTES,
  });
  const prompts = createPromptCatalog(promptContracts);
  const compactOutput: CompactOutputSchemaPresentation = {
    budgetBytes: COMPACT_OUTPUT_SCHEMA_BUDGET_BYTES,
  };
  const outputProfiles = (catalog: typeof full) => ({
    full: digestCatalogs(catalog, prompts, "full"),
    compact: digestCatalogs(
      presentToolCatalog(catalog, undefined, compactOutput),
      prompts,
      "compact",
    ),
    off: digestCatalogs(catalog, prompts, "off"),
  });
  return { full: outputProfiles(full), compact: outputProfiles(compact) };
};

/** One catalog identity: advertised presentation, contract and prompt scope, output profile. */
export interface CatalogIdentityOptions {
  readonly compactPresentation?: CompactInputSchemaPresentation | undefined;
  readonly contracts?: readonly ToolContract[] | undefined;
  readonly outputSchemaProfile?: McpOutputSchemaProfile | undefined;
  readonly promptContracts?: readonly PromptContract[] | undefined;
}

export const createCatalogIdentity = (options: CatalogIdentityOptions = {}) => {
  const {
    compactPresentation,
    contracts = TOOL_CONTRACTS,
    outputSchemaProfile = "full",
    promptContracts = PROMPT_CONTRACTS,
  } = options;
  const selectedPresentation =
    compactPresentation === undefined
      ? undefined
      : { budgetBytes: compactPresentation.budgetBytes };
  // Only the exact built-in presentations have build-time identities. Source
  // runs and custom budgets still compute from their selected schemas lazily.
  const inputProfile =
    selectedPresentation === undefined
      ? "full"
      : selectedPresentation.budgetBytes === COMPACT_INPUT_SCHEMA_BUDGET_BYTES
        ? "compact"
        : undefined;
  // Recorded digests describe the complete default catalog only; a scoped tool
  // or prompt set always computes from its own inputs.
  let catalogDigests: CatalogDigests | undefined =
    inputProfile === undefined ||
    contracts !== TOOL_CONTRACTS ||
    promptContracts !== PROMPT_CONTRACTS
      ? undefined
      : RECORDED_CATALOG_DIGEST_PROFILES?.[inputProfile][outputSchemaProfile];
  return {
    counts: {
      cli_commands: CLI_COMMAND_NAMES.length,
      mcp_tools: contracts.length,
      mcp_prompts: promptContracts.length,
    },
    get digests() {
      return (catalogDigests ??= createCatalogDigests(
        contracts,
        promptContracts,
        selectedPresentation,
        outputSchemaProfile,
      ));
    },
  } as const;
};

/**
 * Full input/output advertisement identity. Digests are recorded at build time
 * or computed on first use; this is independent of the configured default.
 */
export const FULL_CATALOG_IDENTITY = createCatalogIdentity();

/** Default MCP advertisement; explicit full/custom selections have their own identity. */
export const DEFAULT_CATALOG_IDENTITY = createCatalogIdentity({
  compactPresentation: compactPresentationForMcpInputSchemaProfile(undefined),
});

/**
 * Identity whose digests cover exactly the contracts a registration advertises.
 * Composition reuses it when a deferred server attaches its runtime, so both
 * paths derive the same value from the same scope.
 */
export const catalogIdentityForToolFamilies = (
  compactPresentation: CompactInputSchemaPresentation | undefined,
  outputSchemaProfile: McpOutputSchemaProfile,
  advertisedToolFamilies: ReadonlySet<string> | undefined,
): ReturnType<typeof createCatalogIdentity> =>
  compactPresentation === undefined &&
  outputSchemaProfile === "full" &&
  advertisedToolFamilies === undefined
    ? FULL_CATALOG_IDENTITY
    : createCatalogIdentity({
        compactPresentation:
          compactPresentation === undefined
            ? undefined
            : { budgetBytes: compactPresentation.budgetBytes },
        contracts: contractsForToolFamilies(advertisedToolFamilies),
        outputSchemaProfile,
        promptContracts: promptsForToolFamilies(advertisedToolFamilies),
      });
