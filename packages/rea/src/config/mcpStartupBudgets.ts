import { positiveDecimalIntegerSchema } from "./positiveDecimalInteger.js";

import { ConfigurationError } from "../domain/configurationErrors.js";
import { err, ok, type Result } from "../domain/result.js";

/** Smallest phase budget. Zero is not a deadline, and Node's timer needs a positive delay. */
export const MCP_PHASE_BUDGET_FLOOR_MS = 1;

/**
 * Largest delay Node schedules exactly. A `setTimeout` delay above this
 * signed 32-bit bound is clamped to 1 ms, so a phase budget past it would
 * expire immediately. The setting stops here instead of growing without a bound.
 */
export const MCP_PHASE_BUDGET_MAXIMUM_MS = 2_147_483_647;

/** One MCP startup phase budget and where its effective milliseconds came from. */
export interface McpPhaseBudget {
  readonly setting: string;
  readonly phase: string;
  readonly milliseconds: number;
  readonly source: "default" | "setting";
  readonly defaultMilliseconds: number;
  readonly floorMilliseconds: number;
  readonly maximumMilliseconds: number;
}

/** Effective initialize, tools/list, first-catalog, and doctor budgets. */
export interface McpStartupBudgets {
  readonly initialize: McpPhaseBudget;
  readonly toolsList: McpPhaseBudget;
  readonly firstCatalog: McpPhaseBudget;
  readonly doctor: McpPhaseBudget;
}

interface McpPhaseBudgetDefinition {
  readonly key: keyof McpStartupBudgets;
  readonly setting: string;
  readonly phase: string;
  readonly defaultMilliseconds: number;
}

const PHASES = [
  {
    key: "initialize",
    setting: "REA_MCP_INITIALIZE_BUDGET_MS",
    phase: "MCP initialize phase budget",
    defaultMilliseconds: 15_000,
  },
  {
    key: "toolsList",
    setting: "REA_MCP_TOOLS_LIST_BUDGET_MS",
    phase: "MCP tools/list phase budget",
    defaultMilliseconds: 5_000,
  },
  {
    key: "firstCatalog",
    setting: "REA_MCP_FIRST_CATALOG_BUDGET_MS",
    phase: "MCP first-catalog phase budget",
    defaultMilliseconds: 20_000,
  },
  {
    key: "doctor",
    setting: "REA_MCP_DOCTOR_DEADLINE_MS",
    phase: "MCP doctor startup deadline",
    defaultMilliseconds: 30_000,
  },
] as const satisfies readonly McpPhaseBudgetDefinition[];

const phaseConstraint = (phase: McpPhaseBudgetDefinition): string =>
  `${phase.setting} must be a positive decimal integer from ${String(MCP_PHASE_BUDGET_FLOOR_MS)} to ${String(MCP_PHASE_BUDGET_MAXIMUM_MS)} ms; the default is ${String(phase.defaultMilliseconds)} ms. Node schedules a delay above that maximum as 1 ms, so a larger value is refused.`;

const phaseBudgetSchema = (phase: McpPhaseBudgetDefinition) =>
  positiveDecimalIntegerSchema(
    MCP_PHASE_BUDGET_FLOOR_MS,
    MCP_PHASE_BUDGET_MAXIMUM_MS,
    phaseConstraint(phase),
  );

/** Optional decimal millisecond count for the MCP initialize phase budget. */
export const mcpInitializeBudgetMsSchema = phaseBudgetSchema(PHASES[0]);

/** Optional decimal millisecond count for the MCP tools/list phase budget. */
export const mcpToolsListBudgetMsSchema = phaseBudgetSchema(PHASES[1]);

/** Optional decimal millisecond count for the MCP first-catalog phase budget. */
export const mcpFirstCatalogBudgetMsSchema = phaseBudgetSchema(PHASES[2]);

/** Optional decimal millisecond count for the MCP doctor startup deadline. */
export const mcpDoctorDeadlineMsSchema = phaseBudgetSchema(PHASES[3]);

const defaultBudget = (phase: McpPhaseBudgetDefinition): McpPhaseBudget => ({
  setting: phase.setting,
  phase: phase.phase,
  milliseconds: phase.defaultMilliseconds,
  source: "default",
  defaultMilliseconds: phase.defaultMilliseconds,
  floorMilliseconds: MCP_PHASE_BUDGET_FLOOR_MS,
  maximumMilliseconds: MCP_PHASE_BUDGET_MAXIMUM_MS,
});

const parsePhaseBudget = (
  phase: McpPhaseBudgetDefinition,
  value: string | undefined,
): Result<McpPhaseBudget, ConfigurationError> => {
  if (value === undefined) return ok(defaultBudget(phase));
  const parsed = phaseBudgetSchema(phase).safeParse(value);
  return parsed.success
    ? ok({
        setting: phase.setting,
        phase: phase.phase,
        milliseconds: parsed.data,
        source: "setting",
        defaultMilliseconds: phase.defaultMilliseconds,
        floorMilliseconds: MCP_PHASE_BUDGET_FLOOR_MS,
        maximumMilliseconds: MCP_PHASE_BUDGET_MAXIMUM_MS,
      })
    : err(
        new ConfigurationError(phaseConstraint(phase), {
          settings: [
            { setting: phase.setting, constraint: phaseConstraint(phase) },
          ],
        }),
      );
};

/**
 * Resolve every phase budget from one environment. Invalid values are
 * configuration errors and do not fall back to the defaults. Every invalid
 * setting is reported together.
 */
export const parseMcpStartupBudgets = (
  environment: Readonly<Record<string, string | undefined>>,
): Result<McpStartupBudgets, ConfigurationError> => {
  const issues: { setting: string; constraint: string }[] = [];
  const budgets = new Map<keyof McpStartupBudgets, McpPhaseBudget>();
  for (const phase of PHASES) {
    const parsed = parsePhaseBudget(phase, environment[phase.setting]);
    if (!parsed.ok) issues.push(...parsed.error.settings);
    else budgets.set(phase.key, parsed.value);
  }
  if (issues.length > 0)
    return err(
      new ConfigurationError(
        issues.map(({ constraint }) => constraint).join(" "),
        {
          settings: issues,
        },
      ),
    );
  const initialize = budgets.get("initialize");
  const toolsList = budgets.get("toolsList");
  const firstCatalog = budgets.get("firstCatalog");
  const doctor = budgets.get("doctor");
  if (
    initialize === undefined ||
    toolsList === undefined ||
    firstCatalog === undefined ||
    doctor === undefined
  )
    throw new Error("MCP startup budget resolution dropped a phase");
  return ok({ initialize, toolsList, firstCatalog, doctor });
};

/**
 * Resolve the budgets from a composition root's selected environment. An
 * invalid setting is refused, not ignored.
 */
export const resolveMcpStartupBudgets = (
  environment: Readonly<Record<string, string | undefined>>,
): McpStartupBudgets => {
  const parsed = parseMcpStartupBudgets(environment);
  if (!parsed.ok) throw parsed.error;
  return parsed.value;
};

/** How to read and change one MCP startup phase budget. */
export const mcpPhaseBudgetRecovery = (budget: McpPhaseBudget): string =>
  [
    `The effective ${budget.setting} value for the ${budget.phase} is ${String(budget.milliseconds)} ms (source ${budget.source}; default ${String(budget.defaultMilliseconds)} ms, floor ${String(budget.floorMilliseconds)} ms, maximum ${String(budget.maximumMilliseconds)} ms).`,
    `Set ${budget.setting} in the environment that starts REA to a positive decimal integer from ${String(budget.floorMilliseconds)} to ${String(budget.maximumMilliseconds)}, then restart REA.`,
  ].join(" ");
